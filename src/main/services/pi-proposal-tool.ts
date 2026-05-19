import { defineTool } from "@earendil-works/pi-coding-agent";
import { type TSchema, Type } from "typebox";
import type { ResolutionProposal } from "../../shared/types.js";
import { normalizeProposal } from "./validation.js";

type ProposalCapture = (proposal: ResolutionProposal) => void;

function literalUnion(values: string[], fallback: TSchema): TSchema {
	if (values.length === 0) {
		return fallback;
	}
	if (values.length === 1) {
		return Type.Literal(values[0]);
	}
	const literals = values.map((value) => Type.Literal(value)) as unknown as [TSchema, TSchema, ...TSchema[]];
	return Type.Union(literals);
}

export function createProposalTool(candidateIds: string[], capture: ProposalCapture) {
	const candidateId = literalUnion(candidateIds, Type.String({ minLength: 1 }));

	return defineTool({
		name: "propose_sonarr_resolution",
		label: "Propose Sonarr Resolution",
		description:
			"Return the final typed Sonarr queue resolution proposal. This is the only tool that decides what the app will import.",
		promptSnippet: "Return the final typed Sonarr queue resolution proposal.",
		promptGuidelines: [
			"Always finish Sonarr queue analysis by calling propose_sonarr_resolution.",
			"Use selectedImports to explicitly map each chosen file candidate to the Sonarr episode ids it should be imported as.",
			"The selectedImports mapping is authoritative; do not rely on Sonarr's parsed candidate episode ids when you decide they are wrong.",
			"Never select candidates marked as likely samples.",
			"Use needs_review when the candidate data is ambiguous or incomplete.",
		],
		parameters: Type.Object({
			action: Type.Union([
				Type.Literal("import_candidates"),
				Type.Literal("needs_review"),
				Type.Literal("ignore_queue_item"),
				Type.Literal("remove_queue_item"),
			]),
			confidence: Type.Number({
				minimum: 0,
				maximum: 1,
				description: "Confidence from 0 to 1.",
			}),
			selectedCandidateIds: Type.Array(candidateId, {
				description:
					"Candidates to import. Empty unless action is import_candidates. Must match the candidateId values in selectedImports.",
				maxItems: candidateIds.length,
			}),
			selectedImports: Type.Array(
				Type.Object({
					candidateId,
					episodeIds: Type.Array(Type.Integer({ minimum: 1 }), {
						minItems: 1,
						description:
							"Exact Sonarr episode ids this file should be imported as. Choose these ids from the queue/episode lookup context.",
					}),
					reason: Type.Optional(
						Type.String({
							description:
								"Why this file should be imported using these episode ids, especially when Sonarr parsed it differently.",
						}),
					),
				}),
				{
					description:
						"Authoritative file-to-episode mapping for import_candidates. Empty for non-import actions.",
					maxItems: candidateIds.length,
				},
			),
			sampleCandidateIds: Type.Array(candidateId, {
				description: "Candidates believed to be samples.",
				maxItems: candidateIds.length,
			}),
			reason: Type.String({
				minLength: 1,
				description: "Short reason for the proposal.",
			}),
			sonarrIssueSummary: Type.String({
				description: "Explain what Sonarr complained about and how that warning affected the decision.",
			}),
			evidence: Type.Array(Type.String(), {
				description:
					"Concrete evidence used for the decision, such as parsed episode, path, quality, language, size, or Sonarr warnings.",
			}),
			warnings: Type.Array(Type.String(), {
				description: "Risks or ambiguity the user should review.",
			}),
		}),
		async execute(_toolCallId, params) {
			capture(normalizeProposal(params as ResolutionProposal));
			return {
				content: [{ type: "text", text: "Captured Sonarr resolution proposal." }],
				details: params,
				terminate: true,
			};
		},
	});
}
