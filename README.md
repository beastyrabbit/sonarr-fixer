# Sonarr Fixer

Sonarr Fixer is a local Electron desktop app for working through stuck Sonarr import queue items.
It loads warning-state queue entries, asks Pi to inspect Sonarr's manual import candidates, then lets
you review and apply a typed import proposal.

This is meant for power users who already understand Sonarr manual imports. It can start Sonarr
`ManualImport` commands and can remove queue items either explicitly or through narrow local rules.

## What It Does

- Lists Sonarr queue items that are completed but blocked by import warnings.
- Loads Sonarr manual import candidates for a selected download.
- Uses Pi with read-only Sonarr lookup tools to propose a resolution.
- Lets Pi inspect current episode files, quality profiles, and custom format scores before deciding non-upgrade/custom-format warnings.
- Maps chosen files to exact Sonarr episode IDs instead of trusting Sonarr's first parse.
- Instructs Pi that imported files must include German; unsuitable non-German releases should be removed, blocklisted, and left for Sonarr to search again.
- Instructs Pi to plain-remove ordinary non-upgrades when the existing episode file is already better, without blocklisting the release.
- Flags likely samples and blocks sample imports through local validation.
- Applies valid import proposals through Sonarr's API after review.
- Instructs Pi to never import Blu-ray disc structure chunks (`BDMV/STREAM/*.m2ts`) and to remove/blocklist such downloads.
- Flags completed downloads with no manual import candidates for review so they can be removed and re-searched.
- Supports bulk analysis with optional auto-apply for safe imports.

## Safety Model

- Pi receives structured queue and candidate data, not unrestricted Sonarr access.
- Pi can use read-only Sonarr lookup tools during analysis.
- Pi must return one typed `propose_sonarr_resolution` result.
- Pi can return queue removal options for delete/blocklist/search or plain removal decisions.
- The app validates the proposal locally before importing.
- Pi-suggested queue removal can auto-apply only when the proposal is valid, includes explicit removal options, and has at least 95% confidence.
- Auto-import only applies `import_candidates` proposals that pass validation and meet the configured confidence threshold.

## Requirements

- Node.js with `pnpm`
- A reachable Sonarr instance and API key
- Pi auth for the configured provider

For the default `openai-codex` provider, the app can reuse an existing Codex auth file at
`~/.codex/auth.json`.

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
SONARR_URL=http://sonarr.local:8989
SONARR_API=your_api_key
PI_PROVIDER=openai-codex
PI_MODEL=gpt-5.4-mini
PI_THINKING_LEVEL=medium
AUTO_IMPORT_CONFIDENCE=0.8
AUTO_RESOLVE_PARALLELISM=1
```

Supported Sonarr API key aliases are `SONARR_API_KEY`, `SONARR_API`, and `SONARR_TOKEN`.
Supported Sonarr URL aliases are `SONARR_BASE_URL` and `SONARR_URL`.

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

1. Open `Config`, enter the Sonarr URL and API key, and choose a Pi model.
2. Let the queue auto-load, or use `Refresh` to reload it manually.
3. Select a queue item and run analysis, or use `Analyze all` for every actionable row.
4. Review the proposal, validation result, selected candidate, and episode mapping.
5. Use `History` to inspect prior AI proposals and Sonarr actions.
6. Apply the import only when the proposal matches what you expect.

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
