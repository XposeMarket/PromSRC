# Daily X Signal Radar — Read-Only Collector Example

Use this example when a scheduled or delegated agent must read the user's authenticated X context and write a signal report without taking social actions.

## Scope

- Read-only X collection only.
- Allowed: open/read home timeline, run searches, collect visible text/cards, write local markdown artifacts, write a continuity note if there is a real signal/blocker.
- Forbidden: like, reply, repost, quote, follow, unfollow, DM, bookmark, post, delete, edit account/settings, or click anything that might cause a social side effect.

## Successful sequence observed on 2026-05-08, reinforced on 2026-05-11, hardened on 2026-05-12, and validated again on 2026-05-17

1. Read this X browser automation skill before opening X.
2. Verify/create local signal paths before collection, for example:
   - `signal-radar/x/daily-x-signal-YYYY-MM-DD.md`
   - `signal-radar/x/latest-daily-x-signal.md`
   - `signal-radar/x/source-preferences.md`
3. Read `signal-radar/x/source-preferences.md` if present so boosted/downranked source guidance shapes the run.
4. For scheduled collectors, prefer a **text-first/no-screenshot** collection plan unless the job is explicitly pinned to a vision-capable model. Do not call `browser_vision_screenshot`, screenshot observation modes, desktop screenshots, image-analysis tools, or the configured messaging channel screenshot tools in the scheduled collector path when text/DOM collection is sufficient.
5. `browser_open("https://x.com/home")` and confirm authenticated state from visible account/session evidence.
6. Use `browser_scroll_collect` on the home timeline. Do not manually blind-scroll in a loop.
7. Open targeted X search URLs and use `browser_scroll_collect` for each query, for example:
   - desktop/computer-use agents
   - Claude Code/Cursor/agent updates
   - HyperFrames/Remotion/HTML Motion AI video
   - local business marketing / cold outreach agency
   - MCP/workflow automation/agent memory
   - trading psychology / revenge trading / discipline
8. Keep search collection bounded and varied. On 2026-05-11 the collector hit a loop-detector warning after repeating identical `browser_scroll_collect` configurations too many times; it recovered by varying search topics/arguments and continuing. Do not hammer the same query + scroll args repeatedly.
9. Synthesize into a dated markdown report with:
   - collection health
   - rough sample sizes
   - top signals with source/account/link/snippet/why it matters/recommended action
   - deferred/noisy areas
   - blockers, if any
10. Write the dated report and copy/update `latest-daily-x-signal.md`.
11. Verify both files after writing with `file_stats` or a direct read so the final response is based on actual artifacts, not only task status.
12. If the run found important signal or hit a blocker, write a short continuity note.

## 2026-05-12 text-first collector pattern

A successful 2026-05-12 scheduled run used this safer prompt shape after earlier model/vision failures:

- Strict read-only rules were explicit.
- It required text-first collection and prohibited screenshots/vision tools.
- It used `file_stats`/`read_file`, then `browser_open` + `browser_scroll_collect` across home and five search buckets.
- It wrote both `signal-radar/x/daily-x-signal-2026-05-12.md` and `signal-radar/x/latest-daily-x-signal.md`.
- It verified file stats after writing.
- It reported run health: X auth worked, no screenshots/vision tools, no social actions, no blockers.

Use this as the default scheduled-run shape when model routing has recently been unstable.

## 2026-05-17 validated pattern

A scheduled run completed successfully at `2026-05-17T01:39Z` after several prior `openai_codex stream had no activity for 75s` failures on 2026-05-16.

What worked:

- The collector stayed text-first and avoided screenshot/vision tools entirely.
- It read `signal-radar/x/source-preferences.md` first.
- It used compact/no-screenshot browser observations and `browser_scroll_collect` across home plus varied search buckets.
- It wrote and verified:
  - `signal-radar/x/daily-x-signal-2026-05-16.md`
  - `signal-radar/x/latest-daily-x-signal.md`
- It recorded a continuity note with the top signal clusters.

The useful 2026-05-17 signal clusters were Hermes + xAI OAuth/X Premium search validation, `/steer`-style mid-run correction UX, desktop agents for messy no-API workflows, Xpose missed-call/Monday local growth brief opportunities, and post-loss trading reset phrasing. This confirms the collector is valuable when it produces cross-domain signals, not just raw X summaries.

## Error-handling pattern

- If the dated report does not exist yet, `file_stats` returning not found is normal; create it instead of treating that as failure.
- If X redirects to login, rate-limits, or collection tools fail, write the blocker honestly into the report rather than pretending collection succeeded.
- If a query returns mostly noise, say that and record only the usable pattern.
- Do not click tweet action buttons while collecting. Collection should use page open + scroll/text extraction, not engagement controls.
- If the scheduled job fails with `model does not support image inputs`, inspect scheduler model routing. On 2026-05-11/12 the collector was still set to `gpt-5.3-codex-spark`; patching it to `openai_codex/gpt-5.5` and/or forcing a text-first no-screenshot prompt unblocked later runs.
- If the scheduled job fails repeatedly with `openai_codex stream had no activity for 75s`, do not infer that X auth or browser collection is broken. Retry with the hardened text-first workflow and then verify the actual output files; the 2026-05-17 run succeeded with the same collector shape after multiple 2026-05-16 no-activity failures.
- After model-routing or file-write errors, verify the actual output files and freshness. Scheduler success alone is insufficient if the run excerpt says `Tool failed: filename is required` or similar.
- If the scheduler shows a long `terminated` or preflight-only run, do not infer success. Check the final report files and run history before summarizing.

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
- No screenshots/vision tools used in scheduled mode
- No social actions taken
- No blockers / Blocker: ...
Top signals:
- ...
```