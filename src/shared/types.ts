export type PiThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

export interface AppConfig {
	sonarrBaseUrl: string;
	sonarrApiKey: string;
	piProvider: string;
	piModel: string;
	piThinkingLevel: PiThinkingLevel;
	autoImportConfidence: number;
	autoResolveParallelism: number;
}

export interface PublicConfig {
	sonarrBaseUrl: string;
	hasSonarrApiKey: boolean;
	piProvider: string;
	piModel: string;
	piThinkingLevel: PiThinkingLevel;
	autoImportConfidence: number;
	autoResolveParallelism: number;
	configured: boolean;
}

export interface SaveConfigInput {
	sonarrBaseUrl: string;
	sonarrApiKey?: string;
	piProvider: string;
	piModel: string;
	piThinkingLevel?: PiThinkingLevel;
	autoImportConfidence: number;
	autoResolveParallelism?: number;
}

export interface DoctorResult {
	ok: boolean;
	checks: Array<{
		name: string;
		ok: boolean;
		message: string;
	}>;
}

export interface QueueItem {
	id: number;
	title: string;
	seriesId?: number;
	seriesTitle?: string;
	downloadId?: string;
	status?: string;
	trackedDownloadStatus?: string;
	trackedDownloadState?: string;
	size?: number;
	outputPath?: string;
	episodeIds: number[];
	absoluteEpisodeNumbers: number[];
	episodeLabels: string[];
	seasonEpisode?: string;
	statusMessages: string[];
	canAnalyze: boolean;
	addedAt?: string;
}

export interface ManualImportCandidate {
	id: string;
	path: string;
	relativePath?: string;
	folderName?: string;
	name?: string;
	size?: number;
	seriesId?: number;
	seriesTitle?: string;
	seasonNumber?: number;
	episodeIds: number[];
	absoluteEpisodeNumbers: number[];
	episodeLabels: string[];
	quality?: unknown;
	qualityLabel?: string;
	languages: unknown[];
	languageLabels: string[];
	releaseGroup?: string;
	indexerFlags?: number;
	releaseType?: string;
	rejections: string[];
	downloadId?: string;
	isLikelySample: boolean;
	sampleReason?: string;
}

export type ProposalAction = "import_candidates" | "needs_review" | "ignore_queue_item" | "remove_queue_item";

export interface SelectedImport {
	candidateId: string;
	episodeIds: number[];
	reason?: string;
}

export interface ResolutionProposal {
	action: ProposalAction;
	confidence: number;
	selectedCandidateIds: string[];
	selectedImports: SelectedImport[];
	sampleCandidateIds: string[];
	reason: string;
	sonarrIssueSummary: string;
	evidence: string[];
	warnings: string[];
}

export interface ValidationIssue {
	severity: "error" | "warning";
	message: string;
	candidateId?: string;
}

export interface ValidationResult {
	ok: boolean;
	issues: ValidationIssue[];
}

export interface AnalysisResult {
	queueItemId: number;
	candidates: ManualImportCandidate[];
	proposal: ResolutionProposal;
	validation: ValidationResult;
	status: "proposal" | "needs_review" | "error";
	log: string[];
}

export interface ApplyImportInput {
	queueItem: QueueItem;
	candidates: ManualImportCandidate[];
	proposal: ResolutionProposal;
}

export interface ApplyResult {
	ok: boolean;
	message: string;
	commandId?: number;
}

export interface QueueRemovalOptions {
	removeFromClient: boolean;
	blocklist: boolean;
	skipRedownload: boolean;
	changeCategory: boolean;
}

export interface ResolverEvent {
	type: "info" | "warning" | "error" | "pi" | "sonarr";
	message: string;
	timestamp: string;
	itemId?: number;
	details?: unknown;
}

export interface SonarrSystemStatus {
	version?: string;
	instanceName?: string;
	appName?: string;
}
