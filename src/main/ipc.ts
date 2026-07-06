import type { BrowserWindow, IpcMainInvokeEvent } from "electron";
import { ipcMain } from "electron";
import type {
	AnalysisResult,
	AppConfig,
	ApplyImportInput,
	ManualImportCandidate,
	QueueItem,
	QueueRemovalOptions,
	ResolutionProposal,
	ResolverEvent,
	SaveConfigInput,
} from "../shared/types.js";
import { loadConfig, saveConfig, toPublicConfig } from "./services/config.js";
import { PiResolver } from "./services/pi-resolver.js";
import { canLoadManualImportCandidates, SonarrClient } from "./services/sonarr-client.js";

function eventNow(event: Omit<ResolverEvent, "timestamp">): ResolverEvent {
	return { ...event, timestamp: new Date().toISOString() };
}

function createClient(config: AppConfig): SonarrClient {
	if (!config.sonarrBaseUrl || !config.sonarrApiKey) {
		throw new Error("Sonarr URL and API key are required.");
	}
	return new SonarrClient(config.sonarrBaseUrl, config.sonarrApiKey);
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function candidateLoadFailure(queueItem: QueueItem, error: unknown): AnalysisResult {
	const message = `Could not load Sonarr manual import candidates: ${errorMessage(error)}`;
	const proposal: ResolutionProposal = {
		action: "needs_review",
		confidence: 0,
		selectedCandidateIds: [],
		selectedImports: [],
		sampleCandidateIds: [],
		reason: message,
		sonarrIssueSummary: message,
		evidence: [],
		warnings: [message],
	};
	return {
		queueItemId: queueItem.id,
		candidates: [],
		proposal,
		validation: { ok: true, issues: [] },
		status: "needs_review",
		log: [message],
	};
}

export function registerIpc(mainWindow: BrowserWindow): void {
	const activeAbortControllers = new Map<number, AbortController>();

	const emit = (event: Omit<ResolverEvent, "timestamp">) => {
		mainWindow.webContents.send("resolver:event", eventNow(event));
	};

	ipcMain.handle("config:get", async () => toPublicConfig(await loadConfig()));

	ipcMain.handle("config:save", async (_event: IpcMainInvokeEvent, input: SaveConfigInput) =>
		saveConfig(input),
	);

	ipcMain.handle("queue:list", async () => {
		const client = createClient(await loadConfig());
		emit({ type: "sonarr", message: "Loading Sonarr queue." });
		const queue = await client.listQueue();
		emit({ type: "sonarr", message: `Loaded ${queue.length} queue items.` });
		return queue;
	});

	ipcMain.handle("manual-import:list", async (_event: IpcMainInvokeEvent, queueItem: QueueItem) => {
		const client = createClient(await loadConfig());
		if (!canLoadManualImportCandidates(queueItem)) {
			emit({
				type: "sonarr",
				itemId: queueItem.id,
				message: "Skipping manual import candidates for an in-progress or non-actionable download.",
			});
			return [];
		}
		emit({ type: "sonarr", itemId: queueItem.id, message: "Loading manual import candidates." });
		let candidates: ManualImportCandidate[] = [];
		try {
			candidates = await client.getManualImportCandidates(queueItem);
		} catch (error) {
			emit({
				type: "error",
				itemId: queueItem.id,
				message: `Could not load manual import candidates: ${errorMessage(error)}`,
			});
			return candidates;
		}
		emit({
			type: "sonarr",
			itemId: queueItem.id,
			message: `Loaded ${candidates.length} manual import candidates.`,
		});
		return candidates;
	});

	ipcMain.handle("queue:analyze", async (_event: IpcMainInvokeEvent, queueItem: QueueItem) => {
		const abortController = new AbortController();
		activeAbortControllers.get(queueItem.id)?.abort();
		activeAbortControllers.set(queueItem.id, abortController);

		try {
			const config = await loadConfig();
			const client = createClient(config);
			const resolver = new PiResolver();

			if (!canLoadManualImportCandidates(queueItem)) {
				emit({
					type: "sonarr",
					itemId: queueItem.id,
					message: "Skipping analysis for an in-progress or non-actionable download.",
				});
				return candidateLoadFailure(
					queueItem,
					new Error("Download is still in progress or is not ready for manual import."),
				);
			}

			emit({ type: "sonarr", itemId: queueItem.id, message: "Loading manual import candidates." });
			let candidates: ManualImportCandidate[] = [];
			try {
				candidates = await client.getManualImportCandidates(queueItem);
			} catch (error) {
				emit({
					type: "error",
					itemId: queueItem.id,
					message: `Could not load manual import candidates: ${errorMessage(error)}`,
				});
				return candidateLoadFailure(queueItem, error);
			}
			emit({
				type: "sonarr",
				itemId: queueItem.id,
				message: `Loaded ${candidates.length} manual import candidates.`,
			});

			const result = await resolver.analyze({
				queueItem,
				candidates,
				config,
				signal: abortController.signal,
				emit,
			});

			emit({
				type: !result.validation.ok ? "warning" : "pi",
				itemId: queueItem.id,
				message: `Pi proposal: ${result.proposal.action} (${Math.round(result.proposal.confidence * 100)}%).`,
				details: result.proposal,
			});
			return result;
		} catch (error) {
			emit({
				type: "error",
				itemId: queueItem.id,
				message: `Analysis failed: ${errorMessage(error)}`,
			});
			throw error;
		} finally {
			if (activeAbortControllers.get(queueItem.id) === abortController) {
				activeAbortControllers.delete(queueItem.id);
			}
		}
	});

	ipcMain.handle("proposal:apply-import", async (_event: IpcMainInvokeEvent, input: ApplyImportInput) => {
		const client = createClient(await loadConfig());
		emit({ type: "sonarr", itemId: input.queueItem.id, message: "Applying import proposal." });
		const result = await client.applyImportProposal(input.queueItem, input.candidates, input.proposal);
		emit({
			type: result.ok ? "sonarr" : "error",
			itemId: input.queueItem.id,
			message: result.message,
			details: result,
		});
		return result;
	});

	ipcMain.handle(
		"queue:remove",
		async (_event: IpcMainInvokeEvent, queueItemId: number, options: QueueRemovalOptions) => {
			const client = createClient(await loadConfig());
			emit({ type: "sonarr", itemId: queueItemId, message: "Removing queue item." });
			const result = await client.removeQueueItem(queueItemId, options);
			emit({ type: "sonarr", itemId: queueItemId, message: result.message, details: result });
			return result;
		},
	);

	ipcMain.handle("resolver:cancel", async (_event: IpcMainInvokeEvent, itemId?: number) => {
		if (typeof itemId === "number") {
			const abortController = activeAbortControllers.get(itemId);
			if (abortController) {
				abortController.abort();
				activeAbortControllers.delete(itemId);
				emit({ type: "warning", itemId, message: `Cancelled analysis for queue item ${itemId}.` });
			}
			return;
		}

		for (const abortController of activeAbortControllers.values()) {
			abortController.abort();
		}
		activeAbortControllers.clear();
		emit({ type: "warning", message: "Cancellation requested." });
	});
}
