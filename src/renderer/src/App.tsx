import {
	ChevronDown,
	ChevronUp,
	Inbox,
	MousePointerClick,
	Play,
	Plug,
	RefreshCw,
	Sparkles,
	StopCircle,
} from "lucide-react";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
	AnalysisResult,
	ManualImportCandidate,
	PublicConfig,
	QueueItem,
	QueueRemovalOptions,
	ResolutionProposal,
	ResolverEvent,
} from "../../shared/types.js";
import { CandidateTable } from "./components/CandidateTable.js";
import { ConfigBar } from "./components/ConfigBar.js";
import { ConfirmDialog } from "./components/ConfirmDialog.js";
import { EmptyState } from "./components/EmptyState.js";
import { EventLog } from "./components/EventLog.js";
import { HistoryPanel } from "./components/HistoryPanel.js";
import { ProposalPanel } from "./components/ProposalPanel.js";
import { QueueTable } from "./components/QueueTable.js";
import { Spinner } from "./components/Spinner.js";
import { Toasts } from "./components/Toasts.js";
import { IMPORT_REFRESH_DELAY_MS, ignoreRemovalOptions, manualRemovalOptions } from "./constants.js";
import { useConfirm } from "./hooks/useConfirm.js";
import { useToasts } from "./hooks/useToasts.js";
import type { HistoryEntry, UiEvent } from "./types.js";
import { autoRemovalOptionsForResult, selectedImportEpisodeIds } from "./utils/candidates.js";
import { compactDetails } from "./utils/format.js";
import { historySummary, proposalActionLabel } from "./utils/history.js";
import {
	issueTypesForQueue,
	itemTitle,
	normalizedParallelism,
	sonarrIssueType,
	targetDetailText,
	targetEpisodeText,
	uniqueQueueItemsByDownload,
} from "./utils/queue.js";

function errorText(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export function App() {
	const [config, setConfig] = useState<PublicConfig | null>(null);
	const [configOpen, setConfigOpen] = useState(false);
	const [queue, setQueue] = useState<QueueItem[]>([]);
	const [selectedQueueId, setSelectedQueueId] = useState<number | undefined>();
	const [candidates, setCandidates] = useState<ManualImportCandidate[]>([]);
	const [analysisByItem, setAnalysisByItem] = useState(new Map<number, AnalysisResult>());
	const [selectedCandidateIds, setSelectedCandidateIds] = useState<string[]>([]);
	const [events, setEvents] = useState<UiEvent[]>([]);
	const [historyEntries, setHistoryEntries] = useState<HistoryEntry[]>([]);
	const [historyOpen, setHistoryOpen] = useState(false);
	const [logOpen, setLogOpen] = useState(false);
	const [queueLoading, setQueueLoading] = useState(false);
	const [candidatesLoading, setCandidatesLoading] = useState(false);
	const [analyzingIds, setAnalyzingIds] = useState<ReadonlySet<number>>(new Set());
	const [applyingId, setApplyingId] = useState<number | null>(null);
	const [autoApply, setAutoApply] = useState(false);
	const autoApplyRef = useRef(autoApply);
	const cancelledIds = useRef(new Set<number>());
	const importRefreshTimers = useRef<number[]>([]);
	const hasAutoLoadedQueue = useRef(false);
	const { toasts, pushToast, dismissToast } = useToasts();
	const { confirmRequest, confirm, resolveConfirm } = useConfirm();

	const selectedItem = useMemo(
		() => queue.find((item) => item.id === selectedQueueId) ?? queue[0],
		[queue, selectedQueueId],
	);
	const analysis = selectedItem ? (analysisByItem.get(selectedItem.id) ?? null) : null;
	const proposal = analysis?.proposal ?? null;
	const autoResolveParallelism = normalizedParallelism(config?.autoResolveParallelism);
	const actionableQueueCount = queue.filter((item) => item.canAnalyze).length;
	const selectedItemAnalyzing = Boolean(selectedItem && analyzingIds.has(selectedItem.id));

	const appendEvent = useCallback((event: ResolverEvent) => {
		setEvents((current) =>
			[
				{
					...event,
					key: crypto.randomUUID(),
					timeLabel: new Date(event.timestamp).toLocaleTimeString(),
				},
				...current,
			].slice(0, 240),
		);
	}, []);

	const appendLocalEvent = useCallback(
		(event: Omit<ResolverEvent, "timestamp">) => {
			appendEvent({ ...event, timestamp: new Date().toISOString() });
		},
		[appendEvent],
	);

	const appendHistory = useCallback((entry: Omit<HistoryEntry, "id" | "timestamp" | "timeLabel">) => {
		const timestamp = new Date().toISOString();
		setHistoryEntries((current) =>
			[
				{
					...entry,
					id: crypto.randomUUID(),
					timestamp,
					timeLabel: new Date(timestamp).toLocaleTimeString(),
				},
				...current,
			].slice(0, 200),
		);
	}, []);

	useEffect(() => {
		const dispose = window.sonarrFixer.onResolverEvent((event) => {
			appendEvent(event);
		});
		void window.sonarrFixer.getConfig().then(setConfig);
		return () => {
			dispose();
			for (const timer of importRefreshTimers.current) {
				window.clearTimeout(timer);
			}
			importRefreshTimers.current = [];
		};
	}, [appendEvent]);

	useEffect(() => {
		autoApplyRef.current = autoApply;
	}, [autoApply]);

	useEffect(() => {
		if (config) {
			setConfigOpen(!config.configured);
		}
	}, [config]);

	useEffect(() => {
		if (selectedItem && !selectedQueueId) {
			setSelectedQueueId(selectedItem.id);
		}
	}, [selectedItem, selectedQueueId]);

	useEffect(() => {
		if (analysis) {
			setCandidates(analysis.candidates);
			setSelectedCandidateIds(analysis.proposal.selectedCandidateIds);
		}
	}, [analysis]);

	const fetchAndReconcileQueue = useCallback(async () => {
		const items = await window.sonarrFixer.listQueue();
		setQueue(items);
		setSelectedQueueId((current) =>
			current && items.some((item) => item.id === current) ? current : items[0]?.id,
		);
	}, []);

	const loadQueue = useCallback(async () => {
		setQueueLoading(true);
		try {
			await fetchAndReconcileQueue();
		} catch (error) {
			const message = errorText(error);
			appendLocalEvent({ type: "error", message: `Could not load Sonarr queue: ${message}` });
			pushToast("error", `Could not load Sonarr queue: ${message}`);
		} finally {
			setQueueLoading(false);
		}
	}, [appendLocalEvent, pushToast, fetchAndReconcileQueue]);

	const refreshQueueQuietly = fetchAndReconcileQueue;

	useEffect(() => {
		if (!config?.configured || hasAutoLoadedQueue.current) {
			return;
		}
		hasAutoLoadedQueue.current = true;
		void loadQueue();
	}, [config?.configured, loadQueue]);

	const scheduleImportRefresh = () => {
		void refreshQueueQuietly().catch((error) => {
			appendLocalEvent({
				type: "error",
				message: `Could not refresh Sonarr queue after action: ${errorText(error)}`,
			});
		});
		const timer = window.setTimeout(() => {
			importRefreshTimers.current = importRefreshTimers.current.filter((current) => current !== timer);
			void refreshQueueQuietly().catch((error) => {
				appendLocalEvent({
					type: "error",
					message: `Could not refresh Sonarr queue after delay: ${errorText(error)}`,
				});
			});
		}, IMPORT_REFRESH_DELAY_MS);
		importRefreshTimers.current.push(timer);
	};

	const hideQueueItemsById = (itemIds: number[]) => {
		const itemIdSet = new Set(itemIds);
		if (itemIdSet.size === 0) {
			return;
		}
		setQueue((currentQueue) => {
			const nextQueue = currentQueue.filter((item) => !itemIdSet.has(item.id));
			setSelectedQueueId((currentSelectedId) =>
				currentSelectedId &&
				!itemIdSet.has(currentSelectedId) &&
				nextQueue.some((item) => item.id === currentSelectedId)
					? currentSelectedId
					: nextQueue[0]?.id,
			);
			return nextQueue;
		});
		setAnalysisByItem((current) => {
			const next = new Map(current);
			for (const itemId of itemIdSet) {
				next.delete(itemId);
			}
			return next;
		});
		const activeItemId = selectedQueueId ?? selectedItem?.id;
		if (activeItemId && itemIdSet.has(activeItemId)) {
			setCandidates([]);
			setSelectedCandidateIds([]);
		}
	};

	const hideQueuedImport = (itemId: number) => {
		hideQueueItemsById([itemId]);
	};

	const hideImportedQueueItems = (item: QueueItem, proposal: ResolutionProposal) => {
		const importedEpisodeIds = new Set(selectedImportEpisodeIds(proposal));
		if (importedEpisodeIds.size === 0) {
			hideQueuedImport(item.id);
			return;
		}

		const matchingQueueIds: number[] = [];
		for (const queueItem of queue) {
			const sameDownload =
				item.downloadId && queueItem.downloadId
					? queueItem.downloadId === item.downloadId
					: queueItem.id === item.id;
			if (sameDownload && queueItem.episodeIds.some((episodeId) => importedEpisodeIds.has(episodeId))) {
				matchingQueueIds.push(queueItem.id);
			}
		}
		if (matchingQueueIds.length > 0) {
			hideQueueItemsById(matchingQueueIds);
		}
	};

	const loadCandidates = async () => {
		if (!selectedItem?.canAnalyze) {
			return;
		}
		setCandidatesLoading(true);
		try {
			setCandidates(await window.sonarrFixer.getManualImportCandidates(selectedItem));
		} finally {
			setCandidatesLoading(false);
		}
	};

	const analyzeItem = async (item: QueueItem): Promise<AnalysisResult | null> => {
		cancelledIds.current.delete(item.id);
		setAnalyzingIds((current) => new Set(current).add(item.id));
		try {
			const result = await window.sonarrFixer.analyzeQueueItem(item);
			if (cancelledIds.current.delete(item.id)) {
				return null;
			}
			setAnalysisByItem((current) => new Map(current).set(item.id, result));
			if (item.id === (selectedQueueId ?? selectedItem?.id)) {
				setCandidates(result.candidates);
				setSelectedCandidateIds(result.proposal.selectedCandidateIds);
			}
			appendHistory({
				kind: "analysis",
				itemId: item.id,
				itemTitle: itemTitle(item),
				target: targetDetailText(item),
				action: proposalActionLabel(result.proposal.action),
				source: "Pi",
				confidence: result.proposal.confidence,
				status: result.status,
				summary: historySummary(result),
				details: compactDetails([
					`${result.candidates.length} candidate(s)`,
					`${result.proposal.selectedCandidateIds.length} selected file(s)`,
					result.validation.ok ? "validation valid" : "validation guarded",
					...result.proposal.warnings.slice(0, 2),
				]),
			});
			return result;
		} finally {
			setAnalyzingIds((current) => {
				const next = new Set(current);
				next.delete(item.id);
				return next;
			});
		}
	};

	const shouldAutoImportResult = (result: AnalysisResult): boolean =>
		Boolean(config) &&
		result.proposal.action === "import_candidates" &&
		result.validation.ok &&
		result.proposal.confidence >= (config?.autoImportConfidence ?? 1);

	const analyzeSelectedItem = async () => {
		if (!selectedItem?.canAnalyze || analyzingIds.has(selectedItem.id)) {
			return;
		}
		const autoApplyAtStart = autoApplyRef.current;
		try {
			const result = await analyzeItem(selectedItem);
			if (!result) {
				return;
			}
			if (autoApplyAtStart) {
				await applyAutoResult({ item: selectedItem, result, refreshAfter: true });
			} else if (autoApplyRef.current && shouldAutoImportResult(result)) {
				appendLocalEvent({
					type: "warning",
					itemId: selectedItem.id,
					message:
						"Auto-apply was enabled after this analysis started; leaving the proposal for manual import.",
				});
			}
		} catch (error) {
			pushToast("error", `Analysis failed: ${errorText(error)}`);
		}
	};

	const applyProposal = async ({
		item = selectedItem,
		result = analysis,
		candidateIds = selectedCandidateIds,
		interactive = true,
		refreshAfter = true,
	}: {
		item?: QueueItem;
		result?: AnalysisResult | null;
		candidateIds?: string[];
		interactive?: boolean;
		refreshAfter?: boolean;
	} = {}) => {
		if (!item || !result) {
			return false;
		}
		if (interactive) {
			setApplyingId(item.id);
		}
		try {
			const proposalToApply = {
				...result.proposal,
				selectedCandidateIds: candidateIds,
				selectedImports: result.proposal.selectedImports.filter((selectedImport) =>
					candidateIds.includes(selectedImport.candidateId),
				),
			};
			const importedEpisodeIds = selectedImportEpisodeIds(proposalToApply);
			const applyResult = await window.sonarrFixer.applyImportProposal({
				queueItem: item,
				candidates: result.candidates,
				proposal: proposalToApply,
			});
			appendHistory({
				kind: "import",
				itemId: item.id,
				itemTitle: itemTitle(item),
				target: targetDetailText(item),
				action: "Import",
				source: "Sonarr",
				confidence: result.proposal.confidence,
				status: applyResult.ok ? "applied" : "failed",
				summary: applyResult.message,
				details: compactDetails([
					`${proposalToApply.selectedCandidateIds.length} file(s)`,
					importedEpisodeIds.length ? `episode ids ${importedEpisodeIds.join(", ")}` : undefined,
				]),
			});
			if (applyResult.ok) {
				hideImportedQueueItems(item, proposalToApply);
				if (refreshAfter) {
					scheduleImportRefresh();
				}
				if (interactive) {
					pushToast("success", applyResult.message || "Import command sent to Sonarr.");
				}
			} else if (interactive) {
				pushToast("error", applyResult.message || "Sonarr rejected the import.");
			}
			return applyResult.ok;
		} catch (error) {
			const message = errorText(error);
			appendLocalEvent({
				type: "error",
				itemId: item.id,
				message: `Could not apply import proposal: ${message}`,
			});
			if (interactive) {
				pushToast("error", `Could not apply import proposal: ${message}`);
			}
			appendHistory({
				kind: "import",
				itemId: item.id,
				itemTitle: itemTitle(item),
				target: targetDetailText(item),
				action: "Import",
				source: "Sonarr",
				confidence: result.proposal.confidence,
				status: "failed",
				summary: message,
				details: [`${candidateIds.length} file(s)`],
			});
			return false;
		} finally {
			if (interactive) {
				setApplyingId(null);
			}
		}
	};

	const removeQueuedItem = async ({
		item,
		options,
		mode = "remove",
		interactive = true,
		refreshAfter = true,
		requireConfirm = true,
	}: {
		item: QueueItem;
		options: QueueRemovalOptions;
		mode?: "remove" | "ignore";
		interactive?: boolean;
		refreshAfter?: boolean;
		requireConfirm?: boolean;
	}) => {
		if (requireConfirm) {
			const confirmed = await confirm(
				mode === "ignore"
					? {
							title: "Ignore queue item",
							body: `Remove "${itemTitle(item)}" from Sonarr's queue? The download stays untouched in the download client.`,
							confirmLabel: "Ignore",
						}
					: options.blocklist
						? {
								title: "Delete and blocklist",
								body: `Remove "${itemTitle(item)}" from the queue, delete the download from the client, and blocklist this release so Sonarr searches for a replacement?`,
								confirmLabel: "Delete + Block",
								danger: true,
							}
						: {
								title: "Remove queue item",
								body: `Remove "${itemTitle(item)}" from the queue${options.removeFromClient ? " and delete the download from the client" : ""}?`,
								confirmLabel: "Remove",
								danger: true,
							},
			);
			if (!confirmed) {
				return false;
			}
		}
		if (interactive) {
			setApplyingId(item.id);
		}
		const actionLabel = mode === "ignore" ? "Ignore" : options.blocklist ? "Delete + Block" : "Remove";
		const removalDetails = [
			`removeFromClient=${options.removeFromClient}`,
			`blocklist=${options.blocklist}`,
			`skipRedownload=${options.skipRedownload}`,
			`changeCategory=${options.changeCategory}`,
		];
		try {
			const result = await window.sonarrFixer.removeQueueItem(item.id, options);
			appendHistory({
				kind: mode,
				itemId: item.id,
				itemTitle: itemTitle(item),
				target: targetDetailText(item),
				action: actionLabel,
				source: "Sonarr",
				status: result.ok ? "applied" : "failed",
				summary: result.message,
				details: removalDetails,
			});
			if (result.ok) {
				hideQueuedImport(item.id);
				if (refreshAfter) {
					scheduleImportRefresh();
				}
				if (interactive) {
					pushToast(
						"success",
						result.message || (mode === "ignore" ? "Queue item ignored." : "Queue item removed from Sonarr."),
					);
				}
			} else if (interactive) {
				pushToast("error", result.message || "Sonarr rejected the queue removal.");
			}
			return result.ok;
		} catch (error) {
			const message = errorText(error);
			appendLocalEvent({
				type: "error",
				itemId: item.id,
				message: `Could not remove queue item: ${message}`,
			});
			if (interactive) {
				pushToast("error", `Could not remove queue item: ${message}`);
			}
			appendHistory({
				kind: mode,
				itemId: item.id,
				itemTitle: itemTitle(item),
				target: targetDetailText(item),
				action: actionLabel,
				source: "Sonarr",
				status: "failed",
				summary: message,
				details: removalDetails,
			});
			return false;
		} finally {
			if (interactive) {
				setApplyingId(null);
			}
		}
	};

	const applyAutoResult = async ({
		item,
		result,
		refreshAfter,
	}: {
		item: QueueItem;
		result: AnalysisResult;
		refreshAfter: boolean;
	}) => {
		if (shouldAutoImportResult(result)) {
			await applyProposal({
				item,
				result,
				candidateIds: result.proposal.selectedCandidateIds,
				interactive: false,
				refreshAfter,
			});
			return;
		}
		const autoRemovalOptions = autoRemovalOptionsForResult(result);
		if (autoRemovalOptions) {
			await removeQueuedItem({
				item,
				options: autoRemovalOptions,
				interactive: false,
				refreshAfter,
				requireConfirm: false,
			});
		}
	};

	const analyzeIssueTypes = async (issueTypes: string[]) => {
		const issueTypeSet = new Set(issueTypes);
		const matchingItems = queue.filter((item) => item.canAnalyze && issueTypeSet.has(sonarrIssueType(item)));
		const autoApplyAtStart = autoApplyRef.current;
		const items = autoApplyAtStart ? uniqueQueueItemsByDownload(matchingItems) : matchingItems;
		if (items.length === 0) {
			return;
		}
		let failureCount = 0;
		let nextIndex = 0;
		const workerCount = Math.min(autoResolveParallelism, items.length);
		await Promise.all(
			Array.from({ length: workerCount }, async () => {
				while (nextIndex < items.length) {
					const item = items[nextIndex];
					nextIndex += 1;
					if (!item) {
						return;
					}
					try {
						const result = await analyzeItem(item);
						if (result && autoApplyAtStart) {
							await applyAutoResult({ item, result, refreshAfter: false });
						}
					} catch {
						failureCount += 1;
					}
				}
			}),
		);
		if (autoApplyAtStart) {
			scheduleImportRefresh();
		}
		if (failureCount > 0) {
			pushToast("error", `${failureCount} of ${items.length} analyses failed. See the log for details.`);
		}
	};

	const analyzeAll = async () => {
		await analyzeIssueTypes(issueTypesForQueue(queue));
	};

	const removeQueueItem = async () => {
		if (!selectedItem) {
			return;
		}
		const options = analysis?.proposal.queueRemovalOptions ?? manualRemovalOptions;
		await removeQueuedItem({ item: selectedItem, options });
	};

	const ignoreQueueItem = async () => {
		if (!selectedItem) {
			return;
		}
		await removeQueuedItem({ item: selectedItem, options: ignoreRemovalOptions, mode: "ignore" });
	};

	const selectItem = (item: QueueItem) => {
		setSelectedQueueId(item.id);
		const existing = analysisByItem.get(item.id);
		setCandidates(existing?.candidates ?? []);
		setSelectedCandidateIds(existing?.proposal.selectedCandidateIds ?? []);
	};

	const cancelAnalysis = async (item: QueueItem) => {
		cancelledIds.current.add(item.id);
		await window.sonarrFixer.cancelRun(item.id);
		pushToast("info", `Cancelled analysis for "${itemTitle(item)}".`);
	};

	const stop = async () => {
		for (const id of analyzingIds) {
			cancelledIds.current.add(id);
		}
		await window.sonarrFixer.cancelRun();
		pushToast("info", "Cancelled all running analyses.");
	};

	const queuePaneContent = !config?.configured ? (
		<EmptyState
			icon={Plug}
			title="Connect to Sonarr"
			body="Add your Sonarr URL and API key to load the stuck-import queue."
			action={
				<button type="button" className="button primary" onClick={() => setConfigOpen(true)}>
					Open settings
				</button>
			}
		/>
	) : queue.length === 0 && !queueLoading ? (
		<EmptyState
			icon={Inbox}
			title="Queue is clean"
			body="No stuck imports right now. Refresh to check again."
			action={
				<button type="button" className="button secondary" onClick={loadQueue}>
					<RefreshCw size={16} />
					<span>Refresh</span>
				</button>
			}
		/>
	) : (
		<QueueTable
			queue={queue}
			selectedId={selectedItem?.id}
			canAnalyzeIssueTypes={analyzingIds.size === 0}
			analysisByItem={analysisByItem}
			analyzingIds={analyzingIds}
			onAnalyzeIssueType={(issueType) => analyzeIssueTypes([issueType])}
			onCancelAnalysis={(item) => void cancelAnalysis(item)}
			onSelect={selectItem}
		/>
	);

	const reviewPaneContent = historyOpen ? (
		<HistoryPanel entries={historyEntries} />
	) : !selectedItem ? (
		<EmptyState
			icon={MousePointerClick}
			title="Nothing selected"
			body="Select a queue item on the left to review it."
		/>
	) : (
		<Fragment>
			{analysis ? (
				<ProposalPanel
					proposal={proposal ? { ...proposal, selectedCandidateIds } : null}
					analysis={analysis}
					queueItem={selectedItem}
					candidates={candidates}
					config={config}
					analyzing={selectedItemAnalyzing}
					applying={applyingId === selectedItem.id}
					applyBusy={applyingId !== null}
					onApply={() => applyProposal()}
					onRemove={removeQueueItem}
					onIgnore={ignoreQueueItem}
				/>
			) : (
				<EmptyState
					icon={Sparkles}
					title={selectedItemAnalyzing ? "Analyzing…" : "Not analyzed yet"}
					body={
						selectedItemAnalyzing
							? `The AI is working on "${itemTitle(selectedItem)}".`
							: `Run the AI analysis to get a fix proposal for "${itemTitle(selectedItem)}".`
					}
					action={
						selectedItemAnalyzing ? (
							<Spinner label="Analyzing" />
						) : selectedItem.canAnalyze ? (
							<button type="button" className="button primary" onClick={analyzeSelectedItem}>
								<Play size={16} />
								<span>Analyze</span>
							</button>
						) : undefined
					}
				/>
			)}
			<details className="candidate-debug">
				<summary>Candidate data from Sonarr ({candidates.length})</summary>
				<CandidateTable
					candidates={candidates}
					selectedCandidateIds={selectedCandidateIds}
					aiCandidateIds={proposal?.selectedCandidateIds ?? []}
					queueItem={selectedItem}
				/>
			</details>
		</Fragment>
	);

	return (
		<div className="app-shell">
			<ConfigBar
				config={config}
				open={configOpen}
				onOpenChange={setConfigOpen}
				onSaved={setConfig}
				onHistoryToggle={() => setHistoryOpen((value) => !value)}
				onToast={pushToast}
			/>
			<main className="workspace auto-workspace">
				<section className="pane queue-pane">
					<div className="pane-head">
						<h2>Queue</h2>
						<span>{actionableQueueCount} actionable</span>
					</div>
					<div className="queue-toolbar">
						<button
							type="button"
							className="button secondary"
							onClick={loadQueue}
							disabled={!config?.configured || queueLoading}
						>
							{queueLoading ? <Spinner label="Refreshing" /> : <RefreshCw size={16} />}
							<span>Refresh</span>
						</button>
						<button
							type="button"
							className="button secondary"
							onClick={analyzeSelectedItem}
							disabled={!selectedItem?.canAnalyze || selectedItemAnalyzing}
						>
							{selectedItemAnalyzing ? <Spinner label="Analyzing" /> : <Play size={16} />}
							<span>{selectedItemAnalyzing ? "Analyzing…" : "Analyze"}</span>
						</button>
						<button
							type="button"
							className="button secondary"
							onClick={analyzeAll}
							disabled={actionableQueueCount === 0 || analyzingIds.size > 0}
						>
							{analyzingIds.size > 0 ? <Spinner label="Analyzing" /> : <Play size={16} />}
							<span>{analyzingIds.size > 0 ? `Analyzing ${analyzingIds.size}…` : "Analyze all"}</span>
						</button>
						<button
							type="button"
							className="button secondary"
							onClick={loadCandidates}
							disabled={!selectedItem?.canAnalyze || candidatesLoading}
						>
							{candidatesLoading ? <Spinner label="Loading files" /> : <RefreshCw size={16} />}
							<span>Load files</span>
						</button>
						<button
							type="button"
							className="button secondary"
							onClick={stop}
							disabled={analyzingIds.size === 0}
						>
							<StopCircle size={16} />
							<span>Stop</span>
						</button>
						<label className="toggle">
							<input
								type="checkbox"
								checked={autoApply}
								onChange={(event) => {
									autoApplyRef.current = event.target.checked;
									setAutoApply(event.target.checked);
								}}
							/>
							<span>Auto-apply</span>
						</label>
					</div>
					{queuePaneContent}
				</section>
				<section className="pane review-pane">
					<div className="pane-head">
						<h2>{historyOpen ? "History" : "Auto Resolve Review"}</h2>
						<span>
							{historyOpen
								? `${historyEntries.length} entries`
								: selectedItem
									? targetEpisodeText(selectedItem)
									: "-"}
						</span>
					</div>
					{reviewPaneContent}
				</section>
			</main>
			<section className="log-pane">
				<button
					type="button"
					className="log-toggle"
					aria-expanded={logOpen}
					onClick={() => setLogOpen((value) => !value)}
				>
					<span className="log-title">Log</span>
					<span className="log-meta">
						{analyzingIds.size > 0 ? `analyzing ${analyzingIds.size}` : `${events.length} events`}
					</span>
					{!logOpen && events[0] && (
						<span className="log-latest truncate">
							{events[0].timeLabel} · {events[0].message}
						</span>
					)}
					{logOpen ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
				</button>
				{logOpen && <EventLog events={events} />}
			</section>
			<Toasts toasts={toasts} onDismiss={dismissToast} />
			<ConfirmDialog request={confirmRequest} onResolve={resolveConfirm} />
		</div>
	);
}
