import type { ResolverEvent } from "../../shared/types.js";

export type UiEvent = ResolverEvent & { key: string; timeLabel: string };

export type HistoryEntryKind = "analysis" | "import" | "remove" | "ignore";

export interface HistoryEntry {
	id: string;
	timestamp: string;
	timeLabel: string;
	kind: HistoryEntryKind;
	itemId: number;
	itemTitle: string;
	target: string;
	action: string;
	source: string;
	confidence?: number;
	status: string;
	summary: string;
	details: string[];
}
