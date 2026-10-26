# Agent schedule prechecks

Optional `precheck: { command, cwd?, timeoutMs?, skipWhen, pattern? }` is accepted by schedule_job create/update, schedule_job_patch preview/apply and POST/PUT /api/tasks. Shared job detail JSON/tool responses expose it read-only. `precheck: null` removes it; omitted leaves it unchanged. Only agent jobs accept gates.

Before model execution the scheduler invokes the same policy-gated run_command used for script schedules. Default timeout 10s, allowed 100ms–60s. Preview-only schedules fail rather than run a command. Existing unattended-approval protection from #769 applies. No permission override is created.

`stdout_match` checks a bounded stdout tail (not echoed command/stderr); regexes are limited to 256 characters without groups, alternation, backreferences or braces. The supported JSON noop pattern is `"action"\s*:\s*"noop"`. A normal nonzero exit fails unless `exit_nonzero` was deliberately selected. Timeouts, cancellation, spawn errors and policy denials are always failed history, never skipped. On success stdout is passed as explicitly untrusted context. Every precheck records a separate receipt; go additionally has the ordinary agent receipt. Skipped recurring polls advance normally; skipped one-shots are consumed.

## O3 rollout (NOT applied)

Stacked on #769 because the deadline/approval execution signatures overlap; merge #769 first. No live schedules or gateway were changed.

| Baseline | Before | Projected after |
|---|---:|---:|
| Polls/day | 96 | 96 |
| Model runs/day at observed 104/112 noop share | 96 | 6.86 |
| Model steps/day at 8.7 mean | 835.2 | 59.66 |
| Scheduler wall minutes/day at 25.530s observed mean | 40.848 | 4.52–7.72 (1–3s checks plus non-noop runs) |

Projection only; gateway orchestration duration is not actual model busy time. The older 3–9-minute example is not the corrected baseline. Read-only check.ps1 verification returned valid one-line JSON with action=work.

After deploy, preview then apply this schedule_job_patch payload (change action to apply and add confirm:true only after reviewing preview):

```json
{"action":"preview","job_id":"job_1792887442652_yqji2","precheck":{"command":"powershell -NoProfile -File merge-steward/check.ps1","timeoutMs":30000,"skipWhen":"stdout_match","pattern":"\"action\"\\s*:\\s*\"noop\""}}
```

cwd defaults to the user's workspace, no product-specific path. Reverse patch: same job ID with precheck:null. Check next skipped/go/failed receipt independently of deployment.
