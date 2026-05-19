import { contextBridge, ipcRenderer } from "electron";
import type {
	AnalysisResult,
	ApplyImportInput,
	ApplyResult,
	DoctorResult,
	ManualImportCandidate,
	PublicConfig,
	QueueItem,
	QueueRemovalOptions,
	ResolverEvent,
	SaveConfigInput,
} from "../shared/types.js";

const api = {
	getConfig: (): Promise<PublicConfig> => ipcRenderer.invoke("config:get"),
	saveConfig: (input: SaveConfigInput): Promise<PublicConfig> => ipcRenderer.invoke("config:save", input),
	doctor: (): Promise<DoctorResult> => ipcRenderer.invoke("doctor:run"),
	listQueue: (): Promise<QueueItem[]> => ipcRenderer.invoke("queue:list"),
	getManualImportCandidates: (queueItem: QueueItem): Promise<ManualImportCandidate[]> =>
		ipcRenderer.invoke("manual-import:list", queueItem),
	analyzeQueueItem: (queueItem: QueueItem): Promise<AnalysisResult> =>
		ipcRenderer.invoke("queue:analyze", queueItem),
	applyImportProposal: (input: ApplyImportInput): Promise<ApplyResult> =>
		ipcRenderer.invoke("proposal:apply-import", input),
	removeQueueItem: (queueItemId: number, options: QueueRemovalOptions): Promise<ApplyResult> =>
		ipcRenderer.invoke("queue:remove", queueItemId, options),
	cancelRun: (): Promise<void> => ipcRenderer.invoke("resolver:cancel"),
	onResolverEvent: (callback: (event: ResolverEvent) => void): (() => void) => {
		const listener = (_event: Electron.IpcRendererEvent, payload: ResolverEvent) => callback(payload);
		ipcRenderer.on("resolver:event", listener);
		return () => ipcRenderer.off("resolver:event", listener);
	},
};

contextBridge.exposeInMainWorld("sonarrFixer", api);

export type SonarrFixerApi = typeof api;
