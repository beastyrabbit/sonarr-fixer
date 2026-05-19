import {
	AlertTriangle,
	Check,
	ClipboardCheck,
	Play,
	RefreshCw,
	Save,
	Settings,
	StopCircle,
	Trash2,
} from "lucide-react";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
	AnalysisResult,
	DoctorResult,
	ManualImportCandidate,
	PiThinkingLevel,
	PublicConfig,
	QueueItem,
	ResolutionProposal,
	ResolverEvent,
} from "../../shared/types.js";

type BusyState = "idle" | "queue" | "candidates" | "analyze" | "apply" | "doctor";

const IMPORT_REFRESH_DELAY_MS = 30_000;

const piModelOptions = [
	{ provider: "openai-codex", model: "gpt-5.5", label: "Codex GPT-5.5" },
	{ provider: "openai-codex", model: "gpt-5.4", label: "Codex GPT-5.4" },
	{ provider: "openai-codex", model: "gpt-5.4-mini", label: "Codex GPT-5.4 mini" },
	{ provider: "openai-codex", model: "gpt-5.3-codex", label: "GPT-5.3 Codex" },
	{ provider: "openai-codex", model: "gpt-5.3-codex-spark", label: "GPT-5.3 Codex Spark" },
	{ provider: "openai-codex", model: "gpt-5.2", label: "Codex GPT-5.2" },
] as const;

const thinkingOptions: Array<{ value: PiThinkingLevel; label: string }> = [
	{ value: "minimal", label: "minimal" },
	{ value: "low", label: "low" },
	{ value: "medium", label: "medium" },
	{ value: "high", label: "high" },
	{ value: "xhigh", label: "xhigh" },
	{ value: "off", label: "off" },
];

function normalizedParallelism(value?: number): number {
	if (value === undefined || !Number.isFinite(value)) {
		return 1;
	}
	return Math.min(10, Math.max(1, Math.round(value)));
}

function piModelValue(provider: string, model: string): string {
	return JSON.stringify([provider, model]);
}

function parsePiModelValue(value: string): { provider: string; model: string } {
	try {
		const parsed = JSON.parse(value);
		if (Array.isArray(parsed) && typeof parsed[0] === "string" && typeof parsed[1] === "string") {
			return { provider: parsed[0], model: parsed[1] };
		}
	} catch {
		// Fall through to defaults.
	}
	return { provider: "openai-codex", model: "gpt-5.4-mini" };
}

const emptyProposal: ResolutionProposal = {
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

function formatBytes(value?: number): string {
	if (!value || value <= 0) {
		return "-";
	}
	const units = ["B", "KiB", "MiB", "GiB", "TiB"];
	let size = value;
	let unit = 0;
	while (size >= 1024 && unit < units.length - 1) {
		size /= 1024;
		unit += 1;
	}
	return `${size.toFixed(unit > 1 ? 2 : 1)} ${units[unit]}`;
}

function cx(...classes: Array<string | false | undefined>): string {
	return classes.filter(Boolean).join(" ");
}

function confidenceLabel(value: number): string {
	return `${Math.round(value * 100)}%`;
}

function joinOrDash(values: string[], separator = ", "): string {
	return values.length ? values.join(separator) : "-";
}

function pathParts(path?: string): string[] {
	return (path ?? "").split(/[\\/]+/).filter(Boolean);
}

function pathForDisplay(candidate: ManualImportCandidate): string {
	return candidate.relativePath ?? candidate.path ?? candidate.name ?? "";
}

function fileName(path?: string): string {
	const parts = pathParts(path);
	return parts.at(-1) ?? path ?? "-";
}

function folderName(path?: string): string {
	const parts = pathParts(path);
	if (parts.length <= 1) {
		return "";
	}
	return parts.slice(0, -1).join("/");
}

function candidateTitle(candidate: ManualImportCandidate): string {
	return candidate.name ?? fileName(pathForDisplay(candidate));
}

function candidateFolder(candidate: ManualImportCandidate): string {
	return candidate.folderName ?? folderName(pathForDisplay(candidate)) ?? "";
}

function candidateEpisodeText(candidate: ManualImportCandidate): string {
	if (candidate.episodeLabels.length > 0) {
		return candidate.episodeLabels.join(", ");
	}
	if (candidate.episodeIds.length > 0) {
		return `episode ids ${candidate.episodeIds.join(", ")}`;
	}
	return "-";
}

function absoluteText(values?: number[]): string {
	return values?.length ? `abs ${values.join(", ")}` : "";
}

function candidateDetailText(candidate: ManualImportCandidate): string {
	return [
		candidate.qualityLabel,
		joinOrDash(candidate.languageLabels),
		formatBytes(candidate.size),
		candidate.releaseGroup,
	]
		.filter((value) => value && value !== "-")
		.join(" / ");
}

function targetEpisodeText(item?: QueueItem): string {
	if (!item) {
		return "-";
	}
	return item.episodeLabels.join(", ") || item.seasonEpisode || item.title;
}

function targetDetailText(item?: QueueItem): string {
	if (!item) {
		return "-";
	}
	return [targetEpisodeText(item), absoluteText(item.absoluteEpisodeNumbers)].filter(Boolean).join(" / ");
}

function sonarrIssueText(item: QueueItem): string {
	return item.statusMessages[1] ?? item.statusMessages[0] ?? item.trackedDownloadStatus ?? item.status ?? "-";
}

function sonarrIssueType(item: QueueItem): string {
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

function issueTypesForQueue(queue: QueueItem[]): string[] {
	return [...new Set(queue.map(sonarrIssueType))];
}

function groupQueueByIssue(queue: QueueItem[]): Array<{ issueType: string; items: QueueItem[] }> {
	const groups = new Map<string, QueueItem[]>();
	for (const item of queue) {
		const issueType = sonarrIssueType(item);
		groups.set(issueType, [...(groups.get(issueType) ?? []), item]);
	}
	return [...groups].map(([issueType, items]) => ({ issueType, items }));
}

function sameNumberSet(left: number[], right: number[]): boolean {
	if (left.length !== right.length) {
		return false;
	}
	const rightSet = new Set(right);
	return left.every((value) => rightSet.has(value));
}

function importTargetText(episodeIds: number[], item?: QueueItem): string {
	const idText = `id ${episodeIds.join(", ")}`;
	if (item && sameNumberSet(episodeIds, item.episodeIds)) {
		return `${targetDetailText(item)} / ${idText}`;
	}
	return `episode ${idText}`;
}

function matchesTarget(candidate: ManualImportCandidate, item?: QueueItem): boolean {
	if (!item) {
		return false;
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
	if (
		item.seasonEpisode &&
		candidate.episodeLabels.some((label) => label.includes(item.seasonEpisode ?? ""))
	) {
		return true;
	}
	return false;
}

function candidatesByIds(candidates: ManualImportCandidate[], ids: string[]): ManualImportCandidate[] {
	const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
	return ids.flatMap((id) => {
		const candidate = byId.get(id);
		return candidate ? [candidate] : [];
	});
}

function selectedImportFor(proposal: ResolutionProposal, candidateId: string) {
	return proposal.selectedImports.find((selectedImport) => selectedImport.candidateId === candidateId);
}

function inferredSonarrCandidates(
	candidates: ManualImportCandidate[],
	item?: QueueItem,
): ManualImportCandidate[] {
	return candidates.filter((candidate) => matchesTarget(candidate, item));
}

function CandidateSummary({
	candidate,
	empty,
	label = "File",
	importTarget,
	importReason,
}: {
	candidate?: ManualImportCandidate;
	empty: string;
	label?: string;
	importTarget?: string;
	importReason?: string;
}) {
	if (!candidate) {
		return <div className="empty-summary">{empty}</div>;
	}
	return (
		<div className="file-summary">
			<div className="summary-row">
				<span>{label}</span>
				<strong className="truncate">{candidateTitle(candidate)}</strong>
			</div>
			<div className="summary-row">
				<span>Sonarr parsed as</span>
				<strong className="truncate">
					{[candidateEpisodeText(candidate), absoluteText(candidate.absoluteEpisodeNumbers)]
						.filter(Boolean)
						.join(" / ")}
				</strong>
			</div>
			{importTarget && (
				<div className="summary-row import-row">
					<span>AI imports as</span>
					<strong className="truncate">{importTarget}</strong>
				</div>
			)}
			<div className="summary-row">
				<span>Quality</span>
				<strong className="truncate">{candidateDetailText(candidate) || "-"}</strong>
			</div>
			{importReason && <div className="import-reason">{importReason}</div>}
			<div className="file-path truncate">{candidateFolder(candidate) || pathForDisplay(candidate)}</div>
		</div>
	);
}

function ConfigBar({
	config,
	onSaved,
	onDoctor,
	doctor,
	busy,
}: {
	config: PublicConfig | null;
	onSaved: (config: PublicConfig) => void;
	onDoctor: () => void;
	doctor: DoctorResult | null;
	busy: BusyState;
}) {
	const [open, setOpen] = useState(!config?.configured);
	const [sonarrBaseUrl, setSonarrBaseUrl] = useState(config?.sonarrBaseUrl ?? "");
	const [sonarrApiKey, setSonarrApiKey] = useState("");
	const [piProvider, setPiProvider] = useState(config?.piProvider ?? "openai-codex");
	const [piModel, setPiModel] = useState(config?.piModel ?? "gpt-5.4-mini");
	const [piThinkingLevel, setPiThinkingLevel] = useState<PiThinkingLevel>(
		config?.piThinkingLevel ?? "medium",
	);
	const [autoImportConfidence, setAutoImportConfidence] = useState(config?.autoImportConfidence ?? 0.8);
	const [autoResolveParallelism, setAutoResolveParallelism] = useState(config?.autoResolveParallelism ?? 1);

	useEffect(() => {
		if (!config) {
			return;
		}
		setSonarrBaseUrl(config.sonarrBaseUrl);
		setPiProvider(config.piProvider);
		setPiModel(config.piModel);
		setPiThinkingLevel(config.piThinkingLevel);
		setAutoImportConfidence(config.autoImportConfidence);
		setAutoResolveParallelism(config.autoResolveParallelism);
		setOpen(!config.configured);
	}, [config]);

	const save = async () => {
		const saved = await window.sonarrFixer.saveConfig({
			sonarrBaseUrl,
			sonarrApiKey,
			piProvider,
			piModel,
			piThinkingLevel,
			autoImportConfidence,
			autoResolveParallelism,
		});
		setSonarrApiKey("");
		onSaved(saved);
		setOpen(!saved.configured);
	};

	const selectedPiModel = piModelValue(piProvider, piModel);
	const modelOptions = piModelOptions.some(
		(option) => option.provider === piProvider && option.model === piModel,
	)
		? piModelOptions
		: [
				{
					provider: piProvider,
					model: piModel,
					label: `${piProvider}/${piModel}`,
				},
				...piModelOptions,
			];

	return (
		<header className="topbar">
			<div className="brand">
				<div className="brand-title">Sonarr Fixer</div>
				<div className={cx("connection", config?.configured && "ok")}>
					{config?.configured ? config.sonarrBaseUrl : "not configured"}
				</div>
			</div>
			<div className="top-actions">
				{doctor && (
					<div className={cx("doctor", doctor.ok ? "ok" : "bad")}>
						{doctor.ok ? <Check size={14} /> : <AlertTriangle size={14} />}
						<span>{doctor.ok ? "ready" : "check failed"}</span>
					</div>
				)}
				<button type="button" className="button secondary" onClick={onDoctor} disabled={busy !== "idle"}>
					<ClipboardCheck size={16} />
					<span>Doctor</span>
				</button>
				<button type="button" className="button secondary" onClick={() => setOpen((value) => !value)}>
					<Settings size={16} />
					<span>Config</span>
				</button>
			</div>
			{open && (
				<div className="config-row">
					<label>
						<span>Sonarr URL</span>
						<input value={sonarrBaseUrl} onChange={(event) => setSonarrBaseUrl(event.target.value)} />
					</label>
					<label>
						<span>API key</span>
						<input
							type="password"
							value={sonarrApiKey}
							placeholder={config?.hasSonarrApiKey ? "kept" : ""}
							onChange={(event) => setSonarrApiKey(event.target.value)}
						/>
					</label>
					<label>
						<span>Pi model</span>
						<select
							value={selectedPiModel}
							onChange={(event) => {
								const next = parsePiModelValue(event.target.value);
								setPiProvider(next.provider);
								setPiModel(next.model);
							}}
						>
							{modelOptions.map((option) => (
								<option
									key={`${option.provider}/${option.model}`}
									value={piModelValue(option.provider, option.model)}
								>
									{option.label}
								</option>
							))}
						</select>
					</label>
					<label>
						<span>Thinking</span>
						<select
							value={piThinkingLevel}
							onChange={(event) => setPiThinkingLevel(event.target.value as PiThinkingLevel)}
						>
							{thinkingOptions.map((option) => (
								<option key={option.value} value={option.value}>
									{option.label}
								</option>
							))}
						</select>
					</label>
					<label>
						<span>Auto threshold</span>
						<input
							type="number"
							min="0"
							max="1"
							step="0.05"
							value={autoImportConfidence}
							onChange={(event) => setAutoImportConfidence(Number(event.target.value))}
						/>
					</label>
					<label>
						<span>Parallel runs</span>
						<input
							type="number"
							min="1"
							max="10"
							step="1"
							value={autoResolveParallelism}
							onChange={(event) => setAutoResolveParallelism(Number(event.target.value))}
						/>
					</label>
					<button type="button" className="button primary" onClick={save}>
						<Save size={16} />
						<span>Save</span>
					</button>
				</div>
			)}
		</header>
	);
}

function QueueTable({
	queue,
	selectedId,
	selectedIssueTypes,
	canAnalyzeIssueTypes,
	analysisByItem,
	onToggleIssueType,
	onAnalyzeIssueType,
	onSelect,
}: {
	queue: QueueItem[];
	selectedId?: number;
	selectedIssueTypes: string[];
	canAnalyzeIssueTypes: boolean;
	analysisByItem: Map<number, AnalysisResult>;
	onToggleIssueType: (issueType: string) => void;
	onAnalyzeIssueType: (issueType: string) => Promise<void>;
	onSelect: (item: QueueItem) => void;
}) {
	const selectedIssueTypeSet = new Set(selectedIssueTypes);
	const groups = groupQueueByIssue(queue);
	return (
		<div className="queue-table">
			<table>
				<thead>
					<tr>
						<th>Series</th>
						<th>Episode</th>
						<th>Issue</th>
						<th>Size</th>
					</tr>
				</thead>
				<tbody>
					{groups.map((group) => {
						const actionableCount = group.items.filter((item) => item.canAnalyze).length;
						const checked = selectedIssueTypeSet.has(group.issueType);
						return (
							<Fragment key={group.issueType}>
								<tr className="issue-group-row">
									<td colSpan={4}>
										<div className="issue-group-controls">
											<label className="issue-group-toggle">
												<input
													type="checkbox"
													checked={checked}
													onChange={() => onToggleIssueType(group.issueType)}
												/>
												<span>{group.issueType}</span>
												<em>
													{actionableCount} actionable / {group.items.length} total
												</em>
											</label>
											<button
												type="button"
												className="issue-group-run"
												disabled={!canAnalyzeIssueTypes || actionableCount === 0}
												onClick={() => void onAnalyzeIssueType(group.issueType)}
												title={`Analyze all ${group.issueType} items`}
											>
												<Play size={14} />
												<span>Run</span>
											</button>
										</div>
									</td>
								</tr>
								{group.items.map((item) => {
									const analysis = analysisByItem.get(item.id);
									const issueType = sonarrIssueType(item);
									const issueText = sonarrIssueText(item);
									return (
										<tr
											key={item.id}
											className={cx(
												selectedId === item.id && "selected",
												!item.canAnalyze && "muted-row",
												!checked && "issue-disabled-row",
											)}
											onClick={() => onSelect(item)}
										>
											<td>
												<div className="strong">{item.seriesTitle ?? item.title}</div>
												<div className="subtle truncate">
													{item.downloadId ?? item.outputPath ?? "no download id"}
												</div>
											</td>
											<td>
												<div>{item.seasonEpisode || "-"}</div>
												<div className="subtle truncate">{item.episodeLabels.join(", ") || item.title}</div>
											</td>
											<td>
												<div className="issue-cell">
													<span
														className={cx(
															"status",
															item.canAnalyze && "warn",
															analysis?.status === "proposal" && "ok",
															analysis?.status === "needs_review" && "review",
														)}
													>
														{analysis?.status === "proposal" ? "proposal" : issueType}
													</span>
													<div className="subtle truncate">{issueText}</div>
												</div>
											</td>
											<td>{formatBytes(item.size)}</td>
										</tr>
									);
								})}
							</Fragment>
						);
					})}
				</tbody>
			</table>
		</div>
	);
}

function CandidateTable({
	candidates,
	selectedCandidateIds,
	aiCandidateIds,
	queueItem,
}: {
	candidates: ManualImportCandidate[];
	selectedCandidateIds: string[];
	aiCandidateIds: string[];
	queueItem?: QueueItem;
}) {
	const selected = new Set(selectedCandidateIds);
	const ai = new Set(aiCandidateIds);
	return (
		<table className="candidate-table">
			<thead>
				<tr>
					<th className="icon-col">Pick</th>
					<th>File</th>
					<th>Sonarr parsed as</th>
					<th>Signals</th>
					<th>Size</th>
				</tr>
			</thead>
			<tbody>
				{candidates.map((candidate) => {
					const targetMatch = matchesTarget(candidate, queueItem);
					const isSelected = selected.has(candidate.id);
					const isAiPick = ai.has(candidate.id);
					return (
						<tr
							key={candidate.id}
							className={cx(
								candidate.isLikelySample && "sample-row",
								isAiPick && "ai-row",
								targetMatch && "target-row",
							)}
						>
							<td className="icon-col">
								{isSelected ? (
									<span className="pick-mark" title="Agent selected this file">
										<Check size={16} />
									</span>
								) : null}
							</td>
							<td>
								<div className="candidate-primary truncate">{candidateTitle(candidate)}</div>
								<div className="candidate-path truncate">
									{candidateFolder(candidate) || pathForDisplay(candidate)}
								</div>
							</td>
							<td>
								<div className="truncate">{candidateEpisodeText(candidate)}</div>
								<div className="subtle truncate">{candidate.seriesTitle ?? "-"}</div>
							</td>
							<td>
								<div className="signal-list">
									{isAiPick && <span className="tag ai">AI pick</span>}
									{targetMatch && <span className="tag sonarr">Sonarr target</span>}
									{isSelected && !isAiPick && <span className="tag selected-tag">selected</span>}
									{candidate.isLikelySample && <span className="tag sample">sample</span>}
									{candidate.rejections.length > 0 && <span className="tag reject">rejected</span>}
									{!isAiPick &&
										!targetMatch &&
										!isSelected &&
										!candidate.isLikelySample &&
										candidate.rejections.length === 0 && <span className="tag neutral">candidate</span>}
								</div>
								<div className="subtle truncate">
									{candidate.isLikelySample
										? candidate.sampleReason
										: candidate.rejections.join("; ") || candidateDetailText(candidate) || "-"}
								</div>
							</td>
							<td>{formatBytes(candidate.size)}</td>
						</tr>
					);
				})}
			</tbody>
		</table>
	);
}

function DecisionRow({
	label,
	value,
	detail,
	tone,
}: {
	label: string;
	value: string;
	detail?: string | string[];
	tone?: "warning" | "ai" | "blocked";
}) {
	const details = Array.isArray(detail) ? detail : detail ? [detail] : [];
	return (
		<div className={cx("decision-row", tone && `decision-${tone}`)}>
			<div className="decision-label">{label}</div>
			<div className="decision-copy">
				<div className="decision-value">{value}</div>
				{details.length > 0 && (
					<div className="decision-detail">
						{details.map((item) => (
							<div key={item}>{item}</div>
						))}
					</div>
				)}
			</div>
		</div>
	);
}

function ProposalPanel({
	proposal,
	analysis,
	queueItem,
	candidates,
	config,
	onApply,
	onRemove,
	busy,
}: {
	proposal: ResolutionProposal | null;
	analysis: AnalysisResult | null;
	queueItem?: QueueItem;
	candidates: ManualImportCandidate[];
	config: PublicConfig | null;
	onApply: () => void;
	onRemove: () => void;
	busy: BusyState;
}) {
	const activeProposal = proposal ?? emptyProposal;
	const issues = analysis?.validation.issues ?? [];
	const selectedCandidates = candidatesByIds(candidates, activeProposal.selectedCandidateIds);
	const sampleCandidates = candidatesByIds(candidates, activeProposal.sampleCandidateIds);
	const sonarrMatches = inferredSonarrCandidates(candidates, queueItem);
	const primaryCandidate = selectedCandidates[0] ?? sonarrMatches[0] ?? candidates[0];
	const primaryImport = primaryCandidate ? selectedImportFor(activeProposal, primaryCandidate.id) : undefined;
	const statusMessages = queueItem?.statusMessages ?? [];
	const fallbackIssue = queueItem?.statusMessages[0] ?? "";
	const threshold = config?.autoImportConfidence ?? 0.8;
	const validationOk = analysis?.validation.ok ?? false;
	const canAutoImport =
		Boolean(analysis) &&
		activeProposal.action === "import_candidates" &&
		validationOk &&
		activeProposal.confidence >= threshold;
	const verdict = (() => {
		if (!analysis) {
			return {
				className: "waiting",
				title: "Not analyzed",
				detail: "Run Analyze to see whether auto-resolve would import this item.",
			};
		}
		if (canAutoImport) {
			return {
				className: "go",
				title: "Would auto-import",
				detail: `Confidence ${confidenceLabel(activeProposal.confidence)} is at or above the ${confidenceLabel(threshold)} threshold.`,
			};
		}
		if (activeProposal.action === "import_candidates" && !validationOk) {
			return {
				className: "blocked",
				title: "Blocked by validation",
				detail: "The agent selected a file, but local safety checks would stop auto-import.",
			};
		}
		if (activeProposal.action === "import_candidates") {
			return {
				className: "review",
				title: "Below auto threshold",
				detail: `Confidence ${confidenceLabel(activeProposal.confidence)} is below the ${confidenceLabel(threshold)} threshold.`,
			};
		}
		if (activeProposal.action === "remove_queue_item") {
			return {
				className: "blocked",
				title: "Would not auto-import",
				detail: "The agent thinks this queue item should be removed, so it stays manual.",
			};
		}
		return {
			className: "review",
			title: "Needs review",
			detail: "The agent did not find a safe auto-import action.",
		};
	})();
	const fileLine = primaryCandidate
		? candidateTitle(primaryCandidate)
		: (queueItem?.title ?? "No file selected.");
	const fileDetail = primaryCandidate
		? candidateFolder(primaryCandidate) || pathForDisplay(primaryCandidate)
		: queueItem?.outputPath;
	const sonarrIssueLines =
		statusMessages.length > 0
			? statusMessages
			: [activeProposal.sonarrIssueSummary || fallbackIssue || "No Sonarr issue loaded."];
	const sonarrFlaggedLine = sonarrIssueLines.length > 1 ? sonarrIssueLines[1] : sonarrIssueLines[0];
	const sonarrFlaggedDetail =
		sonarrIssueLines.length > 1 ? [sonarrIssueLines[0], ...sonarrIssueLines.slice(2)] : [];
	const sonarrSuggestion = primaryCandidate
		? [candidateEpisodeText(primaryCandidate), absoluteText(primaryCandidate.absoluteEpisodeNumbers)]
				.filter(Boolean)
				.join(" / ")
		: "No Sonarr candidate loaded.";
	const alternateSonarrMatch =
		sonarrMatches[0] && primaryCandidate && sonarrMatches[0].id !== primaryCandidate.id
			? `Queue-target parsed candidate: ${candidateTitle(sonarrMatches[0])} -> ${[
					candidateEpisodeText(sonarrMatches[0]),
					absoluteText(sonarrMatches[0].absoluteEpisodeNumbers),
				]
					.filter(Boolean)
					.join(" / ")}`
			: undefined;
	const aiSuggestion = (() => {
		if (!analysis) {
			return "No AI decision yet.";
		}
		if (activeProposal.action === "import_candidates" && primaryImport) {
			return `Import as ${importTargetText(primaryImport.episodeIds, queueItem)}`;
		}
		if (activeProposal.action === "import_candidates") {
			return "Import selected file, but no explicit episode mapping is visible.";
		}
		if (activeProposal.action === "remove_queue_item") {
			return "Remove this queue item.";
		}
		if (activeProposal.action === "ignore_queue_item") {
			return "Ignore this queue item.";
		}
		return "Needs review.";
	})();
	return (
		<div className="review-panel">
			<section className="decision-flow">
				<DecisionRow label="File" value={fileLine} detail={fileDetail} />
				<DecisionRow
					label="Sonarr flagged"
					value={sonarrFlaggedLine}
					detail={sonarrFlaggedDetail}
					tone="warning"
				/>
				<DecisionRow
					label="Sonarr suggests"
					value={sonarrSuggestion}
					detail={[
						primaryCandidate ? candidateDetailText(primaryCandidate) || "-" : "",
						alternateSonarrMatch ?? "",
					].filter(Boolean)}
				/>
				<DecisionRow
					label="AI suggests"
					value={aiSuggestion}
					detail={[activeProposal.reason, primaryImport?.reason ?? ""].filter(Boolean)}
					tone={canAutoImport ? "ai" : activeProposal.action === "import_candidates" ? "warning" : "blocked"}
				/>
			</section>

			<section className={cx("review-status", verdict.className)}>
				<div>
					<div className="panel-title">Auto-resolve</div>
					<div className="status-title">{verdict.title}</div>
					<div className="verdict-detail">{verdict.detail}</div>
				</div>
				<div className="status-side">
					<div className="hero-metrics">
						<div className="metric">
							<span>Confidence</span>
							<strong>{confidenceLabel(activeProposal.confidence)}</strong>
						</div>
						<div className="metric">
							<span>Validation</span>
							<strong>{!analysis ? "pending" : validationOk ? "valid" : "guarded"}</strong>
						</div>
					</div>
					<div className="proposal-actions">
						<button
							type="button"
							className="button primary"
							disabled={!analysis || activeProposal.action !== "import_candidates" || busy !== "idle"}
							onClick={onApply}
						>
							<Check size={16} />
							<span>Import</span>
						</button>
						<button
							type="button"
							className="button danger"
							disabled={!analysis || activeProposal.action !== "remove_queue_item" || busy !== "idle"}
							onClick={onRemove}
						>
							<Trash2 size={16} />
							<span>Remove</span>
						</button>
					</div>
				</div>
			</section>

			<section className="detail-section">
				<div className="detail-column">
					<div className="block-label">Queue target</div>
					<div className="review-title truncate">
						{queueItem?.seriesTitle ?? queueItem?.title ?? "No queue item selected"}
					</div>
					<div className="summary-row">
						<span>Target</span>
						<strong className="truncate">{targetDetailText(queueItem)}</strong>
					</div>
					<div className="summary-row">
						<span>Download</span>
						<strong className="truncate">
							{[queueItem?.trackedDownloadStatus ?? queueItem?.status, formatBytes(queueItem?.size)]
								.filter(Boolean)
								.join(" / ") || "-"}
						</strong>
					</div>
					<div className="file-path truncate">{queueItem?.downloadId ?? queueItem?.outputPath ?? "-"}</div>
				</div>
				<div className="detail-column">
					<div className="block-label">Reason</div>
					<div className="detail-text">{activeProposal.reason || "No proposal yet."}</div>
				</div>
				<div className="detail-column">
					<div className="block-label">Evidence</div>
					{activeProposal.evidence.length > 0 ? (
						<ul className="evidence-list">
							{activeProposal.evidence.map((item) => (
								<li key={item}>{item}</li>
							))}
						</ul>
					) : (
						<div className="empty-summary">No evidence yet.</div>
					)}
				</div>
				<div className="detail-column">
					<div className="block-label">{issues.length > 0 ? "Safety guard" : "Validation"}</div>
					{issues.length > 0 ? (
						<div className="detail-list">
							{issues.map((issue) => (
								<div key={`${issue.severity}-${issue.candidateId ?? ""}-${issue.message}`}>
									{issue.message}
								</div>
							))}
						</div>
					) : (
						<div className="empty-summary">No local guard issues.</div>
					)}
					{activeProposal.warnings.length > 0 && (
						<div className="detail-list warning-list">
							{activeProposal.warnings.map((warning) => (
								<div key={warning}>{warning}</div>
							))}
						</div>
					)}
				</div>
				<div className="detail-column">
					<div className="block-label">Sonarr parsed match</div>
					<CandidateSummary
						candidate={sonarrMatches[0]}
						empty={
							candidates.length ? "No candidate matches the queue target." : "Load or analyze candidates."
						}
						label="File"
					/>
					{sonarrMatches.length > 1 && (
						<div className="subtle">{sonarrMatches.length} target matches found.</div>
					)}
				</div>
				{sampleCandidates.length > 0 && (
					<div className="detail-column">
						<div className="block-label">Samples ignored</div>
						{sampleCandidates.map((candidate) => (
							<CandidateSummary key={candidate.id} candidate={candidate} empty="No samples." />
						))}
					</div>
				)}
			</section>
		</div>
	);
}

type UiEvent = ResolverEvent & { key: string; timeLabel: string };

function EventLog({ events }: { events: UiEvent[] }) {
	return (
		<div className="event-log">
			{events.map((event) => (
				<div key={event.key} className={`event ${event.type}`}>
					<span>{event.timeLabel}</span>
					<strong>{event.type}</strong>
					<p>{event.message}</p>
				</div>
			))}
		</div>
	);
}

export function App() {
	const [config, setConfig] = useState<PublicConfig | null>(null);
	const [doctor, setDoctor] = useState<DoctorResult | null>(null);
	const [queue, setQueue] = useState<QueueItem[]>([]);
	const [selectedQueueId, setSelectedQueueId] = useState<number | undefined>();
	const [candidates, setCandidates] = useState<ManualImportCandidate[]>([]);
	const [analysisByItem, setAnalysisByItem] = useState(new Map<number, AnalysisResult>());
	const [selectedCandidateIds, setSelectedCandidateIds] = useState<string[]>([]);
	const [selectedIssueTypes, setSelectedIssueTypes] = useState<string[]>([]);
	const [events, setEvents] = useState<UiEvent[]>([]);
	const [busy, setBusy] = useState<BusyState>("idle");
	const [autoImport, setAutoImport] = useState(false);
	const importRefreshTimers = useRef<number[]>([]);

	const selectedItem = useMemo(
		() => queue.find((item) => item.id === selectedQueueId) ?? queue[0],
		[queue, selectedQueueId],
	);
	const analysis = selectedItem ? (analysisByItem.get(selectedItem.id) ?? null) : null;
	const proposal = analysis?.proposal ?? null;
	const selectedIssueTypeSet = useMemo(() => new Set(selectedIssueTypes), [selectedIssueTypes]);
	const autoResolveParallelism = normalizedParallelism(config?.autoResolveParallelism);
	const actionableQueueCount = queue.filter((item) => item.canAnalyze).length;
	const selectedAnalyzeCount = queue.filter(
		(item) => item.canAnalyze && selectedIssueTypeSet.has(sonarrIssueType(item)),
	).length;

	const appendEvent = useCallback((event: ResolverEvent) => {
		setEvents((current) =>
			[
				{
					...event,
					key: crypto.randomUUID(),
					timeLabel: new Date(event.timestamp).toLocaleTimeString(),
				},
				...current,
			].slice(0, 240),
		);
	}, []);

	const appendLocalEvent = useCallback(
		(event: Omit<ResolverEvent, "timestamp">) => {
			appendEvent({ ...event, timestamp: new Date().toISOString() });
		},
		[appendEvent],
	);

	useEffect(() => {
		const dispose = window.sonarrFixer.onResolverEvent((event) => {
			appendEvent(event);
		});
		void window.sonarrFixer.getConfig().then(setConfig);
		return () => {
			dispose();
			for (const timer of importRefreshTimers.current) {
				window.clearTimeout(timer);
			}
			importRefreshTimers.current = [];
		};
	}, [appendEvent]);

	useEffect(() => {
		if (selectedItem && !selectedQueueId) {
			setSelectedQueueId(selectedItem.id);
		}
	}, [selectedItem, selectedQueueId]);

	useEffect(() => {
		if (analysis) {
			setCandidates(analysis.candidates);
			setSelectedCandidateIds(analysis.proposal.selectedCandidateIds);
		}
	}, [analysis]);

	const loadQueue = async () => {
		setBusy("queue");
		try {
			const items = await window.sonarrFixer.listQueue();
			setQueue(items);
			syncSelectedIssueTypes(items);
			setSelectedQueueId((current) =>
				current && items.some((item) => item.id === current) ? current : items[0]?.id,
			);
		} finally {
			setBusy("idle");
		}
	};

	const refreshQueueQuietly = async () => {
		const items = await window.sonarrFixer.listQueue();
		setQueue(items);
		syncSelectedIssueTypes(items);
		setSelectedQueueId((current) =>
			current && items.some((item) => item.id === current) ? current : items[0]?.id,
		);
	};

	const syncSelectedIssueTypes = (items: QueueItem[]) => {
		const nextTypes = issueTypesForQueue(items);
		setSelectedIssueTypes((current) => {
			const currentSet = new Set(current);
			const kept = nextTypes.filter((issueType) => currentSet.has(issueType));
			return current.length === 0 || kept.length === 0 ? nextTypes : kept;
		});
	};

	const toggleIssueType = (issueType: string) => {
		setSelectedIssueTypes((current) =>
			current.includes(issueType)
				? current.filter((currentType) => currentType !== issueType)
				: [...current, issueType],
		);
	};

	const scheduleImportRefresh = () => {
		const timer = window.setTimeout(() => {
			importRefreshTimers.current = importRefreshTimers.current.filter((current) => current !== timer);
			void refreshQueueQuietly();
		}, IMPORT_REFRESH_DELAY_MS);
		importRefreshTimers.current.push(timer);
	};

	const hideQueuedImport = (itemId: number) => {
		setQueue((currentQueue) => {
			const nextQueue = currentQueue.filter((item) => item.id !== itemId);
			syncSelectedIssueTypes(nextQueue);
			setSelectedQueueId((currentSelectedId) =>
				currentSelectedId &&
				currentSelectedId !== itemId &&
				nextQueue.some((item) => item.id === currentSelectedId)
					? currentSelectedId
					: nextQueue[0]?.id,
			);
			return nextQueue;
		});
		setAnalysisByItem((current) => {
			const next = new Map(current);
			next.delete(itemId);
			return next;
		});
		if ((selectedQueueId ?? selectedItem?.id) === itemId) {
			setCandidates([]);
			setSelectedCandidateIds([]);
		}
	};

	const runDoctor = async () => {
		setBusy("doctor");
		try {
			setDoctor(await window.sonarrFixer.doctor());
		} finally {
			setBusy("idle");
		}
	};

	const loadCandidates = async () => {
		if (!selectedItem) {
			return;
		}
		setBusy("candidates");
		try {
			setCandidates(await window.sonarrFixer.getManualImportCandidates(selectedItem));
		} finally {
			setBusy("idle");
		}
	};

	const analyzeItem = async (item: QueueItem, manageBusy = true) => {
		if (manageBusy) {
			setBusy("analyze");
		}
		try {
			const result = await window.sonarrFixer.analyzeQueueItem(item);
			setAnalysisByItem((current) => new Map(current).set(item.id, result));
			if (item.id === (selectedQueueId ?? selectedItem?.id)) {
				setCandidates(result.candidates);
				setSelectedCandidateIds(result.proposal.selectedCandidateIds);
			}
			return result;
		} finally {
			if (manageBusy) {
				setBusy("idle");
			}
		}
	};

	const shouldAutoImportResult = (result: AnalysisResult): boolean =>
		Boolean(config) &&
		result.proposal.action === "import_candidates" &&
		result.validation.ok &&
		result.proposal.confidence >= (config?.autoImportConfidence ?? 1);

	const analyzeSelectedItem = async () => {
		if (!selectedItem) {
			return;
		}
		setBusy("analyze");
		try {
			const result = await analyzeItem(selectedItem, false);
			if (autoImport && shouldAutoImportResult(result)) {
				await applyProposal({
					item: selectedItem,
					result,
					candidateIds: result.proposal.selectedCandidateIds,
					manageBusy: false,
					refreshAfter: true,
				});
			}
		} finally {
			setBusy("idle");
		}
	};

	const applyProposal = async ({
		item = selectedItem,
		result = analysis,
		candidateIds = selectedCandidateIds,
		manageBusy = true,
		refreshAfter = true,
	}: {
		item?: QueueItem;
		result?: AnalysisResult | null;
		candidateIds?: string[];
		manageBusy?: boolean;
		refreshAfter?: boolean;
	} = {}) => {
		if (!item || !result) {
			return;
		}
		if (manageBusy) {
			setBusy("apply");
		}
		try {
			const proposalToApply = {
				...result.proposal,
				selectedCandidateIds: candidateIds,
				selectedImports: result.proposal.selectedImports.filter((selectedImport) =>
					candidateIds.includes(selectedImport.candidateId),
				),
			};
			const applyResult = await window.sonarrFixer.applyImportProposal({
				queueItem: item,
				candidates: result.candidates,
				proposal: proposalToApply,
			});
			if (applyResult.ok) {
				hideQueuedImport(item.id);
				if (refreshAfter) {
					scheduleImportRefresh();
				}
			}
		} finally {
			if (manageBusy) {
				setBusy("idle");
			}
		}
	};

	const analyzeIssueTypes = async (issueTypes: string[]) => {
		const issueTypeSet = new Set(issueTypes);
		const items = queue.filter((item) => item.canAnalyze && issueTypeSet.has(sonarrIssueType(item)));
		if (items.length === 0) {
			return;
		}
		setBusy("analyze");
		try {
			let nextIndex = 0;
			const workerCount = Math.min(autoResolveParallelism, items.length);
			await Promise.all(
				Array.from({ length: workerCount }, async () => {
					while (nextIndex < items.length) {
						const item = items[nextIndex];
						nextIndex += 1;
						if (!item) {
							return;
						}
						try {
							const result = await analyzeItem(item, false);
							if (autoImport && shouldAutoImportResult(result)) {
								await applyProposal({
									item,
									result,
									candidateIds: result.proposal.selectedCandidateIds,
									manageBusy: false,
									refreshAfter: false,
								});
							}
						} catch (error) {
							appendLocalEvent({
								type: "error",
								itemId: item.id,
								message: error instanceof Error ? error.message : String(error),
							});
						}
					}
				}),
			);
			if (autoImport) {
				scheduleImportRefresh();
			}
		} finally {
			setBusy("idle");
		}
	};

	const analyzeAll = async () => {
		await analyzeIssueTypes(selectedIssueTypes);
	};

	const removeQueueItem = async () => {
		if (!selectedItem) {
			return;
		}
		if (!window.confirm(`Remove queue item ${selectedItem.id} from Sonarr?`)) {
			return;
		}
		setBusy("apply");
		try {
			await window.sonarrFixer.removeQueueItem(selectedItem.id, {
				removeFromClient: true,
				blocklist: false,
				skipRedownload: false,
				changeCategory: false,
			});
			await loadQueue();
		} finally {
			setBusy("idle");
		}
	};

	const selectItem = (item: QueueItem) => {
		setSelectedQueueId(item.id);
		const existing = analysisByItem.get(item.id);
		setCandidates(existing?.candidates ?? []);
		setSelectedCandidateIds(existing?.proposal.selectedCandidateIds ?? []);
	};

	const stop = async () => {
		await window.sonarrFixer.cancelRun();
		setBusy("idle");
	};

	return (
		<div className="app-shell">
			<ConfigBar config={config} onSaved={setConfig} onDoctor={runDoctor} doctor={doctor} busy={busy} />
			<div className="toolbar">
				<button
					type="button"
					className="button secondary"
					onClick={loadQueue}
					disabled={!config?.configured || busy !== "idle"}
				>
					<RefreshCw size={16} />
					<span>Refresh</span>
				</button>
				<button
					type="button"
					className="button secondary"
					onClick={analyzeSelectedItem}
					disabled={!selectedItem?.canAnalyze || busy !== "idle"}
				>
					<Play size={16} />
					<span>Analyze</span>
				</button>
				<button
					type="button"
					className="button secondary"
					onClick={analyzeAll}
					disabled={selectedAnalyzeCount === 0 || busy !== "idle"}
				>
					<Play size={16} />
					<span>Analyze selected</span>
				</button>
				<button
					type="button"
					className="button secondary"
					onClick={loadCandidates}
					disabled={!selectedItem || busy !== "idle"}
				>
					<RefreshCw size={16} />
					<span>Load files</span>
				</button>
				<button type="button" className="button secondary" onClick={stop} disabled={busy !== "analyze"}>
					<StopCircle size={16} />
					<span>Stop</span>
				</button>
				<label className="toggle">
					<input
						type="checkbox"
						checked={autoImport}
						onChange={(event) => setAutoImport(event.target.checked)}
					/>
					<span>Auto-import</span>
				</label>
			</div>
			<main className="workspace auto-workspace">
				<section className="pane queue-pane">
					<div className="pane-head">
						<h2>Queue</h2>
						<span>
							{selectedAnalyzeCount} selected / {actionableQueueCount} actionable
						</span>
					</div>
					<QueueTable
						queue={queue}
						selectedId={selectedItem?.id}
						selectedIssueTypes={selectedIssueTypes}
						canAnalyzeIssueTypes={busy === "idle"}
						analysisByItem={analysisByItem}
						onToggleIssueType={toggleIssueType}
						onAnalyzeIssueType={(issueType) => analyzeIssueTypes([issueType])}
						onSelect={selectItem}
					/>
				</section>
				<section className="pane review-pane">
					<div className="pane-head">
						<h2>Auto Resolve Review</h2>
						<span>{selectedItem ? targetEpisodeText(selectedItem) : "-"}</span>
					</div>
					<ProposalPanel
						proposal={proposal ? { ...proposal, selectedCandidateIds } : null}
						analysis={analysis}
						queueItem={selectedItem}
						candidates={candidates}
						config={config}
						busy={busy}
						onApply={() => applyProposal()}
						onRemove={removeQueueItem}
					/>
					<details className="candidate-debug">
						<summary>Candidate data from Sonarr ({candidates.length})</summary>
						<CandidateTable
							candidates={candidates}
							selectedCandidateIds={selectedCandidateIds}
							aiCandidateIds={proposal?.selectedCandidateIds ?? []}
							queueItem={selectedItem}
						/>
					</details>
				</section>
			</main>
			<section className="log-pane">
				<div className="pane-head">
					<h2>Log</h2>
					<span>{busy}</span>
				</div>
				<EventLog events={events} />
			</section>
		</div>
	);
}
