# Repeated no-activity scheduled job failures (2026-05-21)

Observed on 2026-05-21 during the Daily X Signal Radar morning brief schedule: the same scheduled job failed repeatedly across several runs with `Error: openai_codex stream had no activity for 75s` before producing any useful brief.

## Guardrail

When a scheduled job shows multiple consecutive `openai_codex stream had no activity for 75s` errors:

1. Treat it as a scheduler/model-runtime reliability incident, not as a content-quality issue.
2. Inspect `schedule_job_detail` and `schedule_job_history` before patching the prompt.
3. Check whether the job is in a retry loop or firing too frequently; pause or cancel retries if it is producing repeated failed runs.
4. Prefer a text-only, file-read-minimal prompt for recovery runs, and verify with `run_now` plus actual output inspection.
5. If the prompt is already simple/read-only, investigate model routing/owner-subagent health rather than adding more prompt instructions.

Evidence: `audit/cron/runs/job_1777858664048_m25qw.jsonl:35-41` recorded repeated no-activity failures from 2026-05-21T12:20:27Z through 2026-05-21T14:15:45Z.
