import { describe, expect, it } from "vitest";
import { normalizeCodexModels } from "./pi-models.js";

describe("normalizeCodexModels", () => {
	it("maps visible Codex models and preserves server order", () => {
		expect(
			normalizeCodexModels({
				data: [
					{
						id: "gpt-5.6-sol",
						model: "gpt-5.6-sol",
						displayName: "GPT-5.6-Sol",
						description: "Latest frontier agentic coding model.",
						hidden: false,
						isDefault: true,
					},
					{
						id: "hidden-model",
						displayName: "Hidden",
						hidden: true,
					},
					{
						id: "gpt-5.6-sol",
						displayName: "Duplicate",
					},
					{
						id: "gpt-5.6-terra",
						displayName: "GPT-5.6-Terra",
					},
				],
			}),
		).toEqual([
			{
				provider: "openai-codex",
				model: "gpt-5.6-sol",
				label: "GPT-5.6-Sol",
				description: "Latest frontier agentic coding model.",
				isDefault: true,
			},
			{
				provider: "openai-codex",
				model: "gpt-5.6-terra",
				label: "GPT-5.6-Terra",
				description: undefined,
				isDefault: false,
			},
		]);
	});
});
