## 26) Memory Files, Search, and Indexing

Prometheus now has both classic memory files and an indexed layered memory system.

Classic memory roots:

- `USER.md`
- `SOUL.md`
- `MEMORY.md`
- daily notes
- intraday notes

Current memory tools:

- `memory_write`
- `memory_read`
- `memory_browse`
- `memory_search`
- `memory_read_record`
- `memory_search_project`
- `memory_search_timeline`
- `memory_get_related`
- `memory_graph_snapshot`
- `memory_index_refresh`
- `write_note`

Current `memory_search` behavior:

- exact ID/key lookup first
- operational memory layer second
- evidence-layer fallback third

Returned hits can identify:

- `layer = operational | evidence`
- `recordType`
- `canonicalKey`
- `whyMatched`

`memory_read_record` resolves full records from either layer.

## 27) Memory Index Layers

Evidence index:

- stored under `workspace/audit/_index/memory/`
- source types currently include:
  - `chat_session`
  - `chat_transcript`
  - `chat_compaction`
  - `task_state`
  - `proposal_state`
  - `cron_run`
  - `cron_job`
  - `schedule_state`
  - `team_state`
  - `project_state`
  - `memory_root`
  - `memory_note`
  - `audit_misc`

Operational index:

- stored under `workspace/audit/_index/memory/operational/`
- canonical record types currently include:
  - `decision`
  - `preference`
  - `project_fact`
  - `task_outcome`
  - `proposal`
  - `workflow_rule`
  - `entity_fact`
  - `conversation_summary`

Refresh mechanisms:

- `scheduleMemoryIndexRefresh(...)`
- `scheduleOperationalIndexRefresh(...)`
- manual tool trigger via `memory_index_refresh`

Memory defaults in config source:

- provider: `chromadb`
- embedding model: `nomic-embed-text`

Agent retrieval policy settings are configurable via `GET/POST /api/settings/agent`.
