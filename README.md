# Sonarr Fixer

Small Electron + TypeScript desktop tool for resolving Sonarr import queue items with Pi.

## Run

```bash
pnpm dev
```

For normal built usage:

```bash
./run
```

or:

```bash
pnpm start
```

The app opens as a desktop window. Enter the Sonarr URL and API key in `Config`, then run `Doctor`.

## Environment

Connection info can also come from `.env` in this project directory:

```bash
SONARR_URL=http://sonarr.local:8989
SONARR_API=your_api_key
PI_MODEL=gpt-5.4-mini
PI_THINKING_LEVEL=medium
AUTO_IMPORT_CONFIDENCE=0.8
AUTO_RESOLVE_PARALLELISM=1
```

Supported aliases are `SONARR_BASE_URL`, `SONARR_API_KEY`, and `SONARR_TOKEN`.
Values from `.env` override the fallback Electron config at runtime. Pressing `Save` in the GUI updates `.env`.

`AUTO_RESOLVE_PARALLELISM` controls how many queue items bulk auto-resolve may analyze at once. It is clamped from `1` to `10`; lower values are safer if Pi sessions fail to return typed proposals under load.

## Safety Model

- Pi is embedded through the Node SDK, not launched through the Pi TUI.
- Pi gets only structured queue/candidate data.
- Pi can only call one TypeBox-validated tool: `propose_sonarr_resolution`.
- The app validates the proposal and applies Sonarr imports itself.
- Queue removal is never automatic.

## Checks

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

## Git Hooks

This repo uses Lefthook for local hooks and gitleaks for secret scanning.

```bash
pnpm install
pnpm exec lefthook install
pnpm secrets:scan
```

The pre-commit hook scans staged changes. The pre-push hook scans Git history before pushing.
