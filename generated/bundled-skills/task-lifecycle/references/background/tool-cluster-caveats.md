# Task / automation / agent tool caveats — 2026-05-09

Evidence: `Brain/skill-episodes/2026-05-09/episodes.jsonl` entries 20-21; `Brain/skill-gardener/2026-05-09/workflow-episodes.jsonl` entries 40-41.

## Automation cluster

- `background_join` is present, but its contract is system-use-only. Do not call it manually during smoke tests; use `background_status`, `background_progress`, and `background_wait`. Same-turn finalization handles joins automatically.
- `schedule_job_patch` preview can treat empty strings as proposed replacements. Omit unset fields instead of sending `""` unless intentionally clearing a field.
- `schedule_job_stuck_control` destructive/status-mutating actions correctly require `confirm=true`; a `confirm=false` rejection is a successful safety check, not a runtime failure.

## Agent cluster

- `agent_update` can reset fields if omitted depending on tool contract. When doing a no-op/metadata smoke test, include critical fields such as `executionWorkspace`, or inspect and restore immediately if the smoke test changes them.
- `get_agent_result` appears scoped to managed-team background task ids from team/member dispatch flows, not ordinary `dispatch_to_agent` or `message_subagent` task ids. For standalone dispatch/message tasks, use the corresponding task/subagent status path instead of assuming `get_agent_result` will accept the id.

Use these as smoke-test interpretation rules so availability tests do not accidentally mutate config or misclassify expected guardrails as failures.
