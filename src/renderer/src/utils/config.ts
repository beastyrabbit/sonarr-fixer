export function piModelValue(provider: string, model: string): string {
	return JSON.stringify([provider, model]);
}

export function parsePiModelValue(value: string): { provider: string; model: string } {
	try {
		const parsed = JSON.parse(value);
		if (Array.isArray(parsed) && typeof parsed[0] === "string" && typeof parsed[1] === "string") {
			return { provider: parsed[0], model: parsed[1] };
		}
	} catch {
		// Fall through to defaults.
	}
	return { provider: "openai-codex", model: "gpt-5.4-mini" };
}
