# Prometheus P0-1 performance investigation — 2026-08-08

Status: local investigation and safe fixes completed. No production deployment or infrastructure change was made. Backend source changes are built and tested. The local gateway was restarted through its managed quick-restart path and verified on replacement PID 23796; a long-running post-restart soak remains an explicit follow-up.

## Executive result

The highest-confidence web finding was unnecessary Projects work on the critical desktop boot path. Serving the repository HEAD web sources and the working-tree web sources through the same browser harness reduced cold-start median DOMContentLoaded from 156.5 ms to 102.5 ms, first-contentful paint from 124 ms to 80 ms, and decoded resource bytes from 5,585,343 to 5,362,685 bytes across three samples. The Projects API request disappeared from startup.

The highest-impact system finding is the long-running gateway resource state: the local Node gateway had been running for about 25 hours and grew from roughly 9,959 MB to roughly 10,314 MB resident memory during this investigation while the host stayed around 92–93% memory use. The old session cache retained every loaded transcript for the life of the process. A bounded hot-session cache, memory health fields, and cache-status telemetry were added. After the managed restart, the replacement process reported about 269 MB RSS and a 2/256 hot-session cache at startup; this is a clean-start checkpoint, not yet proof of the 24-hour RSS slope.

Model/provider latency remains the dominant chat-tail risk in the available historical telemetry. The existing seven-day local turn log shows a p95 of about 323.6 seconds from first provider event to first visible token and about 611.2 seconds to the main-stream completion in the current mixed workload. The new trace correlation path makes this diagnosable later without logging message contents or token text; no external provider/load-test change was justified or attempted.

The controlled live Luna check confirms the tail is provider-dominated rather than gateway admission/context dominated. On three short `openai_codex/gpt-5.6-luna/medium` turns, context build completed in 134–456 ms after the first sample's initial cold path, while first visible token arrived in 2.61–4.38 seconds post-fix. A bounded read-only desktop/browser smoke task completed in 76.4 seconds post-fix across five provider passes and seven tool calls; the same task was 81.0 seconds before the telemetry-only change, which is too small and provider-variable to claim a speedup.

## A. Architecture and performance map

| Surface | Entry point | Critical path | Current evidence |
|---|---|---|---|
| Electron desktop | electron/main.js → local gateway at 127.0.0.1:18789 → BrowserWindow | static index, module boot, session list, WebSocket, SSE chat | Measured with headless Chromium against the local gateway; Electron native window capture was not needed for this web-path baseline |
| Desktop web UI | web-ui/index.html and web-ui/src; generated mirror under generated/public-web-ui | DOM boot, app.js mode selection, ChatPage.js streaming/session rendering | ChatPage.js is about 2.23 MB; post-fix startup decoded about 5.36 MB and script decoded about 3.11 MB |
| Mobile/PWA | shared index → mobile-router.js → mobile-shell/mobile-pages/mobile-api | mobile route, pairing, session recovery, WebSocket/SSE | No paired token, physical phone, or emulator was available; an unpaired 390×844 Chromium run reproduced a renderer crash under current host memory pressure |
| HTTP/API | src/gateway/core/server.ts and core/app.ts | raw health/status fast paths, auth, JSON parsing, route dispatch | Health/status fast paths are available; global JSON parsing remains 50 MB and is an identified blind spot |
| Chat streaming | routes/chat.router.ts | admission, SSE setup, runtime registration, model/tool loop, retained stream, terminal delivery | turn-timing.log already records many server stages; trace ID is now exposed in the response header and low-frequency SSE events |
| Session/persistence | src/gateway/session.ts | disk session load, in-memory transcript cache, debounced snapshot writes | 3,478 session files occupied about 848 MiB locally; the old process-global cache had no bound |
| Model/tool workers | gateway model-call/finalization/runtime workers | queueing, provider request, tool execution, completion/post-turn persistence | Worker regressions pass; complete tool-loop extraction is still not done |
| Recovery | live-runtime-registry, retained stream, mobile recovery APIs | reconnect, sequence catch-up, session reload, restart reconciliation | Mobile recovery contract passes; local gateway restart and live Luna recovery-path checks completed, but no production soak |

## B. Reproducible measurement method

Harness: scripts/benchmark-performance.mjs, exposed as npm run benchmark:performance.

Baseline and post-fix desktop measurements used the same harness, same local gateway, same viewport, and three sequential Chromium samples. The baseline used source=git, which serves HEAD web sources in browser memory. The post-fix run used source=working-tree. No workspace file is written by the harness.

Conditions:

- Windows win32 build 10.0.26200
- Node v20.20.2
- Playwright 1.58.2
- Chromium 145.0.7632.6
- headless Chromium, GPU disabled, viewport 1440×900
- mobile probe viewport 390×844, device emulation and touch enabled
- local gateway origin http://127.0.0.1:18789
- startup wait 3,000 ms; mobile probe wait 1,200 ms
- desktop service workers blocked in the benchmark so first-install PWA takeover reloads do not masquerade as desktop startup work; mobile retains the real PWA path
- browser-observed local measurements; no production traffic
- API output contains only sanitized endpoint paths, status/timing/counts; IDs, query values other than fixed safe enum variants, bodies, prompts, tokens, and credentials are excluded

Commands:

    npm run sync:web-ui
    npm run build:backend
    node scripts/benchmark-performance.mjs --source=git --samples=3 --skip-mobile --skip-synthetic-chat --phase=baseline
    node scripts/benchmark-performance.mjs --source=working-tree --samples=3 --skip-mobile --skip-synthetic-chat --phase=post-fix
    node scripts/benchmark-performance.mjs --source=working-tree --samples=3 --skip-mobile --skip-synthetic-chat --phase=duplicate-audit-sw-blocked
    node scripts/benchmark-performance.mjs --samples=1 --phase=post-fix

The harness also parses bounded local turn-timing log rotations for stage distributions. Those are historical local observations, not equivalent synthetic browser samples.

### Raw desktop samples

Values are sample 1 / sample 2 / sample 3. DCL and FCP are browser performance-timeline milliseconds; decoded bytes are resource decoded bytes.

| Source | Cold DCL | Cold FCP | Cold decoded bytes | Warm-reload DCL | Thread-open wall |
|---|---:|---:|---:|---:|---:|
| HEAD baseline | 170.2 / 156.5 / 137.9 | 128 / 124 / 124 | 5,585,343 / 5,585,342 / 5,585,344 | 225.7 / 112.2 / 129.4 | 879.6 / 856.0 / 860.9 |
| Working tree | 132.7 / 102.5 / 90.5 | 100 / 72 / 80 | 5,362,685 / 5,362,685 / 5,362,685 | 88.5 / 88.3 / 88.3 | 967.8 / 853.2 / 852.8 |

The working-tree cold navigation wall times were 295.7 / 275.2 / 276.6 ms. The HEAD values were 319.9 / 289.5 / 301.6 ms. Wall timing includes local browser/gateway scheduling noise; the in-page navigation timeline is the better comparison for boot work.

### Aggregated before/after comparison

| Metric | HEAD baseline p50 | Working-tree p50 | Change | Result |
|---|---:|---:|---:|---|
| Cold navigation wall | 301.6 ms | 276.6 ms | -25.0 ms | Improved, modest and noisy |
| Cold DOMContentLoaded | 156.5 ms | 102.5 ms | -54.0 ms | Improved |
| Cold FCP | 124 ms | 80 ms | -44 ms | Improved |
| Cold resource count | 88 | 86 | -2 | Improved |
| Cold decoded resource bytes | 5,585,343 | 5,362,685 | -222,658 | Improved |
| Cold script decoded bytes | 3,109,843 | 3,109,524 | -319 | No material change; the remaining JS is still large |
| Warm reload DCL | 129.4 ms | 88.3 ms | -41.1 ms | Improved in this small local sample |
| Warm reload FCP | 108 ms | 68 ms | -40 ms | Improved in this small local sample |
| Warm reload decoded bytes | 5,578,628 | 5,371,174 | -207,454 | Improved |
| Thread open wall | 860.9 ms | 853.2 ms | -7.7 ms | No reliable change; post-fix p75 was 967.8 ms |
| Background-task route | 357.2 ms | 355.8 ms | -1.4 ms | No material change |
| Return-to-chat route | 369.4 ms | 358.4 ms | -11.0 ms | Within local noise |
| Startup GET /api/projects | 1 per sample | 0 per sample | -1 | Directly fixed |
| Startup API response count | 38 per sample | 37–38 | approximately unchanged | Duplicate/noncritical loaders remain |

The largest post-fix resources remained the monolithic ChatPage.js at about 2.23 MB, the P1 ring image at about 677 KB decoded per occurrence, and components.css at about 228 KB. No LCP, TTI, hydration metric, CPU profile, or long-conversation scroll benchmark was available from this harness; the UI is vanilla modules rather than React hydration.

### Client-stream probe

The harness can intercept POST /api/chat with a fixed synthetic SSE stream. This measures client parser/render overhead only, not model or network latency. One post-fix probe recorded:

- submit → response accepted: about 87 ms
- accepted → first SSE byte mark: about 16 ms
- first SSE byte → first token mark: about 2 ms
- submit → terminal done mark: about 106 ms

The synthetic stream arrived as one fulfilled response, so it is not a token-cadence or TTFB benchmark. The live ChatPage now records chat_submit, request accepted, first SSE byte, server latency_mark stages, first token received, first visible token, done, and error marks when the real flow runs.

### Controlled live Luna tail and startup-duplicate audit

All live model runs in this follow-up used `openai_codex / gpt-5.6-luna`; the earlier Terra probes were discarded after the model correction and their test sessions were deleted. Prompts were bounded and privacy-safe; the surface task used the project-local `workspace/skills/ai-surface-smoke-research` skill and only read-only desktop/browser observations.

| Journey | Samples | First visible token | Completion | Interpretation |
|---|---:|---:|---:|---|
| Luna low, short no-tool, before | 3 | 2.621 / 3.321 / 6.136 s | 3.177 / 3.653 / 7.580 s | Provider variance; context build was about 0.13–0.25 s |
| Luna medium, short no-tool, before | 3 | 2.434 / 4.302 / 9.835 s | 2.649 / 4.892 / 9.968 s | Current main-chat reasoning setting; one long provider tail |
| Luna medium, short no-tool, post | 3 | 2.607 / 3.068 / 4.384 s | 2.949 / 3.286 / 4.728 s | Not a causal speed comparison; restart/provider state differed |
| Luna medium, AI-surface smoke, before | 1 | 71.171 s | 81.037 s | Five provider passes, six tool calls, 16 heartbeats |
| Luna medium, AI-surface smoke, post | 1 | 74.376 s | 76.352 s | Five provider passes, seven tool calls, 15 heartbeats |

The surface task's raw server stages show why total latency is high: post-fix provider passes started at approximately 0.532 s, 4.900 s, 16.401 s, 57.382 s, and 68.370 s. Tool execution and model re-planning dominate the wall clock; context build was 0.456 s. The telemetry fix made the final pass's `providerWaitMs` valid (`5,744 ms`) instead of the pre-fix impossible negative value (`-53,211 ms`). It changes measurement correctness, not model speed.

The startup duplicate audit used fresh Chromium contexts. With the normal PWA service-worker path, Chrome observed two strict account requests across different document loader IDs because the newly installed worker triggered the existing `controllerchange` reload. With `serviceWorkers: 'block'` for desktop measurement, each fresh context issued exactly one non-strict account check and one strict verification; approvals and proposals each issued once. This is a browser/PWA first-install lifecycle duplicate, not a duplicate chat-list loader and not an Electron path. The harness now blocks service workers for desktop samples and leaves the mobile PWA probe unchanged.

### Backend and runtime observations

The local seven-day turn-timing summary contained the following stage distributions. Provider-request-start has multiple attempts per turn, so its n is mark count rather than unique-turn count.

| Stage or delta | n | p50 | p75 | p95 | p99 |
|---|---:|---:|---:|---:|---:|
| request_received | 66 | 0 ms | 0 ms | 1 ms | 1 ms |
| provider_request_start | 1,480 | 150,389 ms | 439,787 ms | 1,696,459 ms | 2,023,204 ms |
| first_provider_event | 69 | 6,866 ms | 10,130 ms | 17,719 ms | 40,777 ms |
| first_visible_token | 64 | 9,915 ms | 26,219 ms | 323,624 ms | 527,114 ms |
| handle_chat_done | 60 | 16,213 ms | 86,604 ms | 611,042 ms | 2,241,332 ms |
| main_stream_completed | 60 | 16,226 ms | 86,613 ms | 611,188 ms | 2,241,357 ms |
| request → provider start | 47 | 245 ms | 431 ms | 2,363 ms | 8,790 ms |
| provider start → first provider event | 69 | 5,390 ms | 6,430 ms | 8,929 ms | 11,850 ms |
| provider event → first visible token | 64 | 3,060 ms | 14,976 ms | 313,318 ms | 520,109 ms |
| first visible token → provider done | 63 | 224 ms | 993 ms | 3,698 ms | 9,314 ms |

These are not a clean provider benchmark: they include background, tool-heavy, retries, and long-running turns. They establish that provider/tool wait and late visibility are the largest measured user-impact areas. The controlled Luna samples above are local-only and do not represent production provider percentiles.

Resource state before the managed restart:

- gateway resident memory: about 10,314 MB; host memory use about 92.9%
- gateway process age: about 25 hours at the beginning of the investigation
- .prometheus storage: about 8.3 GB
- tool-observations: about 5.7 GB, mostly raw result files
- sessions: about 848 MiB across 3,478 files
- model-usage.jsonl: about 30 MB

Managed restart verification (2026-08-08 13:40 local):

- quick restart accepted by `POST /api/voice-agent/restart-gateway-quick`; no production deployment was performed
- the earlier replacement PID 20108 was later replaced by PID 23796 after the per-round telemetry fix; the post-restart health sample reported `rssBytes≈256,786,432` and `heapUsedBytes≈143,264,640`
- `/api/health` was healthy on PID 23796 and live Luna turns completed after the restart
- `/api/status.gatewayQueues.sessionCache` reported `loaded=2`, `maxEntries=256`, and `idleMs=1,800,000`
- the replacement process was healthy at verification time

This confirms that the bounded-cache, health-field, and per-round timing code is live. It does not replace a churn soak or prove that all of the old 10 GB RSS was caused by the session cache.

The disk totals are not themselves memory measurements. They are evidence of the long-lived corpus that makes an unbounded in-memory transcript/index cache unsafe.

## C. Root-cause findings ranked by user impact and confidence

| Rank | Severity | Finding | Evidence | Confidence |
|---|---|---|---|---|
| 1 | High | Process-long session cache had no bound and could retain full histories for every touched session | session.ts held a process-global Map; 3,478 durable sessions occupy about 848 MiB; gateway RSS exceeded 10 GB | High for risk, medium for exclusive attribution of the current RSS |
| 2 | High | Projects controller and request were eager on every desktop boot | HEAD made one /api/projects call and loaded two extra resources; working tree makes the module/request lazy; DCL/FCP/decoded bytes improved | High |
| 3 | High | ChatPage and the app shell remain a large parse/execute surface | ChatPage about 2.23 MB; scripts about 3.11 MB decoded; total post-fix decoded resources about 5.36 MB | High |
| 4 | High | Provider/tool tail latency dominates slow turns | p95 provider-event → visible-token about 313 seconds and p95 completion about 611 seconds in local mixed history | High for impact, low-to-medium for root cause without controlled provider traces |
| 5 | Medium | Multiple legacy GET loaders and query variants still exist | startup still shows repeated account/proposal/approval/status/connector reads; safe in-flight GET coalescing is now available but sequential refreshes remain | High for duplication, medium for impact |
| 6 | Medium | Mobile renderer is not measurable as a paired journey in this environment | unpaired 390×844 Chromium route consistently crashed after navigation under 92–93% host memory; no phone/emulator/token | High for limitation, low for mobile-code attribution |
| 7 | Low/medium | Browser and usage indexes contain additional potentially long-lived maps | browser geometry/site-knowledge and model-usage indexes are bounded only partially or by workload; current direct memory attribution is unavailable | Medium; follow-up telemetry needed |

## D. Implemented fixes and rationale

1. Desktop startup:
   - Removed ProjectsPage.js from desktopModuleSpecs in web-ui/index.html.
   - Changed web-ui/src/app.js to import and load ProjectsPage only when the Projects tab is opened.
   - Removed the ProjectsPage 400 ms self-start timer.
   - Removed the redundant delayed account display refresh from the inline boot script.
   - Evidence: /api/projects disappeared and cold DCL/FCP/decoded bytes improved.

2. Read request coalescing:
   - web-ui/src/api.js now shares only identical in-flight GET promises.
   - POST/mutation requests, AbortSignal requests, no-store reads, and dedupe=false reads are not coalesced.
   - This avoids stale-cache semantics while protecting against simultaneous legacy loader requests.
   - Remaining repeated sequential loaders are intentionally not hidden by a broad cache.

3. Privacy-conscious client/server timing:
   - New web-ui/src/performance.js stores a bounded in-page ring of numeric timings and opaque correlation IDs only.
   - ChatPage marks submit, accepted, first SSE byte, server latency marks, first token, first visible token, done, and error.
   - chat.router.ts returns an opaque X-Prometheus-Trace-Id and attaches it only to low-frequency stream events; token/text bodies are not logged by this instrumentation.
   - The benchmark harness exposes sanitized endpoint/resource summaries and a synthetic stream probe.

4. Long-session memory safety:
   - session.ts now bounds the hot transcript cache to 256 entries, prunes toward 90% capacity, and avoids evicting live-runtime, pending-save, pending-snapshot, or mutation-scoped sessions.
   - server-v2 exposes cache counts in gateway status.
   - core/server.ts exposes process memory byte fields in the raw health fast path.
   - These fields are intentionally numeric and contain no session content.

5. Generated output:
   - npm run sync:web-ui regenerated generated/public-web-ui and npm run check:web-ui confirms source/generated parity.

6. Tail-latency telemetry correctness and benchmark isolation:
   - `src/gateway/routes/chat.router.ts` now tracks first provider event and first visible token per provider/tool round while retaining turn-level marks. Multi-pass tool turns no longer compute provider wait from an earlier pass, which had produced negative values.
   - `scripts/benchmark-performance.mjs` blocks service workers for desktop startup samples so a PWA controller takeover/reload is measured separately from steady desktop boot; the mobile PWA probe remains service-worker capable.
   - Evidence: the same Luna-medium surface smoke task changed `providerWaitMs` from `-53,211 ms` to `5,744 ms`; the live task still had roughly 76–81 seconds of provider/tool wall time.

## E. Post-fix verification

Passed:

- npm run sync:web-ui
- npm run check:web-ui
- npm run build:backend
- node --check scripts/benchmark-performance.mjs
- node --check web-ui/src/performance.js
- npm run test:mobile-recovery
- npm run test:electron-security-boundary
- npx tsx src/gateway/session-persistence.regression.ts
- npx tsx src/providers/model-usage.regression.ts
- npx tsx src/gateway/chat/turn-timing.regression.ts
- npm run test:connections
- npm run test:runtime-workers
- npm run test:desktop
- npm run test:turn-safety
- node --check generated/public-web-ui/static/performance.js

The tests emitted existing non-fatal configuration/vault warnings about an empty voice provider and desktop-only vault key protection. No test failed because of those warnings.

Not run or not available:

- No physical mobile device or emulator.
- No paired mobile token or production account session.
- No production provider/load test or long-running post-restart memory soak. Controlled local Luna short turns and a post-fix read-only AI-surface turn were completed; they are not production percentiles.
- No Electron foreground-window capture benchmark; the measured Electron architecture path is the local gateway/browser web surface.
- No heap snapshot or V8 allocation profile because host memory pressure made broad profiling unsafe.

## F. Remaining risks and prioritized follow-up

P0: Run a 24-hour session-churn/RSS-slope soak now that the managed restart has established a clean baseline. Sample `/api/health`, `/api/status.gatewayQueues.sessionCache`, worker RSS, active sessions, and retained-stream counts. Compare slope and cache behavior, not just the clean-start number; the restart reduced the observed gateway RSS to ~269 MB at startup but does not by itself prove causation.

P1: Extend controlled server spans for auth, admission/queue, database/session load, tool calls, reconnect, retry, timeout, and abandoned stream. The provider-round timing fix is now in place; the remaining work is to report unique turns and per-round attempts together under the opaque trace ID.

P1: Split ChatPage by the highest-cost routes/features and add a long-conversation benchmark with DOM node count, render duration, scroll frame loss, and heap snapshots after repeated open/close. Keep creative, browser, voice, approval, and channel behavior behind contract tests.

P1: Audit the remaining sequential startup loaders, especially connector/provider catalogs, account/status variants, proposals, approvals, and session/context calls. The first-load strict-account duplicate is explained by the PWA service-worker takeover reload; remove other duplicates only when stack traces and before/after request counts prove an application cause.

P1: Bound or externalize model-usage and browser-session indexes after measuring their live sizes. Preserve API semantics for historical reports; do not truncate history silently.

P2: Run paired PWA tests on a physical phone or emulator across cold/warm start, route changes, composer input, streaming, offline transition, reconnect, and memory/jank. Add Network Information and Page Visibility markers without collecting message content.

P2: Add a reproducible provider test fixture that streams controlled chunks at known cadence so client first-token, visible-token, cadence, completion, and reconnect behavior can be compared independently of provider availability.
