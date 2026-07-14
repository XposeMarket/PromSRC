# Detailed guide

This reference preserves the full operating detail that was moved out of the concise skill entrypoint during the catalog migration. Read only the sections needed for the current task.

# Workflow Replay and Runbook Recorder

Use this skill when Prometheus should inspect a completed workflow and turn it into a reusable runbook, skill, composite, or lesson.

## Current State

Status: partially usable today. Prometheus has the evidence sources, but no single first-class "replay completed task into runbook" tool yet.

Known sources:

- Task summaries: `src/gateway/tasks/task-store.ts` -> `listTaskSummaries(...)`
- Full task records: `loadTask(id)` and `GET /api/bg-tasks/:id`
- Task storage: config state base `tasks/` via `task-store.ts`
- Task journal: `TaskRecord.journal`
- Task evidence bus: `GET /api/bg-tasks/:id/evidence`, `getEvidenceBusSnapshot(id)`
- Session history: `src/gateway/session.ts` -> `getSession(id)`
- Legacy per-turn tool logs: `ChatMessage.toolLog`
- Structured tool observations: `src/gateway/tool-observations.ts`
- Observation files: `<configDir>/tool-observations/<sessionId>.jsonl`
- Raw sidecars: `<configDir>/tool-observations/raw/<sessionId>/...`
- Brain workflow episodes: `workspace/Brain/skill-gardener/<date>/workflow-episodes.jsonl`
- Skill episodes: `workspace/Brain/skill-episodes/<date>/episodes.jsonl`

## Procedure

1. Find candidate completed work:
   - Prefer `listTaskSummaries({ status: ['complete'] })` or `GET /api/bg-tasks`.
   - If the workflow happened in normal chat, search sessions by title/history and inspect `session.history`.
2. Load full evidence:
   - Load task by ID.
   - Read `task.prompt`, `task.plan`, `task.journal`, `task.finalSummary`, `task.completedAt`, and `task.proposalExecution`.
   - Load evidence bus for artifacts, decisions, findings, errors, and dedup keys.
   - Load the originating session via `task.sessionId`.
   - Read structured tool observations for that session.
3. Normalize the replay:
   - Keep tool order, meaningful arguments, outputs, artifact paths, approvals, failures, and recovery moves.
   - Drop raw transcript filler and unrelated chat.
   - If `resultRawRef` appears, fetch the sidecar before deciding whether output matters.
4. Decide target:
   - Repeated deterministic tool chain -> composite.
   - Procedural judgment/workflow -> skill or skill resource.
   - One-off business/project fact -> memory/project context.
   - Browser action sequence -> browser teach workflow or browser-to-connector migration.
5. Create the artifact:
   - Use `skill_create_bundle` for a new skill proposal/skill.
   - Use `skill_resource_write` for an additive runbook on an existing skill.
   - Use `create_composite` only after a live successful sequence has been verified.

## Guardrails

- Do not preserve raw tool lists as a skill unless they become a future behavior rule.
- Do not claim a workflow is reusable just because it completed once.
- Keep secrets out of runbooks; observations are scrubbed but still inspect before copying.
- Mark missing evidence as a gap instead of hallucinating steps.
