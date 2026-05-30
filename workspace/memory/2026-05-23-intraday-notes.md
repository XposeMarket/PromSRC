
### [DISCOVERY] 2026-05-23T00:28:36.605Z
_Source: Mobile chat session; session: mobile_mphjy5gj_f4d0vc; origin: Mobile app_
/browse and Preview pathway for browser_scroll_collect visual fallback:

CURRENT STATE:
1. `/browse` command triggers Telegram file browser (telegram-channel.ts:4065-4173)
2. Preview button clicks `fb:preview:` callback, which:
   - Shows "Generating preview..." loading message
   - Calls `GET /api/preview/screenshot?path=...` (canvas.router.ts:7587-7611)
   - That route calls `browserPreviewScreenshot(previewUrl, 1200, 10)` (browser-tools.ts:8108-8190)
   - Returns chunks as base64 PNG array
   - Sends as single photo (1 chunk) or Telegram `sendMediaGroup` photo album (2+ chunks)

BROWSERPREVIEWSCREENSHOT IMPLEMENTATION:
- Opens isolated preview session (`__preview_internal__` sessionId)
- Fresh page per preview (never reuses main session)
- Scrolls to each chunk position, takes viewport screenshot
- Chunk height default 1200px, max 10 chunks
- Returns PreviewChunk[] with {index, total, base64, width, height, mimeType}

INTEGRATION OPPORTUNITY FOR SCROLL_COLLECT:
browser_scroll_collect can add optional `include_screenshots: true` flag:
1. During scroll collection loop (browserScrollCollect lines 5246-5412):
   - After each scroll position, call `browserPreviewScreenshot()` or simpler chunk-screenshot
   - Collect base64 chunks as they're captured
   - Return them alongside deduplicated text in structured payload
2. To Telegram delivery:
   - `browser_send_to_telegram()` or delivery layer can emit screenshots AS THEY COME via SSE/progress signals
   - Real-time photo album building instead of waiting for full collection
3. Alternative: async screenshot sidecar
   - Spawn background screenshot tasks for each scroll position
   - Send chunks to Telegram in real-time as they arrive
   - Keeps scroll collection fast, visual feedback runs parallel

KEY ADVANTAGE:
- Users see scrolling page visually WHILE collection happens (not after, not at end)
- Uses existing browserPreviewScreenshot infrastructure
- Reuses Telegram sendMediaGroup / sendPhoto flow
- Adds no extra browser session overhead (optional feature flag)

RULES TO PRESERVE:
- Preview screenshots use isolated `__preview_internal__` session only
- Main chat browser session never affected
- browserScrollCollect still returns full deduplicated text + structured items
- Visual chunks are optional and additive

### [DEV_EDIT_COMPLETE] 2026-05-23T00:49:49.908Z
_Source: Mobile chat session; session: mobile_mphmivpa_pxzxjl; origin: Mobile app_
Completed dev edit dev_edit_mphmmfs2_09986cdb for mobile chat recovery after gateway restarts. Root cause: mobile header online/offline polling recovered independently, but chat recovery only tried once after SSE disconnect and did not hook ws:open/offline->online; if restart lasted longer than the one recovery attempt, the mobile chat stayed stuck until manual refresh. Changed web-ui/src/ws.js to dispatch ws:close/ws:error while preserving reconnect. Changed web-ui/src/mobile/mobile-pages.js to centralize scheduleMobileRunRecovery, trigger recovery on status Offline->Online and ws:open, and keep retrying while a remembered disconnected run exists. Verified and applied live with prom_apply_dev_changes: npm run sync:web-ui passed twice; no gateway restart required for web-ui sync.

### [DEV_EDIT_COMPLETE] 2026-05-23T01:05:04.333Z
_Source: Mobile chat session; session: mobile_mphmivpa_pxzxjl; origin: Mobile app_
Completed mobile live-run catch-up recovery patch under dev edit dev_edit_mphmmfs2_09986cdb. Updated `web-ui/src/mobile/mobile-pages.js` so forced recovery on chat load/return/visibility, WS reconnect, and offline->online now reloads session history, reloads pending approvals, and replays `/api/mobile/chat/stream/:sessionId` from seq 0 instead of waiting for a future stream event. This should fix mobile getting stuck on “Connecting to live run...” when returning to a chat waiting on approval/tool updates. `self/02-startup-runtime.md` doc update was attempted but blocked by current dev-edit mutation scope. Verification/apply: `prom_apply_dev_changes` verify_only and apply_live both succeeded; `npm run sync:web-ui` passed and desktop reload was requested.

### [DEV_EDIT_COMPLETE] 2026-05-23T02:26:12.604Z
_Source: Mobile chat session; session: mobile_mphk3vjz_kcytrp; origin: Desktop app_
Updated split self-reference docs for the Windows run_command/system-control command-policy expansion. Added source-grounded notes to `self/11-run-and-supervisor.md`, `self/05-tools.md`, and `self/15-paths-and-sharp-edges.md`, and updated `self/index.md` verification date/scope. Docs now capture token-based allowlisting, config-backed command arrays, Windows read/system command lanes, approval_mode lite limitations, hard-deny separation, and the future direction of typed Jarvis-style local-control tools over broad raw shell.

### [DISCOVERY] 2026-05-23T03:06:29.109Z
_Source: Mobile chat session; session: mobile_mphrjhwu_zw5h9f; origin: Mobile app_
Raul uploaded screenshots showing that while current primary was Grok 4.3, casual chat turns incorrectly displayed reasoning/tool traces in mobile UI and repeatedly forced memory_search on casual messages despite SOUL/USER rules to avoid tools for small talk. Screenshots also show model-switch commands appeared to be acknowledged as done. Need investigate mobile/model routing + forced tool/action policy leakage: visible blocks include REASONING text, TOOL memory_search events, and self-critique about unnecessary memory_search.

### [DISCOVERY] 2026-05-23T03:10:56.963Z
_Source: Mobile chat session; session: mobile_mphrjhwu_zw5h9f; origin: Mobile app_
Investigated Grok 4.3 mobile reasoning/tool-trace leak. xAI docs confirm Grok 4.3 reasoning defaults to low unless reasoning_effort none; Responses API supports streaming reasoning_summary_text deltas. Prometheus currently routes xAI through OpenAICompatAdapter chat completions (`src/extensions/bundled/providers/xai/prometheus.extension.json` uses `/chat/completions`, no supportsReasoningEffort) while mobile renders any streaming `thinking_delta` as visible `Reasoning` live trace (`web-ui/src/mobile/mobile-pages.js:2177-2182`, `627-638`). Also config lacks xai reasoning_effort, so none is disabled. Likely root: xAI emits provider-visible reasoning deltas or model outputs reasoning-like stream, backend forwards them as thinking_delta, mobile displays them. Separate issue: tool_choice defaults required when tools exist in OpenAICompatAdapter, likely forcing memory_search/tool calls on casual Grok turns unless xai tool_choice auto is persisted.

### [TASK] 2026-05-23T05:19:12.304Z
_Source: Main chat session; session: 996ac4ea-911a-4119-9d51-e25402947cc1; origin: Desktop app_
Updated interactive visual skill metadata overlays for `interactive-visuals`, `html-interactive`, `chart-visualizer`, `svg-diagrams`, and `mermaid-diagrams`. Before update, `skill_inspect` showed empty descriptions/triggers/categories for all five despite useful SKILL.md content. Added clear descriptions, trigger phrases, categories, required `skill_read`, and defaultWorkflow metadata, then verified overlays are active and validation is clean.

### [TASK] 2026-05-23T05:58:49.836Z
_Source: Main chat session; session: 3505410d-0cfb-4286-abd0-8a4dfa8c694b; origin: Desktop app_
Created new bundled skill `product-carousel-builder` for extracting, curating, and displaying product recommendations via `show_product_carousel`. Added resources/manifest trigger metadata to `web-researcher`, `browse-sh-web-skills`, and `browser-automation-playbook` so shopping/product/Amazon workflows route toward carousel output after extraction. Also confirmed Browse.sh adapter skill was not automatically injected from the word “Amazon” in the prior request; browser-automation skill was active, and Browse.sh Amazon resource existed but was not surfaced in active instructions.
[14:31:21] [voice_identity] [Source: Main chat session] Voice-layer behavior rule from Raul: do not address or describe the Worker as a separate entity in user-facing speech. When handing off or steering work, speak as one unified Prometheus/Prom identity — “I’ll take that into the main run” or “I’ll continue there,” not “the worker will…”. This matters especially in voice mode because Raul wants Prometheus to feel like one continuous self, not split agents.

### [DISCOVERY] 2026-05-23T19:38:55.809Z
_Source: Mobile chat session; session: mobile_mpiqq26b_q1p3e0; origin: Mobile app_
Investigated mobile/voice screenshot preview mismatch. Root cause appears architectural: Voice Agent `voice_send_screenshot` in `src/gateway/routes/chat.router.ts:8490-8495` calls `executeDeliverySendScreenshot`, which broadcasts only `delivery_notification` via `src/gateway/delivery-router.ts:69-85` / `:152-155`. Desktop ChatPage consumes `delivery_notification` at `web-ui/src/pages/ChatPage.js:31334-31375` by appending Markdown with a data URL, but mobile/voice UI has no `delivery_notification` listener. The rich voice/mobile screenshot preview path is separate: normal worker `desktop_screenshot` injects SSE `vision_injected` with preview data at `chat.router.ts:2681-2688`; mobile voice stream consumes `vision_injected` at `web-ui/src/mobile/mobile-pages.js:6126-6129` and enqueues floating previews via `_visionEventToMobileMedia`/`_enqueueVoicePreviews` at `:3136-3149` and `:4740-4767`. Mobile slash command `/screenshot` uses another separate endpoint `/api/mobile/commands/screenshot` at `chat.router.ts:9092-9224`, returning `{ image: { base64, mimeType, width, height } }`, rendered into the command card at `mobile-pages.js:2481-2507`. Fix should make delivery/voice screenshot wrappers emit/handle the same preview payload as the worker/mobile command path, not just a text process result.
[18:34:51] [voice-test] [Source: Main chat session] Voice note smoke test: Raul asked Prometheus to write a note via the live voice layer to confirm voice note-writing works. Timestamp: 2026-05-23 6:34 PM EDT.
