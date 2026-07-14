# Non-vision scheduled-job recovery — 2026-05-11

Use this note when a scheduled/background job fails with an image-input or vision-capability error.

## Evidence

The Daily X Signal Radar collector repeatedly failed while routed to `openai_codex/gpt-5.3-codex-spark` with:

> Model 'gpt-5.3-codex-spark' does not support image inputs.

the user identified the root cause directly: “It's model is 5.3 spark.” Prometheus patched the collector job to `openai_codex/gpt-5.5` and verified the job detail showed `gpt-5.5`; a later rerun completed and wrote `signal-radar/x/daily-x-signal-2026-05-12.md` plus `latest-daily-x-signal.md`.

Evidence: `audit/cron/runs/job_1777858649056_grcnr.jsonl:13-19`; `Brain/skill-gardener/2026-05-11/workflow-episodes.jsonl:8-10`; `audit/chats/transcripts/telegram_1799053599_1778556564166.md` if present.

## Recovery sequence

1. Inspect the failing job detail and history (`schedule_job_detail`, `schedule_job_history`) before patching.
2. Confirm whether the active/scheduled model is non-vision (`gpt-5.3-codex-spark`, other Spark/non-vision routes, or any provider/model known to reject image inputs).
3. If the job needs browser/desktop/Creative visual evidence, patch the job/subagent model to a vision-capable route such as `openai_codex/gpt-5.5` rather than trying to force image payloads into the non-vision model.
4. If the job can run text-only, patch the prompt/model path to use text-first collection and avoid vision tools/screenshot injection.
5. Re-read the job detail after patching and verify the exact model/provider changed.
6. Run or wait for one bounded retry, then inspect actual output files/tool logs — not just scheduler status.

## Guardrail

A status of `success` is not enough after vision/model routing incidents. Verify that the expected artifact exists and contains real fresh output. A previous collector run was marked success while the excerpt was only `Tool failed: filename is required`; treat that as a real failure smell until output files prove otherwise.

## Related source-code opportunity

There is source-level capability gating in `src/gateway/vision-chat.ts` and `src/gateway/routes/chat.router.ts`, but scheduled jobs can still be misrouted to non-vision models. If this repeats, propose source hardening or scheduler model preflight rather than only patching individual jobs.
