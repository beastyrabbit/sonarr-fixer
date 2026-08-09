import { afterEach, describe, expect, it, vi } from "vitest";
import type { ManualImportCandidate, QueueItem, ResolutionProposal } from "../../shared/types.js";
import { SonarrClient } from "./sonarr-client.js";

const removalOptions = {
	removeFromClient: true,
	blocklist: true,
	skipRedownload: false,
	changeCategory: false,
};

function jsonResponse(body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status: 200,
		statusText: "OK",
		headers: { "Content-Type": "application/json" },
	});
}

function queueItem(overrides: Partial<QueueItem> = {}): QueueItem {
	return {
		id: 1,
		service: "sonarr",
		title: "Queue item",
		episodeIds: [],
		absoluteEpisodeNumbers: [],
		episodeLabels: [],
		statusMessages: [],
		canAnalyze: true,
		...overrides,
	};
}

describe("SonarrClient", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("loads system status for connection tests", async () => {
		const fetchMock = vi.fn(async () => jsonResponse({ version: "4.0.0", instanceName: "Series" }));
		vi.stubGlobal("fetch", fetchMock);

		const status = await new SonarrClient("http://sonarr.local/", "test-api-key").getSystemStatus();

		expect(status).toEqual({ version: "4.0.0", instanceName: "Series" });
		expect(fetchMock).toHaveBeenCalledWith(
			"http://sonarr.local/api/v3/system/status",
			expect.objectContaining({
				headers: expect.objectContaining({ "X-Api-Key": "test-api-key" }),
			}),
		);
	});

	it("handles an empty successful queue removal response", async () => {
		const fetchMock = vi.fn(async () => new Response("", { status: 200, statusText: "OK" }));
		vi.stubGlobal("fetch", fetchMock);

		const client = new SonarrClient("http://sonarr.local/", "test-api-key");
		const result = await client.removeQueueItem(42, removalOptions);

		expect(result).toEqual({ ok: true, message: "Removed queue item 42." });
		expect(fetchMock).toHaveBeenCalledWith(
			"http://sonarr.local/api/v3/queue/42?removeFromClient=true&blocklist=true&skipRedownload=false&changeCategory=false",
			expect.objectContaining({
				method: "DELETE",
				headers: expect.objectContaining({
					"Content-Type": "application/json",
					"X-Api-Key": "test-api-key",
				}),
			}),
		);
	});

	it("filters in-progress downloads out of the queue", async () => {
		const fetchMock = vi.fn(async () =>
			jsonResponse({
				records: [
					{
						id: 1,
						title: "Still downloading",
						status: "downloading",
						trackedDownloadStatus: "ok",
						trackedDownloadState: "downloading",
						downloadId: "download-1",
						size: 100,
						sizeleft: 50,
					},
					{
						id: 2,
						title: "Blocked import",
						status: "completed",
						trackedDownloadStatus: "warning",
						trackedDownloadState: "importBlocked",
						downloadId: "download-2",
						size: 100,
						sizeleft: 0,
					},
					{
						id: 3,
						title: "Warning but unfinished",
						status: "warning",
						trackedDownloadStatus: "warning",
						trackedDownloadState: "downloading",
						downloadId: "download-3",
						size: 100,
						sizeleft: 10,
					},
				],
			}),
		);
		vi.stubGlobal("fetch", fetchMock);

		const client = new SonarrClient("http://sonarr.local/", "test-api-key");
		const queue = await client.listQueue();

		expect(queue).toHaveLength(1);
		expect(queue[0]).toMatchObject({
			id: 2,
			canAnalyze: true,
			isInProgress: false,
		});
	});

	it("does not ask Sonarr for manual import candidates while a download is in progress", async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);

		const client = new SonarrClient("http://sonarr.local/", "test-api-key");
		const candidates = await client.getManualImportCandidates(
			queueItem({
				downloadId: "download-1",
				status: "downloading",
				trackedDownloadStatus: "warning",
				trackedDownloadState: "downloading",
				isInProgress: true,
			}),
		);

		expect(candidates).toEqual([]);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("loads manual import candidates for completed warning downloads", async () => {
		const fetchMock = vi.fn(async () =>
			jsonResponse([
				{
					path: "/downloads/show/episode.mkv",
					relativePath: "episode.mkv",
					name: "episode",
					size: 1_000_000_000,
					series: { id: 12, title: "Show" },
					episodes: [{ id: 34, seasonNumber: 1, episodeNumber: 2, title: "Episode" }],
					quality: { quality: { name: "WEBRip-720p" } },
					languages: [{ name: "English" }],
					customFormats: [{ id: 311, name: "German" }],
					customFormatScore: 100,
					downloadId: "download-2",
				},
			]),
		);
		vi.stubGlobal("fetch", fetchMock);

		const client = new SonarrClient("http://sonarr.local/", "test-api-key");
		const candidates = await client.getManualImportCandidates(
			queueItem({
				downloadId: "download-2",
				status: "completed",
				trackedDownloadStatus: "warning",
				trackedDownloadState: "importBlocked",
				isInProgress: false,
			}),
		);

		expect(candidates).toHaveLength(1);
		expect(candidates[0]).toMatchObject({
			path: "/downloads/show/episode.mkv",
			seriesId: 12,
			episodeIds: [34],
			customFormatLabels: ["German"],
			customFormatScore: 100,
		});
		expect(fetchMock).toHaveBeenCalledWith(
			"http://sonarr.local/api/v3/manualimport?downloadId=download-2&filterExistingFiles=false",
			expect.any(Object),
		);
	});

	it("falls back to folder manual import candidates when the downloadId query is empty", async () => {
		const fetchMock = vi.fn(async (url: string) => {
			if (url.endsWith("/api/v3/manualimport?downloadId=download-2&filterExistingFiles=false")) {
				return jsonResponse([]);
			}
			if (
				url.endsWith(
					"/api/v3/manualimport?folder=%2Fdownloads%2Fshow&downloadId=download-2&filterExistingFiles=false",
				)
			) {
				return jsonResponse([
					{
						path: "/downloads/show/episode.mkv",
						relativePath: "episode.mkv",
						name: "episode",
						series: { id: 12, title: "Show" },
						episodes: [{ id: 34, seasonNumber: 1, episodeNumber: 2, title: "Episode" }],
						quality: { quality: { name: "WEBRip-720p" } },
						languages: [{ name: "English" }],
						downloadId: "download-2",
					},
				]);
			}
			return new Response("not found", { status: 404, statusText: "Not Found" });
		});
		vi.stubGlobal("fetch", fetchMock);

		const client = new SonarrClient("http://sonarr.local/", "test-api-key");
		const candidates = await client.getManualImportCandidates(
			queueItem({
				downloadId: "download-2",
				outputPath: "/downloads/show",
				status: "completed",
				trackedDownloadStatus: "warning",
				trackedDownloadState: "importBlocked",
				isInProgress: false,
			}),
		);

		expect(candidates).toHaveLength(1);
		expect(candidates[0]).toMatchObject({
			path: "/downloads/show/episode.mkv",
			seriesId: 12,
			episodeIds: [34],
		});
		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(fetchMock).toHaveBeenNthCalledWith(
			1,
			"http://sonarr.local/api/v3/manualimport?downloadId=download-2&filterExistingFiles=false",
			expect.any(Object),
		);
		expect(fetchMock).toHaveBeenNthCalledWith(
			2,
			"http://sonarr.local/api/v3/manualimport?folder=%2Fdownloads%2Fshow&downloadId=download-2&filterExistingFiles=false",
			expect.any(Object),
		);
	});

	it("loads quality profiles and custom formats for AI upgrade checks", async () => {
		const fetchMock = vi.fn(async (url: string) => {
			if (url.endsWith("/api/v3/qualityprofile")) {
				return jsonResponse([{ id: 1, name: "720p", minUpgradeFormatScore: 1 }]);
			}
			if (url.endsWith("/api/v3/customformat")) {
				return jsonResponse([{ id: 311, name: "German" }]);
			}
			return new Response("not found", { status: 404, statusText: "Not Found" });
		});
		vi.stubGlobal("fetch", fetchMock);

		const client = new SonarrClient("http://sonarr.local/", "test-api-key");

		await expect(client.getQualityProfiles()).resolves.toEqual([
			{ id: 1, name: "720p", minUpgradeFormatScore: 1 },
		]);
		await expect(client.getCustomFormats()).resolves.toEqual([{ id: 311, name: "German" }]);
	});

	function importCandidate(overrides: Partial<ManualImportCandidate> = {}): ManualImportCandidate {
		return {
			id: "candidate_1",
			service: "sonarr",
			path: "/downloads/Show.S01E01/Show.S01E01.mkv",
			seriesId: 5,
			episodeIds: [101],
			absoluteEpisodeNumbers: [],
			episodeLabels: ["S01E01"],
			quality: { quality: { name: "WEBDL-1080p" } },
			languages: [{ name: "English" }],
			languageLabels: ["English"],
			rejections: [],
			isLikelySample: false,
			...overrides,
		};
	}

	function importProposal(): ResolutionProposal {
		return {
			action: "import_candidates",
			confidence: 0.9,
			selectedCandidateIds: ["candidate_1"],
			selectedImports: [{ candidateId: "candidate_1", episodeIds: [101] }],
			sampleCandidateIds: [],
			reason: "Fallback import.",
			issueSummary: "Import blocked by Sonarr.",
			evidence: [],
			warnings: [],
		};
	}

	it("blocks imports that would replace a German-audio file with a non-German candidate", async () => {
		const fetchMock = vi.fn(async (url: string) => {
			if (String(url).includes("/api/v3/episode?")) {
				return jsonResponse([
					{
						id: 101,
						episodeFile: {
							relativePath: "Season 01/Show - S01E01 [German DL].mkv",
							languages: [{ name: "German" }, { name: "English" }],
						},
					},
				]);
			}
			return new Response("not found", { status: 404, statusText: "Not Found" });
		});
		vi.stubGlobal("fetch", fetchMock);

		const result = await new SonarrClient("http://sonarr.local/", "api-key").applyImportProposal(
			queueItem({ episodeIds: [101] }),
			[importCandidate()],
			importProposal(),
		);

		expect(result.ok).toBe(false);
		expect(result.message).toContain("Blocked language downgrade");
		expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/api/v3/command"))).toBe(false);
	});

	it("imports a non-German candidate when the existing file also lacks German", async () => {
		const fetchMock = vi.fn(async (url: string) => {
			if (String(url).includes("/api/v3/episode?")) {
				return jsonResponse([
					{
						id: 101,
						episodeFile: { relativePath: "Season 01/old.mkv", languages: [{ name: "English" }] },
					},
				]);
			}
			if (String(url).endsWith("/api/v3/command")) {
				return jsonResponse({ id: 55 });
			}
			return new Response("not found", { status: 404, statusText: "Not Found" });
		});
		vi.stubGlobal("fetch", fetchMock);

		const result = await new SonarrClient("http://sonarr.local/", "api-key").applyImportProposal(
			queueItem({ episodeIds: [101] }),
			[importCandidate()],
			importProposal(),
		);

		expect(result).toMatchObject({ ok: true, commandId: 55 });
	});

	it("skips the existing-file lookup when the candidate includes German", async () => {
		const fetchMock = vi.fn(async (url: string) => {
			if (String(url).endsWith("/api/v3/command")) {
				return jsonResponse({ id: 56 });
			}
			return new Response("not found", { status: 404, statusText: "Not Found" });
		});
		vi.stubGlobal("fetch", fetchMock);

		const result = await new SonarrClient("http://sonarr.local/", "api-key").applyImportProposal(
			queueItem({ episodeIds: [101] }),
			[
				importCandidate({
					languages: [{ name: "German" }, { name: "English" }],
					languageLabels: ["German", "English"],
				}),
			],
			importProposal(),
		);

		expect(result).toMatchObject({ ok: true, commandId: 56 });
		expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/api/v3/episode?"))).toBe(false);
	});
});
