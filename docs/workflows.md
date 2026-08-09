# Resolution Workflows

## Queue eligibility

Arr Fixer requests up to 500 entries from the active manager queue and removes downloads still in
progress from the displayed result.

An item is analyzable only when all of the following are true:

- it has a download ID;
- it is not downloading or otherwise in progress;
- `status` or `trackedDownloadStatus` is `warning`;
- it is completed, warning, `importBlocked`, or `importPending`.

The shared eligibility rules are applied to both Sonarr and Radarr.

## Candidate loading

For an analyzable item, the client requests `/api/v3/manualimport` using the download ID and
`filterExistingFiles=false`.

If the result is empty and an output path is known, the client retries with the folder. It also uses
the folder fallback when download-ID lookup returns HTTP 404 or 405.

Every manager record is normalized into `ManualImportCandidate`, including:

- path, relative path, folder, name, and size;
- manager target IDs and labels;
- quality and language data;
- release group, flags, and release type where available;
- Custom Formats and Custom Format score;
- manager rejections;
- sample detection.

A candidate is locally marked as a likely sample when its filename contains the word `sample` or its
size is below 80 MiB.

## Analysis

Analysis is read-only with respect to Sonarr and Radarr:

1. load current manual-import candidates;
2. create a manager-specific Pi session;
3. provide a constrained system prompt and read-only lookup tools;
4. stream tool start/results into the diagnostic event log;
5. capture exactly one typed proposal;
6. normalize and validate the proposal;
7. return the complete `AnalysisResult` to the renderer.

Pi extensions, project skills, prompt templates, themes, and context files are disabled for this
session. Compaction is disabled and one model retry is allowed.

## Sonarr lookup tools

| Tool | Data exposed |
| --- | --- |
| `sonarr_get_queue_context` | Queue warning, target episode IDs, target episode records, and current candidates |
| `sonarr_find_episodes` | Read-only episode lookup by ID, series, season, absolute number window, or title |
| `sonarr_get_manual_import_candidates` | Current or refreshed manual-import candidates |
| `sonarr_get_upgrade_context` | Existing episode files, quality profiles, Custom Format scoring, and relevant definitions |
| `propose_sonarr_resolution` | Terminating typed proposal with file-to-episode mappings |

The episode lookup expands the set of IDs that local validation may accept. This allows Pi to correct
Sonarr's candidate parse when the queue and episode lookup provide evidence for the alternate mapping.

## Radarr lookup tools

| Tool | Data exposed |
| --- | --- |
| `radarr_get_queue_context` | Queue warning, target movie, and candidates |
| `radarr_get_movie` | Target movie identity, external identifiers, profile, and existing file |
| `radarr_get_manual_import_candidates` | Current or refreshed manual-import candidates |
| `radarr_get_upgrade_context` | Existing movie file, quality profile, Custom Format scores, and relevant definitions |
| `propose_radarr_resolution` | Terminating typed proposal with a file-to-movie mapping |

Radarr is intentionally limited to one selected feature file for a queue item.

## Typed proposal actions

| Action | Meaning |
| --- | --- |
| `import_candidates` | Import the selected physical file or files using explicit target mappings |
| `needs_review` | Evidence is ambiguous, incomplete, or locally invalid |
| `ignore_queue_item` | Remove the queue entry while keeping the download client item |
| `remove_queue_item` | Remove the queue item using explicit removal/blocklist options |

The proposal also contains:

- confidence from 0 to 1;
- selected candidate IDs;
- authoritative selected-import mappings;
- sample candidate IDs;
- issue summary, reason, evidence, and warnings;
- optional queue-removal parameters.

The typed proposal tool constrains selected candidate IDs to candidates that were actually supplied
to Pi.

## Prompt-level policy

Current resolver prompts instruct Pi to:

- treat the manager warning as the primary diagnostic clue;
- use upgrade context for quality, Custom Format, score, existing-file, and non-upgrade decisions;
- prefer candidates whose languages include German, but import non-German (English or
  original-language) candidates as fallbacks instead of removing them;
- never remove or blocklist a queue item only because it lacks German;
- never replace an existing file whose languages include German with a non-German candidate
  (`needs_review` instead — also enforced deterministically at apply time);
- avoid likely samples and Blu-ray `BDMV/STREAM/*.m2ts` chunks;
- map Sonarr files to exact episode IDs;
- map the Radarr feature file to an exact movie ID;
- remove without blocklisting when the existing library file is already better;
- remove and blocklist unsuitable releases so the manager can search again;
- return `needs_review` rather than guess.

These are model instructions, not all deterministic validators. For example, the local validator
requires language metadata to exist but does not evaluate which languages are present; the German
preference lives in the prompts, with one deterministic backstop: the apply path refuses any
import that would replace a file whose languages include German with a non-German candidate.
The diagnostic review should still verify the actual language labels.

## Deterministic validation

Only `import_candidates` proposals require import validation. Non-import actions return a valid
validation result and are controlled separately by confirmation and auto-removal rules.

Import errors include:

- no selected candidate;
- no explicit mapping;
- an unknown candidate ID;
- a selected candidate without a matching mapping;
- a likely sample;
- missing quality;
- missing language metadata;
- missing Sonarr series ID;
- missing or unrecognized episode IDs;
- duplicate episode mappings;
- missing or unrecognized Radarr movie ID;
- multiple Radarr feature files.

Manager rejections are retained as validation warnings. Warnings do not make `validation.ok` false,
but they remain visible for review.

The manager client runs validation again immediately before creating `ManualImport`. This protects
the mutation path from stale or modified renderer proposal state.

## Dry Run

Dry Run is enabled every time the renderer starts.

While enabled:

- import calls are not sent;
- remove and ignore calls are not sent;
- auto-apply is disabled and forced off;
- analysis, manager read-only tools, validation, history, and diagnostics remain active.

This makes Dry Run suitable for checking whether the resolver would make the expected Custom Format,
quality, language, episode, or movie decision.

Dry Run currently lives in the renderer workflow. See
[Architecture: Trust boundaries](architecture.md#trust-boundaries-and-limitations) for the exact
security boundary.

## Manual actions

With Dry Run disabled:

- **Import** sends only the currently selected candidates and their existing typed mappings.
- **Remove** defaults to removing the download-client item without blocklisting, unless the proposal
  supplies other options.
- **Ignore** uses `removeFromClient=false`, `blocklist=false`, `skipRedownload=true`, and
  `changeCategory=false`.
- destructive queue actions require a confirmation dialog when initiated interactively.

## Auto-apply

Auto-apply is disabled in Dry Run and is sampled at the start of an analysis batch. Enabling it after
an individual analysis has started does not retroactively apply that result.

An import may auto-apply only when:

- the action is `import_candidates`;
- local validation passes;
- confidence meets `AUTO_IMPORT_CONFIDENCE`.

A queue removal may auto-apply only when:

- the action is `remove_queue_item`;
- local validation is valid;
- explicit `queueRemovalOptions` are present;
- `removeFromClient=true`;
- `skipRedownload=false`;
- `changeCategory=false`;
- confidence is at least `0.95`.

`blocklist` may be either true or false. The intended distinction is:

- `blocklist=false` for an ordinary non-upgrade where the existing file is already better;
- `blocklist=true` for unsuitable or unwanted releases that should not be selected again.

Bulk analysis respects `AUTO_RESOLVE_PARALLELISM`. When auto-apply is enabled, queue rows sharing one
download are deduplicated before processing.
