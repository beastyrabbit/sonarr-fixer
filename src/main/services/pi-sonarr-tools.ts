import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { ManualImportCandidate, QueueItem } from "../../shared/types.js";
import type { SonarrClient, SonarrEpisodeRecord } from "./sonarr-client.js";

type SonarrToolEvent = {
	type: "info" | "warning" | "error" | "pi" | "sonarr";
	itemId?: number;
	message: string;
	details?: unknown;
};

type EmitEvent = (event: SonarrToolEvent) => void;

interface CreateSonarrLookupToolsInput {
	client: SonarrClient;
	queueItem: QueueItem;
	getCandidates: () => ManualImportCandidate[];
	refreshCandidates?: () => Promise<ManualImportCandidate[]>;
	rememberEpisodeIds?: (episodeIds: number[]) => void;
	emit?: EmitEvent;
}

function compactCandidate(candidate: ManualImportCandidate) {
	return {
		id: candidate.id,
		path: candidate.path,
		relativePath: candidate.relativePath,
		folderName: candidate.folderName,
		name: candidate.name,
		size: candidate.size,
		seriesId: candidate.seriesId,
		seriesTitle: candidate.seriesTitle,
		episodeIds: candidate.episodeIds,
		absoluteEpisodeNumbers: candidate.absoluteEpisodeNumbers,
		episodeLabels: candidate.episodeLabels,
		quality: candidate.qualityLabel,
		languages: candidate.languageLabels,
		releaseGroup: candidate.releaseGroup,
		rejections: candidate.rejections,
		isLikelySample: candidate.isLikelySample,
		sampleReason: candidate.sampleReason,
	};
}

function compactEpisode(episode: SonarrEpisodeRecord) {
	return {
		id: episode.id,
		seriesId: episode.seriesId,
		seasonNumber: episode.seasonNumber,
		episodeNumber: episode.episodeNumber,
		absoluteEpisodeNumber: episode.absoluteEpisodeNumber,
		sceneSeasonNumber: episode.sceneSeasonNumber,
		sceneEpisodeNumber: episode.sceneEpisodeNumber,
		sceneAbsoluteEpisodeNumber: episode.sceneAbsoluteEpisodeNumber,
		title: episode.title,
		hasFile: episode.hasFile,
		monitored: episode.monitored,
		label: episodeLabel(episode),
	};
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

function episodeNumbers(episode: SonarrEpisodeRecord): number[] {
	return [episode.absoluteEpisodeNumber, episode.sceneAbsoluteEpisodeNumber].flatMap((value) =>
		typeof value === "number" ? [value] : [],
	);
}

function clampWindow(value: number | undefined): number {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		return 4;
	}
	return Math.min(25, Math.max(0, Math.trunc(value)));
}

function truncateEpisodes(episodes: SonarrEpisodeRecord[], limit = 350): SonarrEpisodeRecord[] {
	return episodes.slice(0, limit);
}

async function safeGetTargetEpisodes(client: SonarrClient, queueItem: QueueItem) {
	if (queueItem.episodeIds.length === 0) {
		return [];
	}
	try {
		return await client.getEpisodes({ episodeIds: queueItem.episodeIds });
	} catch {
		return [];
	}
}

export function createSonarrLookupTools({
	client,
	queueItem,
	getCandidates,
	refreshCandidates,
	rememberEpisodeIds,
	emit,
}: CreateSonarrLookupToolsInput) {
	const getQueueContextTool = defineTool({
		name: "sonarr_get_queue_context",
		label: "Get Sonarr Queue Context",
		description:
			"Read the current Sonarr queue target, warning messages, target episode ids, and current manual import candidates.",
		promptSnippet: "Use sonarr_get_queue_context to reread the queue target and Sonarr warning.",
		promptGuidelines: [
			"Use sonarr_get_queue_context when you need to re-check the target episode ids or Sonarr warning.",
		],
		parameters: Type.Object({}),
		executionMode: "parallel" as const,
		async execute() {
			const targetEpisodes = await safeGetTargetEpisodes(client, queueItem);
			rememberEpisodeIds?.(targetEpisodes.flatMap((episode) => (episode.id ? [episode.id] : [])));
			const details = {
				queueItem: {
					id: queueItem.id,
					title: queueItem.title,
					seriesId: queueItem.seriesId,
					seriesTitle: queueItem.seriesTitle,
					targetEpisodeIds: queueItem.episodeIds,
					targetAbsoluteEpisodeNumbers: queueItem.absoluteEpisodeNumbers,
					seasonEpisode: queueItem.seasonEpisode,
					episodeLabels: queueItem.episodeLabels,
					status: queueItem.status,
					trackedDownloadStatus: queueItem.trackedDownloadStatus,
					trackedDownloadState: queueItem.trackedDownloadState,
					statusMessages: queueItem.statusMessages,
					outputPath: queueItem.outputPath,
					size: queueItem.size,
				},
				targetEpisodes: targetEpisodes.map(compactEpisode),
				candidates: getCandidates().map(compactCandidate),
			};
			return {
				content: [{ type: "text", text: JSON.stringify(details, null, 2) }],
				details,
			};
		},
	});

	const findEpisodesTool = defineTool({
		name: "sonarr_find_episodes",
		label: "Find Sonarr Episodes",
		description:
			"Read-only Sonarr episode lookup for the queue series. Use this to verify season/episode, absolute anime episode numbers, scene numbers, and titles before proposing an import.",
		promptSnippet:
			"Use sonarr_find_episodes to verify Sonarr episode ids, absolute episode numbers, and titles.",
		promptGuidelines: [
			"Use sonarr_find_episodes before resolving unexpected-episode warnings.",
			"Do not guess an episode id when Sonarr can be queried for the series episode mapping.",
		],
		parameters: Type.Object({
			seriesId: Type.Optional(
				Type.Number({ description: "Series id. Defaults to the queue item series id." }),
			),
			episodeIds: Type.Optional(
				Type.Array(Type.Number({ description: "Exact Sonarr episode ids to fetch." })),
			),
			seasonNumber: Type.Optional(Type.Number({ description: "Filter to a Sonarr season number." })),
			absoluteEpisodeNumber: Type.Optional(
				Type.Number({ description: "Find episodes around this anime absolute episode number." }),
			),
			titleContains: Type.Optional(Type.String({ description: "Case-insensitive title text filter." })),
			window: Type.Optional(
				Type.Number({ description: "Neighbor range around absoluteEpisodeNumber. Defaults to 4." }),
			),
		}),
		executionMode: "parallel" as const,
		async execute(_toolCallId, params) {
			const seriesId = params.seriesId ?? queueItem.seriesId;
			const exactEpisodeIds = params.episodeIds?.length ? params.episodeIds : undefined;
			let episodes: SonarrEpisodeRecord[];

			if (exactEpisodeIds) {
				episodes = await client.getEpisodes({ episodeIds: exactEpisodeIds });
			} else if (seriesId) {
				episodes = await client.getEpisodes({ seriesId, seasonNumber: params.seasonNumber });
			} else {
				episodes = await safeGetTargetEpisodes(client, queueItem);
			}

			const absoluteEpisodeNumber =
				typeof params.absoluteEpisodeNumber === "number" ? params.absoluteEpisodeNumber : undefined;
			if (absoluteEpisodeNumber !== undefined) {
				const radius = clampWindow(params.window);
				episodes = episodes.filter((episode) =>
					episodeNumbers(episode).some(
						(episodeNumber) => Math.abs(episodeNumber - absoluteEpisodeNumber) <= radius,
					),
				);
			}

			const titleContains = params.titleContains?.trim().toLowerCase();
			if (titleContains) {
				episodes = episodes.filter((episode) => episode.title?.toLowerCase().includes(titleContains));
			}
			rememberEpisodeIds?.(episodes.flatMap((episode) => (episode.id ? [episode.id] : [])));

			const truncated = episodes.length > 350;
			const details = {
				seriesId,
				filter: params,
				truncated,
				count: episodes.length,
				episodes: truncateEpisodes(episodes).map(compactEpisode),
			};
			return {
				content: [{ type: "text", text: JSON.stringify(details, null, 2) }],
				details,
			};
		},
	});

	const getCandidatesTool = defineTool({
		name: "sonarr_get_manual_import_candidates",
		label: "Get Manual Import Candidates",
		description:
			"Read the manual import candidates Sonarr exposes for this queue item, including Sonarr's parsed episode ids and rejections.",
		promptSnippet: "Use sonarr_get_manual_import_candidates to re-check the importable files Sonarr sees.",
		promptGuidelines: [
			"Use sonarr_get_manual_import_candidates when deciding which physical file path should be imported.",
		],
		parameters: Type.Object({
			refresh: Type.Optional(
				Type.Boolean({ description: "Ask Sonarr for fresh candidates before returning." }),
			),
		}),
		executionMode: "parallel" as const,
		async execute(_toolCallId, params) {
			const candidates = params.refresh && refreshCandidates ? await refreshCandidates() : getCandidates();
			rememberEpisodeIds?.(candidates.flatMap((candidate) => candidate.episodeIds));
			emit?.({
				type: "sonarr",
				itemId: queueItem.id,
				message: `Pi inspected ${candidates.length} manual import candidates.`,
			});
			const details = {
				count: candidates.length,
				candidates: candidates.map(compactCandidate),
			};
			return {
				content: [{ type: "text", text: JSON.stringify(details, null, 2) }],
				details,
			};
		},
	});

	return [getQueueContextTool, findEpisodesTool, getCandidatesTool];
}
