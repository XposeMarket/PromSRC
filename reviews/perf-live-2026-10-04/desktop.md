# Desktop renderer multi-thread performance — 2026-10-04

## Scope and conditions

Isolated worktree `C:\Users\rafel\promsrc-pr\perf-live-desktop`, branch `perf/live-desktop-multithread` from `origin/main`. The live gateway and `C:\Users\rafel\PromSRC` were never edited, pulled, restarted, or reset. Headless Chromium at `http://127.0.0.1:32466/?desktop=1`; 1440x900; service workers blocked. Source-overriding Playwright routes serve **original** `PromSRC/web-ui` versus **worktree** `web-ui` while all APIs remain on the same live gateway. Harness and raw WS capture under untracked `temp/perf-live-multithread/`; raw `live-frames.json` is 2,003,843 bytes, intentionally not committed. Captured 295 frames over 66.5 s; 97 background-agent events; 64 main chat events. The gateway sessions endpoint is `GET /api/sessions?scope=all&includeAutomated=1&limit=160&offset=0`.

## Live workload / attribution

| Scenario | Time | WS frames | Script ms | Recalc count / ms | Layout count / ms | Long tasks | DOM start→end | Heap MB start→end | Storage writes / bytes |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Active session + multiple threads, live gateway | 60s | 295 | 769 | 2884 / 1330 | 119 / 126 | 5 | 5382→5407 | 11→11 | 45 / 5,014,234 |
| Long session, many tool traces, live gateway | 30s | 276 | 4154 | 517 / 2877 | 621 / 21,601 | 191 | 14090→14175 | 12→12 | 54 / 3,252,734 |
| Multi-pane workspace with active second session, live gateway | 30s | 204 | 551 | 1427 / 625 | 88 / 220 | 6 | 5109→5119 | 11→11 | 64 / 9,383,688 |

Long-session CPU profile top self times: `get scrollTop` 9,123 ms, `patchStreamingChatBubble` 1,828 ms, `applyToolActivityEvent` 516 ms, tool activity inner callback 379 ms, `card-runtime.js` callback 358 ms; peak LoAF ~866 ms. Headless values are not Electron's 847 MB / ~one-core renderer: host app has accumulated more history, panes and UI state. Recalculations near 48/s on regular sessions persist; do not assert that embers alone caused them. Storage writes are overwhelmingly serialized session history plus background work; persistence is already debounced and not changed here.

## Deterministic replay results

Replay injects captured timestamps at 1x or 5x through `wsEventBus._dispatch`. 5x pair stubs live WebSocket traffic and serves pre-fix vs post-fix source against the same API. **Timing numbers vary with live gateway work, different session histories, and concurrent profiling; they are not reliable end-to-end speedup proof.** The final 5x original and worktree runs were not a simultaneous A/B of identical DOM state (original 5120 vs optimized 3768 in independently sampled runs); use regression assertions for hard guarantees instead of extrapolating them to throughput.

| Replay | Script ms | Style ms / recalcs | Layout ms / count | Task ms | Long tasks | DOM start→end | Storage writes / bytes |
|---|---:|---:|---:|---:|---:|---:|---:|
| 5x original live source (18s) | 386 | 438 / 714 | 169 / 57 | 1936 | 0 | 5120→5125 | 17 / 1,685,499 |
| 5x worktree after first pass (18s) | 423 | 456 / 741 | 217 / 53 | 2062 | 3 | 5096→5101 | 17 / 1,685,499 |
| 5x worktree after lazy trace + offscreen bg gate (18s, later workload) | 222 | 381 / 830 | 100 / 60 | 1620 | 0 | 3768→3849 | 23 / 2,288,880 |
| 1x original live source (70s; live WS additionally present) | 1016 | 1540 / 3240 | 264 / 149 | 6259 | 9 | 5072→5067 | 95 / 11,731,731 |
| 1x first-pass worktree (70s; isolated WS) | 1169 | 1526 / 2960 | 248 / 139 | 6291 | 4 | 5082→5121 | 90 / 10,407,560 |

At 5x, one controlled pre-final original/worktree pair was **431→453 ms script and 422→449 ms style**: the early fixes did not improve overall throughput. The post-lazy 222 ms script number cannot be cleanly attributed to the patch because its DOM baseline and inbound work changed. No measured Electron renderer CPU reduction is claimed. The deterministic behavior regression does prove disabled/non-chat ember animations schedule zero frames over 120 animation ticks, enabled chat schedules frames, visibility/navigation cancels and resumes, and offscreen bg events do not schedule UI paint. Live replay captures remain local-only, not CI fixtures.

## Fixes and reasoning

1. `web-ui/index.html:5703-5714,5814-5819,5869-5904`: previously ember canvas rAF spun every frame when disabled/off-chat. Now cancel and stop, restart on mode/visibility/appearance/theme/data-background-visuals; no change to enabled-chat visuals. `web-ui/src/app.js:1055` emits a mode change after views switch. Standalone VM regression: disabled = **0 vs 120 predicted** requested frames over 120 ticks; off-chat = **0 vs 120**, hidden cancels; enabled and resumed still animate.
2. `web-ui/src/pages/ChatPage.js:13684-13714,15658-15665`: closed historical tool-group bodies no longer rebuild every card for each live streaming update. Existing lazy hydration supplies on demand, with open groups receiving refreshed content; active current group stays eager. Targets the 14k-node, 191-long-task scenario; a controlled **long-session before/after** was not captured, so quantitative benefit remains unverified.
3. `web-ui/src/pages/ChatPage.js:15741-15765`: stop writing the identical scrollTop to a scrolled-up reader on every token; follow-to-bottom behavior remains unchanged. Baseline long session spent 9.1 s in `get scrollTop` and 21.6 s in layouts over 30 s; other scroll reads remain, and this edit alone was not isolated in an A/B.
4. `web-ui/src/pages/ChatPage.js:18870-18923,19056-19078`: persist matching `bg_agent_event` frames but skip scheduling/running dock/detail/source DOM updates for hidden/non-chat/unrelated sessions; recover on visibility/navigation. Collapsed dock signature now depends on visible lane count, not per-token seq/results. Already-existing 120–360 ms background render scheduler remains in place. Approximately **97 background events in 60s** captured; payload bandwidth is gateway-side and unchanged. The known separate wire estimate is 1.59/1.86 MB/min (85%) from the user's steer, not a new measurement made by this script.
5. `web-ui/src/pages/ChatPage.js:19135-19158,47527-47536`: coalesce dock-offset rAF and skip unchanged CSS custom-property writes; avoid sidebar rendering for redundant remote session_activity state. `web-ui/src/pages/ChatPage.js:15765-15775` skips hidden stream paints and refreshes on visibility.
6. `scripts/test-desktop-live-multithread-perf.mjs`, `package.json:20`: deterministic VM ember lifecycle and source contract tests, `npm run test:desktop-live-multithread-perf`. `scripts/test-web-ui-architecture-guardrails.mjs:15`, `scripts/web-ui-architecture-baseline.json:8` explicitly review +1,478 LF bytes of changed ChatPage hot-path logic rather than silently defeating the size ratchet.

## Validation, release and limitations

- `npm run sync:web-ui`, `npm run check:web-ui`, `npm run test:web-ui-architecture`, `npm run test:desktop-live-multithread-perf`, `npm run test:stream-persistence`, `node scripts/test-web-ui-performance-foundation.mjs` and `node --check` on changed JS all passed after the final edits; `npx tsc --noEmit -p tsconfig.json` passed (exit 0). Generated `asset-manifest.json`, `service-worker.js`, hashed chunks and other synced assets were staged with the source. No direct modifications to mobile Liquid Glass CSS.
- No gateway/backend code changed; **no gateway restart required by the code change**. Once merged and deployed, existing desktop clients still require a reload to receive new generated web assets; no merge/deploy/restart was performed here.
- We could not directly reproduce the owner's long-lived Electron renderer's 847 MB and 78–95%-of-one-core state in headless Chromium, nor quantify the reduction on that real window while leaving live threads undisturbed. Fresh browser heaps remained ~11–12 MB; no proof of long-term heap growth. No gateway payload trimming was attempted: it would require a restart and might break consumers.
- Replay 1x baseline and final 5x scenario differ in live traffic or DOM workload; score the 5x final result as suggestive, **not** a validated percentage speedup. Further work: isolate the long-session scroll/layout path with matched DOM snapshots, then address remaining expensive `applyToolActivityEvent` and history serialization without changing semantics. Live 47–48 style recalcs/s remain even when embers are disabled; CSS animation source remains unproven.
