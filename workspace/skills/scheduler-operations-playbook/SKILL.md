---
name: Scheduler Operations Playbook
description: Runbook for managing scheduler jobs and heartbeat-driven autonomous execution with clear, repeatable recovery patterns.
emoji: "🧩"
version: 1.0.0
triggers: scheduler, scheduled job, cron, cron job, schedule job, schedule task, recurring job, recurring task, one-shot, one shot, run now, run_now, heartbeat, autonomous loop, task loop, pause schedule, resume schedule, pause job, resume job, delete schedule, update schedule, list schedules, job status, task status, stalled task, failed task, retry task, rerun task, delivery failure, telegram delivery, webhook delivery, automation recovery, scheduler diagnostics, cron lifecycle
---

# Scheduler Operations Playbook

Runbook for managing scheduler jobs and heartbeat-driven autonomous execution with clear, repeatable recovery patterns.

---

## 1) When to Use This

Use this skill when any request involves:
- `schedule_job` lifecycle actions (list/create/update/pause/resume/delete/run_now).
- diagnosing why automated jobs are not running, are stalled, or are failing.
- distinguishing cron scheduler behavior from agent heartbeat behavior.
- validating delivery destinations (web/Telegram/other channels).
- incident triage and deterministic recovery of automation.

Do **not** use this as a generic coding guide. This is operations-focused.

---

## 2) Core Operating Model (Mental Map)

Prometheus automation has two independent engines:

1. **Scheduled jobs (`schedule_job`)**  
   Time-based dispatch. Jobs fire from cron or one-shot timestamps, then run the provided `instruction_prompt` in either `main` or isolated sessions.

2. **Agent heartbeats (`update_heartbeat`)**  
   Interval-based wakeups tied to an agent, using that agent's HEARTBEAT instructions. This is continuous agent polling behavior, not cron.

Treat these as separate planes. A healthy heartbeat does not prove cron is healthy, and vice versa.

---

## 3) Scheduler Lifecycle Workflows (Deterministic)

### A. Inventory and Baseline

1. Run `schedule_job(action:"list")` to get all jobs and statuses.
2. For each target job capture:
   - job_id
   - name
   - schedule kind (`recurring` vs `one_shot`)
   - cron or run_at
   - timezone
   - delivery channel/session target
   - paused/active state
3. If diagnosing a run problem, also inspect recent executions using `task_control(action:"list", include_all_sessions:true, status:"...")`.

### B. Create Job (safe defaults)

1. Convert natural language timing with `parse_schedule_pattern` when needed.
2. Build a **fully self-contained** `instruction_prompt` (no implicit context).
3. Create with `schedule_job(action:"create", confirm:true, ...)` including:
   - explicit timezone
   - delivery channel (prefer `web` unless user needs external delivery)
   - `session_target` (`main` unless isolation is required)
4. Re-list jobs and verify the new job appears with expected schedule metadata.

### C. Update Existing Job

1. Read current config first with `schedule_job(action:"list")`.
2. Apply **only intended field changes** via `schedule_job(action:"update", confirm:true, ...)`.
3. Re-list and verify exact changed fields.
4. If timing changed, calculate next expected fire time manually and note it.

### D. Pause / Resume / Delete

- Pause: `schedule_job(action:"pause", job_id:"...")` for incident containment.
- Resume: `schedule_job(action:"resume", job_id:"...")` after fix validation.
- Delete: `schedule_job(action:"delete", job_id:"...", confirm:true)` for permanent removal.

Always verify state after control actions with a fresh `list`.

### E. Run Immediately (Operational Test)

Use `schedule_job(action:"run_now", job_id:"...")` to test current job instructions without waiting for next cron fire.

After `run_now`:
1. Check task creation/result via `task_control(action:"latest")` or `task_control(action:"list", status:"running|failed|complete")`.
2. Confirm expected side effects (files/messages/external posts).
3. If failures occur, triage using section 6 before resuming normal cadence.

---

## 4) Heartbeat Interaction Model & Diagnostics

### What heartbeat controls

`update_heartbeat` governs agent wake frequency + HEARTBEAT instruction body. It does **not** edit cron jobs.

### Diagnostic sequence

1. Inspect whether heartbeat is enabled and interval is sane for workload.
2. Verify HEARTBEAT instructions are executable, bounded, and include clear stop criteria.
3. If agent appears silent, check task history with `task_control(action:"list", include_all_sessions:true)`.
4. Distinguish:
   - **No heartbeat runs generated** → heartbeat config/scheduler issue.
   - **Runs generated but failing** → instruction/tool/runtime issue.
5. Apply minimal corrective change (interval, instruction clarity, enable/disable), then monitor one full cycle.

### Heartbeat safety rules

- Avoid overly aggressive intervals unless required.
- Include explicit no-op behavior when nothing actionable is found.
- Keep HEARTBEAT instructions deterministic and idempotent.

---

## 5) Delivery Caveats (Telegram + Fallback Handling)

### Known caveat: delivery-channel ambiguity

A job can execute successfully while user-visible delivery appears missing if the channel/session routing is wrong.

### Telegram caveat guidance

When using Telegram delivery:
1. Ensure the task actually sends output using `send_telegram` or a workflow that ends with Telegram notification.
2. Do not assume scheduler `delivery.channel:"telegram"` alone guarantees rich output if job logic never calls messaging actions.
3. If Telegram message is absent:
   - verify job execution in `task_control`
   - verify completion state and tool logs
   - run `run_now` for immediate reproduction

### Fallback pattern

If Telegram delivery is unreliable or blocked:
1. Switch/duplicate delivery to `web` for guaranteed in-app traceability.
2. Add explicit final status write (report text or file artifact) in the instruction prompt.
3. Optionally send both web + Telegram until stable.

---

## 6) Incident Triage Flow (Stalled/Failed/No-Output)

Use this exact sequence:

1. **Contain**
   - Pause affected job(s) to stop repeated failure loops.
2. **Classify failure**
   - `task_control(action:"list", status:"failed|stalled|needs_assistance|awaiting_user_input", include_all_sessions:true)`.
3. **Identify plane**
   - cron scheduling issue vs heartbeat issue vs instruction/runtime issue.
4. **Reproduce quickly**
   - `schedule_job(action:"run_now")` or `task_control(action:"rerun")`.
5. **Fix smallest surface area first**
   - prompt correctness, delivery channel, schedule syntax, paused state.
6. **Verify**
   - one successful immediate run + one successful naturally scheduled run.
7. **Recover service**
   - resume jobs, keep temporary monitoring for at least one cycle.

---

## 7) Recovery Playbook Checklists

### Checklist A — "Job did not fire"
- [ ] Job exists in `schedule_job list`.
- [ ] Job not paused.
- [ ] Cron/run_at expression valid and timezone correct.
- [ ] Current time checked against expected fire window.
- [ ] `run_now` succeeds.
- [ ] If `run_now` succeeds but schedule still misses, recreate job cleanly.

### Checklist B — "Job fired but failed"
- [ ] Failure visible in `task_control`.
- [ ] Root cause categorized (tool failure, auth, bad prompt, dependency).
- [ ] Instruction prompt made self-contained and deterministic.
- [ ] One immediate rerun succeeds.
- [ ] Next scheduled execution succeeds.

### Checklist C — "Job completed but no delivery"
- [ ] Confirm execution completed.
- [ ] Confirm output path/channel logic exists in instructions.
- [ ] Validate Telegram caveat conditions.
- [ ] Add web fallback artifact/message.
- [ ] Re-test with `run_now` and confirm user-visible output.

---

## 8) Operational Guardrails

- Always inspect before mutating (list/read-first behavior).
- For create/update/delete, require explicit intent and verify post-state.
- Prefer reversible actions first (pause/resume) during active incidents.
- Avoid simultaneous broad changes (schedule + prompt + delivery) unless necessary.
- Keep incident notes concise and timestamped for traceability.

---

## 9) Quick Command Reference

- List jobs: `schedule_job(action:"list")`
- Create: `schedule_job(action:"create", confirm:true, ...)`
- Update: `schedule_job(action:"update", confirm:true, job_id:"...", ...)`
- Pause: `schedule_job(action:"pause", job_id:"...")`
- Resume: `schedule_job(action:"resume", job_id:"...")`
- Delete: `schedule_job(action:"delete", job_id:"...", confirm:true)`
- Run now: `schedule_job(action:"run_now", job_id:"...")`
- Check tasks: `task_control(action:"list" | "latest" | "get", ... )`
- Heartbeat config: `update_heartbeat(agent_id:"...", ...)`

Use this runbook to keep scheduler operations predictable, debuggable, and recoverable under pressure.