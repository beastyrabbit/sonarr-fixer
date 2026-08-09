import { contextBridge, ipcRenderer } from "electron";
import type {
	AnalysisResult,
	ApplyImportInput,
	ApplyResult,
	DiagnosticExportInput,
	DiagnosticExportResult,
	ManualImportCandidate,
	PiModelCatalog,
	PublicConfig,
	QueueItem,
	QueueRemovalOptions,
	ResolverEvent,
	SaveConfigInput,
	TestConnectionInput,
	TestConnectionResult,
} from "../shared/types.js";

const api = {
	getConfig: (): Promise<PublicConfig> => ipcRenderer.invoke("config:get"),
	listPiModels: (): Promise<PiModelCatalog> => ipcRenderer.invoke("pi-models:list"),
	saveConfig: (input: SaveConfigInput): Promise<PublicConfig> => ipcRenderer.invoke("config:save", input),
	testConnection: (input: TestConnectionInput): Promise<TestConnectionResult> =>
		ipcRenderer.invoke("connection:test", input),
	listQueue: (): Promise<QueueItem[]> => ipcRenderer.invoke("queue:list"),
	getManualImportCandidates: (queueItem: QueueItem): Promise<ManualImportCandidate[]> =>
		ipcRenderer.invoke("manual-import:list", queueItem),
	analyzeQueueItem: (queueItem: QueueItem): Promise<AnalysisResult> =>
		ipcRenderer.invoke("queue:analyze", queueItem),
	applyImportProposal: (input: ApplyImportInput): Promise<ApplyResult> =>
		ipcRenderer.invoke("proposal:apply-import", input),
	removeQueueItem: (queueItem: QueueItem, options: QueueRemovalOptions): Promise<ApplyResult> =>
		ipcRenderer.invoke("queue:remove", queueItem, options),
	cancelRun: (itemId?: number): Promise<void> => ipcRenderer.invoke("resolver:cancel", itemId),
	exportDiagnostics: (input: DiagnosticExportInput): Promise<DiagnosticExportResult> =>
		ipcRenderer.invoke("diagnostics:export", input),
	onResolverEvent: (callback: (event: ResolverEvent) => void): (() => void) => {
		const listener = (_event: Electron.IpcRendererEvent, payload: ResolverEvent) => callback(payload);
		ipcRenderer.on("resolver:event", listener);
		return () => ipcRenderer.off("resolver:event", listener);
	},
};

contextBridge.exposeInMainWorld("sonarrFixer", api);

export type SonarrFixerApi = typeof api;
