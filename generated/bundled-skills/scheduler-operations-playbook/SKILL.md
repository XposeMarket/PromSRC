---
name: "scheduler-operations-playbook"
description: "Create, inspect, update, run, diagnose, and verify Prometheus scheduled jobs, including cron/interval timing, ownership, expected outputs, delivery, retries, and run history. Use for scheduler operations; do not use for ordinary foreground tasks or generic background-agent work."
---

# Scheduler operations

Scheduled work is durable automation. A job is not healthy merely because its scheduler entry exists or its last run says “success.” Verify execution, output, and delivery separately.

## Inspect before mutating

1. List or inspect the target schedule and confirm its identifier.
2. Review timing, timezone, enabled state, owner, model/capabilities, prompt, expected outputs, and delivery configuration.
3. Read recent run history and inspect the latest real artifact or delivery evidence.
4. Distinguish scheduler state from worker execution and user-facing delivery.

## Create or update safely

- Make the job prompt self-contained for a future cold start.
- Include the concrete objective, required inputs, output location or delivery target, verification criteria, and failure behavior.
- Use a schedule-owner agent only when the workflow truly needs durable ownership.
- Patch only intended fields on existing jobs; preserve IDs, ownership, delivery, and unrelated configuration.
- Confirm timezone and the next expected run in user-readable terms.

## Verify

For a new or materially changed job, use a safe immediate run when possible. Then verify:

1. the run started under the expected owner;
2. required tools/model capabilities were available;
3. the intended artifact changed or was created;
4. delivery reached the configured destination;
5. run history reflects the actual outcome.

Do not infer success from tool count, a generated final message, or a stale artifact timestamp.

## Triage

- No run: inspect enablement, schedule shape, timezone, and scheduler health.
- Run failed: inspect the first actionable tool/model/auth error.
- False success: compare expected outputs with current files or external state.
- Missing delivery: separate completed work from notification/channel failure.
- Retry loop: stop repeated identical attempts and fix the underlying capability, prompt, or auth issue.
- Long-running work: inspect durable task/process state instead of assuming the foreground timeout cancelled it.

## Read details only when needed

- Read [detailed-guide.md](references/detailed-guide.md) for field-level operations, incident patterns, heartbeat diagnostics, and delivery rules.
- Read a matching example under `examples/` only when creating, updating, or recovering that kind of schedule.
- Read `references/workflows/scheduler-operations-playbook.md` only for historical workflow details not covered here.

Report the schedule change, next run, immediate-test result, artifact evidence, and delivery status independently.
