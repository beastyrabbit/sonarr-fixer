import type {
	ApplyResult,
	ManualImportCandidate,
	QueueItem,
	QueueRemovalOptions,
	ResolutionProposal,
	SonarrSystemStatus,
} from "../../shared/types.js";
import { detectLikelySample } from "./sample.js";
import { normalizeProposal, resolveImportEpisodeIds, validateProposalForImport } from "./validation.js";

class SonarrRequestError extends Error {
	constructor(
		message: string,
		readonly status: number,
		readonly statusText: string,
		readonly body: string,
		readonly path: string,
	) {
		super(message);
		this.name = "SonarrRequestError";
	}
}

type SonarrPaged<T> = {
	records?: T[];
	totalRecords?: number;
};

type SonarrQueueRecord = {
	id: number;
	title?: string;
	size?: number;
	status?: string;
	trackedDownloadStatus?: string;
	trackedDownloadState?: string;
	outputPath?: string;
	downloadId?: string;
	added?: string;
	seriesId?: number;
	series?: {
		id?: number;
		title?: string;
	};
	episode?: SonarrEpisodeRecord;
	episodes?: SonarrEpisodeRecord[];
	statusMessages?: Array<{ title?: string; messages?: string[] }>;
	errorMessage?: string;
};

export type SonarrEpisodeRecord = {
	id?: number;
	seriesId?: number;
	title?: string;
	seasonNumber?: number;
	episodeNumber?: number;
	absoluteEpisodeNumber?: number;
	sceneAbsoluteEpisodeNumber?: number;
	sceneEpisodeNumber?: number;
	sceneSeasonNumber?: number;
	hasFile?: boolean;
	monitored?: boolean;
};

type SonarrManualImportRecord = {
	path?: string;
	relativePath?: string;
	folderName?: string;
	name?: string;
	size?: number;
	series?: { id?: number; title?: string };
	seasonNumber?: number;
	episodes?: SonarrEpisodeRecord[];
	quality?: unknown;
	languages?: unknown[];
	releaseGroup?: string;
	indexerFlags?: number;
	releaseType?: string;
	rejections?: Array<string | { reason?: string; message?: string }>;
	downloadId?: string;
};

type ManualImportCommandFile = {
	path: string;
	folderName?: string;
	seriesId: number;
	episodeIds: number[];
	quality: unknown;
	languages: unknown[];
	releaseGroup?: string;
	indexerFlags?: number;
	releaseType?: string;
	downloadId?: string;
};

function joinUrl(baseUrl: string, path: string): string {
	const cleanBase = baseUrl.replace(/\/+$/, "");
	const cleanPath = path.startsWith("/") ? path : `/${path}`;
	return `${cleanBase}${cleanPath}`;
}

function appendQuery(path: string, params: Record<string, string | number | boolean | undefined>): string {
	const urlParams = new URLSearchParams();
	for (const [key, value] of Object.entries(params)) {
		if (value !== undefined && value !== "") {
			urlParams.set(key, String(value));
		}
	}
	const query = urlParams.toString();
	return query ? `${path}?${query}` : path;
}

function episodeLabel(episode: SonarrEpisodeRecord): string {
	const season =
		typeof episode.seasonNumber === "number" ? `S${String(episode.seasonNumber).padStart(2, "0")}` : "";
	const number =
		typeof episode.episodeNumber === "number"
			? `E${String(episode.episodeNumber).padStart(2, "0")}`
			: episode.absoluteEpisodeNumber
				? `A${episode.absoluteEpisodeNumber}`
				: "";
	const prefix = [season, number].filter(Boolean).join("");
	return [prefix, episode.title].filter(Boolean).join(" - ") || `Episode ${episode.id ?? "unknown"}`;
}

function qualityLabel(quality: unknown): string | undefined {
	if (!quality || typeof quality !== "object") {
		return undefined;
	}
	const record = quality as Record<string, unknown>;
	const nested = record.quality;
	if (nested && typeof nested === "object" && "name" in nested) {
		return String((nested as { name?: unknown }).name ?? "");
	}
	if ("name" in record) {
		return String(record.name ?? "");
	}
	return undefined;
}

function languageLabel(language: unknown): string {
	if (!language || typeof language !== "object") {
		return String(language);
	}
	const record = language as Record<string, unknown>;
	return String(record.name ?? record.language?.toString() ?? JSON.stringify(language));
}

function rejectionLabel(rejection: string | { reason?: string; message?: string }): string {
	if (typeof rejection === "string") {
		return rejection;
	}
	return rejection.reason ?? rejection.message ?? JSON.stringify(rejection);
}

function normalizeQueueRecord(record: SonarrQueueRecord): QueueItem {
	const episodes = record.episodes?.length ? record.episodes : record.episode ? [record.episode] : [];
	const episodeIds: number[] = [];
	const absoluteEpisodeNumbers: number[] = [];
	for (const episode of episodes) {
		if (typeof episode.id === "number") {
			episodeIds.push(episode.id);
		}
		if (typeof episode.absoluteEpisodeNumber === "number") {
			absoluteEpisodeNumbers.push(episode.absoluteEpisodeNumber);
		}
	}
	const episodeLabels = episodes.map(episodeLabel);
	const seasonEpisodeParts: string[] = [];
	for (const episode of episodes) {
		if (typeof episode.seasonNumber === "number" && typeof episode.episodeNumber === "number") {
			seasonEpisodeParts.push(
				`S${String(episode.seasonNumber).padStart(2, "0")}E${String(episode.episodeNumber).padStart(2, "0")}`,
			);
		}
	}
	const seasonEpisode = seasonEpisodeParts.join(", ");
	const statusMessages: string[] = [];
	for (const message of record.statusMessages ?? []) {
		if (message.title) {
			statusMessages.push(message.title);
		}
		for (const statusMessage of message.messages ?? []) {
			if (statusMessage) {
				statusMessages.push(statusMessage);
			}
		}
	}
	if (record.errorMessage) {
		statusMessages.push(record.errorMessage);
	}

	const trackedDownloadStatus = record.trackedDownloadStatus;
	const status = record.status;
	const canAnalyze =
		Boolean(record.downloadId) && status === "completed" && trackedDownloadStatus === "warning";

	return {
		id: record.id,
		title: record.title ?? record.series?.title ?? `Queue item ${record.id}`,
		seriesId: record.seriesId ?? record.series?.id,
		seriesTitle: record.series?.title,
		downloadId: record.downloadId,
		status,
		trackedDownloadStatus,
		trackedDownloadState: record.trackedDownloadState,
		size: record.size,
		outputPath: record.outputPath,
		episodeIds,
		absoluteEpisodeNumbers,
		episodeLabels,
		seasonEpisode: seasonEpisode || undefined,
		statusMessages,
		canAnalyze,
		addedAt: record.added,
	};
}

function normalizeManualImportRecord(record: SonarrManualImportRecord, index: number): ManualImportCandidate {
	const episodes = record.episodes ?? [];
	const episodeIds: number[] = [];
	const absoluteEpisodeNumbers: number[] = [];
	for (const episode of episodes) {
		if (typeof episode.id === "number") {
			episodeIds.push(episode.id);
		}
		if (typeof episode.absoluteEpisodeNumber === "number") {
			absoluteEpisodeNumbers.push(episode.absoluteEpisodeNumber);
		}
	}
	const sample = detectLikelySample({
		path: record.path,
		relativePath: record.relativePath,
		name: record.name,
		size: record.size,
	});

	return {
		id: `candidate_${index + 1}`,
		path: record.path ?? "",
		relativePath: record.relativePath,
		folderName: record.folderName,
		name: record.name,
		size: record.size,
		seriesId: record.series?.id,
		seriesTitle: record.series?.title,
		seasonNumber: record.seasonNumber,
		episodeIds,
		absoluteEpisodeNumbers,
		episodeLabels: episodes.map(episodeLabel),
		quality: record.quality,
		qualityLabel: qualityLabel(record.quality),
		languages: record.languages ?? [],
		languageLabels: (record.languages ?? []).map(languageLabel),
		releaseGroup: record.releaseGroup,
		indexerFlags: record.indexerFlags,
		releaseType: record.releaseType,
		rejections: (record.rejections ?? []).map(rejectionLabel),
		downloadId: record.downloadId,
		...sample,
	};
}

function normalizeManualImportRecords(records: SonarrManualImportRecord[]): ManualImportCandidate[] {
	const candidates: ManualImportCandidate[] = [];
	for (const [index, record] of records.entries()) {
		const candidate = normalizeManualImportRecord(record, index);
		if (candidate.path) {
			candidates.push(candidate);
		}
	}
	return candidates;
}

export class SonarrClient {
	constructor(
		private readonly baseUrl: string,
		private readonly apiKey: string,
	) {}

	private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
		const response = await fetch(joinUrl(this.baseUrl, path), {
			...init,
			headers: {
				"Content-Type": "application/json",
				"X-Api-Key": this.apiKey,
				...(init.headers ?? {}),
			},
		});

		if (!response.ok) {
			const text = await response.text().catch(() => "");
			throw new SonarrRequestError(
				`Sonarr ${response.status} ${response.statusText}: ${text || path}`,
				response.status,
				response.statusText,
				text,
				path,
			);
		}

		if (response.status === 204) {
			return undefined as T;
		}

		const text = await response.text();
		if (!text.trim()) {
			return undefined as T;
		}
		return JSON.parse(text) as T;
	}

	async getSystemStatus(): Promise<SonarrSystemStatus> {
		return this.request<SonarrSystemStatus>("/api/v3/system/status");
	}

	async getEpisodes({
		seriesId,
		seasonNumber,
		episodeIds,
		includeSeries = false,
		includeEpisodeFile = false,
	}: {
		seriesId?: number;
		seasonNumber?: number;
		episodeIds?: number[];
		includeSeries?: boolean;
		includeEpisodeFile?: boolean;
	}): Promise<SonarrEpisodeRecord[]> {
		const params = new URLSearchParams();
		if (seriesId !== undefined) {
			params.set("seriesId", String(seriesId));
		}
		if (seasonNumber !== undefined) {
			params.set("seasonNumber", String(seasonNumber));
		}
		for (const episodeId of episodeIds ?? []) {
			params.append("episodeIds", String(episodeId));
		}
		params.set("includeSeries", String(includeSeries));
		params.set("includeEpisodeFile", String(includeEpisodeFile));
		return this.request<SonarrEpisodeRecord[]>(`/api/v3/episode?${params.toString()}`);
	}

	async listQueue(): Promise<QueueItem[]> {
		const response = await this.request<SonarrPaged<SonarrQueueRecord>>(
			appendQuery("/api/v3/queue", {
				page: 1,
				pageSize: 500,
				sortKey: "timeleft",
				sortDirection: "ascending",
				includeUnknownSeriesItems: true,
				includeSeries: true,
				includeEpisode: true,
			}),
		);
		return (response.records ?? []).map(normalizeQueueRecord);
	}

	async getManualImportCandidates(queueItem: QueueItem): Promise<ManualImportCandidate[]> {
		if (!queueItem.downloadId) {
			return [];
		}

		const query = new URLSearchParams();
		query.append("downloadIds", queueItem.downloadId);
		query.set("filterExistingFiles", "false");

		try {
			const records = await this.request<SonarrManualImportRecord[]>(
				`/api/v5/manualimport?${query.toString()}`,
			);
			return normalizeManualImportRecords(records);
		} catch (error) {
			if (!(error instanceof SonarrRequestError) || ![404, 405].includes(error.status)) {
				throw error;
			}
			if (!queueItem.outputPath) {
				throw error;
			}
			const path = appendQuery("/api/v3/manualimport", {
				folder: queueItem.outputPath,
				downloadId: queueItem.downloadId,
				filterExistingFiles: false,
			});
			const records = await this.request<SonarrManualImportRecord[]>(path);
			return normalizeManualImportRecords(records);
		}
	}

	private async getKnownEpisodeIds(
		queueItem: QueueItem,
		candidates: ManualImportCandidate[],
	): Promise<number[]> {
		const ids = new Set<number>([
			...queueItem.episodeIds,
			...candidates.flatMap((candidate) => candidate.episodeIds),
		]);
		if (queueItem.seriesId) {
			try {
				for (const episode of await this.getEpisodes({ seriesId: queueItem.seriesId })) {
					if (typeof episode.id === "number") {
						ids.add(episode.id);
					}
				}
			} catch {
				// Validation can still use the queue and candidate ids if the wider series lookup fails.
			}
		}
		return [...ids];
	}

	async applyImportProposal(
		queueItem: QueueItem,
		candidates: ManualImportCandidate[],
		proposal: ResolutionProposal,
	): Promise<ApplyResult> {
		const normalizedProposal = normalizeProposal(proposal);
		const knownEpisodeIds = await this.getKnownEpisodeIds(queueItem, candidates);
		const validation = validateProposalForImport(candidates, normalizedProposal, queueItem, knownEpisodeIds);
		if (!validation.ok) {
			return {
				ok: false,
				message: validation.issues.map((issue) => issue.message).join(" "),
			};
		}

		if (normalizedProposal.action !== "import_candidates") {
			return { ok: false, message: `Proposal action ${normalizedProposal.action} is not an import.` };
		}

		const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
		const files: ManualImportCommandFile[] = normalizedProposal.selectedCandidateIds.map((candidateId) => {
			const candidate = byId.get(candidateId);
			if (!candidate) {
				throw new Error(`Unknown candidate id ${candidateId}`);
			}

			if (!candidate.seriesId || !candidate.quality || candidate.languages.length === 0) {
				throw new Error(`Candidate ${candidateId} is missing Sonarr import fields.`);
			}

			return {
				path: candidate.path,
				folderName: candidate.folderName,
				seriesId: candidate.seriesId,
				episodeIds: resolveImportEpisodeIds(normalizedProposal, candidateId),
				quality: candidate.quality,
				languages: candidate.languages,
				releaseGroup: candidate.releaseGroup,
				indexerFlags: candidate.indexerFlags,
				releaseType: candidate.releaseType,
				downloadId: candidate.downloadId ?? queueItem.downloadId,
			};
		});

		const command = await this.request<{ id?: number }>("/api/v3/command", {
			method: "POST",
			body: JSON.stringify({
				name: "ManualImport",
				files,
				importMode: "auto",
				priority: "high",
			}),
		});

		return {
			ok: true,
			commandId: command.id,
			message: command.id
				? `Started Sonarr ManualImport command ${command.id}.`
				: "Started Sonarr ManualImport.",
		};
	}

	async removeQueueItem(queueItemId: number, options: QueueRemovalOptions): Promise<ApplyResult> {
		await this.request<void>(
			appendQuery(`/api/v3/queue/${queueItemId}`, {
				removeFromClient: options.removeFromClient,
				blocklist: options.blocklist,
				skipRedownload: options.skipRedownload,
				changeCategory: options.changeCategory,
			}),
			{ method: "DELETE" },
		);
		return { ok: true, message: `Removed queue item ${queueItemId}.` };
	}
}
