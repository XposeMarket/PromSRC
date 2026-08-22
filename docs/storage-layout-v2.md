# Prometheus storage layout v2

Prometheus persistent state is independent from the PromSRC source checkout.

## Canonical roots

Desktop defaults resolve to the operating-system Prometheus app-data directory. On Windows this is `%APPDATA%\Prometheus`.

```text
Prometheus/
├── runtime/
│   ├── config/
│   ├── sessions/
│   ├── agent-chats/
│   ├── tool-observations/
│   ├── resources/
│   ├── projects/
│   ├── tasks/
│   ├── schedules/
│   ├── cron/
│   ├── teams/
│   ├── connections/
│   ├── connectors/
│   ├── plugins/
│   ├── vault/
│   ├── memory-index/
│   ├── browser/
│   ├── brain-state/
│   ├── audit/
│   ├── diagnostics/
│   ├── updates/
│   ├── cache/
│   ├── migrations/
│   ├── backups/
│   └── boot/
└── workspace/
    ├── AGENTS.md
    ├── SOUL.md
    ├── IDENTITY.md
    ├── USER.md
    ├── TOOLS.md
    ├── BOOTSTRAP.md
    ├── MEMORY.md
    ├── memory/
    ├── projects/
    ├── proposals/
    ├── generated/
    ├── uploads/
    ├── downloads/
    ├── skills/
    ├── hooks/
    ├── Brain/
    ├── creative-projects/
    ├── creatives/
    ├── analysis/
    ├── entities/
    ├── events/
    ├── integrations/
    ├── .prometheus/subagents/<agentId>/
    └── teams/<teamId>/
        ├── workspace/
        └── subagents/<agentId>/
```

## Ownership rule

`runtime/` is private machine/application state. It may be rebuilt, migrated, compacted, indexed, encrypted, or otherwise managed by Prometheus without presenting the files as the user's working documents.

Examples include sessions, tool observations, resource registries, task and schedule state, connection metadata, plugins, vault state, indexes, browser memory, Brain checkpoints, audit mirrors, caches, diagnostics, and migration manifests.

`workspace/` is durable user/agent-owned work. Files here are intentionally inspectable and editable. Application updates must never overwrite existing workspace files.

Examples include identity/profile documents, curated memory, projects, proposals, generated artifacts, authored skills and hooks, Thoughts/Dreams, creative projects, standalone subagent identity workspaces, team shared workspaces, and team-scoped agent identities.

## Source checkout invariant

A PromSRC checkout is application source only. Deleting, resetting, pulling, recloning, or updating the source repository must not delete or overwrite live Prometheus runtime or workspace state.

No production runtime should use `PromSRC/.prometheus` or `PromSRC/workspace` as its canonical persistent store.

## Subagent and team isolation

Standalone subagent identity lives under:

```text
workspace/.prometheus/subagents/<agentId>/
```

Team-scoped identity lives under:

```text
workspace/teams/<teamId>/subagents/<agentId>/
```

Team shared work lives under:

```text
workspace/teams/<teamId>/workspace/
```

Execution workspaces and additional allowed work paths remain separate concepts. An agent may work against an external repository without relocating that repository into Prometheus app data.

## Skills versus plugins

Authored Prometheus skills are portable workspace material:

```text
workspace/skills/
```

Executable installed application extensions/plugins are runtime material:

```text
runtime/plugins/
```

Bundled skills/extensions remain part of the application package.

## Memory

Human/agent-readable continuity remains in workspace files such as `USER.md`, `MEMORY.md`, `memory/*.md`, agent `MEMORY.md`, and team memory artifacts.

Machine retrieval/index state belongs under `runtime/memory-index/`.

Neither form silently overwrites the other. Promotion/reconciliation between structured memory and readable workspace memory must be explicit.

## Migration invariants

1. Git never owns live Prometheus user state.
2. Updates never overwrite workspace files.
3. Migration never deletes source data before destination verification.
4. Every affected source and conflicting destination is backed up before mutation.
5. Vault/key continuity fails closed.
6. User-owned files are never silently overwritten.
7. External user-selected work paths remain external.
8. Only paths under known legacy Prometheus roots are automatically rewritten.
9. Subagent and team identity isolation survives migration.
10. File/shell sandbox boundaries are at least as strict after migration.
11. Migrations are versioned, idempotent, and recoverable after interruption.
12. Legacy copies remain until a later verified cleanup phase.
13. A fresh installation contains no personal/user-specific content.
14. Persistence paths are resolved through the canonical storage-layout layer rather than constructed ad hoc.

## Compatibility phase

`src/runtime/storage-layout.ts` initially defaults to `legacy` mode so introducing the path contract is not itself a data migration.

Canonical mode is enabled explicitly with:

```text
PROMETHEUS_STORAGE_LAYOUT=canonical
```

or by supplying an explicit:

```text
PROMETHEUS_RUNTIME_DIR=...
```

`PROMETHEUS_DATA_DIR` remains a compatibility alias for the Prometheus app-data parent during migration. `PROMETHEUS_WORKSPACE_DIR` remains an explicit workspace override.
