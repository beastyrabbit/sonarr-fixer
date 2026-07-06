import { cx } from "../utils/format.js";

export function DecisionRow({
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
						{details.map((item, index) => (
							// Static, non-reordering display lines; index disambiguates duplicate strings.
							// biome-ignore lint/suspicious/noArrayIndexKey: order is stable per render
							<div key={`${index}-${item}`}>{item}</div>
						))}
					</div>
				)}
			</div>
		</div>
	);
}
