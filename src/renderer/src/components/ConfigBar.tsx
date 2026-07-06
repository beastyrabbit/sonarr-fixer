import { History, Save, Settings } from "lucide-react";
import { useEffect, useState } from "react";
import type { PiThinkingLevel, PublicConfig } from "../../../shared/types.js";
import { piModelOptions, thinkingOptions } from "../constants.js";
import type { ToastKind } from "../hooks/useToasts.js";
import { parsePiModelValue, piModelValue } from "../utils/config.js";
import { cx } from "../utils/format.js";

export function ConfigBar({
	config,
	open,
	onOpenChange,
	onSaved,
	onHistoryToggle,
	onToast,
}: {
	config: PublicConfig | null;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onSaved: (config: PublicConfig) => void;
	onHistoryToggle: () => void;
	onToast: (kind: ToastKind, message: string) => void;
}) {
	const [saving, setSaving] = useState(false);
	const [sonarrBaseUrl, setSonarrBaseUrl] = useState(config?.sonarrBaseUrl ?? "");
	const [sonarrApiKey, setSonarrApiKey] = useState("");
	const [piProvider, setPiProvider] = useState(config?.piProvider ?? "openai-codex");
	const [piModel, setPiModel] = useState(config?.piModel ?? "gpt-5.4-mini");
	const [piThinkingLevel, setPiThinkingLevel] = useState<PiThinkingLevel>(
		config?.piThinkingLevel ?? "medium",
	);
	const [autoImportConfidence, setAutoImportConfidence] = useState(config?.autoImportConfidence ?? 0.8);
	const [autoResolveParallelism, setAutoResolveParallelism] = useState(config?.autoResolveParallelism ?? 1);

	useEffect(() => {
		if (!config) {
			return;
		}
		setSonarrBaseUrl(config.sonarrBaseUrl);
		setPiProvider(config.piProvider);
		setPiModel(config.piModel);
		setPiThinkingLevel(config.piThinkingLevel);
		setAutoImportConfidence(config.autoImportConfidence);
		setAutoResolveParallelism(config.autoResolveParallelism);
	}, [config]);

	const save = async () => {
		setSaving(true);
		try {
			const saved = await window.sonarrFixer.saveConfig({
				sonarrBaseUrl,
				sonarrApiKey,
				piProvider,
				piModel,
				piThinkingLevel,
				autoImportConfidence,
				autoResolveParallelism,
			});
			setSonarrApiKey("");
			onSaved(saved);
			onOpenChange(!saved.configured);
			onToast("success", "Configuration saved.");
		} catch (error) {
			onToast(
				"error",
				`Could not save configuration: ${error instanceof Error ? error.message : String(error)}`,
			);
		} finally {
			setSaving(false);
		}
	};

	const selectedPiModel = piModelValue(piProvider, piModel);
	const modelOptions = piModelOptions.some(
		(option) => option.provider === piProvider && option.model === piModel,
	)
		? piModelOptions
		: [
				{
					provider: piProvider,
					model: piModel,
					label: `${piProvider}/${piModel}`,
				},
				...piModelOptions,
			];

	return (
		<header className="topbar">
			<div className="brand">
				<div className="brand-title">Sonarr Fixer</div>
				<div className={cx("connection", config?.configured && "ok")}>
					{config?.configured ? config.sonarrBaseUrl : "not configured"}
				</div>
			</div>
			<div className="top-actions">
				<button type="button" className="button secondary" onClick={onHistoryToggle}>
					<History size={16} />
					<span>History</span>
				</button>
				<button
					type="button"
					className="button secondary"
					aria-expanded={open}
					onClick={() => onOpenChange(!open)}
				>
					<Settings size={16} />
					<span>Config</span>
				</button>
			</div>
			{open && (
				<div className="config-row">
					<label>
						<span>Sonarr URL</span>
						<input value={sonarrBaseUrl} onChange={(event) => setSonarrBaseUrl(event.target.value)} />
					</label>
					<label>
						<span>API key</span>
						<input
							type="password"
							value={sonarrApiKey}
							placeholder={config?.hasSonarrApiKey ? "kept" : ""}
							onChange={(event) => setSonarrApiKey(event.target.value)}
						/>
					</label>
					<label>
						<span>Pi model</span>
						<select
							value={selectedPiModel}
							onChange={(event) => {
								const next = parsePiModelValue(event.target.value);
								setPiProvider(next.provider);
								setPiModel(next.model);
							}}
						>
							{modelOptions.map((option) => (
								<option
									key={`${option.provider}/${option.model}`}
									value={piModelValue(option.provider, option.model)}
								>
									{option.label}
								</option>
							))}
						</select>
					</label>
					<label>
						<span>Thinking</span>
						<select
							value={piThinkingLevel}
							onChange={(event) => setPiThinkingLevel(event.target.value as PiThinkingLevel)}
						>
							{thinkingOptions.map((option) => (
								<option key={option.value} value={option.value}>
									{option.label}
								</option>
							))}
						</select>
					</label>
					<label>
						<span>Auto threshold</span>
						<input
							type="number"
							min="0"
							max="1"
							step="0.05"
							value={autoImportConfidence}
							onChange={(event) => setAutoImportConfidence(Number(event.target.value))}
						/>
					</label>
					<label>
						<span>Parallel runs</span>
						<input
							type="number"
							min="1"
							max="10"
							step="1"
							value={autoResolveParallelism}
							onChange={(event) => setAutoResolveParallelism(Number(event.target.value))}
						/>
					</label>
					<button type="button" className="button primary" onClick={save} disabled={saving}>
						<Save size={16} />
						<span>{saving ? "Saving…" : "Save"}</span>
					</button>
				</div>
			)}
		</header>
	);
}
