# Optional chat ownership and native multi-pane runtime reuse

Date: 2026-08-23

Program baseline: `f19b299b82dfc2feb10ea1b6a4a7a02f81a46da9` (`fix(mobile): rebase status-edge theme sync onto current main (#181)`)

PR base: `perf/keyed-chat-timeline` / PR #195 at `3782e525d12cc5742ebb0cceb81b2fc9e34ab516`

Program design: `workspace/self/WEB_UI_PERFORMANCE_PROGRAM_2026-08-22.md`

## Outcome

Plain desktop and mobile text chat no longer evaluate the thinking orb, rich
tool/terminal renderer, Creative scene graph or workspace, Browser canvas DOM
renderer, ProcessRun cards, coding diff renderer, Sources environment, or the
standalone/inline Voice page. These are feature-owned production chunks with
cached, retryable activation boundaries. Mobile Voice is now a real owner rather
than a 5,683-line function embedded in the Chat owner.

The native side chat introduced by #176 remains a same-document view. Opening it
retains the existing shared `{gatewayId, sessionId}` runtime for the side
session, releases the previous secondary lease, and coordinates by explicit
chat lifecycle events. It creates no iframe, router, socket, full application,
document-wide mutation observer, or 500 ms active-session poll. Its compatibility
hydrate is reduced from a 300-message/500-process suffix to 80/240; cursor paging
from PR #194 remains the authority for older history.

This PR does not change gateway protocols, persistent session formats, route
URLs, auth/pairing, framework, CSS sources, or service-worker cache schema.

## Ownership and chunk map

| Owner | Activation | Responsibility |
| --- | --- | --- |
| `features/chat/optional/tool-activity-runtime.js:43-139` | first structured tool/process/terminal record | synchronous compatibility facade, ordered deferred operations, fallback row, ready event |
| `tool-activity.js` | requested by the facade | rich tool and live terminal lifecycle/rendering |
| `features/chat/optional/thinking-orb-runtime.js:3-19` | Voice surface mount | cached orb module and stale-host guard |
| `mobile/mobile-voice-page.js:4-5684` | `/mobile/voice` entry or explicit inline Voice gesture | standalone/inline Voice DOM, media, realtime controls, room behavior |
| `features/chat/optional/creative-scene-runtime.js:3-36` | Creative activation | dormant plain-chat scene record and real scene-graph loader |
| `features/chat/optional/creative-workspace-runtime.js:3-1733` | Creative activation | studio DOM and Creative command execution |
| `components/creative/featureRuntime.js` | Creative activation | Creative clients, export/runtime integrations |
| `features/chat/optional/browser-surface-renderer.js:3-450` | active/loading/restorable Browser state or visible Browser canvas | Browser canvas DOM materialization and surface synchronization |
| `features/chat/optional/chat-detail-runtime.js:1-27` | visible Sources, actual diff request, or approval process run | Sources environment, coding diff, and ProcessRun module loaders |
| `features/chat/multi-chat-intent.js:14-46` | persisted workspace, session drag, explicit multi-chat request, or opened side chat | multi-chat/canonical-composer activation only |
| `features/chat/runtime/desktop-chat-adapter.js:57-88,239-267` | visible primary/secondary pane | one primary lease, one visible secondary lease, registry diagnostics and release |
| `features/chat/multi-chat-workspace-v2.js:284-291,603-613` | real multi-pane intent | native pane coordination by lifecycle events and bounded compatibility hydrate |
| `pages/ChatPage.js` | desktop Chat route | lightweight activation bridges plus existing non-extracted chat/canvas compatibility behavior |
| `mobile/mobile-pages.js:29122-29347` | mobile Chat route | live-binding Voice context and dynamic owner bridge; no Voice evaluation until requested |

The live-binding contexts are deliberate compatibility seams. They preserve the
current global/closure contracts while moving evaluation and feature DOM work
behind natural production chunks. The success criterion is the production
static closure, not source line count.

Desktop optional page startup is event-owned. `app.js:964` publishes the active
page; `performance.js:24-67` loads only the small Chat intent/context tracking on
Chat, defers Prom Bot and creation surfaces to Subagents/Teams, and loads the
turn-file-diff bridge on the first actual file-row activation. Mobile resolves
its guard before any of those listeners or modules are installed.

## Native side-chat lifecycle

`showSideChatSplit` at `ChatPage.js:575-598` calls
`setSecondaryVisible(sessionId)` before rendering and synchronizes the already
keyed runtime. Closing, switching, or showing background-agent detail releases
that secondary reference. Adapter diagnostics expose the primary and retained
secondary session IDs at `window.getDesktopChatRuntimeDiagnostics` without
creating a second state store.

The desktop view publishes three narrow events:

- `prometheus:chat-session-activated` after the primary session is synchronized;
- `prometheus:side-chat-state` when the native secondary pane opens/closes;
- `prometheus:chat-rendered` after empty, split, or single-pane commits.

The multi-chat owner listens to these events at
`multi-chat-workspace-v2.js:603-613`. The former subtree `MutationObserver` and
500 ms `setInterval` are gone. The behavior test installs the workspace with
constructor traps and opens a real secondary identity through its public API;
zero observers, intervals, and sockets are created, while the native bridge is
called with `historyLimit: 80` and `processLimit: 240`.

## Production and route evidence

Reference environment: Windows 11 `10.0.26200`, Node `20.20.2`, esbuild
production target Chrome 120 / Safari 16.4. Commands:

- `npm run benchmark:chat-optional-ownership`
- `npm run test:mobile-route-chunks`

The committed reference is the exact PR #195 tip. A closure starts at the
feature entry output and follows only static `import-statement` edges in the
production manifest. Dynamic imports are reported but excluded, matching what
plain Chat must parse/evaluate.

| Production closure | PR #195 | This PR | Change |
| --- | ---: | ---: | ---: |
| Desktop Chat raw JS | 1,716,807 B | 1,340,275 B | -21.9% |
| Desktop Chat gzip JS | 491,696 B | 380,410 B | -22.6% |
| Desktop static modules | 13 | 9 | -4 |
| Mobile Chat raw JS | 1,474,175 B | 1,119,564 B | -24.1% |
| Mobile Chat gzip JS | 442,953 B | 330,552 B | -25.4% |
| Mobile static modules | 22 | 20 | -2 |
| Mobile Voice owner | embedded in Chat | 155,517 B / 44,667 B gzip | independent |

The live production route capture includes the mobile shell and request-driven
chunks in addition to the feature closure:

| Route | JS raw | JS gzip | CSS gzip | Modules |
| --- | ---: | ---: | ---: | ---: |
| `/mobile/chat` | 1,136,683 B | 337,580 B | 76,252 B | 25 |
| `/mobile/voice` | 1,501,262 B | 449,322 B | 76,252 B | 27 |

Chat explicitly forbids the Voice owner and all unrelated route owners; Voice
must request its owner. Mobile Chat still exceeds the program's aspirational
250 KB route target, so the hard staged milestone is a 350 KB gzip static Chat
closure with at least a 20% reduction from the committed PR #195 reference.
Further reduction requires moving the remaining shared Voice transport and rich
message construction out of `mobile-pages.js`, not raising the baseline.

The controlled build's initial shell remains below the earlier hard targets:
desktop initial JS is 49,243 gzip bytes; mobile initial JS is 89,097 gzip bytes
and CSS is 76,252 gzip bytes. Production HTML/CSS compression and service-worker
manifest tests remain green. The build automatically gives each new owner a
content-hashed path and updates the service-worker build ID; no manual precache
list or duplicate source/static URL was added.

Committed gates live in:

- `scripts/chat-optional-ownership-baseline.json` (immutable PR #195 reference and budgets);
- `scripts/benchmark-chat-optional-ownership.mjs` (manifest closure, exclusion, reduction, and Voice owner gates);
- `scripts/test-chat-optional-ownership.mjs` (dormant facade, first-use load, owner exports, native side behavior, mobile-before-desktop guard);
- `scripts/test-mobile-route-chunks.mjs` (real browser Chat/Voice request isolation).

## Compatibility, rollout, and rollback

Existing synchronous tool helpers retain their call surface. Plain records keep
the optional renderer idle; the first structured record gets a safe loading row,
queued lifecycle operations preserve order, and a ready event repaints the
bounded active view. Failed import promises are cleared where retry is safe.
Voice and Creative use live owner bindings so callbacks observe current session,
gateway, and scene state rather than extraction-time copies.

No stored data migration or runtime feature flag is needed. Activation itself is
the rollout boundary, and diagnostics are available through
`window.__PROM_OPTIONAL_CHAT_FEATURES`,
`window.__PROM_DESKTOP_FEATURE_LOADS`, and
`window.getDesktopChatRuntimeDiagnostics`. Rollback is a single PR revert on top
of #195; histories, cursor tokens, queued prompts, and service-worker schema need
no repair.

## Electron startup evaluation

Electron already paints a dedicated 420x300 loading renderer before gateway
startup. `electron/main.js:3110-3161` creates and loads the splash;
`main.js:3586-3604` then starts/waits for the gateway, prepares the trusted
renderer, creates the main window, and closes the splash. This already decouples
perceptual shell paint from gateway readiness.

Loading the full application renderer earlier is not a safe optimization in this
PR: trusted renderer URL checks and IPC authority require the gateway origin, and
the current error path can close the isolated splash without exposing a partially
authorized application. No Electron code changes are made. A future startup PR
would require measured splash-to-interactive CDP evidence and a reviewed local
trusted bootstrap origin; line-count or speculative parallelization is not enough.

## Test matrix

Validation before opening the PR:

- `npm run test:chat-optional-ownership`
- `npm run test:web-ui-performance`
- `npm run test:web-ui-production`
- `npm run test:mobile-route-chunks`
- all `scripts/test-mobile*.mjs`
- `npm run test:shared-chat-runtime`
- `npm run test:desktop`
- `npm run test:background-agent-steering`
- `npm run test:design-preview`
- `node scripts/test-desktop-subagent-chat-ui.mjs`
- `node scripts/test-web-ui-architecture-guardrails.mjs`
- syntax checks for every changed/new browser module

The architecture byte ceilings were not raised. At the measurement point:

- `ChatPage.js`: 2,326,685 / 2,435,115 canonical bytes;
- `mobile-pages.js`: 1,485,882 / 1,738,241 bytes;
- `mobile-voice-page.js`: 282,565 / 400,000 new-module bytes;
- CSS and source HTML are unchanged by this PR.

## Risks and deliberately deferred work

- `ChatPage.js` remains a large compatibility orchestrator even though its plain
  production closure is smaller. More Browser/Creative controller functions can
  move only with end-to-end feature fixtures; moving text without changing
  evaluation is not counted as performance work.
- The remaining mobile Chat owner still contains shared Voice transport,
  attachment, and rich-message helpers. The standalone DOM owner is separated,
  but reaching the 250 KB route aspiration needs measured follow-up extraction.
- Prom Bot remains available on its owning Subagents/Teams pages. If product UX
  adds a Chat-local bot affordance, it should publish an explicit intent event
  rather than restoring shell-time evaluation.
- CSS/index ownership was not split. Their source line counts do not make plain
  Chat execute optional JavaScript, and the production/mobile shell already
  meets the current CSS budget. A later CSS split must be driven by coverage and
  route transfer evidence.
- Optional first activation adds one asynchronous boundary. Loading states and
  retries are covered, but full Creative/Browser visual regression remains more
  expensive than the portable contract and should run in a pinned UI environment.

## Dependency graph and references

`#184 foundation -> #191 mobile routes -> #193 production modules -> #194 shared runtime/cursor -> #195 keyed timeline -> this PR`

Prometheus evidence on the exact parent/current stack:

- `ChatPage.js:6-35,86-135` holds lightweight lazy facades and Creative activation;
- `ChatPage.js:4387-4458` activates the Browser DOM owner only for real Browser state;
- `ChatPage.js:19789,20713,44874` activates Sources, diff, and ProcessRun detail on use;
- `mobile-pages.js:29122-29347` owns the live Voice bridge, while
  `mobile-voice-page.js:4` owns Voice DOM behavior;
- `desktop-chat-adapter.js:57-88,239-267` owns secondary runtime leases;
- `multi-chat-workspace-v2.js:284-291,603-613` owns bounded/event-driven native pane coordination;
- #176 is therefore retained as the correct native same-document foundation,
  not treated as an obsolete iframe implementation.

Reference repositories remain read-only evidence:

- T3 Code `30be31195883635aba96031a8d79c255fb28b438` uses keyed client runtime
  ownership in `packages/client-runtime/src/state/entities.ts:52`, narrow thread
  state in `threadDetail.ts:76-189`, and idle retention in
  `threadRetention.ts` / `runtime.ts:487-548`.
- Hermes Agent Desktop `530028c213ae9eed5d7f1a826451e0edf24a11d2`
  demonstrates controlled optional chunks and committed CDP gates under
  `apps/desktop/scripts/perf/`, plus settled session eviction in
  `apps/desktop/src/store/session-states.ts`.

The concepts were adapted to Prometheus's vanilla ES modules and existing
gateway. No React/framework rewrite or reference implementation code was copied.
