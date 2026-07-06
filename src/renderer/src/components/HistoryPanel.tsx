import { History } from "lucide-react";
import type { HistoryEntry } from "../types.js";
import { compactDetails, confidenceLabel, cx } from "../utils/format.js";
import { EmptyState } from "./EmptyState.js";

export function HistoryPanel({ entries }: { entries: HistoryEntry[] }) {
	if (entries.length === 0) {
		return (
			<div className="history-panel">
				<EmptyState
					icon={History}
					title="No history yet"
					body="Analyses, imports, and removals from this session will show up here."
				/>
			</div>
		);
	}

	return (
		<div className="history-panel">
			{entries.map((entry) => (
				<article key={entry.id} className={cx("history-entry", `history-${entry.kind}`)}>
					<div className="history-entry-head">
						<span>{entry.timeLabel}</span>
						<strong>{entry.action}</strong>
						{entry.confidence !== undefined && <em>{confidenceLabel(entry.confidence)}</em>}
					</div>
					<div className="history-title truncate">{entry.itemTitle}</div>
					<div className="history-target truncate">{entry.target}</div>
					<div className="history-summary">{entry.summary}</div>
					<div className="history-meta">
						{compactDetails([entry.source, entry.status, `queue ${entry.itemId}`]).join(" / ")}
					</div>
					{entry.details.length > 0 && (
						<ul className="history-details">
							{entry.details.map((detail) => (
								<li key={detail}>{detail}</li>
							))}
						</ul>
					)}
				</article>
			))}
		</div>
	);
}
