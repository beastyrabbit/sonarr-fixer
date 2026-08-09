# Troubleshooting

## Connection test fails

Check:

1. the URL points to the Sonarr/Radarr root origin, not a UI page or path prefix;
2. the API key belongs to the same manager;
3. the Electron host can reach the manager network;
4. reverse-proxy authentication is not blocking `/api/v3/system/status`;
5. HTTPS certificates are trusted by the host.

The test uses the entered key when non-empty and otherwise uses the saved key. Re-enter the key if
there is any doubt which value is stored.

## Saving appears to have no effect

Shell, container, or service-manager environment variables override `.env`. Inspect only variable
names and sources without printing secret values. Remove or update the higher-priority variable, then
restart the app.

Also remember that only the active manager determines `config.configured`. Sonarr may be configured
while switching to an incomplete Radarr configuration opens the settings again.

## Queue is empty

Arr Fixer intentionally excludes in-progress downloads. It analyzes only completed/warning items that
have a download ID and are in a warning/import-blocked/import-pending state.

Compare the manager queue record against [Queue eligibility](workflows.md#queue-eligibility).

## Queue row cannot be analyzed

Common reasons:

- no download ID;
- download is still in progress;
- no warning status;
- tracked state is not ready for import;
- active manager changed after the row loaded.

Refresh the queue after changing Sonarr/Radarr.

## No manual-import candidates

The client tries download-ID lookup and then a folder fallback when possible. If both return no
candidates:

- confirm the download still exists;
- confirm the output path is visible to the manager;
- inspect manager path mappings and permissions;
- use the manager's own Manual Import page to see whether it discovers files;
- inspect the diagnostic event for an HTTP error or empty result.

The resolver returns `needs_review` when no candidates exist.

## Model list looks old

Open Config and inspect the model field label:

- no fallback label: models came from `codex app-server`;
- `registry fallback`: Codex could not return a catalog and Pi's built-in registry was used.

Verify:

```bash
codex --version
codex app-server --stdio
```

If Codex is installed under another path, launch Arr Fixer with `CODEX_BINARY` set to that executable.
The model request has an eight-second timeout.

## Pi authentication is not configured

For `openai-codex`, log in with the Codex CLI and confirm `~/.codex/auth.json` exists. Arr Fixer needs
Codex OAuth access and refresh tokens plus an account ID. It does not perform interactive login.

Restart the app after updating Codex authentication.

## Pi did not return a typed proposal

The resolver retries the proposal-tool request once. Persistent failure can mean:

- the model does not support the expected tool behavior;
- authentication expired;
- the analysis was cancelled;
- a lookup tool failed;
- the model context was insufficient or malformed.

Export the diagnostic log and inspect tool completion events and the final analysis warning.

## Custom Format decision seems wrong

Keep Dry Run enabled and rerun analysis. Confirm that Pi called the manager's
`*_get_upgrade_context` tool. If it did not, the final proposal may lack the existing file, profile,
or Custom Format evidence required for a reliable comparison.

Use the checklist in [Diagnostics](diagnostics.md#custom-format-and-non-upgrade-checklist). Attach the
exported JSON for independent review.

## Import button is disabled

Possible causes:

- Dry Run is enabled;
- analysis is still running;
- another action is being applied;
- the proposal action is not `import_candidates`;
- no analysis exists for the selected row.

If validation failed, the review panel shows the blocking issues.

## Auto-apply does nothing

Auto-apply is disabled while Dry Run is active. For imports, the proposal must also validate and meet
the configured confidence threshold. For removals, the stricter 0.95 threshold and option constraints
apply.

See [Auto-apply](workflows.md#auto-apply) for the complete conditions.

## A manager accepted the command but the row remains

Command acceptance is asynchronous. The renderer refreshes immediately and once more after 30
seconds. If the item remains:

- inspect the manager's command and history pages;
- check filesystem permissions and path mappings;
- refresh Arr Fixer manually;
- export a new diagnostic file after the delayed refresh.

## Diagnostic export contains private paths or titles

Credential redaction intentionally preserves decision evidence such as filenames, paths, titles, and
manager hostnames. Remove those fields manually before sharing outside a trusted environment if they
are sensitive.
