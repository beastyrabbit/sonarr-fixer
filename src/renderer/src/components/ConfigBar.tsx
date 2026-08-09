import { CheckCircle2, History, LoaderCircle, Save, Settings, X, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import type { MediaService, PiModelOption, PiThinkingLevel, PublicConfig } from "../../../shared/types.js";
import { thinkingOptions } from "../constants.js";
import type { ToastKind } from "../hooks/useToasts.js";
import { parsePiModelValue, piModelValue } from "../utils/config.js";
import { cx } from "../utils/format.js";

type ConnectionTestState = {
	status: "idle" | "testing" | "success" | "error";
	message?: string;
};

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
	const [activeService, setActiveService] = useState<MediaService>(config?.activeService ?? "sonarr");
	const [sonarrBaseUrl, setSonarrBaseUrl] = useState(config?.sonarrBaseUrl ?? "");
	const [sonarrApiKey, setSonarrApiKey] = useState("");
	const [radarrBaseUrl, setRadarrBaseUrl] = useState(config?.radarrBaseUrl ?? "");
	const [radarrApiKey, setRadarrApiKey] = useState("");
	const [piProvider, setPiProvider] = useState(config?.piProvider ?? "openai-codex");
	const [piModel, setPiModel] = useState(config?.piModel ?? "gpt-5.4-mini");
	const [modelOptions, setModelOptions] = useState<PiModelOption[]>([]);
	const [modelsLoading, setModelsLoading] = useState(false);
	const [modelSource, setModelSource] = useState<"codex-app-server" | "pi-registry">();
	const [piThinkingLevel, setPiThinkingLevel] = useState<PiThinkingLevel>(
		config?.piThinkingLevel ?? "medium",
	);
	const [autoImportConfidence, setAutoImportConfidence] = useState(config?.autoImportConfidence ?? 0.8);
	const [autoResolveParallelism, setAutoResolveParallelism] = useState(config?.autoResolveParallelism ?? 1);
	const [connectionTests, setConnectionTests] = useState<Record<MediaService, ConnectionTestState>>({
		sonarr: { status: "idle" },
		radarr: { status: "idle" },
	});

	useEffect(() => {
		if (!config) {
			return;
		}
		setActiveService(config.activeService);
		setSonarrBaseUrl(config.sonarrBaseUrl);
		setRadarrBaseUrl(config.radarrBaseUrl);
		setPiProvider(config.piProvider);
		setPiModel(config.piModel);
		setPiThinkingLevel(config.piThinkingLevel);
		setAutoImportConfidence(config.autoImportConfidence);
		setAutoResolveParallelism(config.autoResolveParallelism);
	}, [config]);

	useEffect(() => {
		if (!open) {
			return;
		}
		let cancelled = false;
		setModelsLoading(true);
		void window.sonarrFixer
			.listPiModels()
			.then((catalog) => {
				if (cancelled) {
					return;
				}
				setModelOptions(catalog.options);
				setModelSource(catalog.source);
			})
			.catch((error) => {
				if (!cancelled) {
					onToast(
						"error",
						`Could not load Pi models: ${error instanceof Error ? error.message : String(error)}`,
					);
				}
			})
			.finally(() => {
				if (!cancelled) {
					setModelsLoading(false);
				}
			});
		return () => {
			cancelled = true;
		};
	}, [open, onToast]);

	const save = async (service: MediaService = activeService) => {
		setSaving(true);
		try {
			const saved = await window.sonarrFixer.saveConfig({
				activeService: service,
				sonarrBaseUrl,
				sonarrApiKey,
				radarrBaseUrl,
				radarrApiKey,
				piProvider,
				piModel,
				piThinkingLevel,
				autoImportConfidence,
				autoResolveParallelism,
			});
			setSonarrApiKey("");
			setRadarrApiKey("");
			setActiveService(saved.activeService);
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

	const switchService = async (service: MediaService) => {
		if (service === activeService || saving) {
			return;
		}
		await save(service);
	};

	const runConnectionTest = async (service: MediaService) => {
		setConnectionTests((current) => ({
			...current,
			[service]: { status: "testing", message: "Testing connection…" },
		}));
		try {
			const result = await window.sonarrFixer.testConnection({
				service,
				baseUrl: service === "radarr" ? radarrBaseUrl : sonarrBaseUrl,
				apiKey: service === "radarr" ? radarrApiKey : sonarrApiKey,
			});
			setConnectionTests((current) => ({
				...current,
				[service]: {
					status: result.ok ? "success" : "error",
					message: result.message,
				},
			}));
		} catch (error) {
			setConnectionTests((current) => ({
				...current,
				[service]: {
					status: "error",
					message: error instanceof Error ? error.message : String(error),
				},
			}));
		}
	};

	const selectedPiModel = piModelValue(piProvider, piModel);
	const visibleModelOptions = modelOptions.some(
		(option) => option.provider === piProvider && option.model === piModel,
	)
		? modelOptions
		: [
				{
					provider: piProvider,
					model: piModel,
					label: `${piProvider}/${piModel}`,
				},
				...modelOptions,
			];
	const selectedModelDescription = visibleModelOptions.find(
		(option) => option.provider === piProvider && option.model === piModel,
	)?.description;

	return (
		<>
			<header className="topbar">
				<div className="brand">
					<div className="brand-title">Arr Fixer</div>
					<div className={cx("connection", config?.configured && "ok")}>
						{config?.configured
							? config.activeService === "radarr"
								? config.radarrBaseUrl
								: config.sonarrBaseUrl
							: `${activeService === "radarr" ? "Radarr" : "Sonarr"} not configured`}
					</div>
				</div>
				<div className="top-actions">
					<div className="service-switch">
						<button
							type="button"
							className={cx(activeService === "sonarr" && "active")}
							aria-pressed={activeService === "sonarr"}
							onClick={() => void switchService("sonarr")}
						>
							Sonarr
						</button>
						<button
							type="button"
							className={cx(activeService === "radarr" && "active")}
							aria-pressed={activeService === "radarr"}
							onClick={() => void switchService("radarr")}
						>
							Radarr
						</button>
					</div>
					<button type="button" className="button secondary" onClick={onHistoryToggle}>
						<History size={16} />
						<span>History</span>
					</button>
					<button
						type="button"
						className="button secondary"
						aria-expanded={open}
						onClick={() => onOpenChange(true)}
					>
						<Settings size={16} />
						<span>Config</span>
					</button>
				</div>
			</header>

			{open && (
				<form
					className="settings-screen"
					role="dialog"
					aria-modal="true"
					aria-labelledby="settings-title"
					onSubmit={(event) => {
						event.preventDefault();
						void save();
					}}
				>
					<header className="settings-head">
						<div>
							<h1 id="settings-title">Configuration</h1>
							<p>Connections and resolver behavior are managed together here.</p>
						</div>
						<button
							type="button"
							className="icon-button settings-close"
							aria-label="Close configuration"
							onClick={() => onOpenChange(false)}
						>
							<X size={20} />
						</button>
					</header>

					<div className="settings-body">
						<section className="settings-section">
							<div className="settings-section-head">
								<div>
									<h2>Media managers</h2>
									<p>Enter both connections once. Choose which queue is active from the header.</p>
								</div>
								<label className="active-manager">
									<span>Active queue</span>
									<select
										value={activeService}
										onChange={(event) => setActiveService(event.target.value as MediaService)}
									>
										<option value="sonarr">Sonarr</option>
										<option value="radarr">Radarr</option>
									</select>
								</label>
							</div>

							<div className="manager-grid">
								<div className="manager-config">
									<div className="manager-title">
										<h3>Sonarr</h3>
										<span>Series</span>
									</div>
									<label>
										<span>URL</span>
										<input
											value={sonarrBaseUrl}
											placeholder="http://sonarr.local:8989"
											onChange={(event) => {
												setSonarrBaseUrl(event.target.value);
												setConnectionTests((current) => ({
													...current,
													sonarr: { status: "idle" },
												}));
											}}
										/>
									</label>
									<label>
										<span>API key</span>
										<input
											type="password"
											value={sonarrApiKey}
											placeholder={config?.hasSonarrApiKey ? "Stored key will be used" : ""}
											onChange={(event) => {
												setSonarrApiKey(event.target.value);
												setConnectionTests((current) => ({
													...current,
													sonarr: { status: "idle" },
												}));
											}}
										/>
									</label>
									<div className="connection-test-row">
										<button
											type="button"
											className="button secondary"
											disabled={connectionTests.sonarr.status === "testing" || !sonarrBaseUrl.trim()}
											onClick={() => void runConnectionTest("sonarr")}
										>
											{connectionTests.sonarr.status === "testing" ? (
												<LoaderCircle className="spin" size={16} />
											) : (
												<CheckCircle2 size={16} />
											)}
											<span>Test connection</span>
										</button>
										<ConnectionTestStatus state={connectionTests.sonarr} />
									</div>
								</div>

								<div className="manager-config">
									<div className="manager-title">
										<h3>Radarr</h3>
										<span>Movies</span>
									</div>
									<label>
										<span>URL</span>
										<input
											value={radarrBaseUrl}
											placeholder="http://radarr.local:7878"
											onChange={(event) => {
												setRadarrBaseUrl(event.target.value);
												setConnectionTests((current) => ({
													...current,
													radarr: { status: "idle" },
												}));
											}}
										/>
									</label>
									<label>
										<span>API key</span>
										<input
											type="password"
											value={radarrApiKey}
											placeholder={config?.hasRadarrApiKey ? "Stored key will be used" : ""}
											onChange={(event) => {
												setRadarrApiKey(event.target.value);
												setConnectionTests((current) => ({
													...current,
													radarr: { status: "idle" },
												}));
											}}
										/>
									</label>
									<div className="connection-test-row">
										<button
											type="button"
											className="button secondary"
											disabled={connectionTests.radarr.status === "testing" || !radarrBaseUrl.trim()}
											onClick={() => void runConnectionTest("radarr")}
										>
											{connectionTests.radarr.status === "testing" ? (
												<LoaderCircle className="spin" size={16} />
											) : (
												<CheckCircle2 size={16} />
											)}
											<span>Test connection</span>
										</button>
										<ConnectionTestStatus state={connectionTests.radarr} />
									</div>
								</div>
							</div>
						</section>

						<section className="settings-section">
							<div className="settings-section-head">
								<div>
									<h2>AI resolver</h2>
									<p>Models are requested from the local Codex app server when this screen opens.</p>
								</div>
							</div>
							<div className="resolver-settings-grid">
								<label className="model-field">
									<span>
										Pi model
										{modelsLoading
											? " · loading…"
											: modelSource === "pi-registry"
												? " · registry fallback"
												: ""}
									</span>
									<select
										value={selectedPiModel}
										title={selectedModelDescription}
										disabled={modelsLoading && visibleModelOptions.length === 0}
										onChange={(event) => {
											const next = parsePiModelValue(event.target.value);
											setPiProvider(next.provider);
											setPiModel(next.model);
										}}
									>
										{visibleModelOptions.map((option) => (
											<option
												key={`${option.provider}/${option.model}`}
												value={piModelValue(option.provider, option.model)}
											>
												{option.label}
												{option.isDefault ? " · default" : ""}
											</option>
										))}
									</select>
									{selectedModelDescription && <small>{selectedModelDescription}</small>}
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
									<span>Auto-import threshold</span>
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
									<span>Parallel analyses</span>
									<input
										type="number"
										min="1"
										max="10"
										step="1"
										value={autoResolveParallelism}
										onChange={(event) => setAutoResolveParallelism(Number(event.target.value))}
									/>
								</label>
							</div>
						</section>
					</div>

					<footer className="settings-footer">
						<span>API keys are written only to the local .env file.</span>
						<div>
							<button type="button" className="button" onClick={() => onOpenChange(false)}>
								Cancel
							</button>
							<button type="submit" className="button primary" disabled={saving}>
								<Save size={16} />
								<span>{saving ? "Saving…" : "Save configuration"}</span>
							</button>
						</div>
					</footer>
				</form>
			)}
		</>
	);
}

function ConnectionTestStatus({ state }: { state: ConnectionTestState }) {
	if (state.status === "idle") {
		return <span className="connection-test-status idle">Not tested</span>;
	}
	return (
		<span className={cx("connection-test-status", state.status)}>
			{state.status === "success" ? <CheckCircle2 size={15} /> : null}
			{state.status === "error" ? <XCircle size={15} /> : null}
			{state.message}
		</span>
	);
}
