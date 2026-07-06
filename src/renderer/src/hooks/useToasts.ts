import { useCallback, useEffect, useRef, useState } from "react";

export type ToastKind = "success" | "error" | "info";

export interface Toast {
	id: string;
	kind: ToastKind;
	message: string;
}

const TOAST_DISMISS_MS = 5_000;
const ERROR_TOAST_DISMISS_MS = 8_000;
const MAX_TOASTS = 4;

export function useToasts() {
	const [toasts, setToasts] = useState<Toast[]>([]);
	const timers = useRef(new Map<string, number>());

	useEffect(() => {
		const activeTimers = timers.current;
		return () => {
			for (const timer of activeTimers.values()) {
				window.clearTimeout(timer);
			}
			activeTimers.clear();
		};
	}, []);

	const dismissToast = useCallback((id: string) => {
		setToasts((current) => current.filter((toast) => toast.id !== id));
		const timer = timers.current.get(id);
		if (timer !== undefined) {
			window.clearTimeout(timer);
			timers.current.delete(id);
		}
	}, []);

	const pushToast = useCallback(
		(kind: ToastKind, message: string) => {
			const id = crypto.randomUUID();
			setToasts((current) => [...current, { id, kind, message }].slice(-MAX_TOASTS));
			const timer = window.setTimeout(
				() => dismissToast(id),
				kind === "error" ? ERROR_TOAST_DISMISS_MS : TOAST_DISMISS_MS,
			);
			timers.current.set(id, timer);
		},
		[dismissToast],
	);

	return { toasts, pushToast, dismissToast };
}
