# Audit Directory

This directory is a one-way materialized mirror for observability.

- Canonical runtime stores remain in `.prometheus/` and `workspace/`.
- Files under `workspace/audit/` are snapshots for debugging and review.
- Team/subagent workspaces are intentionally not mirrored here.

## Navigation

- `_index/` global indexes and run metadata
- `chats/` session snapshots, transcripts, compaction artifacts
- `projects/` project state snapshots
- `tasks/` task/background-task state snapshots
- `proposals/` proposal timeline/state snapshots
- `cron/` cron scheduler config and run history
- `schedules/` schedule memory and per-run logs
- `teams/` managed-team state and run metadata (not workspace files)
- `connections/` connector state and activity logs
- `restarts/` restart context snapshots
- `startup/` startup-notification and boot state snapshots
- `memory/` memory markdown snapshots (intraday + USER.md/SOUL.md/MEMORY.md root snapshots)
- `system/` selected system config, audit, and logs
