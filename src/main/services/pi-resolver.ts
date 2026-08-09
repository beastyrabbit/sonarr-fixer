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
import { createRadarrLookupTools } from "./pi-radarr-tools.js";
import { createSonarrLookupTools } from "./pi-sonarr-tools.js";
import { RadarrClient } from "./radarr-client.js";
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

function buildSonarrSystemPrompt(): string {
	return [
		"You resolve Sonarr downloaded-queue manual import problems.",
		"You may use the provided read-only Sonarr lookup tools, but you do not mutate Sonarr.",
		"You receive one queue item plus Sonarr manual import candidates, and you have read-only Sonarr lookup tools.",
		"You must finish by calling propose_sonarr_resolution exactly once.",
		"You decide both the physical file candidate or candidates and the exact Sonarr episode ids to import them as.",
		"Return that decision only through selectedImports in propose_sonarr_resolution.",
		"Never select candidates marked as likely samples.",
		"German audio is preferred but not required. When several usable candidates exist, prefer one whose languages include German.",
		"Candidates without German, such as English or original-language releases, are acceptable fallbacks. Import them when they are otherwise valid; a German version arrives later through the normal upgrade flow.",
		"Never remove or blocklist a queue item only because its languages lack German.",
		"The fallback rule never runs backwards: never replace an existing episode file whose languages include German with a candidate that lacks German, even when profile scoring favors the candidate. Check the existing file via sonarr_get_upgrade_context before importing a non-German candidate over it, and use needs_review for that conflict.",
		"Never import Blu-ray disc structure stream chunks such as BDMV/STREAM/*.m2ts.",
		"If the download is only Blu-ray disc structure stream chunks, use remove_queue_item.",
		"Treat Sonarr status messages as the main diagnostic clue.",
		"When Sonarr reports a quality, custom format, or non-upgrade rejection, call sonarr_get_upgrade_context before deciding. Compare the candidate to the current episode file, quality profile, custom format score, and languages.",
		"If the candidate is otherwise valid but does not improve the existing episode file according to Sonarr's profile/custom-format scoring, do not import it. Use remove_queue_item with queueRemovalOptions removeFromClient=true, blocklist=false, skipRedownload=false, changeCategory=false.",
		"For unsuitable or unwanted releases, such as wrong episodes, wrong series, missing usable video files, or disc structures, use remove_queue_item with queueRemovalOptions removeFromClient=true, blocklist=true, skipRedownload=false, changeCategory=false so Sonarr searches again.",
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

function buildSonarrPrompt(queueItem: QueueItem, candidates: ManualImportCandidate[]): string {
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
- Prefer candidates whose languages include German when several usable candidates exist, but candidates without German (English or the original language) are acceptable fallbacks. Import them when they are otherwise valid instead of removing the download.
- Do not propose remove_queue_item only because no candidate includes German.
- Never replace an existing episode file whose languages include German with a non-German candidate, even when profile scoring favors the candidate. Check the existing file with sonarr_get_upgrade_context first and use needs_review for that conflict.
- If Sonarr's upgrade context shows the existing file is already better and the candidate is otherwise valid, propose remove_queue_item with queueRemovalOptions { removeFromClient: true, blocklist: false, skipRedownload: false, changeCategory: false }. Do not blocklist these ordinary non-upgrades.
- If the release is unsuitable or unwanted, such as wrong episode, wrong series, missing usable video files, or disc structure, propose remove_queue_item with queueRemovalOptions { removeFromClient: true, blocklist: true, skipRedownload: false, changeCategory: false } so Sonarr searches again.
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

function buildRadarrSystemPrompt(): string {
	return [
		"You resolve Radarr downloaded-queue manual import problems.",
		"You may use the provided read-only Radarr lookup tools, but you do not mutate Radarr.",
		"You receive one queue item plus Radarr manual import candidates.",
		"You must finish by calling propose_radarr_resolution exactly once.",
		"You decide the physical file candidate and exact Radarr movie id to import it as.",
		"Return that decision through selectedImports using candidateId and movieId.",
		"Never select candidates marked as likely samples.",
		"German audio is preferred but not required. When several usable candidates exist, prefer one whose languages include German.",
		"Candidates without German, such as English or original-language releases, are acceptable fallbacks. Import them when they are otherwise valid; a German version arrives later through the normal upgrade flow.",
		"Never remove or blocklist a queue item only because its languages lack German.",
		"The fallback rule never runs backwards: never replace an existing movie file whose languages include German with a candidate that lacks German, even when profile scoring favors the candidate. Check the existing file via radarr_get_upgrade_context first and use needs_review for that conflict.",
		"Never import Blu-ray disc structure stream chunks such as BDMV/STREAM/*.m2ts.",
		"Treat Radarr status messages as the main diagnostic clue.",
		"When Radarr reports a quality, custom format, or non-upgrade rejection, call radarr_get_upgrade_context before deciding.",
		"If the existing movie file is already better, remove the queue item without blocklisting it.",
		"For unsuitable releases such as the wrong movie, missing usable video files, or disc structures, remove and blocklist so Radarr searches again.",
		"Use radarr_get_movie to verify title, year, TMDb/IMDb identity, and the existing file before resolving a wrong-movie or ambiguous match.",
		"Do not import more than one feature file for a movie. Samples and extras must not be selected.",
		"Use needs_review when the file identity, movie id, or upgrade decision remains uncertain.",
		"Use ignore_queue_item only when the download should stay untouched in the download client but Radarr should stop tracking it.",
	].join("\n");
}

function buildRadarrPrompt(queueItem: QueueItem, candidates: ManualImportCandidate[]): string {
	return `Analyze this Radarr queue item and choose the safest resolution.

Queue item:
${JSON.stringify(
	{
		id: queueItem.id,
		title: queueItem.title,
		movieId: queueItem.movieId,
		movieTitle: queueItem.movieTitle,
		movieYear: queueItem.movieYear,
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
- Read Radarr's statusMessages first.
- Use radarr_get_movie for movie identity and radarr_get_upgrade_context for quality/custom-format/non-upgrade warnings.
- Prefer German candidates, but candidates without German (English or the original language) are acceptable fallbacks; do not remove a download only because it lacks German.
- Never replace an existing movie file whose languages include German with a non-German candidate; check the existing file with radarr_get_upgrade_context first and use needs_review for that conflict.
- Map the chosen candidate to the exact queue/candidate movie id in selectedImports.movieId.
- Select only the main movie file; never select samples, extras, or Blu-ray disc structure chunks.
- If the existing file is better, remove without blocklisting. If the release is unsuitable or the wrong movie, remove and blocklist so Radarr searches again.
- If Radarr rejections are blocking or the movie mapping is unclear, use needs_review.
- Call propose_radarr_resolution now.`;
}

function fallbackProposal(reason: string): ResolutionProposal {
	return {
		action: "needs_review",
		confidence: 0,
		selectedCandidateIds: [],
		selectedImports: [],
		sampleCandidateIds: [],
		reason,
		issueSummary: reason,
		evidence: [],
		warnings: [reason],
	};
}

export class PiResolver {
	async analyze(input: ResolveInput): Promise<AnalysisResult> {
		const { queueItem, candidates, config, signal } = input;
		const log: string[] = [];
		const service = queueItem.service ?? config.activeService;
		const serviceName = service === "radarr" ? "Radarr" : "Sonarr";
		const proposalToolName = service === "radarr" ? "propose_radarr_resolution" : "propose_sonarr_resolution";

		if (candidates.length === 0) {
			const proposal = fallbackProposal(`${serviceName} returned no manual import candidates.`);
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
		const proposalTool = createProposalTool(
			candidateIds,
			(proposal) => {
				capturedProposal = proposal;
			},
			service,
		);
		const lookupTools =
			service === "radarr"
				? (() => {
						const client = new RadarrClient(config.radarrBaseUrl, config.radarrApiKey);
						return createRadarrLookupTools({
							client,
							queueItem,
							getCandidates: () => currentCandidates,
							refreshCandidates: async () => {
								currentCandidates = await client.getManualImportCandidates(queueItem);
								return currentCandidates;
							},
							emit: (event) => emit(input.emit, event),
						});
					})()
				: (() => {
						const client = new SonarrClient(config.sonarrBaseUrl, config.sonarrApiKey);
						return createSonarrLookupTools({
							client,
							queueItem,
							getCandidates: () => currentCandidates,
							refreshCandidates: async () => {
								currentCandidates = await client.getManualImportCandidates(queueItem);
								rememberEpisodeIds(currentCandidates.flatMap((candidate) => candidate.episodeIds));
								return currentCandidates;
							},
							rememberEpisodeIds,
							emit: (event) => emit(input.emit, event),
						});
					})();

		const authStorage = AuthStorage.create();
		const seeded = seedOpenAICodexAuthFromCodex(authStorage);
		const modelRegistry = ModelRegistry.create(authStorage);
		const registeredModel = modelRegistry.find(config.piProvider, config.piModel);
		const codexTemplate =
			config.piProvider === "openai-codex"
				? (modelRegistry.find("openai-codex", "gpt-5.5") ??
					modelRegistry.getAll().find((candidate) => candidate.provider === "openai-codex"))
				: undefined;
		const model =
			registeredModel ??
			(codexTemplate
				? {
						...codexTemplate,
						id: config.piModel,
						name: config.piModel,
					}
				: undefined);
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
			systemPrompt: service === "radarr" ? buildRadarrSystemPrompt() : buildSonarrSystemPrompt(),
		});
		await resourceLoader.reload();

		const { session } = await createAgentSession({
			cwd: process.cwd(),
			agentDir,
			authStorage,
			modelRegistry,
			model,
			thinkingLevel: config.piThinkingLevel,
			tools:
				service === "radarr"
					? [
							"radarr_get_queue_context",
							"radarr_get_movie",
							"radarr_get_manual_import_candidates",
							"radarr_get_upgrade_context",
							"propose_radarr_resolution",
						]
					: [
							"sonarr_get_queue_context",
							"sonarr_find_episodes",
							"sonarr_get_manual_import_candidates",
							"sonarr_get_upgrade_context",
							"propose_sonarr_resolution",
						],
			customTools: [...lookupTools, proposalTool],
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
				if (event.type === "tool_execution_end") {
					emit(input.emit, {
						type: event.isError ? "error" : "pi",
						itemId: queueItem.id,
						message: `Pi completed ${event.toolName}${event.isError ? " with an error" : ""}.`,
						details: {
							toolCallId: event.toolCallId,
							toolName: event.toolName,
							isError: event.isError,
							result: event.result,
						},
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
				await session.prompt(
					service === "radarr"
						? buildRadarrPrompt(queueItem, candidates)
						: buildSonarrPrompt(queueItem, candidates),
				);
			}

			if (!capturedProposal && !signal?.aborted) {
				emit(input.emit, {
					type: "warning",
					itemId: queueItem.id,
					message: "Pi did not call the proposal tool; retrying once.",
				});
				await session.prompt(
					`You did not call ${proposalToolName}. Call it now with the safest ${serviceName} resolution.`,
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
