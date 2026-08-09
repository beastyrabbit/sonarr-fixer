import { describe, expect, it } from "vitest";
import type { DiagnosticExportInput } from "../../shared/types.js";
import { serializeDiagnosticLog } from "./diagnostics.js";

describe("serializeDiagnosticLog", () => {
	it("keeps analysis evidence while redacting credentials at any nesting level", () => {
		const input = {
			formatVersion: 1,
			exportedAt: "2026-07-17T12:00:00.000Z",
			testMode: true,
			config: null,
			queue: [],
			analyses: [
				{
					queueItemId: 42,
					candidates: [],
					proposal: {
						action: "needs_review",
						confidence: 0.4,
						selectedCandidateIds: [],
						selectedImports: [],
						sampleCandidateIds: [],
						reason: "The custom format score is ambiguous.",
						issueSummary: "Needs review",
						evidence: ["Candidate score: 10"],
						warnings: [],
					},
					validation: { ok: true, issues: [] },
					status: "needs_review",
					log: ["Compared candidate custom formats."],
				},
			],
			events: [
				{
					timestamp: "2026-07-17T12:00:00.000Z",
					type: "pi",
					message: "Request failed for https://arr.test/api?api_key=query-secret using Bearer bearer-secret",
					details: {
						apiKey: "should-not-leak",
						nested: { accessToken: "also-secret", candidateScore: 10 },
					},
				},
			],
			history: [{ password: "hidden", action: "analysis_completed" }],
		} satisfies DiagnosticExportInput;

		const serialized = serializeDiagnosticLog(input);

		expect(serialized).toContain("Candidate score: 10");
		expect(serialized).toContain('"candidateScore": 10');
		expect(serialized).toContain('"apiKey": "[redacted]"');
		expect(serialized).toContain('"accessToken": "[redacted]"');
		expect(serialized).toContain('"password": "[redacted]"');
		expect(serialized).not.toContain("should-not-leak");
		expect(serialized).not.toContain("also-secret");
		expect(serialized).not.toContain('"hidden"');
		expect(serialized).not.toContain("query-secret");
		expect(serialized).not.toContain("bearer-secret");
		expect(serialized).toContain("Bearer [redacted]");
	});
});
