
### [DISCOVERY] 2026-05-17T00:41:15.412Z
Researched X API vs xAI OAuth for Raul. Key finding: xAI/SuperGrok OAuth is not the same as X Developer Platform API access. xAI OAuth/API covers Grok/xAI endpoints and built-in x_search; official X API v2 features (bookmarks, likes, follows, DMs, lists, posting, metrics/analytics, streams) require an X Developer Console app, X API credits/pay-per-use, and X OAuth 2.0 PKCE/user-context scopes such as tweet.read/users.read/bookmark.read/like.read/tweet.write/offline.access. X pricing docs include owned reads for own posts/bookmarks/likes/followers at $0.001/resource and analytics read at $0.005/resource. Metrics docs say public metrics are accessible with bearer token, private/non-public/organic/promoted metrics require user context and owned posts, with a 30-day limit for non-public/organic/promoted metrics.

### [TASK] 2026-05-17T01:38:47.702Z
Daily X Signal Radar completed successfully for 2026-05-16 in text-first mode. Updated `signal-radar/x/daily-x-signal-2026-05-16.md` and `signal-radar/x/latest-daily-x-signal.md`; top signals were Hermes+xAI OAuth/X Premium search validation, mid-run steering UX, desktop agents for messy no-API workflows, and a trading post-loss reset rule.
_Related task: 2803d7d3-a49e-41e4-9cdc-4a75d16005ea_

### [LAST_RUN_INSIGHT] 2026-05-17T01:38:55.188Z
Text-first X collection with compact browser observations worked cleanly and avoided the prior screenshot/non-vision model-routing failure path. Tricky pattern: search results are noisy, but varied bounded `browser_scroll_collect` calls plus aggressive dedupe produced enough signal without loop-detector issues.
_Related task: 2803d7d3-a49e-41e4-9cdc-4a75d16005ea_

### [DISCOVERY] 2026-05-17T01:56:46.745Z
Investigated mobile voice + xAI response failure after Raul hit xAI OAuth 400 token-limit error. Switched current model back to openai_codex/gpt-5.5. Source finding: mobile xAI voice mode is not realtime; it uses xAI STT/TTS in `voice.router.ts`, then sends text through normal `/api/chat` (`web-ui/src/mobile/mobile-api.js`), so response generation uses the current primary model. When primary is xAI/Grok, `chat.router.ts` sends the full Prometheus system/personality/memory/tool context to `ollama.chatWithThinking`; with the current massive injected context this produced 1,405,036 tokens, exceeding xAI's 1,000,000 prompt max. OpenAI Realtime has separate context clamping in `realtime.router.ts`, but normal chat/xAI does not have equivalent provider-specific prompt budgeting.

### [DISCOVERY] 2026-05-17T05:27:52.871Z
Inspected Prometheus mobile Creative route. Mobile files are under `web-ui/src/mobile/`; `mobile-data.js` already exposes a bottom-tab Creative route (`#mobile/creative`), but `mobile-router.js:162` currently maps it to `renderPlaceholderPage(...)` with “Mobile creative tools and HyperFrames previews are coming soon.” `mobile-pages.js` is the large render-function file, and `mobile-shell.js` provides header/tabbar plus a reusable bottom canvas/file viewer sheet. Good next design direction: make Creative mobile a launcher/remote-control page, not a full desktop editor clone: prompt-to-create, recent exports/previews, mode cards (Image/Video/Design), HyperFrames/templates browser, render job progress, and handoff/open-on-desktop actions.

### [TASK] 2026-05-17T06:07:03.822Z
Updated Daily X Signal Radar — Collector scheduled job (`job_1777858649056_grcnr`) to use the native `x_search` tool as the primary X collection route and only use browser/X DOM collection as fallback when x_search fails, is unavailable, or returns insufficient signal. Also rewrote `skills/scheduler-operations-playbook/SKILL.md` from v1.0.0 to v2.0.0 with current scheduler tools: schedule_job_detail/history/log_search/outputs/patch/stuck_control, schedule-owner subagents, managed-team schedules, expected outputs, delivery verification, and modern failure modes.

### [DISCOVERY] 2026-05-17T06:24:04.108Z
Dug into mobile-only Prometheus chat `Load failed` / `Error: terminated` issue. Source findings: `/api/chat` SSE in `src/gateway/routes/chat.router.ts:6587-6617` registers main-chat runtime then aborts the whole turn on `res.on('close')` if request not completed; it also lacks `res.flushHeaders()` unlike team stream. Gateway server in `src/gateway/core/server.ts:304-312` sets `requestTimeout=30_000`, `headersTimeout=15_000`, `maxRequestsPerSocket=1`, and per-socket `setTimeout(15_000)` with keepalive disabled. Mobile frontend `web-ui/src/mobile/mobile-api.js:777-858` uses fetch streaming with an AbortController; mobile UI `web-ui/src/mobile/mobile-pages.js:1196-1239` rerenders the entire chat thread on every token/tool/progress event. Likely combined cause: mobile browser/network/renderer closes the long fetch stream during heavy tool-output turns; server interprets close as cancellation and aborts the backend turn, causing generic `terminated`/`Load failed`. Fix direction: treat mobile SSE client close as UI disconnect/recoverable instead of killing the turn, add explicit abort reason instrumentation, flush headers, and reduce/batch mobile process-log rerenders/payloads.
### [COMPACTION_SUMMARY] 2026-05-17T06:38:13.386Z
Goal: fix Prometheus mobile-only chat failures where long/tool-heavy turns show `Load failed` / `Error: terminated`. Confirmed current model is `openai_codex/gpt-5.5`, not xAI. Diagnosis so far: issue is likely mobile chat streaming/lifecycle, not provider. Source findings: `/api/chat` in `src/gateway/routes/chat.router.ts` aborts the backend assistant run on `res.close`; mobile uses fetch-stream SSE in `web-ui/src/mobile/mobile-api.js`; mobile rerenders the whole chat/thread on each event in `web-ui/src/mobile/mobile-pages.js`; gateway socket timeout settings in `src/gateway/core/server.ts` m

### [COMPACTION_SUMMARY] 2026-05-17T06:40:14.672Z
Goal: fix Prometheus mobile-only chat failures where long/tool-heavy turns show `Load failed` / `Error: terminated`. Confirmed current model is `openai_codex/gpt-5.5`; issue is mobile chat streaming/lifecycle, not xAI/provider. Diagnosis: `/api/chat` in `src/gateway/routes/chat.router.ts` aborts backend assistant runs on `res.close`; mobile fetch-stream SSE in `web-ui/src/mobile/mobile-api.js` likely disconnects during long/tool-heavy turns; `web-ui/src/mobile/mobile-pages.js` appears to rerender the whole chat/thread on every stream event; gateway socket timeout settings in `src/gateway/core/


### [TASK] 2026-05-17T06:48:39.175Z
Applied approved mobile chat stability edits: `/api/chat` now detects mobile-origin requests and does not abort the backend turn when the mobile SSE client disconnects; gateway server timeout/socket handling no longer forcibly closes `/api/chat` SSE after 15-30s; mobile stream errors now normalize `terminated/load failed` into an actionable message; mobile chat UI batches streaming renders with a short scheduler instead of rerendering the whole thread on every token/tool event. Pending: build/sync/restart verification.
### [COMPACTION_SUMMARY] 2026-05-17T13:33:20.185Z
Goal: finish and verify the Prometheus mobile chat stability fix for long/tool-heavy turns that were failing with `Load failed` / `Error: terminated`.

Constraints: keep fixes scoped to approved files; preserve unrelated dirty work; use dev source-edit flow; after web-ui/mobile edits sync generated assets, build, and restart gateway when backend changed. Raul wants direct action, minimal chatter, and real verification rather than speculation.

Decisions/current state: issue was diagnosed as mobile streaming/lifecycle, not xAI/model routing. Backend `/api/chat` was aborting runs when mobile SSE

### [COMPACTION_SUMMARY] 2026-05-17T13:46:55.174Z
Goal: confirm/finalize the Prometheus mobile chat stability fix for long/tool-heavy turns that previously failed with `Load failed` / `Error: terminated`.

Constraints: keep fixes scoped to approved files; preserve unrelated dirty repo changes; use dev source-edit flow; after web-ui/mobile edits run sync/build, and restart gateway for backend changes. Raul prefers direct verification and concise status, not speculation.

Decisions/current state: diagnosis points to mobile streaming/lifecycle, not xAI/model routing. Patch is reportedly applied in `src/gateway/routes/chat.router.ts`, `src/gatewa

### [COMPACTION_SUMMARY] 2026-05-17T13:51:12.042Z
Goal: make Prometheus mobile chat resilient when the phone app/browser is backgrounded, closed, or reopened during a long/tool-heavy AI turn. Current patch improved backend behavior so mobile disconnects do not necessarily abort the running turn, but mobile still shows a warning: “Mobile stream disconnected before Prometheus finished…” because the UI treats the SSE connection as the live source of truth.

Constraints: no editing yet; Raul only asked for planning. Keep future source changes scoped, proposal-quality concrete, and preserve unrelated repo state. Mobile should not show scary discon


### [TASK] 2026-05-17T18:18:05.451Z
Updated `skills/scheduler-operations-playbook` to v2.1.0. Changes: synced manifest/overlay metadata with triggers/categories/required tools; added automations toolBinding; added current rules for schedule shapes/timezones, schedule-owner/team ownership, `schedule_job_patch` patchable fields, expected output object forms, bounded `internal_watch` follow-ups, model routing/capability checks via `get_agent_models`/`set_agent_model`, and stronger user-facing delivery verification. Verified `skill_inspect` reports overlay source, v2.1.0, ready status, no missing tools/categories, and updated required tools including `internal_watch`, schedule detail/history/logs/patch/outputs/stuck controls, dashboard, parse schedule, and heartbeat.
