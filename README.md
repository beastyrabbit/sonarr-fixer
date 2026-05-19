# Sonarr Fixer

Sonarr Fixer is a local Electron desktop app for working through stuck Sonarr import queue items.
It loads warning-state queue entries, asks Pi to inspect Sonarr's manual import candidates, then lets
you review and apply a typed import proposal.

This is meant for power users who already understand Sonarr manual imports. It can start Sonarr
`ManualImport` commands and can remove queue items when you explicitly choose that action.

## What It Does

- Lists Sonarr queue items that are completed but blocked by import warnings.
- Loads Sonarr manual import candidates for a selected download.
- Uses Pi with read-only Sonarr lookup tools to propose a resolution.
- Maps chosen files to exact Sonarr episode IDs instead of trusting Sonarr's first parse.
- Flags likely samples and blocks sample imports through local validation.
- Applies valid import proposals through Sonarr's API after review.
- Supports bulk analysis with optional auto-import above a configurable confidence threshold.

## Safety Model

- Pi receives structured queue and candidate data, not unrestricted Sonarr access.
- Pi can use read-only Sonarr lookup tools during analysis.
- Pi must return one typed `propose_sonarr_resolution` result.
- The app validates the proposal locally before importing.
- Queue removal is never automatic. It only happens when you click the remove action.
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
2. Run `Doctor` to verify Sonarr and Pi auth.
3. Load the queue.
4. Select a queue item and run analysis.
5. Review the proposal, validation result, selected candidate, and episode mapping.
6. Apply the import only when the proposal matches what you expect.

## Configuration

`AUTO_IMPORT_CONFIDENCE` sets the minimum Pi confidence required for auto-import. Use a value from
`0` to `1`.

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
