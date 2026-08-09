import type { PiThinkingLevel, QueueRemovalOptions, ResolutionProposal } from "../../shared/types.js";

export const IMPORT_REFRESH_DELAY_MS = 30_000;
export const AI_QUEUE_REMOVAL_CONFIDENCE = 0.95;

export const thinkingOptions: Array<{ value: PiThinkingLevel; label: string }> = [
	{ value: "minimal", label: "minimal" },
	{ value: "low", label: "low" },
	{ value: "medium", label: "medium" },
	{ value: "high", label: "high" },
	{ value: "xhigh", label: "xhigh" },
	{ value: "off", label: "off" },
];

export const emptyProposal: ResolutionProposal = {
	action: "needs_review",
	confidence: 0,
	selectedCandidateIds: [],
	selectedImports: [],
	sampleCandidateIds: [],
	reason: "",
	issueSummary: "",
	evidence: [],
	warnings: [],
};

export const manualRemovalOptions: QueueRemovalOptions = {
	removeFromClient: true,
	blocklist: false,
	skipRedownload: false,
	changeCategory: false,
};

export const ignoreRemovalOptions: QueueRemovalOptions = {
	removeFromClient: false,
	blocklist: false,
	skipRedownload: true,
	changeCategory: false,
};
