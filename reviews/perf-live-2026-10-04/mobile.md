# Mobile V1 multi-thread performance investigation — 2026-10-04

## Scope, evidence and limits

- Isolated branch `perf/live-mobile-multithread`, worktree `C:\Users\rafel\promsrc-pr\perf-live-mobile` from `origin/main` f58ed9c0b. Never edited, pulled, or restarted the live checkout/gateway. Liquid Glass CSS unchanged; mobile V2 untouched.
- Legitimate pairing: `POST /api/pairing/qr` is guarded by `requirePairingAdmin`; the running desktop-managed gateway returns HTTP 403 `Trusted desktop pairing authority required` to unauthenticated 127.0.0.1. Source: `src/gateway/pairing/pairing-admin-auth.ts:75-87`; desktop admin header/gateway credential required. Approved phones store `pm_device_token` via `web-ui/src/mobile/mobile-api.js:14,97` following `/api/pairing/claim` → `/api/pairing/poll/:reqId` → desktop `/api/pairing/approve`. No token was extracted, forged, or borrowed.
- Read-only CDP live desktop WS capture: `ws-60s.json` (60 s, 220 frames, 1,861,208 serialized bytes). It is **sensitive raw user activity** and stays local/untracked. Background 88 frames/1,585,471 B (85.2%); process output 17/132,825 B; process updates 14/58,308 B; session activity 51/6,875 B; history changes 22/3,718 B. For a phone focused on one of the two active captured parent sessions, the other parent's 30 bg frames/330,262 B could be discarded early by the new guard. This does **not** reduce WS network ingress or parsing: gateway broadcasts these frames regardless of focus.
- A 4x-CPU headless `/mobile` CDP profiler was attempted twice; Chromium/navigation/metric collection stalled without output, and the supervised processes were stopped without touching the gateway. No paired headless session; no trustworthy mobile ScriptDuration, layout/style times, LoAF attribution, heap, storage write stacks, scrolling measurements, or real-phone/Tailscale Funnel measurements. `scripts/profile-mobile-idle.mjs` is provided for a later authorized paired profiling pass; it now has a watchdog. No invented paint/CPU gains are claimed.

## Deterministic before/after replay

`npm run bench:mobile-multithread` runs a non-secret fixture through the **actual source handler** in VM with mocked lane/UI dependencies. `node scripts/bench-mobile-multithread.mjs replay reviews/perf-live-2026-10-04/ws-60s.json` locally replays captured frames. To compare `HEAD` before the commit, set `BASELINE=1` in the environment; timing numbers are sub-millisecond Node handler-only and intentionally **not** mobile CPU or DOM metrics.

| Captured-frame replay; 58 known-parent bg events from selected session | Before | After |
| --- | ---: | ---: |
| Offscreen events forwarded into background lane/UI (1x) | 58/58 | 0/58 |
| Offscreen events forwarded (5x) | 290/290 | 0/290 |
| Focused-session events forwarded (1x) | 58/58 | 58/58 |
| Focused-session events forwarded (5x) | 290/290 | 290/290 |
| Focus polling while visible | 2.5 checks/s | 0.5 checks/s + on-visibility |
| Focus polling while hidden | 2.5 checks/s | timer still scheduled at 0.5/s, callback skips scan |
| Source list rebuild for a steady-state lane event if sheet points at lane | 1 | 0 unless new lane/status transition |

The baseline handler's actual matcher would reject many foreign-session frames; the replay stubs normalization intentionally so these counts represent avoided *entry into normalization* and potential downstream work, not real phone DOM operations or guaranteed 58 actual pre-fix DOM renders. Timing is noisy: 1x offscreen handler-only 0.109 ms before / 0.095 ms after; 5x 0.220 / 0.202 ms in one run; do not extrapolate these as user-visible speedup.

## Changes and causal reasoning

1. `web-ui/src/mobile/mobile-chat-page-runtime.js:8839-8844`: Gateway focuses token streams but broadcasts `bg_agent_event` to every client. Reject direct explicit parent IDs not matching visible chat **before** `_pushMobileBackgroundSpawnEvent` normalizes lanes/persists cache/schedules UI. Parentless/nested-parent frames still use canonical matcher, preserving compatibility. Real capture: 30 of 88 background frames belong to another parent when one session is focused.
2. `web-ui/src/mobile/mobile-chat-renderer-runtime.js:4423-4425`: Sources sheet previously rebuilt on every background frame. Render only for a newly created lane or changed status; ordinary tool/thought output still updates lane and dock via existing scheduler. No CSS changed.
3. `web-ui/src/ws.js:384-389`: Existing 400 ms interval checked focus even if phone was hidden. Retain immediate route `syncWsStreamFocus()` and WS-open, poll fallback at 2 s only if visible, and resynchronize immediately on visibility restore. Network subscription unchanged aside from at most 2 s delay in legacy consumers that never signal explicitly.
4. `scripts/bench-mobile-multithread.mjs`, `scripts/fixtures/mobile-multithread-frames.json`, `package.json:153`: reproducible fixture+real-capture 1x/5x replay with behavioral assertions. The capture is deliberately not committed. `scripts/profile-mobile-idle.mjs` provides instrumentation for later authenticated CDP work.

Already-scoped or already-coalesced paths deliberately left alone: camera `setInterval(...,100)` is installed only during recording and cleared afterwards; voice connection pill timer runs only while voice page is rendered and is cleared on cleanup; stream patch scheduler already coalesces. Drawer invalidation only refreshes if drawer is open (`mobile-shell.js:728-732`); no evidence yet supporting a larger change. No gateway-side change or restart required.

## Validation and outstanding work

- `node --check` changed JS/scripts: pass. `npm run sync:web-ui` and `npm run check:web-ui`: pass; generated `asset-manifest.json`, `service-worker.js`, static mobile files, HTML and referenced hash chunks included in commit. `node scripts/test-web-ui-architecture-guardrails.mjs`: pass (renderer 256895/256913 B, chat page below 472009 B cap).
- `node scripts/test-mobile-chat-renderer-ownership.mjs`, `test-mobile-chat-runtime-authority.mjs`, `test-mobile-chat-runtime-hydration.mjs`, `test-mobile-agent-activity-ui.mjs`, `test-mobile-stream-receipts.mjs`, and `test-mobile-voice-runtime-ownership.mjs`: pass.
- `node scripts/test-mobile-rich-artifact-recovery.mjs`: fails on the pre-existing baseline regex expectation (`msg.content.trim() || ...richArtifacts...`), known to fail on main; not altered in this change.
- For authoritative improvement numbers: ask Raul to pair a disposable profiling browser through Settings → Pairing, record 4x CDP mobile idle/active chat/drawer/scroll LoAF/Performance metrics with consent, then repeat on an isolated preview serving this worktree. Also evaluate gateway-side filtering of offscreen bg/process frames in a separately approved gateway-restart rollout; it could cut wire/JSON overhead substantially.
