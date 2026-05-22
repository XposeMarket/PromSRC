# Daily X Signal Radar — Read-Only Collector Example

Use this example when a scheduled or delegated agent must read Raul's authenticated X context and write a signal report without taking social actions.

## Scope

- Read-only X collection only.
- Allowed: open/read home timeline, run searches, collect visible text/cards, write local markdown artifacts, write a continuity note if there is a real signal/blocker.
- Forbidden: like, reply, repost, quote, follow, unfollow, DM, bookmark, post, delete, edit account/settings, or click anything that might cause a social side effect.

## Successful sequence observed on 2026-05-08 and reinforced on 2026-05-11

1. Read this X browser automation skill before opening X.
2. Verify/create local signal paths before collection, for example:
   - `signal-radar/x/daily-x-signal-YYYY-MM-DD.md`
   - `signal-radar/x/latest-daily-x-signal.md`
   - `signal-radar/x/source-preferences.md`
3. Read `signal-radar/x/source-preferences.md` if present so boosted/downranked source guidance shapes the run.
4. `browser_open("https://x.com/home")` and confirm authenticated state from visible account/session evidence.
5. Use `browser_scroll_collect` on the home timeline. Do not manually blind-scroll in a loop.
6. Open targeted X search URLs and use `browser_scroll_collect` for each query, for example:
   - desktop/computer-use agents
   - Claude Code/Cursor/agent updates
   - HyperFrames/Remotion/HTML Motion AI video
   - local business marketing / cold outreach agency
   - trading psychology / revenge trading / discipline
7. Keep search collection bounded and varied. On 2026-05-11 the collector hit a loop-detector warning after repeating identical `browser_scroll_collect` configurations too many times; it recovered by varying search topics/arguments and continuing. Do not hammer the same query + scroll args repeatedly.
8. Synthesize into a dated markdown report with:
   - collection health
   - rough sample sizes
   - top signals with source/account/link/snippet/why it matters/recommended action
   - deferred/noisy areas
   - blockers, if any
9. Write the dated report and copy/update `latest-daily-x-signal.md`.
10. If the run found important signal or hit a blocker, write a short continuity note.

## Error-handling pattern

- If the dated report does not exist yet, `file_stats` returning not found is normal; create it instead of treating that as failure.
- If X redirects to login, rate-limits, or collection tools fail, write the blocker honestly into the report rather than pretending collection succeeded.
- If a query returns mostly noise, say that and record only the usable pattern.
- Do not click tweet action buttons while collecting. Collection should use page open + scroll/text extraction, not engagement controls.
- If the scheduled job fails with `model does not support image inputs`, inspect scheduler model routing. On 2026-05-11 the collector was still set to `gpt-5.3-codex-spark`; patching it to `openai_codex/gpt-5.5` and verifying job detail unblocked the later run.
- After model-routing or file-write errors, verify the actual output files and freshness. Scheduler success alone is insufficient if the run excerpt says `Tool failed: filename is required` or similar.

## Output contract

A good final report says exactly what was saved, run health, auth state, searches run, blockers, and 3-7 top signals. Example final summary shape:

```text
Saved/updated:
- signal-radar/x/daily-x-signal-YYYY-MM-DD.md
- signal-radar/x/latest-daily-x-signal.md
Run health:
- X authenticated as @raulinvests
- Home timeline collection worked
- N targeted searches ran
- No blockers / Blocker: ...
Top signals:
- ...
```
