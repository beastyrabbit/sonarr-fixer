import type { ManualImportCandidate } from "../../../shared/types.js";
import {
	candidateDetailText,
	candidateEpisodeText,
	candidateFolder,
	candidateTitle,
	pathForDisplay,
} from "../utils/candidates.js";
import { absoluteText } from "../utils/format.js";

export function CandidateSummary({
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
				<span>{candidate.service === "radarr" ? "Radarr" : "Sonarr"} parsed as</span>
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
