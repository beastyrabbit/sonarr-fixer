import type { QueueItem } from "../../../shared/types.js";
import { absoluteText } from "./format.js";

export function normalizedParallelism(value?: number): number {
	if (value === undefined || !Number.isFinite(value)) {
		return 1;
	}
	return Math.min(10, Math.max(1, Math.round(value)));
}

export function targetEpisodeText(item?: QueueItem): string {
	if (!item) {
		return "-";
	}
	return item.episodeLabels.join(", ") || item.seasonEpisode || item.title;
}

export function targetDetailText(item?: QueueItem): string {
	if (!item) {
		return "-";
	}
	return [targetEpisodeText(item), absoluteText(item.absoluteEpisodeNumbers)].filter(Boolean).join(" / ");
}

export function sonarrIssueText(item: QueueItem): string {
	return item.statusMessages[1] ?? item.statusMessages[0] ?? item.trackedDownloadStatus ?? item.status ?? "-";
}

export function sonarrIssueType(item: QueueItem): string {
	const text = sonarrIssueText(item).toLowerCase();
	if (text.includes("unexpected") && text.includes("episode")) {
		return "unexpected episode";
	}
	if (text.includes("sample")) {
		return "sample";
	}
	if (text.includes("quality")) {
		return "quality";
	}
	if (text.includes("language")) {
		return "language";
	}
	if (text.includes("series")) {
		return "series match";
	}
	if (text.includes("file") && (text.includes("missing") || text.includes("exist"))) {
		return "missing file";
	}
	if (text.includes("rejected") || text.includes("rejection")) {
		return "rejected";
	}
	if (text.includes("manual import")) {
		return "manual import";
	}
	return item.trackedDownloadStatus ?? item.status ?? "queue";
}

export function issueTypesForQueue(queue: QueueItem[]): string[] {
	return [...new Set(queue.map(sonarrIssueType))];
}

export function groupQueueByIssue(queue: QueueItem[]): Array<{ issueType: string; items: QueueItem[] }> {
	const groups = new Map<string, QueueItem[]>();
	for (const item of queue) {
		const issueType = sonarrIssueType(item);
		groups.set(issueType, [...(groups.get(issueType) ?? []), item]);
	}
	return [...groups].map(([issueType, items]) => ({ issueType, items }));
}

export function uniqueQueueItemsByDownload(items: QueueItem[]): QueueItem[] {
	const seenDownloadIds = new Set<string>();
	return items.filter((item) => {
		if (!item.downloadId) {
			return true;
		}
		if (seenDownloadIds.has(item.downloadId)) {
			return false;
		}
		seenDownloadIds.add(item.downloadId);
		return true;
	});
}

export function itemTitle(item: QueueItem): string {
	return item.seriesTitle ?? item.title;
}
