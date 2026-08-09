import { Play, X } from "lucide-react";
import { Fragment, type KeyboardEvent } from "react";
import type { AnalysisResult, QueueItem } from "../../../shared/types.js";
import { cx, formatBytes } from "../utils/format.js";
import { groupQueueByIssue, itemTitle, sonarrIssueText, sonarrIssueType } from "../utils/queue.js";
import { Spinner } from "./Spinner.js";

export function QueueTable({
	queue,
	selectedId,
	canAnalyzeIssueTypes,
	analysisByItem,
	analyzingIds,
	onAnalyzeIssueType,
	onCancelAnalysis,
	onSelect,
}: {
	queue: QueueItem[];
	selectedId?: number;
	canAnalyzeIssueTypes: boolean;
	analysisByItem: Map<number, AnalysisResult>;
	analyzingIds: ReadonlySet<number>;
	onAnalyzeIssueType: (issueType: string) => Promise<void>;
	onCancelAnalysis: (item: QueueItem) => void;
	onSelect: (item: QueueItem) => void;
}) {
	const groups = groupQueueByIssue(queue);
	const isRadarr = queue[0]?.service === "radarr";
	const onRowKeyDown = (event: KeyboardEvent<HTMLTableRowElement>, item: QueueItem) => {
		if (event.key === "Enter" || event.key === " ") {
			event.preventDefault();
			onSelect(item);
		}
	};
	return (
		<div className="queue-table">
			<table>
				<thead>
					<tr>
						<th>{isRadarr ? "Movie" : "Series"}</th>
						<th>{isRadarr ? "Year" : "Episode"}</th>
						<th>Issue</th>
						<th>Size</th>
					</tr>
				</thead>
				<tbody>
					{groups.map((group) => {
						const actionableCount = group.items.filter((item) => item.canAnalyze).length;
						return (
							<Fragment key={group.issueType}>
								<tr className="issue-group-row">
									<td colSpan={4}>
										<div className="issue-group-controls">
											<div className="issue-group-label">
												<span>{group.issueType}</span>
												<em>
													{actionableCount} actionable / {group.items.length} total
												</em>
											</div>
											<button
												type="button"
												className="issue-group-run"
												disabled={!canAnalyzeIssueTypes || actionableCount === 0}
												onClick={() => void onAnalyzeIssueType(group.issueType)}
												title={`Analyze all ${group.issueType} items`}
												aria-label={`Analyze all ${group.issueType} items`}
											>
												<Play size={14} />
												<span>Run</span>
											</button>
										</div>
									</td>
								</tr>
								{group.items.map((item) => {
									const analysis = analysisByItem.get(item.id);
									const analyzing = analyzingIds.has(item.id);
									const issueType = sonarrIssueType(item);
									const issueText = sonarrIssueText(item);
									return (
										<tr
											key={item.id}
											className={cx(
												selectedId === item.id && "selected",
												!item.canAnalyze && "muted-row",
												analyzing && "row-analyzing",
											)}
											tabIndex={0}
											aria-selected={selectedId === item.id}
											onClick={() => onSelect(item)}
											onKeyDown={(event) => onRowKeyDown(event, item)}
										>
											<td>
												<div className="strong">{itemTitle(item)}</div>
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
													{analyzing ? (
														<span className="status analyzing">
															<Spinner label="Analyzing" />
															<span>analyzing</span>
														</span>
													) : (
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
													)}
													<div className="subtle truncate">{issueText}</div>
												</div>
											</td>
											<td>
												<div className="size-cell">
													<span>{formatBytes(item.size)}</span>
													{analyzing && (
														<button
															type="button"
															className="icon-button"
															aria-label={`Cancel analysis for ${itemTitle(item)}`}
															title="Cancel analysis"
															onClick={(event) => {
																event.stopPropagation();
																onCancelAnalysis(item);
															}}
														>
															<X size={14} />
														</button>
													)}
												</div>
											</td>
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
