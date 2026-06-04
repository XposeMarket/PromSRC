# Artifact Registry

Use this skill when Prometheus needs to find, index, or reason about generated outputs.

## Current State

Status: partial. Artifacts exist in several places, but there is no single first-class registry/query tool yet.

Current sources:

- Chat messages: `artifacts`, `generatedImages`, `generatedVideos`, `processEntries` in `src/gateway/session.ts`
- Tool observations: `ToolObservation.artifacts`, `pathsTouched`, `resultRawRef`
- Task evidence bus: category `artifact`
- Team artifacts: `share_artifact` and team room state
- Legacy DB table: `src/db/database.ts` has `artifacts`, but current chat/runtime artifacts are not all unified there
- Brain artifacts: `workspace/Brain/...`
- Canvas/Creative export artifacts in `src/gateway/routes/canvas.router.ts`

## Procedure

1. Search the active session first.
2. Read tool observations for artifact arrays and path references.
3. If task-bound, load task evidence bus and journal.
4. If team-bound, inspect team shared artifacts.
5. If creative/media, inspect canvas/creative export metadata.
6. Write a normalized artifact index entry with path/url, source session/task/team, type, createdAt, and verification status.

## Gap To Implement

Add a durable `artifact_index` with list/search/read APIs and a background indexer over sessions, tool observations, tasks, teams, and Brain outputs.
