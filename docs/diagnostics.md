# Diagnostics and Decision Review

## Live event log

The bottom **Diagnostic log** receives `ResolverEvent` objects from the main process and local UI
events from the renderer. Each event contains:

- ISO timestamp;
- type: `info`, `warning`, `error`, `pi`, `sonarr`, or `radarr`;
- human-readable message;
- optional queue item ID;
- optional structured details.

Tool execution produces two events:

1. tool start with its arguments;
2. tool completion with tool name, call ID, error state, and full result.

Structured details are collapsed in the UI by default and can be expanded per event.

Events and history are retained for the current app session without a fixed item cap. They are
in-memory and disappear when the renderer exits.

## Diagnostic export

**Export full log** writes a versioned JSON document through an Electron save dialog. The default
filename is:

```text
arr-fixer-diagnostic-<ISO timestamp>.json
```

The file is created and then changed to mode `0600` where supported.

Top-level shape:

```json
{
  "formatVersion": 1,
  "exportedAt": "2026-07-17T12:00:00.000Z",
  "testMode": true,
  "runtime": {
    "appVersion": "0.1.0",
    "platform": "linux",
    "arch": "x64"
  },
  "config": {},
  "selectedQueueId": 123,
  "queue": [],
  "analyses": [],
  "events": [],
  "history": []
}
```

### Included evidence

- public settings, including selected provider/model and thresholds;
- app version, OS platform, and architecture;
- whether Dry Run was enabled at export time;
- the visible normalized queue;
- all analysis results held by the renderer;
- every candidate returned during those analyses;
- typed proposals and selected mappings;
- validation errors and warnings;
- Pi text deltas retained in each analysis;
- manager and Pi tool events, including structured tool results;
- renderer history entries for analysis and attempted actions.

API-key values are not present in `PublicConfig`.

## Redaction

Serialization recursively replaces values whose JSON key contains a credential term such as:

- API key;
- authorization;
- access or refresh token;
- secret;
- token;
- password.

Boolean `has...ApiKey` flags are preserved. Strings are also scrubbed for Bearer credentials and
common API-key/token query parameters.

Redaction is defense in depth, not a proof that arbitrary free-form text cannot contain a secret.
Before sharing an export outside a trusted environment:

1. search it for the literal manager hostnames and any sensitive path names;
2. search for fragments of known keys or tokens;
3. confirm values under credential-like fields read `[redacted]`;
4. remove unrelated private titles or paths if they are not needed.

Do not share `.env` as a diagnostic artifact.

## Reviewing whether the resolver chose correctly

Use this order when independently reviewing a diagnostic export:

1. Find the selected queue item in `queue`.
2. Read its `statusMessages`; these are the manager's reason for blocking import.
3. Find the matching entry in `analyses` by `queueItemId`.
4. Inspect every candidate's path, size, target parse, quality, languages, Custom Formats, score,
   rejections, and sample flag.
5. Locate relevant lookup tool results in `events`.
6. Compare the lookup evidence with `proposal.evidence` and `proposal.reason`.
7. Verify every `selectedImports` target mapping.
8. Read `validation.issues`.
9. Confirm `testMode` before assuming that no action was sent.
10. Check `history` for a later applied import or queue action.

## Custom Format and non-upgrade checklist

For a Custom Format (CF), quality, or “not an upgrade” decision, locate
`sonarr_get_upgrade_context` or `radarr_get_upgrade_context` and compare:

- the existing episode/movie file quality;
- existing-file Custom Formats and total score;
- candidate quality, Custom Formats, and score;
- the active quality profile;
- profile upgrade cutoff and allowed quality groups;
- profile `formatItems` scores;
- relevant Custom Format definitions;
- candidate and existing-file languages;
- the exact manager rejection text.

Expected high-level outcomes:

- Candidate is a valid improvement: propose an explicitly mapped import.
- Candidate lacks German but is otherwise valid: import it as a fallback; a German version
  arrives later through the normal upgrade flow.
- Candidate lacks German while the existing library file has German: `needs_review`; the
  apply path refuses this language downgrade even if Pi proposes it.
- Existing library file is already better: remove the queue item without blocklisting.
- Candidate is wrong, unwanted, a sample, or structurally unusable: remove and
  blocklist so the manager may search again.
- Evidence does not establish the comparison: `needs_review`.

## Interpreting event order

The renderer stores newest events first, so the exported `events` array is reverse chronological.
Within an analysis, look at timestamps to reconstruct:

1. candidate load;
2. Pi analysis start;
3. tool start and completion pairs;
4. final typed proposal;
5. optional mutation attempt.

## Known diagnostic limitations

- History and events are not persisted across app restarts.
- Export captures only analyses still held by the current renderer session.
- HTTP request/response headers are not intentionally logged.
- The complete raw manager API response is normalized before storage; fields not represented by the
  client types may be absent.
- Pi text output is accumulated as trimmed text deltas and is not a byte-for-byte transcript.
- A successful manager command means the command was accepted, not that the later import ultimately
  completed. Refresh the manager queue and inspect the manager's own history for final status.
