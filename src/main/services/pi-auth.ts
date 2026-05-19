import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AuthStorage } from "@earendil-works/pi-coding-agent";

type CodexAuthJson = {
	OPENAI_API_KEY?: string;
	tokens?: {
		access_token?: string;
		refresh_token?: string;
		expires_at?: number;
		account_id?: string;
	};
};

function decodeJwtPayload(token: string): Record<string, unknown> | undefined {
	const payload = token.split(".")[1];
	if (!payload) {
		return undefined;
	}

	try {
		return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
	} catch {
		return undefined;
	}
}

function accountIdFromAccessToken(token: string): string | undefined {
	const payload = decodeJwtPayload(token);
	const authClaim = payload?.["https://api.openai.com/auth"];
	if (!authClaim || typeof authClaim !== "object") {
		return undefined;
	}
	const accountId = (authClaim as { chatgpt_account_id?: unknown }).chatgpt_account_id;
	return typeof accountId === "string" ? accountId : undefined;
}

export function seedOpenAICodexAuthFromCodex(authStorage: AuthStorage): boolean {
	if (authStorage.hasAuth("openai-codex")) {
		return false;
	}

	const codexAuthPath = join(homedir(), ".codex", "auth.json");
	if (!existsSync(codexAuthPath)) {
		return false;
	}

	try {
		const codexAuth = JSON.parse(readFileSync(codexAuthPath, "utf8")) as CodexAuthJson;
		const access = codexAuth.tokens?.access_token;
		const refresh = codexAuth.tokens?.refresh_token;
		if (!access || !refresh) {
			return false;
		}

		const accountId = codexAuth.tokens?.account_id ?? accountIdFromAccessToken(access);
		if (!accountId) {
			return false;
		}

		authStorage.set("openai-codex", {
			type: "oauth",
			access,
			refresh,
			expires: codexAuth.tokens?.expires_at ?? Date.now() + 30 * 60 * 1000,
			accountId,
		});
		return true;
	} catch {
		return false;
	}
}
