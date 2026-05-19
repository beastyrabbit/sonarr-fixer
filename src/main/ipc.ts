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
import { seedOpenAICodexAuthFromCodex } from "./services/pi-auth.js";
import { PiResolver } from "./services/pi-resolver.js";
import { SonarrClient } from "./services/sonarr-client.js";

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
	const activeAbortControllers = new Set<AbortController>();

	const emit = (event: Omit<ResolverEvent, "timestamp">) => {
		mainWindow.webContents.send("resolver:event", eventNow(event));
	};

	ipcMain.handle("config:get", async () => toPublicConfig(await loadConfig()));

	ipcMain.handle("config:save", async (_event: IpcMainInvokeEvent, input: SaveConfigInput) =>
		saveConfig(input),
	);

	ipcMain.handle("doctor:run", async () => {
		const config = await loadConfig();
		const checks: Array<{ name: string; ok: boolean; message: string }> = [];

		try {
			const status = await createClient(config).getSystemStatus();
			checks.push({
				name: "Sonarr",
				ok: true,
				message: `${status.instanceName ?? status.appName ?? "Sonarr"} ${status.version ?? ""}`.trim(),
			});
		} catch (error) {
			checks.push({
				name: "Sonarr",
				ok: false,
				message: error instanceof Error ? error.message : String(error),
			});
		}

		try {
			const { AuthStorage, ModelRegistry } = await import("@earendil-works/pi-coding-agent");
			const authStorage = AuthStorage.create();
			seedOpenAICodexAuthFromCodex(authStorage);
			const modelRegistry = ModelRegistry.create(authStorage);
			const model = modelRegistry.find(config.piProvider, config.piModel);
			checks.push({
				name: "Pi",
				ok: Boolean(model && modelRegistry.hasConfiguredAuth(model)),
				message: model
					? modelRegistry.hasConfiguredAuth(model)
						? `${config.piProvider}/${config.piModel} auth configured`
						: `${config.piProvider}/${config.piModel} found but auth missing`
					: `${config.piProvider}/${config.piModel} not found`,
			});
		} catch (error) {
			checks.push({
				name: "Pi",
				ok: false,
				message: error instanceof Error ? error.message : String(error),
			});
		}

		return { ok: checks.every((check) => check.ok), checks };
	});

	ipcMain.handle("queue:list", async () => {
		const client = createClient(await loadConfig());
		emit({ type: "sonarr", message: "Loading Sonarr queue." });
		const queue = await client.listQueue();
		emit({ type: "sonarr", message: `Loaded ${queue.length} queue items.` });
		return queue;
	});

	ipcMain.handle("manual-import:list", async (_event: IpcMainInvokeEvent, queueItem: QueueItem) => {
		const client = createClient(await loadConfig());
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
		activeAbortControllers.add(abortController);

		try {
			const config = await loadConfig();
			const client = createClient(config);
			const resolver = new PiResolver();

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
				type: result.validation.ok ? "pi" : "warning",
				itemId: queueItem.id,
				message: `Pi proposal: ${result.proposal.action} (${Math.round(result.proposal.confidence * 100)}%).`,
				details: result.proposal,
			});
			return result;
		} finally {
			activeAbortControllers.delete(abortController);
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

	ipcMain.handle("resolver:cancel", async () => {
		for (const abortController of activeAbortControllers) {
			abortController.abort();
		}
		activeAbortControllers.clear();
		emit({ type: "warning", message: "Cancelled active resolver runs." });
	});
}
