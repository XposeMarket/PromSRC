# Knowledge Import Pipeline

Use this skill when bringing external information into Prometheus.

## Current State

Status: mostly usable manually; needs a dedicated import wizard/tool for 110%.

Current support:

- Memory tools: `memory_search`, `memory_read_record`, `memory_index_refresh`, `memory_write`, `write_note`
- Evidence index source types include chat/session/task/proposal/cron/team/project/memory roots.
- Operational records include decisions, preferences, project facts, task outcomes, workflow rules, entity facts, and conversation summaries.
- Memory index files live under `workspace/audit/_index/memory/`.
- Project context and team context references can store scoped knowledge.
- Extension runtime supports `registerMemorySource(...)`, but source use must be verified before relying on it.

## Procedure

1. Identify import target: durable memory, project context, team context, skill, artifact, or temporary note.
2. Classify content:
   - entity/business fact -> entity or BUSINESS/project context
   - user preference -> USER memory
   - workflow/procedure -> skill/resource, not general memory
   - one-off evidence -> artifact/note
3. Chunk or summarize source material with source paths/URLs.
4. Write only durable facts to memory.
5. Run `memory_index_refresh` after meaningful imports.
6. Verify with `memory_search` and `memory_read_record`.

## Guardrails

- Do not dump raw docs into durable memory.
- Preserve citations/source paths.
- Keep temporary research separate from stable facts.
