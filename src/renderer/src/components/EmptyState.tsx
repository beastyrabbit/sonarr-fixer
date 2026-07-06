import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export function EmptyState({
	icon: Icon,
	title,
	body,
	action,
}: {
	icon: LucideIcon;
	title: string;
	body: string;
	action?: ReactNode;
}) {
	return (
		<div className="empty-state">
			<Icon size={28} aria-hidden="true" />
			<div className="empty-state-title">{title}</div>
			<div className="empty-state-body">{body}</div>
			{action}
		</div>
	);
}
