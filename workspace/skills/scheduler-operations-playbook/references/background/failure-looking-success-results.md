# Failure-looking success results — 2026-05-18

Observed during Brain Dream review for the Weekly Opportunity Radar scheduled run.

## Signal
A scheduled report run can be marked `success` even when the final output text is a tool failure string such as:

```text
Tool failed: pattern is required
```

Evidence:
- `audit/chats/transcripts/auto_job_1777659794081_8f76x_1779062738611.md:15-18`
- `audit/cron/runs/job_1777659794081_8f76x.jsonl:10`

## Guardrail
When verifying scheduled jobs, do not trust job status alone. Inspect the final result excerpt, linked task journal/final summary, expected output checks, and actual written/delivered artifact.

Treat the following as failure-looking results even if scheduler status says success:
- `Tool failed:`
- `ERROR:`
- `pattern is required`
- `not found` when the target artifact was required
- `no output written`, `could not write`, or missing required sections
- terse `Done.` / raw tool-output blobs for report-producing jobs

## Recovery pattern
1. Open `schedule_job_detail` / history for the job.
2. Inspect the linked task or auto-job transcript.
3. Check expected output files with `schedule_job_outputs(check)` or direct file reads.
4. If the result is failure-looking, mark the run operationally failed in the report/notes and either rerun after fixing the blocker or propose a scheduler/source hardening patch.
5. For report-producing jobs, verify required sections and evidence index exist in the artifact before saying the job delivered.
