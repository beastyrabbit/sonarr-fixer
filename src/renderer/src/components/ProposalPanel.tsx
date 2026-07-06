import { Check, EyeOff, Trash2 } from "lucide-react";
import type {
	AnalysisResult,
	ManualImportCandidate,
	PublicConfig,
	QueueItem,
	ResolutionProposal,
} from "../../../shared/types.js";
import { AI_QUEUE_REMOVAL_CONFIDENCE, emptyProposal } from "../constants.js";
import {
	autoRemovalOptionsForResult,
	candidateDetailText,
	candidateEpisodeText,
	candidateFolder,
	candidatesByIds,
	candidateTitle,
	importTargetText,
	inferredSonarrCandidates,
	pathForDisplay,
	selectedImportFor,
} from "../utils/candidates.js";
import { absoluteText, confidenceLabel, cx, formatBytes } from "../utils/format.js";
import { itemTitle, targetDetailText } from "../utils/queue.js";
import { CandidateSummary } from "./CandidateSummary.js";
import { DecisionRow } from "./DecisionRow.js";
import { Spinner } from "./Spinner.js";

export function ProposalPanel({
	proposal,
	analysis,
	queueItem,
	candidates,
	config,
	onApply,
	onRemove,
	onIgnore,
	analyzing,
	applying,
	applyBusy,
}: {
	proposal: ResolutionProposal | null;
	analysis: AnalysisResult | null;
	queueItem?: QueueItem;
	candidates: ManualImportCandidate[];
	config: PublicConfig | null;
	onApply: () => void;
	onRemove: () => void;
	onIgnore: () => void;
	analyzing: boolean;
	applying: boolean;
	applyBusy: boolean;
}) {
	const actionsLocked = analyzing || applyBusy;
	const activeProposal = proposal ?? emptyProposal;
	const issues = analysis?.validation.issues ?? [];
	const queueRemovalOptions = activeProposal.queueRemovalOptions;
	const autoRemovalOptions = analysis ? autoRemovalOptionsForResult(analysis) : undefined;
	const removalWillBlocklist = Boolean(queueRemovalOptions?.blocklist);
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
	const canAutoRemove =
		activeProposal.action === "remove_queue_item" && validationOk && Boolean(autoRemovalOptions);
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
		if (canAutoRemove) {
			return {
				className: "blocked",
				title: autoRemovalOptions?.blocklist ? "Would auto-delete/block" : "Would auto-remove",
				detail: autoRemovalOptions?.blocklist
					? `Confidence ${confidenceLabel(activeProposal.confidence)} is at or above the ${confidenceLabel(AI_QUEUE_REMOVAL_CONFIDENCE)} removal threshold; delete from the download client, blocklist, and search again.`
					: `Confidence ${confidenceLabel(activeProposal.confidence)} is at or above the ${confidenceLabel(AI_QUEUE_REMOVAL_CONFIDENCE)} removal threshold; remove from the download client without blocklisting.`,
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
				title: "Manual removal",
				detail:
					activeProposal.confidence < AI_QUEUE_REMOVAL_CONFIDENCE
						? `Confidence ${confidenceLabel(activeProposal.confidence)} is below the ${confidenceLabel(AI_QUEUE_REMOVAL_CONFIDENCE)} removal threshold.`
						: removalWillBlocklist
							? "The agent did not provide valid delete/blocklist options, so manual confirmation is required."
							: "The agent did not provide valid removal options, so manual confirmation is required.",
			};
		}
		return {
			className: "review",
			title: "Needs review",
			detail: "The agent did not find a safe auto-import action.",
		};
	})();
	const fileLine = primaryCandidate
		? selectedCandidates.length > 1
			? `${selectedCandidates.length} files selected`
			: candidateTitle(primaryCandidate)
		: (queueItem?.title ?? "No file selected.");
	const fileDetail = primaryCandidate
		? selectedCandidates.length > 1
			? selectedCandidates.slice(0, 4).map(candidateTitle).join(" / ")
			: candidateFolder(primaryCandidate) || pathForDisplay(primaryCandidate)
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
			if (selectedCandidates.length > 1) {
				return `Import ${selectedCandidates.length} files as mapped episodes`;
			}
			return `Import as ${importTargetText(primaryImport.episodeIds, queueItem)}`;
		}
		if (activeProposal.action === "import_candidates") {
			return "Import selected file, but no explicit episode mapping is visible.";
		}
		if (activeProposal.action === "remove_queue_item") {
			return removalWillBlocklist
				? "Delete from the download client, blocklist the release, and let Sonarr search again."
				: "Remove this queue item.";
		}
		if (activeProposal.action === "ignore_queue_item") {
			return "Stop tracking this queue item; the download stays in the client.";
		}
		return "Needs review.";
	})();
	return (
		<div className="review-panel">
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
							disabled={!analysis || activeProposal.action !== "import_candidates" || actionsLocked}
							onClick={onApply}
						>
							{applying && activeProposal.action === "import_candidates" ? (
								<Spinner label="Importing" />
							) : (
								<Check size={16} />
							)}
							<span>Import</span>
						</button>
						<button
							type="button"
							className="button danger"
							disabled={!analysis || activeProposal.action !== "remove_queue_item" || actionsLocked}
							onClick={onRemove}
						>
							{applying && activeProposal.action === "remove_queue_item" ? (
								<Spinner label="Removing" />
							) : (
								<Trash2 size={16} />
							)}
							<span>{removalWillBlocklist ? "Delete + Block" : "Remove"}</span>
						</button>
						<button
							type="button"
							className="button"
							disabled={!analysis || activeProposal.action !== "ignore_queue_item" || actionsLocked}
							onClick={onIgnore}
						>
							{applying && activeProposal.action === "ignore_queue_item" ? (
								<Spinner label="Ignoring" />
							) : (
								<EyeOff size={16} />
							)}
							<span>Ignore</span>
						</button>
					</div>
				</div>
			</section>

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

			<section className="detail-section">
				<div className="detail-column">
					<div className="block-label">Queue target</div>
					<div className="review-title truncate">
						{queueItem ? itemTitle(queueItem) : "No queue item selected"}
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
