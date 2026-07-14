---
name: "context-pack-builder"
description: "Assemble reusable Prometheus briefing packs from memory, project and team context, sessions, files, and cited sources. Use only when the user explicitly asks for a context pack, briefing pack, or reusable agent handoff; do not invoke for ordinary prompt context."
---

# Context Pack Builder

Use this skill when Prometheus needs a reusable briefing packet for a project, client, repo, team, or workflow.

## Current State

Status: partial but useful.

Current support:

- Prompt context builder: `src/gateway/prompt-context.ts`
- Project context: `src/gateway/projects/project-store.ts`
- Project learning: `src/gateway/projects/project-learning.ts`
- Team context references: `src/gateway/teams/managed-teams.ts`
- Memory search/read/index: `memory_search`, `memory_read_record`, `memory_index_refresh`
- Extension runtime can register context providers, but injection/use is not clearly wired end-to-end yet.

## Procedure

1. Define the pack target: project, client, repo, team, workflow, or connector.
2. Pull durable facts from memory search and project context.
3. Pull current/open work from tasks, proposals, and session summaries.
4. Include explicit source links/paths for every durable fact.
5. Separate:
   - facts
   - preferences
   - decisions
   - constraints
   - open tasks
   - useful files/artifacts
6. Store as a workspace file, project context section, team context reference, or skill resource depending on reuse target.

## Gap To Implement

Add a first-class `context_pack_*` tool family that creates, lists, updates, and injects named packs.
