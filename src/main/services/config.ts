import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { app } from "electron";
import { z } from "zod";
import type { AppConfig, PiThinkingLevel, PublicConfig, SaveConfigInput } from "../../shared/types.js";

export const defaultConfig: AppConfig = {
	sonarrBaseUrl: "",
	sonarrApiKey: "",
	piProvider: "openai-codex",
	piModel: "gpt-5.4-mini",
	piThinkingLevel: "medium",
	autoImportConfidence: 0.8,
	autoResolveParallelism: 1,
};

const piThinkingLevels = [
	"off",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
] as const satisfies readonly PiThinkingLevel[];

const storedConfigSchema = z
	.object({
		sonarrBaseUrl: z.string().optional(),
		sonarrApiKey: z.string().optional(),
		piProvider: z.string().optional(),
		piModel: z.string().optional(),
		piThinkingLevel: z.enum(piThinkingLevels).optional(),
		autoImportConfidence: z.number().optional(),
		autoResolveParallelism: z.number().optional(),
	})
	.partial();

function configPath(): string {
	return join(app.getPath("userData"), "config.json");
}

function envPath(): string {
	return join(process.cwd(), ".env");
}

function normalizeBaseUrl(value: string): string {
	const trimmed = value.trim().replace(/\/+$/, "");
	if (!trimmed) {
		return trimmed;
	}
	const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
	try {
		const url = new URL(withScheme);
		return url.origin;
	} catch {
		return withScheme;
	}
}

function normalizeParallelism(value: number | undefined): number {
	if (value === undefined || !Number.isFinite(value)) {
		return defaultConfig.autoResolveParallelism;
	}
	return Math.min(10, Math.max(1, Math.round(value)));
}

function normalizeConfig(input: Partial<AppConfig>): AppConfig {
	const piThinkingLevel = piThinkingLevels.includes(input.piThinkingLevel ?? defaultConfig.piThinkingLevel)
		? (input.piThinkingLevel ?? defaultConfig.piThinkingLevel)
		: defaultConfig.piThinkingLevel;
	return {
		...defaultConfig,
		...input,
		sonarrBaseUrl: normalizeBaseUrl(input.sonarrBaseUrl ?? defaultConfig.sonarrBaseUrl),
		sonarrApiKey: (input.sonarrApiKey ?? defaultConfig.sonarrApiKey).trim(),
		piProvider: (input.piProvider ?? defaultConfig.piProvider).trim() || defaultConfig.piProvider,
		piModel: (input.piModel ?? defaultConfig.piModel).trim() || defaultConfig.piModel,
		piThinkingLevel,
		autoImportConfidence: Math.min(
			1,
			Math.max(0, input.autoImportConfidence ?? defaultConfig.autoImportConfidence),
		),
		autoResolveParallelism: normalizeParallelism(input.autoResolveParallelism),
	};
}

function unquoteEnvValue(value: string): string {
	const trimmed = value.trim();
	if (
		(trimmed.startsWith('"') && trimmed.endsWith('"')) ||
		(trimmed.startsWith("'") && trimmed.endsWith("'"))
	) {
		return trimmed.slice(1, -1);
	}
	return trimmed;
}

function parseEnvFile(content: string): Record<string, string> {
	const env: Record<string, string> = {};
	for (const line of content.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) {
			continue;
		}
		const separator = trimmed.indexOf("=");
		if (separator <= 0) {
			continue;
		}
		const key = trimmed.slice(0, separator).trim();
		const value = trimmed.slice(separator + 1);
		env[key] = unquoteEnvValue(value);
	}
	return env;
}

function formatEnvValue(value: string): string {
	if (/^[A-Za-z0-9_./:@-]*$/.test(value)) {
		return value;
	}
	return JSON.stringify(value);
}

function findExistingEnvKey(env: Record<string, string>, aliases: string[], fallback: string): string {
	return aliases.find((key) => env[key] !== undefined) ?? fallback;
}

function setEnvValue(content: string, key: string, value: string): string {
	const lines = content ? content.split(/\r?\n/) : [];
	const nextValue = `${key}=${formatEnvValue(value)}`;
	let updated = false;

	const nextLines = lines.map((line) => {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) {
			return line;
		}
		const separator = line.indexOf("=");
		if (separator <= 0) {
			return line;
		}
		const existingKey = line.slice(0, separator).trim();
		if (existingKey !== key) {
			return line;
		}
		updated = true;
		return nextValue;
	});

	if (!updated) {
		if (nextLines.length > 0 && nextLines[nextLines.length - 1] !== "") {
			nextLines.push("");
		}
		nextLines.push(nextValue);
	}

	return nextLines.join("\n").replace(/\n*$/, "\n");
}

async function loadDotEnv(): Promise<Record<string, string>> {
	try {
		return parseEnvFile(await readFile(envPath(), "utf8"));
	} catch {
		return {};
	}
}

function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
	return values.find((value) => value !== undefined && value.trim().length > 0);
}

async function loadStoredConfig(): Promise<AppConfig> {
	try {
		const raw = await readFile(configPath(), "utf8");
		return normalizeConfig(storedConfigSchema.parse(JSON.parse(raw)));
	} catch {
		return { ...defaultConfig };
	}
}

async function loadEnvOverrides(): Promise<Partial<AppConfig>> {
	const dotEnv = await loadDotEnv();
	const env = { ...dotEnv, ...process.env };
	const confidence = firstNonEmpty(env.AUTO_IMPORT_CONFIDENCE, env.SONARR_AUTO_IMPORT_CONFIDENCE);
	const parallelism = firstNonEmpty(
		env.AUTO_RESOLVE_PARALLELISM,
		env.AUTO_IMPORT_PARALLELISM,
		env.SONARR_FIXER_AUTO_RESOLVE_PARALLELISM,
	);
	const piThinkingLevel = firstNonEmpty(env.PI_THINKING_LEVEL, env.SONARR_FIXER_PI_THINKING_LEVEL);

	return {
		sonarrBaseUrl: firstNonEmpty(env.SONARR_BASE_URL, env.SONARR_URL),
		sonarrApiKey: firstNonEmpty(env.SONARR_API_KEY, env.SONARR_API, env.SONARR_TOKEN),
		piProvider: firstNonEmpty(env.PI_PROVIDER, env.SONARR_FIXER_PI_PROVIDER),
		piModel: firstNonEmpty(env.PI_MODEL, env.SONARR_FIXER_PI_MODEL),
		piThinkingLevel: piThinkingLevel as PiThinkingLevel | undefined,
		autoImportConfidence: confidence ? Number(confidence) : undefined,
		autoResolveParallelism: parallelism ? Number(parallelism) : undefined,
	};
}

async function saveDotEnvConfig(config: AppConfig): Promise<void> {
	const path = envPath();
	let content = "";
	try {
		content = await readFile(path, "utf8");
	} catch {
		content = "";
	}

	const env = parseEnvFile(content);
	const urlKey = findExistingEnvKey(env, ["SONARR_BASE_URL", "SONARR_URL"], "SONARR_URL");
	const apiKey = findExistingEnvKey(env, ["SONARR_API_KEY", "SONARR_API", "SONARR_TOKEN"], "SONARR_API");

	let next = content;
	next = setEnvValue(next, urlKey, config.sonarrBaseUrl);
	next = setEnvValue(next, apiKey, config.sonarrApiKey);
	next = setEnvValue(next, "PI_PROVIDER", config.piProvider);
	next = setEnvValue(next, "PI_MODEL", config.piModel);
	next = setEnvValue(next, "PI_THINKING_LEVEL", config.piThinkingLevel);
	next = setEnvValue(next, "AUTO_IMPORT_CONFIDENCE", String(config.autoImportConfidence));
	next = setEnvValue(next, "AUTO_RESOLVE_PARALLELISM", String(config.autoResolveParallelism));

	await mkdir(dirname(path), { recursive: true, mode: 0o700 });
	await writeFile(path, next, "utf8");
	await chmod(path, 0o600).catch(() => undefined);
}

export async function loadConfig(): Promise<AppConfig> {
	return normalizeConfig({
		...(await loadStoredConfig()),
		...(await loadEnvOverrides()),
	});
}

export async function saveConfig(input: SaveConfigInput): Promise<PublicConfig> {
	const current = await loadConfig();
	const next = normalizeConfig({
		sonarrBaseUrl: input.sonarrBaseUrl,
		sonarrApiKey: input.sonarrApiKey?.trim() ? input.sonarrApiKey : current.sonarrApiKey,
		piProvider: input.piProvider,
		piModel: input.piModel,
		piThinkingLevel: input.piThinkingLevel ?? current.piThinkingLevel,
		autoImportConfidence: input.autoImportConfidence,
		autoResolveParallelism: input.autoResolveParallelism ?? current.autoResolveParallelism,
	});

	await saveDotEnvConfig(next);
	return toPublicConfig(await loadConfig());
}

export function toPublicConfig(config: AppConfig): PublicConfig {
	return {
		sonarrBaseUrl: config.sonarrBaseUrl,
		hasSonarrApiKey: config.sonarrApiKey.length > 0,
		piProvider: config.piProvider,
		piModel: config.piModel,
		piThinkingLevel: config.piThinkingLevel,
		autoImportConfidence: config.autoImportConfidence,
		autoResolveParallelism: config.autoResolveParallelism,
		configured: config.sonarrBaseUrl.length > 0 && config.sonarrApiKey.length > 0,
	};
}
