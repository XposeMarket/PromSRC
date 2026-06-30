
### [DISCOVERY] 2026-06-29T00:00:51.578Z
_Source: Mobile chat session; session: mobile_mqyg7tmj_x86zuf; origin: Mobile app_
Investigated Raul's Prom SRC question about the "short 20-word response before doing anything" behavior. Source search found no active main-chat prompt forcing a mandatory 20-word pre-tool response. Current durable USER/SOUL context already says the opposite: no mandatory pre-tool announcement; call tools first and speak after results. Related source surfaces found: `src/gateway/routes/chat.router.ts` base prompt says direct execution and only voice narrator keeps spoken updates under 24 words; `web-ui/src/mobile/mobile-pages.js` has `preamble` live-trace handling that displays any model text before first tool, but does not cause it; `src/gateway/routes/realtime.router.ts` voice policy says selective spoken progress only. Likely issue is provider/model natural tool preambles or old audit/session context, not a current Prometheus src instruction.

### [TASK] 2026-06-29T00:18:28.836Z
_Source: Mobile chat session; session: mobile_mqyg7gew_ibgg6s; origin: Mobile app_
Completed browser/desktop latency benchmark. Wrote `browser-tool-bench/browser-latency-results-2026-06-28.md`. Browser sample: 53 calls, avg 2.95s, median 1.83s, p90 7.74s, slowest `browser_open` YouTube 17.25s. Desktop sample: 12 calls, avg 2.33s, median 1.98s, slowest verified scroll/click ~5.1s. Biggest speedups: avoid new heavy navigations, use compact/none observations, use snapshot_delta/extract/scroll_collect, add source-level fast path and browser_batch_actions.

### [DISCOVERY] 2026-06-29T05:20:05.452Z
_Source: Main chat session; session: c47eacbb-38fc-4a4d-a832-cf1ecac1e934; origin: Desktop app_
Audited Prometheus workspace file-tool source for Raul's planned cleanup/unification. Key findings: workspace_write category currently bundles FILE_OPS_TOOL_NAMES and COMMAND_RUNNER_TOOL_NAMES in `src/gateway/tool-builder.ts`; schemas live in `src/gateway/tools/defs/file-web-memory.ts`; chat execution mostly lives in `src/gateway/agents-runtime/subagent-executor.ts`; registry implementations live separately in `src/tools/files.ts`, `src/tools/repo-tools.ts`, `src/tools/shell.ts`, and `src/tools/process-tools.ts`. Important cleanup opportunities: terminal already unifies hidden command aliases, but file/git/safety/code-nav remain many top-level tools; `apply_workspace_patchset` schema/chat path supports rename_file but registry implementation does not; patchset is described as atomic while execution is sequential; prompt-context still describes workspace_write as one huge category and legacy file_ops wording remains.

### [DEBUG] 2026-06-29T05:58:48.063Z
_Source: Main chat session; session: c47eacbb-38fc-4a4d-a832-cf1ecac1e934; origin: Mobile app_
Smoke-tested Raul's newly implemented unified workspace wrappers. Passing: workspace_read exists/list/list_files/tree/stats/read/batch_read/grep/search; workspace_edit mkdir/create/write/patchset/delete_lines/copy/move/delete_file/preview_patch/apply_patch(check); workspace_run run/start/status/log/typecheck; workspace_git status/diff; workspace_safety snapshot/scan_large_files/scan_secrets/operation_plan/preview_patch. Setup docs/tool-builder appear wrapper-first with granular compat tools hidden. Found blocker: workspace_code_nav outline fails with `Cannot read properties of undefined (reading 'TS'/'JS')`, traced to `src/gateway/agents-runtime/subagent-executor.ts` `buildCodeOutlineForFile` using `const ts = await import('typescript')` and then `ts.ScriptKind.*`; in this runtime dynamic import of CJS TypeScript exposes ScriptKind under default, so code-nav wrappers are not fully working yet. `npx tsc --noEmit` passed.

### [TASK] 2026-06-29T06:06:39.193Z
_Source: Background agent; session: brain_dream_2026-06-28_
Brain Dream 2026-06-28 ran evidence review and filed two approval-ready proposals: prop_1782713139514_a4a870 (add switch_model_low/medium fallbacks in .prometheus/config.json) and prop_1782713173063_c4333b (finish/verify games/mobile-sideways-fps Pocket Zombies). Verified live config still lacks switch_model_low/medium at .prometheus/config.json:326-335 while schema supports them; verified Pocket Zombies artifact exists with start/control layering still needing a final browser QA pass. Could not write Brain/dreams/2026-06-28/02-01-dream.md or Brain/proposals.md in this run because no workspace file write tool was exposed in the current API namespace.
_Related task: brain_dream_2026-06-28_02-01_

### [DEBUG] 2026-06-29T15:46:20.227Z
_Source: Mobile chat session; session: mobile_mqzdu0sy_v1r2io; origin: Mobile app_
Smoke-tested Raul's new single-wrapper tool categories from mobile session. Covered workspace_read/edit/run/git/safety/code_nav; dev_source_read across src + web-ui; browser_session/observe/act/extract; desktop_screen/apps/window/input/macro/background; agent/model tools including get/list/save/delete template; agent/team/schedule/watch dashboard paths. Cleanup removed scratch `tool-wrapper-smoke` and deleted temporary model template. Findings: source write category correctly blocked without approved dev edit; workspace_read(search) with glob `tool-wrapper-smoke/*.txt` returned no matches while direct file grep worked; workspace_read(grep) with directory+glob but no filename errored `filename is required`; browser network read returns guidance unless interception is started; desktop_window find requires `name` not `title`; team_collab update_status correctly errors outside team sessions; desktop_background reports no sandbox/Hyper-V worker configured.

### [DEBUG] 2026-06-29T15:47:49.990Z
_Source: Mobile chat session; session: mobile_mqzdu0sy_v1r2io; origin: Mobile app_
Smoke-tested tool stopwatch benchmark instrumentation at Raul's request. Stopwatch markers appeared on core tool calls: skill_list elapsed_ms=654, request_tool_category elapsed_ms=735, workspace_read exists elapsed_ms=5, workspace_run node smoke elapsed_ms=3265 with successful command output. Confirms benchmark stopwatch output is still active across tool surfaces.

### [TASK] 2026-06-29T16:13:04.618Z
_Source: Mobile chat session; session: mobile_mqzeugl9_czzl29; origin: Mobile app_
Started full Prometheus main-tool benchmark for Raul. Updating `browser-tool-bench/` with a broad latency report covering workspace/dev/browser/desktop/memory/skills/automation/core tools using `[TOOL_STOPWATCH]` timings.

### [TASK] 2026-06-29T16:22:42.908Z
_Source: Mobile chat session; session: mobile_mqzeugl9_czzl29; origin: Mobile app_
Completed full Prometheus main-tool benchmark and wrote `browser-tool-bench/prometheus-tool-benchmark-2026-06-29.md` (379 lines). Key findings: workspace file reads/edits are already very fast; biggest speed targets are browser action fast paths, desktop click/scroll overhead, memory_search FTS latency, workspace_run cold path, skill_read prompt bloat, and web_search timeout/fallback.

### [TASK] 2026-06-29T17:30:27.010Z
_Source: Mobile chat session; session: mobile_mqzeugl9_czzl29; origin: Mobile app_
Completed focused browser/desktop speed retest after latest tool changes. Wrote `browser-tool-bench/browser-desktop-speed-retest-2026-06-29.md` and updated benchmark README. Major wins: browser scroll observe:none 1.23s -> 14ms, type 24ms -> 8ms, screenshot 3.90s -> 2.79s; desktop screenshot 4.43s -> 3.05s, window click 4.34s -> 3.18s, window scroll 4.13s -> 3.04s, global input click/scroll ~0.6-0.7s. Remaining bottlenecks: browser key still ~1.52s, browser click still 1.62s, desktop window-scoped actions still 2.5-3.2s, desktop modifier defaults still report +ctrl, and a desktop_window scroll handle lookup failed once unless title/name was supplied.

### [DISCOVERY] 2026-06-29T17:41:59.411Z
_Source: Background agent; session: background_bg_1e3faba8-4726-4724-8361-5d362b1a2b65_
Background performance scan (no edits) found concrete Prometheus tool latency suspects: `src/gateway/browser-tools.ts` browserPressKey calls helper `pressKey`, whose `pressKey` helper waits 1500ms after every key, matching ~1.5s `browser_act key observe:none`; browserClick fastAck skips extra 500ms settle but still calls clickByRef/clickBySelector and minimal ack, so inspect Playwright action defaults/metadata sync next. Desktop window-scoped paths in `src/gateway/desktop-tools.ts` always run `prepareWindowForInput` -> `resolveCanonicalWindow` + `focusWindowHandle` before delegating to global desktopClick/PressKey/Scroll, explaining 2.5-3.2s vs global 350-700ms. `desktop_window` schema still lacks modifier:'none', while schema enum exposes shift/ctrl/alt only.
_Related task: bg_1e3faba8-4726-4724-8361-5d362b1a2b65_

### [TASK] 2026-06-29T19:48:31.546Z
_Source: Mobile chat session; session: mobile_mqzmol67_ohzuje; origin: Mobile app_
Ran AI surface smoke test: activated desktop and browser tool categories, focused Codex window successfully; could not find a running dedicated Claude desktop app, only Chrome tab with Claude-themed title. Focused Chrome window (active) and executed browser searches on Reddit and X for 'Claude OpenClaw Hermes AI'. Collected live Reddit/X text with recurring themes around comparing Hermes vs OpenClaw vs Claude Code, security/agent safety concerns, and practical migration/agent-stack discussions. Browser automation worked after attaching to CDP (9222 pass). Delivered a desktop screenshot to mobile via delivery_send_screenshot.

### [TASK] 2026-06-29T21:08:30.976Z
_Source: Mobile chat session; session: mobile_mqzpi3wi_aju8fq_
Ran post-restart AI surface smoke test. Desktop focus found/focused Codex successfully and delivered screenshot to origin. No dedicated Claude window was open; only WindowsTerminal and Codex were listed. Browser automation opened Reddit search and X search for `Claude OpenClaw Hermes AI`, with screenshots delivered. Reddit showed current threads comparing Hermes/OpenClaw/Claude Code/Codex; X showed live/authenticated search results, but xAI provider fallback failed due spending-limit credits.

### [TASK] 2026-06-29T21:11:28.226Z
_Source: Mobile chat session; session: mobile_mqzpnjta_sjdab6; origin: Mobile app_
Ran AI smoke test again for Raul from mobile. Desktop windows: Codex found/focused and screenshot delivered to origin; no open Claude desktop window matched. Browser doctor passed on Prometheus Chrome/CDP 9222. Browser opened Reddit search and X live search for `Claude OpenClaw Hermes AI`. Reddit showed active Hermes/OpenClaw/Claude Code comparison chatter, including r/hermesagent posts like “Why use Hermes over Claude?” (168 votes/168 comments), “Claude Code + Hermes = Massive Unlock” (223/118), “OpenClaw vs Hermes” (123/175). X search worked while logged in as @raulinvests; visible live posts discussed AI agents, OpenClaw/Hermes, Claude Code skills, and agent limitations/auth/2FA. Browser tab closed after completion.

### [TASK] 2026-06-29T21:16:49.032Z
_Source: Mobile chat session; session: mobile_mqzptmdw_vewq13; origin: Mobile app_
Ran AI surface smoke test for Raul from mobile. Skills loaded: ai-surface-smoke-research, desktop/browser/X playbooks. Desktop: Codex window found/focused and screenshot delivered to origin; no Claude desktop window found among open windows. Browser doctor passed on Prometheus Chrome profile/CDP 9222. Reddit search opened for `Claude OpenClaw Hermes AI` and returned current posts around Hermes vs Claude/OpenClaw. X search opened for same query, logged-in search loaded live posts, screenshot delivered. Browser tab closed afterward.

### [TASK] 2026-06-29T21:44:50.672Z
_Source: Mobile chat session; session: mobile_mqzqulcy_6xsg7e; origin: Mobile app_
Ran AI surface smoke test for Raul from mobile. Loaded ai-surface-smoke-research skill, activated desktop/browser tools, focused Codex successfully and delivered screenshot to origin. No dedicated Claude window was open; only WindowsTerminal, Codex, and Chrome were visible. Browser doctor passed CDP 9222/attach/profile. Reddit browser search for `Claude OpenClaw Hermes AI` returned live results around Hermes vs Claude Code, Hermes vs OpenClaw, multi-agent Claude/Codex/OpenClaw/Hermes collaboration, and Claude+Hermes unlock posts. X live search worked and showed recent AI-agent chatter from MacpreneurFM, Ledama, Elia Alberti, COTI, Ishaan Gupta, etc. Tool issue observed: browser_extract scroll_collect/scroll_collect_v2 routed incorrectly to structured extraction and errored `requires schema.fields`, but page_text and browser scroll worked.
