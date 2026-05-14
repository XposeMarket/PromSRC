# Prometheus Obsidian Bridge

Prometheus can use Obsidian as a native memory source while keeping Prometheus memory intact.

## Bridge modes

- `read_only`: Prometheus indexes Obsidian notes and never writes to the vault.
- `assisted`: Prometheus indexes notes and can write generated notes into the configured writeback folder.
- `full`: Reserved for richer bidirectional workflows; currently enables the same safe writeback path as assisted mode.

Read-only is the default.

## How sync works

1. A vault folder is registered through Connections -> Obsidian or `/api/obsidian/vaults`.
2. Markdown files are scanned with include/exclude globs.
3. Notes are mirrored into `workspace/audit/obsidian/vaults/...`.
4. The existing memory index ingests those mirrors as `obsidian_note` evidence.
5. Notes marked with Prometheus frontmatter or tags are promoted into operational memory.

The original Obsidian files remain the source of truth. Prometheus stores sync state in the config directory and indexed mirrors in the audit tree.

## Promotion markers

Any note can be searchable evidence. To make a note durable operational memory, add frontmatter:

```yaml
---
prometheus-memory: true
prometheus-memory-type: decision
tags:
  - prometheus/memory
---
```

Supported memory types:

- `decision`
- `preference`
- `workflow_rule`
- `project_fact`
- `entity_fact`

Tags also work:

- `#prometheus/memory`
- `#prometheus/decision`
- `#prometheus/preference`
- `#prometheus/rule`

## API

- `GET /api/obsidian/status`
- `POST /api/obsidian/vaults`
- `PATCH /api/obsidian/vaults/:vaultId`
- `DELETE /api/obsidian/vaults/:vaultId`
- `POST /api/obsidian/sync`
- `POST /api/obsidian/writeback`

## Connector tools

Obsidian is exposed as an optional connector, so these tools appear only when the `external_apps` category is active:

- `connector_obsidian_status`
- `connector_obsidian_connect_vault`
- `connector_obsidian_sync`
- `connector_obsidian_writeback`

General memory retrieval still uses `memory_search`, `memory_read_record`, `memory_search_timeline`, and `memory_get_related`.
