---


# Scheduler Operations Playbook

Modern operations runbook for Prometheus automations: scheduled jobs, schedule-owner subagents, managed-team schedules, expected output checks, internal watches, run history, stuck-state controls, user-visible delivery verification, model routing, and agent heartbeats.

---

## 1) When to Use This

Use this skill when a request involves:
- Listing, creating, updating, pausing, resuming, deleting, or running scheduled jobs.
- Diagnosing scheduled jobs that failed, stalled, falsely succeeded, delivered stale output, or produced no user-visible result.
- Updating a job prompt safely with `schedule_job_patch`.
- Checking job run history, linked tasks, run logs, expected outputs, or stale files.
- Managing schedule-owner subagents or managed-team schedules.
- Distinguishing scheduler behavior from heartbeat behavior.
- Hardening jobs with expected output verification and deterministic instructions.

This is operations-focused. For source-code changes, use source/proposal workflows. For workspace file edits, use the file-surgery skill.

---

## 2) Current Mental Model

Prometheus automation has three related but separate planes:

1. **Scheduled jobs (`schedule_job`)**
   - Time-based dispatch: recurring cron or one-shot `run_at`.
   - New normal: jobs run through an isolated schedule-owner subagent unless a managed `team_id` is provided.
   - `session_target:"main"` is legacy compatibility only; do not treat it as actual job ownership.

2. **Schedule-owner subagents**
   - Durable owner agents attached to individual scheduled jobs.
   - They execute the job prompt and preserve job-linked context/memory.
   - Inspect linkage via `schedule_job_detail`, not by guessing from job name.

3. **Agent heartbeats (`update_heartbeat`)**
   - Interval-based agent wakeups using that agent's HEARTBEAT.md instructions.
   - Heartbeat is not cron. A healthy heartbeat does not prove scheduled jobs are healthy, and vice versa.

Managed-team schedules are a special case: a scheduled run wakes the team manager first, and the manager derives work from team mission/focus/context before dispatching members.

---

## 3) Default Inspection Flow

Before mutating any job, inspect the real current state.

1. **Inventory**
   - `schedule_job(action:"list", limit:...)`
   - Capture: id, name, enabled/status, cron/run_at, timezone, nextRun, lastRun, lastResult, model, team_id, subagent_id, assignment target, delivery.

2. **Open the target detail**
   - `schedule_job_detail(job_id:"...", limit:10)`
   - Use this as the source of truth for:
     - full prompt/config
     - recent run records
     - linked task ids/statuses
     - recent errors/blockers
     - expected outputs
     - output checks
     - schedule memory

3. **If output correctness matters**
   - `schedule_job_outputs(action:"get"|"check", job_id:"...")`
   - Validate actual files/payloads, not just `lastResult` snippets.

4. **If logs/errors are unclear**
   - `schedule_job_history(job_id:"...", limit:...)`
   - `schedule_job_log_search(job_id:"...", query:"...", status:"...", limit:...)`
   - `task_control(action:"get", task_id:"...")` for linked task details when needed.

5. **For broad automation health**
   - `automation_dashboard(limit:..., include_done:false)` gives jobs + tasks + watches + pending events in one snapshot.

6. **If asynchronous follow-up matters**
   - `internal_watch(action:"create", target:{type:"scheduled_job", job_id:"..."}, condition:{mode:"terminal"|"latest_result"|"ran"}, on_match:"...")`
   - Use a watch when a `run_now`, retry, managed-team dispatch, or linked task may finish after the current turn and you need this chat to resume with the result. Give every watch a bounded TTL and clear success/timeout instructions.
   - Do not use watches as busy-polling replacements; use them only for bounded task/job/event/file completion conditions.

---

## 4) Creating Jobs Safely

1. Convert timing if needed:
   - `parse_schedule_pattern(text:"weekday at 8:30am", timezone:"America/New_York")`
2. Write a fully self-contained `instruction_prompt`.
   - Assume a fresh agent with no chat context.
   - Include exact inputs, outputs, allowed tools/actions, forbidden side effects, fallback behavior, and success criteria.
3. Prefer `delivery.channel:"web"` unless the user explicitly needs Telegram/Discord/other output.
4. Create with:
   - `schedule_job(action:"create", confirm:true, name:"...", instruction_prompt:"...", schedule:{...}, timezone:"...", delivery:{channel:"web"})`
5. Re-list and open detail to verify config.

### Schedule shapes and ownership fields

- `schedule` may be a raw cron/run_at object or friendly fields such as `{kind:"recurring", repeat:"daily"|"weekday"|"weekend", time:"09:00"}`, `{days_of_week:["monday","wednesday"], time:"14:30"}`, `{every_hours:6}`, `{every_days:2, time:"09:00"}`, or `{text:"weekdays at 9am"}`.
- Always include a real IANA timezone such as `America/New_York`; do not assume local time silently.
- For managed-team schedules, pass `team_id`; the scheduler wakes the team manager first.
- For non-team schedules, omit `subagent_id` unless intentionally reusing a known schedule-owner subagent. The scheduler will create/assign an isolated owner automatically.
- Treat `delivery.session_target:"main"` as legacy compatibility, not actual ownership.
6. Add expected outputs when the job should create/read a file or deterministic artifact:
   - `schedule_job_outputs(action:"set", job_id:"...", expected_outputs:[...], confirm:true)`
7. Run once immediately when safe:
   - `schedule_job(action:"run_now", job_id:"...")`
8. Verify via detail/history/output checks.

### Prompt requirements for future-proof jobs

A good scheduled job prompt includes:
- Who the agent is.
- Exact objective.
- Read/write paths and expected filenames.
- Whether browsing/API use is allowed.
- Whether external side effects are forbidden or allowed.
- What to do if blocked.
- Output format.
- Completion criteria.
- Delivery expectations.
- Verification requirements.

Bad: “Send Raul a morning brief.”
Good: “Read `signal-radar/x/latest-daily-x-signal.md`; if missing, report the exact missing path and do not invent signals; deliver exactly this phone-friendly markdown format...”

---

## 5) Updating Existing Jobs

Prefer `schedule_job_patch` over raw full `schedule_job(action:"update")` when changing prompt/model/enabled/expected output fields because it provides previewable diffs.

1. Inspect first:
   - `schedule_job_detail(job_id:"...", limit:10)`
2. Preview the change:
   - `schedule_job_patch(action:"preview", job_id:"...", instruction_prompt:"...")`
3. Confirm only the intended fields changed.
4. Apply:
   - `schedule_job_patch(action:"apply", job_id:"...", instruction_prompt:"...", confirm:true)`
5. Re-open detail and verify prompt/config.
6. If behavior changed, run now and inspect outputs.

Use `schedule_job(action:"update", confirm:true, ...)` for ordinary schedule/timezone/delivery updates when patch fields do not cover the needed change.

### Mutation guardrails

- Do not update a job from memory. Read the full current prompt first.
- Keep the schedule unchanged unless the user asked to change timing.
- Preserve explicit safety rules in existing prompts unless intentionally replacing them.
- If adding a new primary tool route, keep deterministic fallback behavior.

### Patchable fields

`schedule_job_patch` can safely preview/apply common targeted changes:
- `name`
- full replacement `instruction_prompt`
- `timezone`
- `model_override` (empty string clears it)
- `enabled`
- `expected_outputs`

For changes outside those fields — cron/friendly schedule, delivery channel, `team_id`, `subagent_id`, or one-shot vs recurring shape — use `schedule_job(action:"update", confirm:true, ...)` after reading the detail and preserving unchanged fields.
- If output files matter, add/update expected output checks in the same maintenance pass.

---

## 6) Running and Verifying Jobs

### Immediate test

Use `schedule_job(action:"run_now", job_id:"...")` to test current config without waiting for cron.

After a run:
1. Open `schedule_job_detail(job_id:"...", limit:10)`.
2. Check `recentRuns`, `linked.tasks`, `latestResult`, `recentErrors`, and `outputChecks`.
3. If a task id exists and status is failed/stalled, inspect it with `task_control(action:"get", task_id:"...")`.
4. If expected files exist, read or check the actual file when correctness matters.
5. For user-facing messages, inspect the actual outbound payload/tool log when possible; do not rely only on job success.

### Natural schedule verification

For production fixes, one successful `run_now` is good but not always enough. If the issue is scheduler timing, verify the next natural cron run too.

---

## 7) Expected Outputs

Expected outputs are how scheduled jobs avoid false success.

Use when a job should create, update, or rely on a file/artifact.

- Get current specs:
  - `schedule_job_outputs(action:"get", job_id:"...")`
- Set specs:
  - `schedule_job_outputs(action:"set", job_id:"...", expected_outputs:["path/file.md"], confirm:true)`
  - or objects: `{path:"...", requiredText:"...", absentText:"..."}`
- Check specs:
  - `schedule_job_outputs(action:"check", job_id:"...")`

Good expected output examples:
- `{path:"signal-radar/x/latest-daily-x-signal.md", requiredText:"# Daily X Signal Radar", absentText:"[obsolete brand]"}`
- `{path:"opportunity-radar/latest-weekly-opportunity-brief.md", requiredText:"## Top opportunities"}`

Expected output checks do not replace reading the file when the content is high-stakes; they are a guardrail, not full judgment.

---


### Output spec forms

Expected output entries may be either:
- a workspace-relative path string, e.g. `"signal-radar/x/latest-daily-x-signal.md"`
- an object, e.g. `{path:"signal-radar/x/latest-daily-x-signal.md", requiredText:"# Daily X Signal Radar", absentText:"[obsolete brand]"}`

Use `requiredText` for must-have headers/markers and `absentText` for stale brands, known bad placeholders, or previous failure strings. If delivery depends on a file, require enough text to prove it is the fresh intended artifact, not just any file at that path.
## 8) Incident Triage Flow

Use this sequence for stalled/failed/no-output jobs:

1. **Open the detail**
   - `schedule_job_detail(job_id:"...", limit:10)`
2. **Classify the failure**
   - Scheduler did not fire.
   - Job fired but model/tool failed.
   - Job is still running/stalled.
   - Job completed but output is missing/stale/wrong.
   - Job completed but delivery was not visible.
   - Managed-team manager woke but did not dispatch useful work.
3. **Contain if repeating**
   - Pause only if repeated failures are causing spam, cost, or bad outputs.
   - `schedule_job(action:"pause", job_id:"...")`
4. **Inspect linked task/logs**
   - `task_control(action:"get", task_id:"...")`
   - `schedule_job_log_search(...)`
5. **Patch the smallest surface**
   - Prompt clarity, model route, expected outputs, delivery, or schedule timing.
6. **Clear stuck/error state if needed**
   - `schedule_job_stuck_control(action:"clear_blocked"|"mark_handled"|"cancel_retry_loop"|"rerun_clean", job_id:"...", confirm:true)`
7. **Run now**
   - Confirm the immediate path works.
8. **Verify real outputs**
   - Files, payloads, outbound messages, or task artifacts.
9. **Resume if paused**
   - `schedule_job(action:"resume", job_id:"...")`
10. **Record continuity**
   - Use `write_note` for meaningful fixes, blockers, or runbook insights.

---

## 9) Common Failure Modes and Fixes

### A. False success / stale output

Symptoms:
- `lastResult` says done but expected file is missing/stale.
- User receives old or obsolete content.

Fix:
- Add expected outputs with required/absent text.
- Patch prompt to read/write exact paths and fail closed if missing.
- Verify actual file or outbound payload after `run_now`.

### B. Model/tool mismatch

Symptoms:
- Non-vision model receives screenshot/image input.
- Provider quota/routing errors.
- Tool unavailable in scheduled context.

Fix:
- Patch prompt to avoid vision/image tools for scheduled reliability unless required.
- Prefer text/API routes first.
- Use `get_agent_models` / `set_agent_model` only when routing defaults are actually wrong.
- Re-run and verify.

### C. Browser-auth-dependent job fails silently

Symptoms:
- Browser login redirect treated as zero results.
- Search/bookmark pipeline reports no data but auth was missing.

Fix:
- Prompt must verify exact target surface auth, not generic home/profile access.
- If auth fails, write an explicit blocker.
- For X work, prefer native `x_search` when suitable, with browser fallback only if needed.

### D. Managed-team scheduled run does nothing useful

Symptoms:
- `lastResult`: “Hey! How can I help?”
- Manager woke with insufficient mission/focus/instructions.

Fix:
- Inspect team mission/focus/context with team coordinator tools, not direct low-level team mutation from main chat.
- Update team purpose/context/focus so the manager has a concrete recurring run objective.
- Run now and verify dispatched member work.

### E. Stalled retry loop

Symptoms:
- Multiple failed/stalled linked tasks.
- Same run keeps retrying/backing off.

Fix:
- Pause if needed.
- `schedule_job_stuck_control(action:"cancel_retry_loop"...)` or `rerun_clean` after patch.
- Inspect whether duplicate tasks remain active.


### F. Long-running or asynchronous run loses foreground visibility

Symptoms:
- `run_now` starts work but the current chat does not have the terminal result yet.
- A managed-team dispatch, linked task, or file-producing job is expected to complete later.
- Manual polling would waste turns or miss a result after restart.

Fix:
- Create a bounded `internal_watch` on the scheduled job, linked task, expected file, or event queue.
- Use `target:{type:"scheduled_job", job_id:"..."}` with `condition:{mode:"terminal"|"latest_result"|"ran"}` for job completion.
- Use `target:{type:"task", task_id:"..."}` for linked task terminal status, or `target:{type:"file", path:"..."}` with `mode:"appears_or_changes"` for artifact completion.
- Include `on_match` instructions that reopen detail/history/output checks and report the result; include `on_timeout` instructions that state the exact timeout and next inspection step.
- Keep `max_firings:1` unless intentionally monitoring multiple changes.
### F. Delivery missing

Symptoms:
- Job complete, but Raul does not see the result.

Fix:
- Verify whether job prompt actually sends/returns output.
- For Telegram, confirm a real `send_telegram` call or delivery tool log when required.
- Add web fallback or explicit artifact path.
- Do not assume `delivery.channel` alone guarantees the desired rich message.

---

## 10) Heartbeat Diagnostics

Heartbeat operations use `update_heartbeat`; they are separate from scheduled jobs.

Diagnostic sequence:
1. Identify the agent id.
2. Inspect current heartbeat configuration if available.
3. Verify HEARTBEAT instructions are bounded, idempotent, and have no-op behavior.
4. Check task history for heartbeat-generated runs.
5. Classify:
   - No heartbeat tasks generated → heartbeat config/scheduler issue.
   - Tasks generated but failing → instruction/tool/runtime issue.
6. Apply the smallest change: interval, enabled state, model, or instructions.
7. Monitor one full cycle.

Heartbeat safety rules:
- Avoid aggressive intervals unless necessary.
- Include explicit stop/no-op criteria.
- Do not use heartbeat as a substitute for cron when exact timing matters.

---


---

## 11) Model Routing and Capability Checks

Scheduled jobs often run outside the main chat's current model. Do not assume the current live chat model is the job model.

Use this sequence when model capability or provider routing is implicated:
1. Inspect `schedule_job_detail` for `model_override`, linked owner subagent, team/subagent assignment, and recent provider/model errors.
2. If the job has a direct `model_override`, patch it with `schedule_job_patch(action:"preview"|"apply", model_override:"provider/model")`.
3. If proposal/background/subagent defaults are the blocker, inspect with `get_agent_models` and update only the specific default with `set_agent_model`.
4. For browser/desktop/Creative visual work, use a vision-capable route; otherwise prefer text/API-first prompts for scheduled reliability.
5. After any routing change, reopen the job detail to verify the exact route, then `run_now` and verify real outputs.

Common capability failures:
- Non-vision model receives screenshots/image input.
- Provider quota/rate limit blocks the owner subagent.
- Tool category is unavailable in the scheduled context.
- Browser auth is missing for the exact target surface.

---

## 12) User-Facing Delivery Verification

A completed run is not proof that Raul received the right thing.

For Telegram/Discord/WhatsApp or other external delivery:
- Verify the prompt explicitly performs the send action, or that the scheduler delivery mechanism is known to emit that exact payload.
- Inspect outbound payload/tool logs when possible; do not trust `lastResult` alone.
- If the content is generated from a file, read/check the actual file and confirm it is fresh before delivery.
- For stale-brand/obsolete-copy risks, use expected outputs with `absentText` and inspect the final outbound text.
- If delivery fails, preserve the artifact path and deliver via a web/main-channel fallback rather than regenerating from memory.
## 13) Delivery Rules

### Web delivery
- Best default for in-app traceability.
- Still verify output files/artifacts when relevant.

### Telegram delivery
- Job success is not proof of Telegram delivery.
- The prompt must explicitly call `send_telegram` or use a workflow that sends to Telegram.
- Verify actual outbound payload/tool log when correctness matters.

### Main-channel delivery
- Some jobs have `assignmentTarget:"main"` / `deliverToMainChannel:true`.
- Inspect detail to confirm this instead of assuming from schedule name.

---

## 14) Quick Command Reference

- Dashboard: `automation_dashboard(limit:25, include_done:false)`
- List jobs: `schedule_job(action:"list", limit:100)`
- Job detail: `schedule_job_detail(job_id:"...", limit:10)`
- Run history: `schedule_job_history(job_id:"...", limit:10)`
- Search logs: `schedule_job_log_search(job_id:"...", query:"...", limit:25)`
- Create: `schedule_job(action:"create", confirm:true, ...)`
- Update: `schedule_job(action:"update", confirm:true, job_id:"...", ...)`
- Patch preview: `schedule_job_patch(action:"preview", job_id:"...", ...)`
- Patch apply: `schedule_job_patch(action:"apply", job_id:"...", confirm:true, ...)`
- Pause: `schedule_job(action:"pause", job_id:"...")`
- Resume: `schedule_job(action:"resume", job_id:"...")`
- Delete: `schedule_job(action:"delete", job_id:"...", confirm:true)`
- Run now: `schedule_job(action:"run_now", job_id:"...")`
- Expected outputs get/check/set: `schedule_job_outputs(action:"get"|"check"|"set", ...)`
- Stuck control: `schedule_job_stuck_control(action:"clear_blocked"|"mark_handled"|"cancel_retry_loop"|"rerun_clean", job_id:"...", confirm:true)`
- Task detail: `task_control(action:"get", task_id:"...")`
- Outputs get/check/set: `schedule_job_outputs(action:"get"|"check"|"set", job_id:"...", ...)`
- Watch completion: `internal_watch(action:"create", target:{type:"scheduled_job", job_id:"..."}, condition:{mode:"terminal"|"latest_result"|"ran"}, ttl_ms:..., on_match:"...", on_timeout:"...")`
- Dashboard: `automation_dashboard(limit:25, include_done:false)`
- Model routing inspect: `get_agent_models()`
- Model routing update: `set_agent_model(agent_type:"...", model:"provider/model")`
- Parse schedule text: `parse_schedule_pattern(text:"weekdays at 9am", timezone:"America/New_York")`
- Task list: `task_control(action:"list", include_all_sessions:true, status:"...")`
- Heartbeat config: `update_heartbeat(agent_id:"...", ...)`

---

## 15) Golden Rules

- Inspect before mutating.
- Prefer `schedule_job_detail` over `lastResult` snippets.
- Preview patches before applying.
- Use expected outputs for file-producing jobs.
- Verify actual outbound payloads for user-facing delivery.
- Treat browser auth as a real dependency; fail closed with explicit blockers.
- Use text/API-first routes for scheduled reliability when possible.
- Record meaningful fixes and recurring gotchas with `write_note`.

A scheduled job is not “healthy” because it ran. It is healthy when it ran the intended prompt, used the intended tools, produced fresh expected outputs, and delivered the right user-visible result without unsafe side effects.
