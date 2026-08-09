import type {
	AnalysisResult,
	ManualImportCandidate,
	QueueItem,
	QueueRemovalOptions,
	ResolutionProposal,
} from "../../../shared/types.js";
import { AI_QUEUE_REMOVAL_CONFIDENCE } from "../constants.js";
import { fileName, folderName, formatBytes, joinOrDash } from "./format.js";
import { targetDetailText } from "./queue.js";

export function pathForDisplay(candidate: ManualImportCandidate): string {
	return candidate.relativePath ?? candidate.path ?? candidate.name ?? "";
}

export function candidateTitle(candidate: ManualImportCandidate): string {
	return candidate.name ?? fileName(pathForDisplay(candidate));
}

export function candidateFolder(candidate: ManualImportCandidate): string {
	return candidate.folderName ?? folderName(pathForDisplay(candidate)) ?? "";
}

export function candidateEpisodeText(candidate: ManualImportCandidate): string {
	if (candidate.service === "radarr") {
		return candidate.movieTitle
			? `${candidate.movieTitle}${candidate.movieYear ? ` (${candidate.movieYear})` : ""}`
			: candidate.movieId
				? `movie id ${candidate.movieId}`
				: "-";
	}
	if (candidate.episodeLabels.length > 0) {
		return candidate.episodeLabels.join(", ");
	}
	if (candidate.episodeIds.length > 0) {
		return `episode ids ${candidate.episodeIds.join(", ")}`;
	}
	return "-";
}

export function candidateDetailText(candidate: ManualImportCandidate): string {
	return [
		candidate.qualityLabel,
		joinOrDash(candidate.languageLabels),
		formatBytes(candidate.size),
		candidate.releaseGroup,
	]
		.filter((value) => value && value !== "-")
		.join(" / ");
}

function sameNumberSet(left: number[], right: number[]): boolean {
	if (left.length !== right.length) {
		return false;
	}
	const rightSet = new Set(right);
	return left.every((value) => rightSet.has(value));
}

export function importTargetText(episodeIds: number[], item?: QueueItem, movieId?: number): string {
	if (item?.service === "radarr") {
		const targetMovieId = movieId ?? item.movieId;
		return targetMovieId
			? `${item.movieTitle ?? "movie"}${item.movieYear ? ` (${item.movieYear})` : ""} / id ${targetMovieId}`
			: "movie";
	}
	const idText = `id ${episodeIds.join(", ")}`;
	if (item && sameNumberSet(episodeIds, item.episodeIds)) {
		return `${targetDetailText(item)} / ${idText}`;
	}
	return `episode ${idText}`;
}

export function matchesTarget(candidate: ManualImportCandidate, item?: QueueItem): boolean {
	if (!item) {
		return false;
	}
	if (item.service === "radarr") {
		return Boolean(item.movieId && candidate.movieId === item.movieId);
	}
	const targetIds = new Set(item.episodeIds);
	const targetAbsoluteNumbers = new Set(item.absoluteEpisodeNumbers);
	if (targetIds.size > 0 && candidate.episodeIds.some((episodeId) => targetIds.has(episodeId))) {
		return true;
	}
	if (
		targetAbsoluteNumbers.size > 0 &&
		candidate.absoluteEpisodeNumbers.some((episodeNumber) => targetAbsoluteNumbers.has(episodeNumber))
	) {
		return true;
	}
	if (item.seasonEpisode) {
		const targetTokens = item.seasonEpisode.split(/[,\s]+/).filter(Boolean);
		if (targetTokens.some((token) => candidate.episodeLabels.some((label) => label.includes(token)))) {
			return true;
		}
	}
	return false;
}

export function candidatesByIds(candidates: ManualImportCandidate[], ids: string[]): ManualImportCandidate[] {
	const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
	return ids.flatMap((id) => {
		const candidate = byId.get(id);
		return candidate ? [candidate] : [];
	});
}

export function selectedImportFor(proposal: ResolutionProposal, candidateId: string) {
	return proposal.selectedImports.find((selectedImport) => selectedImport.candidateId === candidateId);
}

export function selectedImportEpisodeIds(proposal: ResolutionProposal): number[] {
	return [...new Set(proposal.selectedImports.flatMap((selectedImport) => selectedImport.episodeIds))];
}

export function selectedImportMovieIds(proposal: ResolutionProposal): number[] {
	return [
		...new Set(
			proposal.selectedImports.flatMap((selectedImport) =>
				selectedImport.movieId ? [selectedImport.movieId] : [],
			),
		),
	];
}

function canAutoApplyRemovalOptions(options: QueueRemovalOptions): boolean {
	return options.removeFromClient && !options.skipRedownload && !options.changeCategory;
}

export function autoRemovalOptionsForResult(result: AnalysisResult): QueueRemovalOptions | undefined {
	if (
		result.proposal.action === "remove_queue_item" &&
		result.validation.ok &&
		result.proposal.queueRemovalOptions &&
		canAutoApplyRemovalOptions(result.proposal.queueRemovalOptions) &&
		result.proposal.confidence >= AI_QUEUE_REMOVAL_CONFIDENCE
	) {
		return result.proposal.queueRemovalOptions;
	}
	return undefined;
}

export function inferredSonarrCandidates(
	candidates: ManualImportCandidate[],
	item?: QueueItem,
): ManualImportCandidate[] {
	return candidates.filter((candidate) => matchesTarget(candidate, item));
}
