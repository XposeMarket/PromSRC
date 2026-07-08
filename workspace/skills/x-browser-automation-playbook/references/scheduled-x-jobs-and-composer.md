# Scheduled X jobs, composer refs, cron

Migrated from **MEMORY.md** `project_memory` (2026-06-06, 2026-06-12) on 2026-07-07.

## Live schedule source of truth

Before assuming stale blockers, read **`audit/cron/jobs/jobs.json`** and Mara schedule memory at  
`.prometheus/subagents/x_account_operator_raulinvests_v1/memory/schedule-memory.md`.

## Known jobs (verify IDs in jobs.json)

| Job name | Typical cron | Owner |
|----------|--------------|--------|
| `prometheus-x-posts` | `0 */3 * * *` (every 3h) | Mara (`x_account_operator_raulinvests_v1`) |
| `prometheus-x-research-replies` | (per jobs.json) | Mara |

Historical IDs (may change): `job_1781023720991_vo76d`, `job_1781023570457_uvjbb`.

## schedule_job contract

Recurring jobs require explicit **`schedule.cron`** in `schedule_job` create/update (not only natural-language schedule fields).

## Posting contract (Mara / scheduled runs)

- Browser-only posting and replies for @raulinvests (verify live auth in browser).
- **No em dashes** in generated copy — see `references/no-em-dash-x-copy.md`.
- Close browser after run; log content/targets per playbook session hygiene.
- Entity: `entities/projects/mara-x-account-operator.md`.

## Composer / DOM patterns (fallback manual flow)

When composites are unavailable, snapshots often expose:

- Composer: `tweetTextarea_0` (inline) patterns
- Submit: `tweetButtonInline` or snapshot **COMPOSER SUBMIT BUTTON: @N** — click after fill unless high-impact final action needs `request_final_action_approval`
- Keyboard: **Control+Enter** submit fallback

Prefer verified **`x_post_text`** composite for standard posts when exposed (see SKILL.md changelog v1.6.0).

## Draft-only

If Raul says draft only / don't post: do not click Post/Submit; stop at filled composer + screenshot proof.