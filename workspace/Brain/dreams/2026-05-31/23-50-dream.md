# Brain Dream — 2026-05-31
_Generated: 2026-05-31 23:50 local / completed after compaction_

## Executive synthesis

2026-05-31 was a product-polish and reliability day. The strongest thread is that Prometheus is becoming useful enough for Raul to test it like a real operating layer: mobile UI polish, realtime voice quiet mode, HyperFrames promo output, X/browser automation, desktop app focus, and Polymarket research all got exercised in one day. The work was concrete, but the same theme kept repeating: status reports and static success are not enough. The important failures were all verification failures — invisible mobile header spacing, quiet mode saying it is quiet while still failing, screenshots captured but not delivered, browser ports responding but not attachable, and promo text technically rendered but not readable long enough.

The best product signal was Prometheus' positioning. Repeated AI smoke tests and fallback research pointed toward the market wanting a unified mission-control / Agent OS layer around Codex, Claude, Hermes, OpenClaw, memory, tools, and execution. That is exactly Prometheus territory. The practical money signal was Polymarket: the imported Hermes-adapted skill works, and Raul immediately asked whether it can help make money. That should become a read-only edge-scanner/watchlist workflow rather than staying a one-off CLI lookup.

## Durable memory/entity updates written

Updated project/vendor entities from `Brain/business-candidates/2026-05-31/candidates.jsonl`:

- `project/prometheus`
  - Recorded the 45s Ash & Archive Prometheus HyperFrames promo in `workspace/hyperframes-prometheus-promo`, including 1350-frame render, local FFmpeg encode, verified `final.mp4`, and Raul's critique that readable text holds are too short.
  - Recorded the medium-confidence Agent OS / mission-control market-positioning signal from repeated AI smoke tests.
- `project/prometheus-mobile-app`
  - Recorded the realtime quiet-mode activation failure and likely `voice_enter_quiet_mode` tool-call ordering issue.
  - Recorded the mobile liquid-glass polish and remaining possible invisible header wrapper/padding/top-space issue.
- `vendor/polymarket`
  - Created entity and recorded that `skills/polymarket-research` plus `scripts/polymarket.py` are verified functional; AI search returned 892 markets.
- `project/polymarket-edge-scanner`
  - Created entity and recorded the medium-confidence repeatable edge-scanner/watchlist idea after Raul asked whether Polymarket can help make money.

Updated `MEMORY.md` / `project_memory`:

- HyperFrames promo readability rule: future Prometheus/HyperFrames promos need readable text hold-time QA and direct response to praise+critique.
- Mobile realtime quiet-mode follow-up: tool output first, suppress extra `response.create`, provider-correct session update, wake phrase reactivation.
- Browser automation health issue: 9222 CDP attach timeout and 9223 normal-profile conflict; avoid retry loops after diagnosis.
- Polymarket capability: imported skill works; next useful step is a read-only edge scanner/watchlist workflow.

Wrote reconciliation artifact:

- `Brain/business-reconciliation/2026-05-31/report.md`

## Source-grounded findings from this Dream run

### 1. Realtime quiet mode remains the critical mobile voice follow-up

The day’s evidence narrowed the bug from “quiet mode is flaky” to a concrete response-lane ordering problem. Raul saw quiet mode fail with `Realtime: Cancellation failed: no active response found`, while Codex suspected quiet activation/cancellation happens before the realtime function-call output is safely returned. The current source areas inspected during compaction show the architecture that matters:

- `src/gateway/routes/chat.router.ts`
  - `voiceToolResult()` returns compact JSON tool outputs.
  - `voiceRuntimeDirectiveFromToolResult()` extracts `runtimeAction`, `wakePhrase`, `activateAfterReply`, and `requiresWakePhrase`.
  - `voice_enter_quiet_mode` returns `runtimeAction: 'enter_quiet_mode'`, `activateAfterReply: true`, and `requiresWakePhrase: true`.
- `web-ui/src/mobile/mobile-pages.js`
  - Realtime function outputs for quiet mode include `realtime_quiet_applied: true` and `spoken_confirmation_not_needed: true` and are sent with `{ createResponse: false }`.
  - `_activateMobileRealtimeAgentQuietMode({ skipCancel: true })` is called after the quiet output path.
- `web-ui/src/pages/ChatPage.js`
  - Desktop chat realtime quiet output has similar `spoken_confirmation_not_needed` and `{ createResponse: false }` behavior.

Conclusion: some quiet-mode suppression logic appears to exist, but the live failure means it still needs provider-specific runtime verification and probably a small ordering/suppression fix. The acceptance bar should be strict: OpenAI and xAI each quiet after a single acknowledgement/tool output, no extra `response.create`, no cancellation toast, and wake phrase reactivates the realtime agent.

### 2. Mobile liquid-glass header is close, but needs direct render QA

The current CSS/source intent is correct on paper: `.pm-header` is an absolute, pointer-transparent floating layer, only actual controls receive pointer events, and `.pm-title-row` carries top spacing only for pages that render a title row. Chat/voice pages should have no title row so messages can scroll behind floating controls.

However Raul repeatedly corrected that there must be no hidden header wrapper, reserved height, spacer, overlay, or padding compensation. The final Claude follow-up failed with a model inactivity error, so the status is not closed. This should be verified directly in source/generated mobile output and visually in a mobile viewport/PWA. If the rendered chat still reserves top space, the fix should be surgical and respect the intended floating-header model.

### 3. HyperFrames promo pipeline succeeded; readability QA did not

Prometheus produced a concrete 45s Ash & Archive vertical promo from local source-backed rendering rather than a fake/static mock. It rendered 1350 PNG frames with Playwright/local Edge, encoded with local FFmpeg, and verified MP4 duration/sample frames. Raul liked it — but his most useful critique was that zoomed/readable text only stays up for about 2-5 seconds and disappears too fast.

This is now a durable QA rule: for future Prometheus/HyperFrames promo work, visual QA must include readable text hold-time, not only export success, lint, or isolated frame samples. The best follow-up is a retiming pass on `workspace/hyperframes-prometheus-promo`.

### 4. Browser automation health is a real operational blocker

Repeated AI smoke tests showed desktop focus and web fallback worked, but browser automation did not. Prometheus Chrome on 9222 responded to CDP probes while Playwright could not attach; user Chrome on 9223 could not launch/respond because the normal Chrome profile was already open. Earlier X posting also hit a no-session browser-open timeout.

The behavior rule is now clear: once `browser_doctor` or equivalent confirms this state, stop retry loops, preserve pending social/composer text, report the exact blocker, and use desktop/web fallback. A future tooling fix should provide a safe recovery lane for restarting/clearing the Prometheus debug target.

### 5. Polymarket is ready for a scanner workflow

The imported `polymarket-research` skill is not theoretical. The approved command ran successfully and returned 892 AI search results. Raul’s immediate “can this help make money?” question is the key product transition: a single market search is not enough; Prometheus should build a repeatable read-only scanner that ranks liquid markets with outside evidence, prices, liquidity, edge rationale, and risk flags.

## Follow-up proposal candidates for `Brain/proposals.md`

1. **Fix mobile realtime quiet-mode tool-call ordering and provider suppression**
   - Priority: critical.
   - Scope: `src/gateway/routes/chat.router.ts`, `web-ui/src/mobile/mobile-pages.js`, and parity review in `web-ui/src/pages/ChatPage.js`.
   - Goal: tool output/ack first, no extra response, correct OpenAI/xAI session update shape, no cancellation errors, wake phrase reactivation.

2. **Verify and repair mobile liquid-glass floating header layout**
   - Priority: high.
   - Scope: `web-ui/src/mobile/mobile-shell.js`, `web-ui/src/mobile/mobile-pages.js`, `web-ui/src/styles/mobile.css`, generated mobile sync, rendered mobile/PWA behavior.
   - Goal: no invisible bar/spacer/padding; controls truly float over chat/voice content.

3. **Retiming pass for the 45s Prometheus HyperFrames promo**
   - Priority: high.
   - Scope: `workspace/hyperframes-prometheus-promo/`, source timing, sampled frames, FFmpeg/Playwright export.
   - Goal: readable claims hold long enough, sample frames verify readability, revised MP4 is clearly produced.

4. **Build a read-only Polymarket edge scanner workflow**
   - Priority: high.
   - Scope: `skills/polymarket-research/`, public Polymarket APIs, external evidence research, scoring/report template.
   - Goal: ranked shortlist/watchlist of liquid markets with evidence, implied odds, edge rationale, and risk flags.

5. **Add or expose a one-click AI smoke/health check**
   - Priority: medium.
   - Scope: `ai-surface-smoke-research`, possible composite tool, desktop/browser/screenshot/web fallback diagnostics.
   - Goal: one command gives pass/fail status without repeating fragile manual choreography.

6. **Browser target recovery for wedged Chrome debug/profile states**
   - Priority: medium.
   - Scope: browser automation runtime/doctor UX and a safe guarded restart/recovery lane.
   - Goal: stop retry loops and recover from 9222 CDP attach timeout / 9223 profile conflict states when allowed.

## Blockers / scope notes

- No executable `write_proposal` records were created because this scheduled cron task explicitly prohibited creating proposals unless the schedule prompt explicitly instructed it. `Brain/proposals.md` was updated as the proposal-candidate artifact.
- No Prometheus source files were edited. The mobile quiet/header findings are source/log grounded but require a normal approved source-edit/review lane.
- No live phone/provider tests were run during Dream. Realtime quiet-mode acceptance still needs OpenAI and xAI live verification.
- The 2026-05-31 run started after context compaction; this artifact intentionally continues the active Brain Dream rather than redoing all earlier tool logs.
