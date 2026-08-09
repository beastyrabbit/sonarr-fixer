# Configuration

## One configuration surface

The **Config** button opens one full-screen form containing:

- Sonarr URL and API key;
- Radarr URL and API key;
- the active queue selector;
- Pi model and thinking level;
- auto-import confidence;
- parallel analysis count.

Both manager connections are saved together. Switching the active queue does not require replacing
the other manager's credentials.

An empty API-key field preserves the previously stored key. The renderer receives only
`hasSonarrApiKey` and `hasRadarrApiKey` booleans; stored key values are never returned to it.

## Connection tests

Each manager card has a **Test connection** button. The test:

1. normalizes the entered URL;
2. uses the newly entered key, or the stored key when the field is empty;
3. calls `/api/v3/system/status`;
4. displays the instance name and version when available;
5. emits a structured diagnostic event.

Testing does not save the form and does not mutate either manager.

## Configuration precedence

Effective configuration is merged in this order, where later sources win:

1. compiled defaults;
2. legacy Electron user-data `config.json`, when present;
3. the project `.env` file;
4. the Electron process environment.

The user-data JSON location is `app.getPath("userData")/config.json`. The current UI does not write
that file; it exists only as a compatibility input.

The UI saves the complete effective configuration to `.env` in the process working directory.
Environment variables injected by a shell, service manager, or container still override the saved
`.env` values on the next load.

## Environment variables

| Setting | Preferred variable | Accepted aliases | Default |
| --- | --- | --- | --- |
| Active manager | `ARR_SERVICE` | `ACTIVE_SERVICE` | `sonarr` |
| Sonarr URL | `SONARR_URL` | `SONARR_BASE_URL` | empty |
| Sonarr API key | `SONARR_API` | `SONARR_API_KEY`, `SONARR_TOKEN` | empty |
| Radarr URL | `RADARR_URL` | `RADARR_BASE_URL` | empty |
| Radarr API key | `RADARR_API` | `RADARR_API_KEY`, `RADARR_TOKEN` | empty |
| Pi provider | `PI_PROVIDER` | `SONARR_FIXER_PI_PROVIDER` | `openai-codex` |
| Pi model | `PI_MODEL` | `SONARR_FIXER_PI_MODEL` | `gpt-5.4-mini` |
| Thinking level | `PI_THINKING_LEVEL` | `SONARR_FIXER_PI_THINKING_LEVEL` | `medium` |
| Auto-import confidence | `AUTO_IMPORT_CONFIDENCE` | `SONARR_AUTO_IMPORT_CONFIDENCE` | `0.8` |
| Parallel analyses | `AUTO_RESOLVE_PARALLELISM` | `AUTO_IMPORT_PARALLELISM`, `SONARR_FIXER_AUTO_RESOLVE_PARALLELISM` | `1` |

Example:

```dotenv
ARR_SERVICE=sonarr
SONARR_URL=http://sonarr.local:8989
SONARR_API=replace_me
RADARR_URL=http://radarr.local:7878
RADARR_API=replace_me
PI_PROVIDER=openai-codex
PI_MODEL=gpt-5.4-mini
PI_THINKING_LEVEL=medium
AUTO_IMPORT_CONFIDENCE=0.8
AUTO_RESOLVE_PARALLELISM=1
```

When saving, the application preserves an already-used URL or API-key alias where possible rather
than adding a second alias.

## Normalization and limits

- A URL without a scheme receives `http://`.
- Trailing slashes are removed.
- A valid URL is reduced to its origin. Do not configure a reverse-proxy path prefix; it will not be
  preserved.
- Auto-import confidence is clamped to `0..1`.
- Parallel analyses are rounded and clamped to `1..10`.
- Supported thinking levels are `off`, `minimal`, `low`, `medium`, `high`, and `xhigh`.

## Local credential storage

The `.env` file is created with restrictive intent and is changed to mode `0600` where the platform
supports POSIX permissions. It contains manager API keys in plaintext, so:

- do not commit `.env`;
- restrict access to the project directory;
- do not paste `.env` into issue reports;
- rotate a key if it has been exposed.

Diagnostic exports use a public configuration object and additionally redact common credential key
names and token patterns.

## Dynamic model discovery

Opening Config calls `pi-models:list`. The main process:

1. starts `codex app-server --stdio`;
2. sends `initialize`;
3. requests `model/list` with hidden models excluded;
4. normalizes the returned model names, descriptions, and default marker;
5. terminates the temporary app-server process.

The request times out after eight seconds. `CODEX_BINARY` may point to a non-default Codex
executable.

If Codex cannot start, times out, or returns no models, the UI receives the `openai-codex` models in
Pi's built-in `ModelRegistry` and labels the source as a registry fallback. This explains why a
fallback list can be older than the models available to the installed Codex CLI.

When a current Codex model is not yet present in Pi's registry, the resolver clones the provider
configuration from a known `openai-codex` model and substitutes the selected model ID.

## Pi authentication

The resolver first uses authentication already known to Pi. If `openai-codex` auth is not configured,
it attempts to seed an in-memory auth record from `~/.codex/auth.json`.

The seed requires:

- an access token;
- a refresh token;
- an account ID, either stored directly or recoverable from the access-token claim.

The copied auth exists only in the resolver's in-memory auth storage. Arr Fixer does not rewrite the
Codex auth file.
