import type { PiThinkingLevel, QueueRemovalOptions, ResolutionProposal } from "../../shared/types.js";

export const IMPORT_REFRESH_DELAY_MS = 30_000;
export const AI_QUEUE_REMOVAL_CONFIDENCE = 0.95;

export const piModelOptions = [
	{ provider: "openai-codex", model: "gpt-5.5", label: "Codex GPT-5.5" },
	{ provider: "openai-codex", model: "gpt-5.4", label: "Codex GPT-5.4" },
	{ provider: "openai-codex", model: "gpt-5.4-mini", label: "Codex GPT-5.4 mini" },
	{ provider: "openai-codex", model: "gpt-5.3-codex", label: "GPT-5.3 Codex" },
	{ provider: "openai-codex", model: "gpt-5.3-codex-spark", label: "GPT-5.3 Codex Spark" },
	{ provider: "openai-codex", model: "gpt-5.2", label: "Codex GPT-5.2" },
] as const;

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
	sonarrIssueSummary: "",
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
