# Arr Fixer

Arr Fixer is a local Electron desktop app for working through stuck Sonarr and Radarr import queue
items. It loads warning-state queue entries, asks Pi to inspect the active manager's manual import candidates, then lets
you review and apply a typed import proposal.

This is meant for power users who already understand Sonarr and Radarr manual imports. It can start
`ManualImport` commands and can remove queue items either explicitly or through narrow local rules.

Detailed implementation and operating documentation is available in [`docs/`](docs/README.md),
including the [architecture](docs/architecture.md), [resolution workflows](docs/workflows.md), and
[diagnostic review guide](docs/diagnostics.md).

## What It Does

- Keeps Sonarr, Radarr, and resolver settings together in one full-screen configuration view.
- Tests either manager connection with the currently entered URL and API key before saving.
- Switches between Sonarr and Radarr queues without re-entering either connection.
- Lists completed queue items that are blocked by import warnings.
- Loads manual import candidates for a selected download.
- Uses Pi with manager-specific, read-only lookup tools to propose a resolution.
- Lets Pi inspect current episode files, quality profiles, and custom format scores before deciding non-upgrade/custom-format warnings.
- Maps Sonarr files to exact episode IDs and Radarr files to exact movie IDs instead of trusting the first parse.
- Instructs Pi to prefer German releases but to import non-German (English or original-language) candidates as acceptable fallbacks; German versions arrive later through the manager's normal upgrade flow.
- Instructs Pi to remove and blocklist genuinely unsuitable releases (wrong episode or series, no usable video files) so the active manager can search again — but never only because a release lacks German.
- Refuses, deterministically at apply time, any import that would replace an existing file whose languages include German with a non-German file; language downgrades require manual action in the manager.
- Instructs Pi to plain-remove ordinary non-upgrades when the existing episode file is already better, without blocklisting the release.
- Flags likely samples and blocks sample imports through local validation.
- Applies valid import proposals through the active manager's API after review.
- Instructs Pi to never import Blu-ray disc structure chunks (`BDMV/STREAM/*.m2ts`) and to remove/blocklist such downloads.
- Flags completed downloads with no manual import candidates for review so they can be removed and re-searched.
- Supports bulk analysis with optional auto-apply for safe imports.
- Starts in dry-run mode so analysis is live while imports and queue mutations are blocked.
- Exports a redacted diagnostic JSON containing queue data, candidates, read-only tool results,
  proposals, validation, events, and history for decision review.

## Safety Model

- Pi receives structured queue and candidate data, not unrestricted manager access.
- Pi can use read-only Sonarr or Radarr lookup tools during analysis.
- Dry-run mode is enabled at startup and disables every import, remove, ignore, and auto-apply action.
- Pi must return one typed `propose_sonarr_resolution` or `propose_radarr_resolution` result.
- Pi can return queue removal options for delete/blocklist/search or plain removal decisions.
- The app validates the proposal locally before importing.
- Pi-suggested queue removal can auto-apply only when the proposal is valid, includes explicit removal options, and has at least 95% confidence.
- Auto-import only applies `import_candidates` proposals that pass validation and meet the configured confidence threshold.

## Requirements

- Node.js with `pnpm`
- A reachable Sonarr and/or Radarr instance and API key
- Pi auth for the configured provider

For the default `openai-codex` provider, the app can reuse an existing Codex auth file at
`~/.codex/auth.json`.
The model picker requests the current catalog from `codex app-server` when Config opens and falls
back to Pi's built-in registry if Codex is unavailable.

## Setup

Install dependencies:

```bash
pnpm install
```

Create a local environment file if you want to configure the app before opening it:

```bash
cp .env.example .env
```

Edit `.env`:

```bash
ARR_SERVICE=sonarr
SONARR_URL=http://sonarr.local:8989
SONARR_API=your_api_key
RADARR_URL=http://radarr.local:7878
RADARR_API=your_api_key
PI_PROVIDER=openai-codex
PI_MODEL=gpt-5.4-mini
PI_THINKING_LEVEL=medium
AUTO_IMPORT_CONFIDENCE=0.8
AUTO_RESOLVE_PARALLELISM=1
```

Supported Sonarr API key aliases are `SONARR_API_KEY`, `SONARR_API`, and `SONARR_TOKEN`.
Supported Sonarr URL aliases are `SONARR_BASE_URL` and `SONARR_URL`.
Radarr supports the matching `RADARR_API_KEY`/`RADARR_API`/`RADARR_TOKEN` and
`RADARR_BASE_URL`/`RADARR_URL` aliases. `ARR_SERVICE` selects `sonarr` or `radarr`.

Values from `.env` override the fallback Electron config at runtime. Pressing `Save` in the app
updates `.env`.

## Run

Development mode:

```bash
pnpm dev
```

Build and open the app:

```bash
./run
```

or:

```bash
pnpm start
```

Inside the app:

1. Open `Config`, enter both manager connections in the single full-screen form, test each
   connection, and choose a Pi model.
2. Save once, select the active Sonarr or Radarr queue, then refresh it if needed.
3. Keep `Dry run` enabled, select a queue item, and run analysis (or use `Analyze all`).
4. Review the proposal, validation result, selected candidate, episode/movie mapping, and
   custom-format evidence.
5. Expand structured entries in `Diagnostic log`, or use `Export full log` and attach the JSON for
   an independent review of whether the same action should have been chosen.
6. Disable `Dry run` only after the proposal matches what you expect, then apply the action.

## Configuration

`AUTO_IMPORT_CONFIDENCE` sets the minimum Pi confidence required for auto-import. Use a value from
`0` to `1`. Local deterministic delete/blocklist rules do not use this threshold.

`AUTO_RESOLVE_PARALLELISM` controls how many queue items bulk auto-resolve may analyze at once. It
is clamped from `1` to `10`. Lower values are safer if Pi sessions fail to return typed proposals
under load.

`PI_THINKING_LEVEL` supports `off`, `minimal`, `low`, `medium`, `high`, and `xhigh`.

## Development

Useful checks:

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

Format code:

```bash
pnpm format
```

This repo uses Lefthook for local hooks and gitleaks for secret scanning:

```bash
pnpm exec lefthook install
pnpm secrets:scan
```

The pre-commit hook scans staged changes. The pre-push hook scans Git history before pushing.

## License

MIT. See [LICENSE](LICENSE).
