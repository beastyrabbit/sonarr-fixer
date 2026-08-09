import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { AuthStorage, ModelRegistry } from "@earendil-works/pi-coding-agent";
import type { PiModelCatalog, PiModelOption } from "../../shared/types.js";

type CodexModelRecord = {
	id?: unknown;
	model?: unknown;
	displayName?: unknown;
	description?: unknown;
	hidden?: unknown;
	isDefault?: unknown;
};

type CodexModelListResult = {
	data?: unknown;
};

function nonEmptyString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function normalizeCodexModels(value: unknown): PiModelOption[] {
	const records =
		value && typeof value === "object" && Array.isArray((value as CodexModelListResult).data)
			? ((value as CodexModelListResult).data as CodexModelRecord[])
			: [];
	const seen = new Set<string>();
	const options: PiModelOption[] = [];
	for (const record of records) {
		if (!record || typeof record !== "object" || record.hidden === true) {
			continue;
		}
		const model = nonEmptyString(record.model) ?? nonEmptyString(record.id);
		if (!model || seen.has(model)) {
			continue;
		}
		seen.add(model);
		options.push({
			provider: "openai-codex",
			model,
			label: nonEmptyString(record.displayName) ?? model,
			description: nonEmptyString(record.description),
			isDefault: record.isDefault === true,
		});
	}
	return options;
}

async function requestCodexModels(timeoutMs = 8_000): Promise<PiModelOption[]> {
	return new Promise((resolve, reject) => {
		const child = spawn(process.env.CODEX_BINARY?.trim() || "codex", ["app-server", "--stdio"], {
			stdio: ["pipe", "pipe", "ignore"],
		});
		const lines = createInterface({ input: child.stdout });
		let settled = false;

		const finish = (error?: Error, options?: PiModelOption[]) => {
			if (settled) {
				return;
			}
			settled = true;
			clearTimeout(timer);
			lines.close();
			child.stdin.end();
			child.kill();
			if (error) {
				reject(error);
			} else {
				resolve(options ?? []);
			}
		};
		const send = (message: unknown) => {
			child.stdin.write(`${JSON.stringify(message)}\n`);
		};
		const timer = setTimeout(
			() => finish(new Error("Timed out while requesting the Codex model catalog.")),
			timeoutMs,
		);

		child.once("error", () => finish(new Error("Could not start the Codex app server.")));
		child.once("exit", () => {
			if (!settled) {
				finish(new Error("The Codex app server stopped before returning models."));
			}
		});
		lines.on("line", (line) => {
			let message: {
				id?: number;
				result?: unknown;
				error?: { message?: string };
			};
			try {
				message = JSON.parse(line);
			} catch {
				return;
			}
			if (message.id === 0) {
				if (message.error) {
					finish(new Error(message.error.message || "Codex initialization failed."));
					return;
				}
				send({ method: "initialized", params: {} });
				send({
					method: "model/list",
					id: 1,
					params: { limit: 100, includeHidden: false },
				});
				return;
			}
			if (message.id === 1) {
				if (message.error) {
					finish(new Error(message.error.message || "Codex model request failed."));
					return;
				}
				const options = normalizeCodexModels(message.result);
				if (options.length === 0) {
					finish(new Error("Codex returned an empty model catalog."));
					return;
				}
				finish(undefined, options);
			}
		});

		send({
			method: "initialize",
			id: 0,
			params: {
				clientInfo: {
					name: "arr_fixer",
					title: "Arr Fixer",
					version: "0.1.0",
				},
			},
		});
	});
}

function piRegistryOptions(): PiModelOption[] {
	const registry = ModelRegistry.create(AuthStorage.create());
	return registry
		.getAll()
		.filter((model) => model.provider === "openai-codex")
		.map((model) => ({
			provider: model.provider,
			model: model.id,
			label: model.name,
		}));
}

export async function listPiModels(): Promise<PiModelCatalog> {
	try {
		return {
			options: await requestCodexModels(),
			source: "codex-app-server",
		};
	} catch (error) {
		return {
			options: piRegistryOptions(),
			source: "pi-registry",
			warning: error instanceof Error ? error.message : String(error),
		};
	}
}
