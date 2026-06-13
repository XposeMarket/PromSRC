# Long-Running Job Inspector

Use this skill when Prometheus needs to understand or manage ongoing work.

## Current State

Status: mostly usable from existing APIs/tools; needs one unified inspector tool for 110%.

Current support:

- Background tasks: `/api/bg-tasks`, `/api/bg-tasks/:id`
- Evidence: `/api/bg-tasks/:id/evidence`
- Task stream: `/api/bg-tasks/:id/stream`
- Task pause/resume/restart/message routes exist.
- Processes: `/api/processes`, `/api/processes/:runId`, `/api/processes/:runId/log`, kill/rerun/write/submit.
- Scheduled jobs: `/api/tasks`, schedule tool family.
- Task statuses include `running`, `stalled`, `needs_assistance`, `awaiting_user_input`, `complete`, `failed`.
- Process tools: `process_status`, `process_log`, `process_wait`, `process_kill`, `process_submit`.

## Procedure

1. List running/stalled/needs-assistance tasks.
2. Load the task and evidence bus.
3. Inspect latest journal entries, last tool call, pause reason, and runtime progress.
4. If process-bound, inspect process list and logs.
5. If approval-bound, inspect pending approval state.
6. Recommend one action: wait, nudge/message, resume, retry, cancel/kill, or ask user.

## Gap To Implement

Add `job_inspector` as a single read-only summary tool with optional explicit follow-up actions.
