import {
	AuthStorage,
	createAgentSession,
	DefaultResourceLoader,
	getAgentDir,
	ModelRegistry,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import type {
	AnalysisResult,
	AppConfig,
	ManualImportCandidate,
	QueueItem,
	ResolutionProposal,
	ResolverEvent,
} from "../../shared/types.js";
import { seedOpenAICodexAuthFromCodex } from "./pi-auth.js";
import { createProposalTool } from "./pi-proposal-tool.js";
import { createSonarrLookupTools } from "./pi-sonarr-tools.js";
import { SonarrClient } from "./sonarr-client.js";
import { compactCandidate } from "./sonarr-format.js";
import { validateProposalForImport } from "./validation.js";

type EmitEvent = (event: Omit<ResolverEvent, "timestamp">) => void;

interface ResolveInput {
	queueItem: QueueItem;
	candidates: ManualImportCandidate[];
	config: AppConfig;
	signal?: AbortSignal;
	emit?: EmitEvent;
}

function emit(emitEvent: EmitEvent | undefined, event: Omit<ResolverEvent, "timestamp">): void {
	emitEvent?.(event);
}

function buildSystemPrompt(): string {
	return [
		"You resolve Sonarr downloaded-queue manual import problems.",
		"You may use the provided read-only Sonarr lookup tools, but you do not mutate Sonarr.",
		"You receive one queue item plus Sonarr manual import candidates, and you have read-only Sonarr lookup tools.",
		"You must finish by calling propose_sonarr_resolution exactly once.",
		"You decide both the physical file candidate or candidates and the exact Sonarr episode ids to import them as.",
		"Return that decision only through selectedImports in propose_sonarr_resolution.",
		"Never select candidates marked as likely samples.",
		"Every imported candidate must include German as one of its languages. If a candidate does not include German, do not import it.",
		"If no importable candidate includes German, use remove_queue_item and set queueRemovalOptions to removeFromClient=true, blocklist=true, skipRedownload=false, changeCategory=false so Sonarr can search for a German replacement.",
		"Never import Blu-ray disc structure stream chunks such as BDMV/STREAM/*.m2ts.",
		"If the download is only Blu-ray disc structure stream chunks, use remove_queue_item.",
		"Treat Sonarr status messages as the main diagnostic clue.",
		"When Sonarr reports a quality, custom format, or non-upgrade rejection, call sonarr_get_upgrade_context before deciding. Compare the candidate to the current episode file, quality profile, custom format score, and languages.",
		"If the candidate is otherwise valid but does not improve the existing episode file according to Sonarr's profile/custom-format scoring, do not import it. Use remove_queue_item with queueRemovalOptions removeFromClient=true, blocklist=false, skipRedownload=false, changeCategory=false.",
		"For unsuitable or unwanted releases, such as non-German files, wrong episodes, wrong series, missing usable video files, or disc structures, use remove_queue_item with queueRemovalOptions removeFromClient=true, blocklist=true, skipRedownload=false, changeCategory=false so Sonarr searches again.",
		"If Sonarr exposes multiple clean Season Pack manual import candidates for one download, you may import all safe candidates using their parsed episode ids even when the currently selected queue row targets only one episode.",
		"Use sonarr_find_episodes to verify anime absolute numbers, scene numbers, season/episode mapping, and titles before resolving unexpected-episode warnings.",
		"Sonarr's candidate episode ids are Sonarr's current guess; you may override them in selectedImports when the warning and Sonarr episode lookup show the file should import as different episode ids.",
		"If a file visibly matches the queued episode's absolute number/title after lookup, select that file and map it to the correct Sonarr episode ids.",
		"If the file identity, target episode ids, or episode mapping remain uncertain after lookup, use needs_review.",
		"Explain how the selected candidate resolves or conflicts with Sonarr's warning.",
		"Use needs_review when the data is ambiguous, incomplete, or would require guessing.",
		"Use remove_queue_item only when the queue item clearly cannot be imported or should not be imported.",
		"Use ignore_queue_item only when the download should stay untouched in the download client but Sonarr should stop tracking it, for example files the user keeps outside Sonarr's library.",
	].join("\n");
}

function buildPrompt(queueItem: QueueItem, candidates: ManualImportCandidate[]): string {
	return `Analyze this Sonarr queue item and choose the safest resolution.

Queue item:
${JSON.stringify(
	{
		id: queueItem.id,
		title: queueItem.title,
		seriesTitle: queueItem.seriesTitle,
		targetEpisodeIds: queueItem.episodeIds,
		targetAbsoluteEpisodeNumbers: queueItem.absoluteEpisodeNumbers,
		seasonEpisode: queueItem.seasonEpisode,
		episodeLabels: queueItem.episodeLabels,
		status: queueItem.status,
		trackedDownloadStatus: queueItem.trackedDownloadStatus,
		trackedDownloadState: queueItem.trackedDownloadState,
		statusMessages: queueItem.statusMessages,
		outputPath: queueItem.outputPath,
		size: queueItem.size,
	},
	null,
	2,
)}

Manual import candidates:
${JSON.stringify(candidates.map(compactCandidate), null, 2)}

Rules:
- Read Sonarr's statusMessages first. They describe the actual failure mode.
- Use sonarr_find_episodes when Sonarr mentions an unexpected episode, anime absolute numbers, or scene numbering.
- Use sonarr_get_upgrade_context when Sonarr mentions quality, custom formats, scores, existing files, or non-upgrade rejections.
- Compare Sonarr's target episode ids, the queue folder/title, the candidate filename/title, and Sonarr's episode lookup before deciding.
- Every imported candidate must include German in its languages. If the only visible candidate is not German, do not import it.
- If no importable candidate includes German, propose remove_queue_item with queueRemovalOptions { removeFromClient: true, blocklist: true, skipRedownload: false, changeCategory: false } so Sonarr can search for a German release.
- If Sonarr's upgrade context shows the existing file is already better and the candidate is otherwise valid, propose remove_queue_item with queueRemovalOptions { removeFromClient: true, blocklist: false, skipRedownload: false, changeCategory: false }. Do not blocklist these ordinary non-upgrades.
- If the release is unsuitable or unwanted, such as non-German, wrong episode, wrong series, missing usable video files, or disc structure, propose remove_queue_item with queueRemovalOptions { removeFromClient: true, blocklist: true, skipRedownload: false, changeCategory: false } so Sonarr searches again.
- You are allowed to import a candidate using episode ids different from Sonarr's parsed candidate ids if your Sonarr lookup supports that mapping.
- For multi-file Season Pack candidates from the same download, you may select multiple safe candidates and map each one to its own Sonarr-parsed episode ids. Do not reject a season pack solely because the first visible candidate is not the currently selected queue target.
- Put the exact import mapping in selectedImports: candidateId plus the Sonarr episode ids to import the file as.
- Do not import if you cannot explain why the selected file and selected episode ids are the correct pair.
- If one real episode file and one sample are present, select only the real episode file and list the sample id in sampleCandidateIds.
- Do not select sample-like candidates even if Sonarr guessed an episode.
- Do not import Blu-ray disc structure chunks such as BDMV/STREAM/*.m2ts.
- If all candidates are Blu-ray disc structure chunks, use remove_queue_item.
- If Sonarr rejections are blocking or the episode/series mapping is unclear, use needs_review.
- Call propose_sonarr_resolution now.`;
}

function fallbackProposal(reason: string): ResolutionProposal {
	return {
		action: "needs_review",
		confidence: 0,
		selectedCandidateIds: [],
		selectedImports: [],
		sampleCandidateIds: [],
		reason,
		sonarrIssueSummary: reason,
		evidence: [],
		warnings: [reason],
	};
}

export class PiResolver {
	async analyze(input: ResolveInput): Promise<AnalysisResult> {
		const { queueItem, candidates, config, signal } = input;
		const log: string[] = [];

		if (candidates.length === 0) {
			const proposal = fallbackProposal("Sonarr returned no manual import candidates.");
			return {
				queueItemId: queueItem.id,
				candidates,
				proposal,
				validation: { ok: true, issues: [] },
				status: "needs_review",
				log,
			};
		}

		const candidateIds = candidates.map((candidate) => candidate.id);
		let currentCandidates = candidates;
		const knownEpisodeIds = new Set<number>([
			...queueItem.episodeIds,
			...candidates.flatMap((candidate) => candidate.episodeIds),
		]);
		const rememberEpisodeIds = (episodeIds: number[]) => {
			for (const episodeId of episodeIds) {
				if (Number.isSafeInteger(episodeId) && episodeId > 0) {
					knownEpisodeIds.add(episodeId);
				}
			}
		};
		let capturedProposal: ResolutionProposal | undefined;
		const proposalTool = createProposalTool(candidateIds, (proposal) => {
			capturedProposal = proposal;
		});
		const sonarrClient = new SonarrClient(config.sonarrBaseUrl, config.sonarrApiKey);
		const sonarrLookupTools = createSonarrLookupTools({
			client: sonarrClient,
			queueItem,
			getCandidates: () => currentCandidates,
			refreshCandidates: async () => {
				currentCandidates = await sonarrClient.getManualImportCandidates(queueItem);
				rememberEpisodeIds(currentCandidates.flatMap((candidate) => candidate.episodeIds));
				return currentCandidates;
			},
			rememberEpisodeIds,
			emit: (event) => emit(input.emit, event),
		});

		const authStorage = AuthStorage.create();
		const seeded = seedOpenAICodexAuthFromCodex(authStorage);
		const modelRegistry = ModelRegistry.create(authStorage);
		const model = modelRegistry.find(config.piProvider, config.piModel);
		if (!model) {
			throw new Error(`Pi model not found: ${config.piProvider}/${config.piModel}`);
		}

		if (!modelRegistry.hasConfiguredAuth(model)) {
			throw new Error(`Pi auth is not configured for provider ${config.piProvider}.`);
		}

		if (seeded) {
			log.push("Seeded openai-codex auth from Codex CLI auth.");
		}

		const settingsManager = SettingsManager.inMemory({
			compaction: { enabled: false },
			retry: { enabled: true, maxRetries: 1 },
		});
		const agentDir = getAgentDir();
		const resourceLoader = new DefaultResourceLoader({
			cwd: process.cwd(),
			agentDir,
			settingsManager,
			noExtensions: true,
			noSkills: true,
			noPromptTemplates: true,
			noThemes: true,
			noContextFiles: true,
			systemPrompt: buildSystemPrompt(),
		});
		await resourceLoader.reload();

		const { session } = await createAgentSession({
			cwd: process.cwd(),
			agentDir,
			authStorage,
			modelRegistry,
			model,
			thinkingLevel: config.piThinkingLevel,
			tools: [
				"sonarr_get_queue_context",
				"sonarr_find_episodes",
				"sonarr_get_manual_import_candidates",
				"sonarr_get_upgrade_context",
				"propose_sonarr_resolution",
			],
			customTools: [...sonarrLookupTools, proposalTool],
			sessionManager: SessionManager.inMemory(process.cwd()),
			settingsManager,
			resourceLoader,
		});

		const abort = () => {
			void session.abort();
		};
		if (signal?.aborted) {
			abort();
		} else {
			signal?.addEventListener("abort", abort, { once: true });
		}

		try {
			session.subscribe((event) => {
				if (event.type === "tool_execution_start") {
					emit(input.emit, {
						type: "pi",
						itemId: queueItem.id,
						message: `Pi called ${event.toolName}.`,
						details: event.args,
					});
				}
				if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
					const delta = event.assistantMessageEvent.delta.trim();
					if (delta) {
						log.push(delta);
					}
				}
			});

			if (!signal?.aborted) {
				emit(input.emit, { type: "pi", itemId: queueItem.id, message: "Starting typed Pi analysis." });
				await session.prompt(buildPrompt(queueItem, candidates));
			}

			if (!capturedProposal && !signal?.aborted) {
				emit(input.emit, {
					type: "warning",
					itemId: queueItem.id,
					message: "Pi did not call the proposal tool; retrying once.",
				});
				await session.prompt(
					"You did not call propose_sonarr_resolution. Call it now with the safest Sonarr resolution.",
				);
			}
		} finally {
			signal?.removeEventListener("abort", abort);
			session.dispose();
		}

		const proposal = capturedProposal ?? fallbackProposal("Pi did not return a typed proposal.");
		const validation = validateProposalForImport(currentCandidates, proposal, queueItem, [
			...knownEpisodeIds,
		]);
		const status = proposal.action === "needs_review" || !validation.ok ? "needs_review" : "proposal";

		return {
			queueItemId: queueItem.id,
			candidates: currentCandidates,
			proposal,
			validation,
			status,
			log,
		};
	}
}
