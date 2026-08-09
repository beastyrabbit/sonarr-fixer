import { chmod, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { BrowserWindow, IpcMainInvokeEvent } from "electron";
import { app, dialog, ipcMain } from "electron";
import type {
	AnalysisResult,
	AppConfig,
	ApplyImportInput,
	DiagnosticExportInput,
	DiagnosticExportResult,
	ManualImportCandidate,
	QueueItem,
	QueueRemovalOptions,
	ResolutionProposal,
	ResolverEvent,
	SaveConfigInput,
	TestConnectionInput,
	TestConnectionResult,
} from "../shared/types.js";
import { loadConfig, normalizeBaseUrl, saveConfig, toPublicConfig } from "./services/config.js";
import { serializeDiagnosticLog } from "./services/diagnostics.js";
import { listPiModels } from "./services/pi-models.js";
import { PiResolver } from "./services/pi-resolver.js";
import { RadarrClient } from "./services/radarr-client.js";
import { canLoadManualImportCandidates, SonarrClient } from "./services/sonarr-client.js";

function eventNow(event: Omit<ResolverEvent, "timestamp">): ResolverEvent {
	return { ...event, timestamp: new Date().toISOString() };
}

type ArrClient = Pick<
	SonarrClient,
	"listQueue" | "getManualImportCandidates" | "applyImportProposal" | "removeQueueItem"
>;

function createClient(config: AppConfig, expectedService?: QueueItem["service"]): ArrClient {
	if (expectedService && expectedService !== config.activeService) {
		throw new Error(
			`The active manager changed to ${config.activeService}. Refresh the queue before continuing.`,
		);
	}
	if (config.activeService === "radarr") {
		if (!config.radarrBaseUrl || !config.radarrApiKey) {
			throw new Error("Radarr URL and API key are required.");
		}
		return new RadarrClient(config.radarrBaseUrl, config.radarrApiKey);
	}
	if (!config.sonarrBaseUrl || !config.sonarrApiKey) {
		throw new Error("Sonarr URL and API key are required.");
	}
	return new SonarrClient(config.sonarrBaseUrl, config.sonarrApiKey);
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

async function testConnection(input: TestConnectionInput): Promise<TestConnectionResult> {
	const config = await loadConfig();
	const baseUrl = normalizeBaseUrl(input.baseUrl);
	const apiKey =
		input.apiKey?.trim() || (input.service === "radarr" ? config.radarrApiKey : config.sonarrApiKey);
	if (!baseUrl || !apiKey) {
		return {
			ok: false,
			service: input.service,
			message: "URL and API key are required.",
		};
	}
	try {
		const status =
			input.service === "radarr"
				? await new RadarrClient(baseUrl, apiKey).getSystemStatus()
				: await new SonarrClient(baseUrl, apiKey).getSystemStatus();
		const serviceName = input.service === "radarr" ? "Radarr" : "Sonarr";
		return {
			ok: true,
			service: input.service,
			message: `Connected to ${status.instanceName || serviceName}${status.version ? ` ${status.version}` : ""}.`,
			version: status.version,
			instanceName: status.instanceName,
		};
	} catch (error) {
		return {
			ok: false,
			service: input.service,
			message: errorMessage(error),
		};
	}
}

function candidateLoadFailure(queueItem: QueueItem, error: unknown): AnalysisResult {
	const serviceName = queueItem.service === "radarr" ? "Radarr" : "Sonarr";
	const message = `Could not load ${serviceName} manual import candidates: ${errorMessage(error)}`;
	const proposal: ResolutionProposal = {
		action: "needs_review",
		confidence: 0,
		selectedCandidateIds: [],
		selectedImports: [],
		sampleCandidateIds: [],
		reason: message,
		issueSummary: message,
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
	ipcMain.handle("pi-models:list", async () => listPiModels());
	ipcMain.handle("connection:test", async (_event: IpcMainInvokeEvent, input: TestConnectionInput) => {
		const result = await testConnection(input);
		const serviceName = input.service === "radarr" ? "Radarr" : "Sonarr";
		emit({
			type: result.ok ? input.service : "error",
			message: result.ok
				? `${serviceName} connection test passed.`
				: `${serviceName} connection test failed: ${result.message}`,
			details: result,
		});
		return result;
	});

	ipcMain.handle("config:save", async (_event: IpcMainInvokeEvent, input: SaveConfigInput) =>
		saveConfig(input),
	);

	ipcMain.handle("queue:list", async () => {
		const config = await loadConfig();
		const client = createClient(config);
		const service = config.activeService;
		const serviceName = service === "radarr" ? "Radarr" : "Sonarr";
		emit({ type: service, message: `Loading ${serviceName} queue.` });
		const queue = await client.listQueue();
		emit({ type: service, message: `Loaded ${queue.length} queue items.` });
		return queue;
	});

	ipcMain.handle("manual-import:list", async (_event: IpcMainInvokeEvent, queueItem: QueueItem) => {
		const config = await loadConfig();
		const client = createClient(config, queueItem.service);
		const service = config.activeService;
		if (!canLoadManualImportCandidates(queueItem)) {
			emit({
				type: service,
				itemId: queueItem.id,
				message: "Skipping manual import candidates for an in-progress or non-actionable download.",
			});
			return [];
		}
		emit({ type: service, itemId: queueItem.id, message: "Loading manual import candidates." });
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
			type: service,
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
			const client = createClient(config, queueItem.service);
			const service = config.activeService;
			const resolver = new PiResolver();

			if (!canLoadManualImportCandidates(queueItem)) {
				emit({
					type: service,
					itemId: queueItem.id,
					message: "Skipping analysis for an in-progress or non-actionable download.",
				});
				return candidateLoadFailure(
					queueItem,
					new Error("Download is still in progress or is not ready for manual import."),
				);
			}

			emit({ type: service, itemId: queueItem.id, message: "Loading manual import candidates." });
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
				type: service,
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
		const config = await loadConfig();
		const client = createClient(config, input.queueItem.service);
		const service = config.activeService;
		emit({ type: service, itemId: input.queueItem.id, message: "Applying import proposal." });
		const result = await client.applyImportProposal(input.queueItem, input.candidates, input.proposal);
		emit({
			type: result.ok ? service : "error",
			itemId: input.queueItem.id,
			message: result.message,
			details: result,
		});
		return result;
	});

	ipcMain.handle(
		"queue:remove",
		async (_event: IpcMainInvokeEvent, queueItem: QueueItem, options: QueueRemovalOptions) => {
			const config = await loadConfig();
			const client = createClient(config, queueItem.service);
			const service = config.activeService;
			emit({ type: service, itemId: queueItem.id, message: "Removing queue item." });
			const result = await client.removeQueueItem(queueItem.id, options);
			emit({ type: service, itemId: queueItem.id, message: result.message, details: result });
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

	ipcMain.handle(
		"diagnostics:export",
		async (_event: IpcMainInvokeEvent, input: DiagnosticExportInput): Promise<DiagnosticExportResult> => {
			const stamp = new Date().toISOString().replace(/[:.]/g, "-");
			const result = await dialog.showSaveDialog(mainWindow, {
				title: "Export diagnostic log",
				defaultPath: join(app.getPath("documents"), `arr-fixer-diagnostic-${stamp}.json`),
				filters: [{ name: "JSON diagnostic log", extensions: ["json"] }],
			});
			if (result.canceled || !result.filePath) {
				return { ok: false, canceled: true };
			}
			const diagnostic = {
				...input,
				runtime: {
					appVersion: app.getVersion(),
					platform: process.platform,
					arch: process.arch,
				},
			};
			await writeFile(result.filePath, serializeDiagnosticLog(diagnostic), {
				encoding: "utf8",
				mode: 0o600,
			});
			await chmod(result.filePath, 0o600).catch(() => undefined);
			return { ok: true, canceled: false, path: result.filePath };
		},
	);
}
