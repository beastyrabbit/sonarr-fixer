import { Check } from "lucide-react";
import type { ManualImportCandidate, QueueItem } from "../../../shared/types.js";
import {
	candidateDetailText,
	candidateEpisodeText,
	candidateFolder,
	candidateTitle,
	matchesTarget,
	pathForDisplay,
} from "../utils/candidates.js";
import { cx, formatBytes } from "../utils/format.js";

export function CandidateTable({
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
