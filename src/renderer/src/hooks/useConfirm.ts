import { useCallback, useRef, useState } from "react";

export interface ConfirmOptions {
	title: string;
	body: string;
	confirmLabel: string;
	danger?: boolean;
}

export function useConfirm() {
	const [confirmRequest, setConfirmRequest] = useState<ConfirmOptions | null>(null);
	const resolver = useRef<((confirmed: boolean) => void) | null>(null);

	const confirm = useCallback(
		(options: ConfirmOptions) =>
			new Promise<boolean>((resolve) => {
				resolver.current?.(false);
				resolver.current = resolve;
				setConfirmRequest(options);
			}),
		[],
	);

	const resolveConfirm = useCallback((confirmed: boolean) => {
		resolver.current?.(confirmed);
		resolver.current = null;
		setConfirmRequest(null);
	}, []);

	return { confirmRequest, confirm, resolveConfirm };
}
