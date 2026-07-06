import { type KeyboardEvent, useEffect, useRef } from "react";
import type { ConfirmOptions } from "../hooks/useConfirm.js";
import { cx } from "../utils/format.js";

export function ConfirmDialog({
	request,
	onResolve,
}: {
	request: ConfirmOptions | null;
	onResolve: (confirmed: boolean) => void;
}) {
	const cancelRef = useRef<HTMLButtonElement | null>(null);
	const confirmRef = useRef<HTMLButtonElement | null>(null);
	const previousFocus = useRef<HTMLElement | null>(null);
	const open = Boolean(request);

	useEffect(() => {
		if (!open) {
			return;
		}
		previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
		cancelRef.current?.focus();
		return () => {
			previousFocus.current?.focus();
		};
	}, [open]);

	if (!request) {
		return null;
	}

	const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
		if (event.key === "Escape") {
			event.stopPropagation();
			onResolve(false);
			return;
		}
		if (event.key === "Tab") {
			event.preventDefault();
			const next = document.activeElement === cancelRef.current ? confirmRef.current : cancelRef.current;
			next?.focus();
		}
	};

	return (
		<div className="confirm-overlay">
			<div
				className="confirm-dialog"
				role="dialog"
				aria-modal="true"
				aria-labelledby="confirm-dialog-title"
				aria-describedby="confirm-dialog-body"
				onKeyDown={onKeyDown}
			>
				<h3 id="confirm-dialog-title">{request.title}</h3>
				<p id="confirm-dialog-body">{request.body}</p>
				<div className="confirm-actions">
					<button ref={cancelRef} type="button" className="button secondary" onClick={() => onResolve(false)}>
						Cancel
					</button>
					<button
						ref={confirmRef}
						type="button"
						className={cx("button", request.danger ? "danger" : "primary")}
						onClick={() => onResolve(true)}
					>
						{request.confirmLabel}
					</button>
				</div>
			</div>
		</div>
	);
}
