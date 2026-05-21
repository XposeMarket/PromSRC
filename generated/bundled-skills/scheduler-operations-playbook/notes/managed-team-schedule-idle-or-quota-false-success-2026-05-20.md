# Managed-team schedule false-success: idle/manager quota output

Observed 2026-05-20 during Brain Thought scan.

## Symptom
A managed-team scheduled job can record `status:"success"` even though the manager did not dispatch useful team work. Concrete outputs seen:

- `Team manager scheduled run finished (natural_stop, 1 turn(s)): Hey! How can I help?`
- `Team manager scheduled run finished (idle, 3 turn(s)): Error: anthropic API error 400: ... You're out of extra usage ...`

Example job: `job_1778021273904_3ehgf` (`Daily X Bookmark → Prometheus Feature Pipeline — Nightly Team Run`) in `audit/cron/runs/job_1778021273904_3ehgf.jsonl:9-12`.

## Diagnostic rule
For managed-team schedules, never treat scheduler `success` as sufficient. Inspect the `result_excerpt` / latest result and classify these as unhealthy even when cron status is success:

- generic greeting (`Hey! How can I help?`)
- provider quota/auth/model errors embedded in the manager text
- `idle`/`natural_stop` with no artifact paths, no dispatch summary, no counts, and no `[GOAL_COMPLETE]`/expected completion marker
- no linked artifacts or zero evidence written when the job prompt requires artifacts

## Preferred recovery path
1. Open `schedule_job_detail(job_id, limit:10)` and read the full prompt, team id, latest result, recent runs, and linked tasks.
2. Check whether the manager has enough self-contained schedule instructions to read team mission/context and dispatch member lanes.
3. Verify model routing for the manager/coordinator path if the latest result embeds Anthropic/OpenAI quota or unsupported-model errors.
4. Add/verify expected output checks for concrete artifacts when possible.
5. Patch the smallest surface: schedule prompt, manager/team focus, or model route. Then run now and verify real artifacts, not only job success.

## Reporting language
Call this a false-success or unhealthy scheduled run, not a healthy run with a minor warning.