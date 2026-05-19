import { Value } from "typebox/value";
import { describe, expect, it } from "vitest";
import type { ResolutionProposal } from "../../shared/types.js";
import { createProposalTool } from "./pi-proposal-tool.js";

describe("createProposalTool", () => {
	it("restricts candidate ids through the TypeBox schema", () => {
		const tool = createProposalTool(["candidate_1", "candidate_2"], () => undefined);
		const valid = {
			action: "import_candidates",
			confidence: 0.9,
			selectedCandidateIds: ["candidate_1"],
			selectedImports: [{ candidateId: "candidate_1", episodeIds: [101] }],
			sampleCandidateIds: ["candidate_2"],
			reason: "candidate_1 is the episode; candidate_2 is sample",
			sonarrIssueSummary: "Sonarr warning was caused by the sample file.",
			evidence: ["candidate_1 has the target episode id."],
			warnings: [],
		};
		const invalid = { ...valid, selectedCandidateIds: ["candidate_3"] };
		const invalidMapping = { ...valid, selectedImports: [{ candidateId: "candidate_3", episodeIds: [101] }] };

		expect(Value.Check(tool.parameters, valid)).toBe(true);
		expect(Value.Check(tool.parameters, invalid)).toBe(false);
		expect(Value.Check(tool.parameters, invalidMapping)).toBe(false);
	});

	it("captures a normalized terminating proposal", async () => {
		let captured: ResolutionProposal | undefined;
		const tool = createProposalTool(["candidate_1"], (proposal) => {
			captured = proposal;
		});

		const result = await tool.execute(
			"call_1",
			{
				action: "import_candidates",
				confidence: 2,
				selectedCandidateIds: ["candidate_1"],
				selectedImports: [{ candidateId: "candidate_1", episodeIds: [101] }],
				sampleCandidateIds: [],
				reason: "correct file",
				sonarrIssueSummary: "Sonarr warning does not block candidate_1.",
				evidence: ["candidate_1 has usable metadata."],
				warnings: [],
			},
			undefined,
			undefined,
			undefined as never,
		);

		expect(result.terminate).toBe(true);
		expect(captured?.confidence).toBe(1);
	});
});
