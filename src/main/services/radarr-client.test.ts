import { afterEach, describe, expect, it, vi } from "vitest";
import type { QueueItem, ResolutionProposal } from "../../shared/types.js";
import { RadarrClient } from "./radarr-client.js";

function jsonResponse(body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status: 200,
		statusText: "OK",
		headers: { "Content-Type": "application/json" },
	});
}

function queueItem(overrides: Partial<QueueItem> = {}): QueueItem {
	return {
		id: 9,
		service: "radarr",
		title: "Arrival.2016",
		movieId: 42,
		movieTitle: "Arrival",
		movieYear: 2016,
		downloadId: "download-9",
		status: "completed",
		trackedDownloadStatus: "warning",
		trackedDownloadState: "importBlocked",
		isInProgress: false,
		episodeIds: [42],
		absoluteEpisodeNumbers: [],
		episodeLabels: ["Arrival (2016)"],
		statusMessages: ["Not an upgrade for existing movie file"],
		canAnalyze: true,
		...overrides,
	};
}

describe("RadarrClient", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("loads system status for connection tests", async () => {
		const fetchMock = vi.fn(async () => jsonResponse({ version: "5.1.0", instanceName: "Movies" }));
		vi.stubGlobal("fetch", fetchMock);

		const status = await new RadarrClient("http://radarr.local/", "api-key").getSystemStatus();

		expect(status).toEqual({ version: "5.1.0", instanceName: "Movies" });
		expect(fetchMock).toHaveBeenCalledWith(
			"http://radarr.local/api/v3/system/status",
			expect.objectContaining({
				headers: expect.objectContaining({ "X-Api-Key": "api-key" }),
			}),
		);
	});

	it("normalizes completed Radarr movie queue items", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () =>
				jsonResponse({
					records: [
						{
							id: 9,
							title: "Arrival.2016",
							movieId: 42,
							movie: { id: 42, title: "Arrival", year: 2016 },
							status: "completed",
							trackedDownloadStatus: "warning",
							trackedDownloadState: "importBlocked",
							downloadId: "download-9",
							size: 100,
							sizeleft: 0,
						},
					],
				}),
			),
		);

		const queue = await new RadarrClient("http://radarr.local/", "api-key").listQueue();

		expect(queue).toHaveLength(1);
		expect(queue[0]).toMatchObject({
			service: "radarr",
			movieId: 42,
			movieTitle: "Arrival",
			movieYear: 2016,
			episodeIds: [42],
			canAnalyze: true,
		});
	});

	it("loads Radarr manual import candidates with movie metadata", async () => {
		const fetchMock = vi.fn(async () =>
			jsonResponse([
				{
					path: "/downloads/Arrival.2016/Arrival.2016.German.mkv",
					name: "Arrival.2016.German",
					size: 8_000_000_000,
					movie: { id: 42, title: "Arrival", year: 2016 },
					quality: { quality: { name: "Bluray-1080p" } },
					languages: [{ name: "German" }],
					customFormats: [{ id: 1, name: "German" }],
					customFormatScore: 100,
					downloadId: "download-9",
				},
			]),
		);
		vi.stubGlobal("fetch", fetchMock);

		const candidates = await new RadarrClient("http://radarr.local/", "api-key").getManualImportCandidates(
			queueItem(),
		);

		expect(candidates[0]).toMatchObject({
			service: "radarr",
			movieId: 42,
			movieTitle: "Arrival",
			movieYear: 2016,
			qualityLabel: "Bluray-1080p",
			languageLabels: ["German"],
		});
		expect(fetchMock).toHaveBeenCalledWith(
			"http://radarr.local/api/v3/manualimport?downloadId=download-9&filterExistingFiles=false",
			expect.any(Object),
		);
	});

	it("starts a Radarr ManualImport command with a movie id mapping", async () => {
		const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
			if (url.endsWith("/api/v3/command")) {
				return jsonResponse({ id: 88 });
			}
			return new Response("not found", { status: 404, statusText: "Not Found" });
		});
		vi.stubGlobal("fetch", fetchMock);
		const candidate = {
			id: "candidate_1",
			service: "radarr" as const,
			path: "/downloads/Arrival.2016/Arrival.mkv",
			movieId: 42,
			movieTitle: "Arrival",
			movieYear: 2016,
			episodeIds: [42],
			absoluteEpisodeNumbers: [],
			episodeLabels: ["Arrival (2016)"],
			quality: { quality: { name: "Bluray-1080p" } },
			languages: [{ name: "German" }],
			languageLabels: ["German"],
			rejections: [],
			downloadId: "download-9",
			isLikelySample: false,
		};
		const proposal: ResolutionProposal = {
			action: "import_candidates",
			confidence: 0.98,
			selectedCandidateIds: ["candidate_1"],
			selectedImports: [{ candidateId: "candidate_1", episodeIds: [], movieId: 42 }],
			sampleCandidateIds: [],
			reason: "The feature file matches Arrival.",
			issueSummary: "Radarr could not import automatically.",
			evidence: ["The parsed movie id is 42."],
			warnings: [],
		};

		const result = await new RadarrClient("http://radarr.local/", "api-key").applyImportProposal(
			queueItem(),
			[candidate],
			proposal,
		);

		expect(result).toMatchObject({ ok: true, commandId: 88 });
		const request = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/api/v3/command"));
		expect(JSON.parse(String(request?.[1]?.body))).toMatchObject({
			name: "ManualImport",
			files: [{ movieId: 42, path: candidate.path, downloadId: "download-9" }],
		});
	});

	it("blocks a non-German import that would replace a German-audio movie file", async () => {
		const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
			if (url.endsWith("/api/v3/movie/42")) {
				return jsonResponse({
					id: 42,
					movieFile: {
						relativePath: "Arrival (2016) German DL.mkv",
						languages: [{ name: "German" }, { name: "English" }],
					},
				});
			}
			if (url.endsWith("/api/v3/command")) {
				return jsonResponse({ id: 89 });
			}
			return new Response("not found", { status: 404, statusText: "Not Found" });
		});
		vi.stubGlobal("fetch", fetchMock);
		const candidate = {
			id: "candidate_1",
			service: "radarr" as const,
			path: "/downloads/Arrival.2016/Arrival.mkv",
			movieId: 42,
			movieTitle: "Arrival",
			movieYear: 2016,
			episodeIds: [42],
			absoluteEpisodeNumbers: [],
			episodeLabels: ["Arrival (2016)"],
			quality: { quality: { name: "Bluray-1080p" } },
			languages: [{ name: "English" }],
			languageLabels: ["English"],
			rejections: [],
			downloadId: "download-9",
			isLikelySample: false,
		};
		const proposal: ResolutionProposal = {
			action: "import_candidates",
			confidence: 0.98,
			selectedCandidateIds: ["candidate_1"],
			selectedImports: [{ candidateId: "candidate_1", episodeIds: [], movieId: 42 }],
			sampleCandidateIds: [],
			reason: "English fallback import.",
			issueSummary: "Radarr could not import automatically.",
			evidence: [],
			warnings: [],
		};

		const result = await new RadarrClient("http://radarr.local/", "api-key").applyImportProposal(
			queueItem(),
			[candidate],
			proposal,
		);

		expect(result.ok).toBe(false);
		expect(result.message).toContain("Blocked language downgrade");
		expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/api/v3/command"))).toBe(false);
	});
});
