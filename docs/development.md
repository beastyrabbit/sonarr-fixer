# Development

## Stack

- Electron 42
- React 19
- TypeScript
- electron-vite / Vite
- Pi coding-agent libraries
- TypeBox for Pi tool schemas
- Zod for stored configuration parsing
- Vitest
- Biome
- Lefthook and gitleaks

Use the versions in [`package.json`](../package.json) and `pnpm-lock.yaml` as the source of truth.

## Source layout

```text
src/
├── main/
│   ├── index.ts                 Electron bootstrap
│   ├── ipc.ts                   Main-process application API
│   └── services/
│       ├── config.ts            Configuration load/save/normalization
│       ├── diagnostics.ts       Export redaction
│       ├── pi-auth.ts           Codex auth seeding
│       ├── pi-models.ts         Dynamic model catalog
│       ├── pi-proposal-tool.ts  Typed terminating proposal
│       ├── pi-resolver.ts       Prompt/session orchestration
│       ├── pi-sonarr-tools.ts   Read-only Sonarr tools
│       ├── pi-radarr-tools.ts   Read-only Radarr tools
│       ├── sample.ts            Sample heuristic
│       ├── sonarr-client.ts     Sonarr API adapter
│       ├── radarr-client.ts     Radarr API adapter
│       └── validation.ts        Deterministic proposal checks
├── preload/
│   └── index.ts                 contextBridge API
├── renderer/
│   ├── index.html
│   └── src/                     React UI, state, components, utilities
└── shared/
    └── types.ts                 Cross-process contracts
```

## Local commands

Install:

```bash
pnpm install
```

Run the Electron development environment:

```bash
pnpm dev
```

Build:

```bash
pnpm build
```

Build and launch:

```bash
./run
```

Quality checks:

```bash
pnpm format
pnpm typecheck
pnpm lint
pnpm test
pnpm build
git diff --check
```

Secret scan:

```bash
pnpm secrets:scan
```

Lefthook runs gitleaks for staged changes before commit and scans Git history before push.

## Test organization

Tests run in the Node environment and live beside the implementation:

| Test file | Coverage focus |
| --- | --- |
| `diagnostics.test.ts` | Nested credential and token redaction |
| `pi-models.test.ts` | Codex model-list normalization |
| `pi-proposal-tool.test.ts` | Typed schema and terminating proposal capture |
| `sonarr-client.test.ts` | Queue filtering, candidates, lookups, connection, and mutations |
| `radarr-client.test.ts` | Queue/candidate normalization, connection, and import mapping |
| `sonarr-format.test.ts` | Candidate and episode formatting |
| `validation.test.ts` | Sample, mapping, identity, duplicate, and manager-specific checks |

When changing a mutation path, test both:

1. the proposal/validation rule;
2. the exact manager request payload.

For UI changes, run a production build and inspect the renderer at the minimum supported window size
of 1020×680 as well as a normal desktop size.

## Adding a shared contract

1. Add or update the type in [`src/shared/types.ts`](../src/shared/types.ts).
2. Add the main-process handler in [`src/main/ipc.ts`](../src/main/ipc.ts).
3. Expose only the required method in [`src/preload/index.ts`](../src/preload/index.ts).
4. Update `src/renderer/src/global.d.ts` indirectly through the exported preload API type if needed.
5. Add tests at the lowest deterministic layer.
6. Update the IPC table in [Architecture](architecture.md#ipc-api).

Avoid exposing generic filesystem, shell, or arbitrary HTTP primitives through preload.

## Extending manager behavior

Manager-specific behavior should stay behind the normalized shared contracts:

1. add the API response types to the manager client;
2. normalize them into `QueueItem` or `ManualImportCandidate`;
3. add read-only Pi tools only for evidence Pi genuinely needs;
4. update the manager prompt with a concrete decision rule;
5. add deterministic validation wherever the rule can be checked locally;
6. validate again in the mutation client;
7. emit structured events for tool calls and results;
8. cover the new behavior with request and validation tests.

Do not give Pi a generic manager client or mutation tool. Mutations should remain explicit IPC
operations after typed proposal capture.

## Adding a Pi lookup tool

A lookup tool should:

- use a stable manager-prefixed name;
- be read-only;
- define narrow TypeBox parameters;
- return a compact JSON-serializable `details` object;
- avoid credentials and HTTP headers;
- use `executionMode: "parallel"` only when calls are independent;
- be listed in the manager's `tools` allowlist in `PiResolver`;
- be added to `customTools`;
- have a prompt guideline that says when it is relevant.

If the tool discovers valid alternate Sonarr episode IDs, pass them to `rememberEpisodeIds` so local
validation recognizes the lookup evidence.

## Changing proposal fields

Proposal changes touch several layers:

- `ResolutionProposal` or `SelectedImport` in shared types;
- TypeBox schema in `pi-proposal-tool.ts`;
- normalization in `validation.ts`;
- deterministic validation;
- manager `ManualImport` request construction;
- renderer decision display and history;
- diagnostic documentation and tests.

Treat the `selectedImports` mapping as authoritative. `selectedCandidateIds` controls which files are
included, while each mapping controls the target episode/movie identity.

## Configuration development notes

- Use the configuration service rather than reading `process.env` elsewhere.
- Preserve old API-key values when the UI submits an empty key.
- Never include key values in `PublicConfig`.
- Keep connection tests read-only.
- Use the dynamic model catalog instead of maintaining a static renderer list.
- If configuration storage changes, document migration and precedence explicitly.

## Documentation maintenance

Update `/docs` in the same change when modifying:

- a process or trust boundary;
- an IPC channel;
- configuration variables or precedence;
- Pi tools or proposal actions;
- deterministic validation;
- Dry Run or auto-apply behavior;
- diagnostic export fields or redaction.
