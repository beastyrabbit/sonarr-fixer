# Arr Fixer Documentation

This directory documents the implementation and operating model of Arr Fixer. The documents describe
the current code, including its safety boundaries and known limitations; they are not a future design
proposal.

## Documentation map

| Document | Purpose |
| --- | --- |
| [Architecture](architecture.md) | Electron process boundaries, components, IPC API, data flow, and lifecycle |
| [Configuration](configuration.md) | Full-screen settings, configuration precedence, model discovery, and authentication |
| [Resolution workflows](workflows.md) | Queue eligibility, Sonarr/Radarr analysis, typed proposals, validation, Dry Run, and auto-apply |
| [Diagnostics](diagnostics.md) | Event logging, diagnostic JSON exports, redaction, and independent decision review |
| [Development](development.md) | Source layout, local commands, tests, and extension points |
| [Troubleshooting](troubleshooting.md) | Common connection, model, auth, queue, and analysis failures |

## Core invariants

The implementation is built around a few rules:

1. Sonarr and Radarr share one application configuration and one UI, but only one manager queue is
   active at a time.
2. Pi receives manager-specific read-only lookup tools. It cannot import or remove queue items
   directly.
3. Pi must finish with a typed proposal. The proposal is normalized and locally validated before it
   can become an import command.
4. Dry Run starts enabled and blocks mutation calls from normal renderer workflows.
5. Diagnostic exports retain the evidence required to review a decision while redacting common
   credential fields and token patterns.

## Quick path for reviewing a decision

1. Leave **Dry run** enabled.
2. Select a Sonarr or Radarr queue item and run **Analyze**.
3. Review the proposed action, mapping, validation issues, and structured tool results.
4. Select **Export full log**.
5. Share the resulting JSON file for an independent review.

For Custom Format or non-upgrade decisions, the most important evidence is normally in the
`*_get_upgrade_context` tool result inside `events`, plus the final entry in `analyses`.
