import { X } from "lucide-react";
import type { Toast } from "../hooks/useToasts.js";
import { cx } from "../utils/format.js";

export function Toasts({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: string) => void }) {
	return (
		<div className="toast-stack" aria-live="polite">
			{toasts.map((toast) => (
				<div
					key={toast.id}
					className={cx("toast", toast.kind)}
					role={toast.kind === "error" ? "alert" : "status"}
				>
					<span className="toast-message">{toast.message}</span>
					<button
						type="button"
						className="toast-dismiss"
						aria-label="Dismiss notification"
						onClick={() => onDismiss(toast.id)}
					>
						<X size={14} />
					</button>
				</div>
			))}
		</div>
	);
}
