# Prometheus Web UI performance program

Status: implementation plan and measurement contract

Source baseline: `f19b299b82dfc2feb10ea1b6a4a7a02f81a46da9`

Source title: `fix(mobile): rebase status-edge theme sync onto current main (#181)`

Source date: `2026-08-22T21:13:18-04:00`

Captured: 2026-08-22 (America/New_York)

## Outcome and order of operations

The program optimizes one causal chain: load less, initialize less, subscribe less,
render less, and retain less DOM. It deliberately keeps the existing vanilla ES
module application and gateway semantics. A framework migration is not part of
this program.

Work is delivered as six reviewable pull requests. PRs 2-6 are stacked only where
their implementation consumes a seam introduced by the prior PR. Every PR keeps a
standalone rollback boundary and records its base branch in its description.

1. Establish repeatable desktop/mobile performance scenarios, hard gates, and
   boot hygiene.
2. Serve a lightweight mobile document and load only the requested route owner.
3. Add a controlled production module pipeline with content-hashed feature chunks.
4. Move chat behavior into a shared keyed runtime and add true older-history pages.
5. Move transcript paint into keyed weighted windows and replace fixed stream
   throttles with measured scheduling.
6. Remove remaining heavyweight ownership from the chat orchestrators and prove
   that a second chat reuses the same runtime and transport.

## Current-main evidence

The source tree was fetched and fast-forwarded before this profile. Untracked
comparison/workspace material was preserved. Measurements below are raw source
bytes, not bundle estimates:

| Surface | Bytes | Relevant evidence |
| --- | ---: | --- |
| Desktop ChatPage | 2,485,073 | `web-ui/src/pages/ChatPage.js` |
| Mobile route/page monolith | 2,054,677 | `web-ui/src/mobile/mobile-pages.js` |
| Mobile stylesheet | 603,583 | `web-ui/src/styles/mobile.css` |
| Shared desktop/mobile document | 574,641 | `web-ui/index.html` |

Observed ownership and boot leaks on this exact baseline:

- `web-ui/src/performance.js:1-3` evaluates multi-chat, the canonical desktop
  composer, and desktop context tracking before its mobile check at line 5.
- `web-ui/src/mobile/mobile-router.js:13` eagerly evaluates the complete mobile
  page monolith. Lines 397-401 schedule recurring prefetch, while
  `web-ui/src/mobile/mobile-api.js:1575-1594` fetches Tasks, Schedule, Teams, and
  Subagents regardless of the active route.
- Version-query and plain URL imports give the same mobile API more than one ES
  module identity (`mobile-router.js:20`, `mobile-pages.js:65`,
  `mobile-shell.js:5`, and plain imports outside the mobile folder).
- `web-ui/service-worker.js:23-51` precaches several navigation aliases plus both
  `/src` and `/static` copies of the same shell modules.
- `web-ui/index.html` is a desktop document and desktop CSS graph that every mobile
  navigation must parse before the mobile router can replace the visible surface.
- `web-ui/src/pages/ChatPage.js:20-41` evaluates Creative scene-graph, process,
  diff, and Sources owners for plain text chat. Browser state/timers begin at
  lines 230-302.
- Desktop streaming retains a fixed 180 ms coalescer at
  `ChatPage.js:13988-14001`. `renderChatMessages` starts at line 14218 and owns
  full transcript rebuild paths even though active-row patch helpers now exist.
- Mobile `_renderThread` begins at `mobile-pages.js:8604`; message patches exist,
  but structural paths still rebuild the transcript and preserve/restore DOM state.
- The gateway returns progressively larger suffixes. The limiting function is
  `src/gateway/routes/chat.router.ts:16756-16771`; the session route applies it at
  lines 22202-22236. Mobile “load earlier” increases `historyLimit` and downloads
  that entire larger suffix at `mobile-pages.js:13954-13983`.
- Native side chat from #176 no longer creates an iframe or another full app. It
  binds `window.sideChatLinks` at `multi-chat-workspace-v2.js:209-232` and opens
  the native split at lines 270-272, but still polls the active session every
  500 ms at line 609 and separately hydrates through `_loadSessionFromServer`.
- The old benchmark’s synthetic stream was a single `ok` token followed by final
  and done (`scripts/benchmark-performance.mjs:266-324`). The architecture guard
  trusted an editable JSON ceiling whose captured SHA predates current main.

This is why reducing monolith line counts alone is not accepted as success. Each
delivery must show a reduction in work or retained state at an observable boundary.

## External evidence used, not copied

The comparison repositories are read-only evidence at these exact snapshots:

- T3 Code `30be31195883635aba96031a8d79c255fb28b438` (2026-08-22). Scoped thread
  identity is explicit in `packages/client-runtime/src/state/entities.ts:52`.
  Narrow per-thread projections and a five-minute idle retention boundary are in
  `threadDetail.ts:76-189`, `threadRetention.ts`, and `runtime.ts:487-548`.
  Older-turn requests are keyed in `threads.ts:119`; mobile durable outbox grouping
  is keyed in `apps/mobile/src/state/thread-outbox-model.ts:130-131`.
- Hermes Agent Desktop `530028c213ae9eed5d7f1a826451e0edf24a11d2`
  (2026-08-22). Its materialization budget is weight-based and distinct from DOM
  paint (`apps/desktop/src/app/chat/transcript-window.ts:9-29,81-115,137-159`),
  with stepped backfill in `transcript-backfill.ts:5-36,64-120`. Adaptive delivery
  uses a 33 ms responsive floor, measured write/paint cost, and a 250 ms cap in
  `use-message-stream/utils.ts:67-73` and
  `use-message-stream/index.ts:193-329`; visibility handling is at line 386.
  Settled session eviction lives in `apps/desktop/src/store/session-states.ts` and
  is covered by `session-states-eviction.test.ts`. Its CDP runner and committed
  baselines are under `apps/desktop/scripts/perf/`.

T3’s React/Vite surface is not a prescription. Hermes’s constants are not copied
blindly. The useful concepts are keyed authority, narrow projections, separate
materialization/paint budgets, measured delivery, and behavior-level performance
contracts.

Historical Prometheus PRs were also inspected through GitHub. #59’s size ratchet,
#60’s chat core seams, and #62’s stable background-agent cache remain useful.
Draft extraction stack #65-#73 is not revived: it mostly relocates fixed behavior
and tests source locations. #175’s canonical composer and #176’s native side chat
are current-main inputs; the latter means the final work is transport/runtime reuse,
not removal of an obsolete iframe.

## State ownership boundaries

The shared runtime is framework-neutral and keyed by
`gatewayId + U+001F + sessionId`. A key never aliases the same session ID across
gateways.

| Owner | Authoritative state | Exposes | Must not own |
| --- | --- | --- | --- |
| Gateway session | persisted history, turn lifecycle, process/tool records, cursor snapshots | history page and live event protocols | view windows or DOM state |
| Gateway connection runtime | one HTTP/WS transport per gateway, auth refresh, reconnect/backoff | multiplexed event channel and request client | transcript rendering |
| Shared chat runtime | normalized turns/messages by stable key, order, active stream deltas, final reconciliation, queue/retry/interruption, approvals/questions, attachments, background semantics, retention | narrow selectors/subscriptions and commands | route navigation, DOM, CSS, pane geometry |
| Desktop view adapter | active session reference, desktop composer binding, pane/scroll/selection state | keyed row descriptors | transport or duplicate history cache |
| Mobile view adapter | active gateway/session reference, mobile composer/persistence/background signals | compact row descriptors | secondary-route polling or desktop modules |
| Side-chat view adapter | pane key, local scroll/selection/unread state | same runtime selectors as desktop | router, socket, timers, or a second app boot |
| Timeline materializer | per-view anchor, weight budget, hidden/backfill pages | stable ordered visible keys | message semantics or persistence |
| Row renderer registry | lazy renderer for a row kind | DOM node/update/dispose contract | stream scheduling or global subscriptions |

Runtime subscriptions are slice-specific: order, one row, stream state, composer
state, approvals/questions, and connection state. A token delta must not notify
session lists, route owners, or settled rows.

Retention uses explicit references. Active streams, visible panes, queued work,
pending approvals/questions, and dirty drafts pin a runtime. A settled runtime with
no references enters a grace period, then evicts materialized rows first and the
normalized cache second. Gateway transport remains shared while any keyed runtime
uses it.

## Module and chunk map

The natural ownership graph is:

```text
desktop.html/index.html -> desktop-entry
  -> desktop-shell/router
  -> chat-view-desktop -> shared-chat-runtime -> gateway-connection
  -> projects | hub | settings | other desktop route chunks

mobile.html -> mobile-entry -> mobile-shell/router
  -> chat route -> chat-view-mobile -> shared-chat-runtime
  -> voice | tasks | schedule | teams | subagents | hub | proposals | more

chat row registry (loaded by observed row kind)
  -> plain/reasoning (core)
  -> approvals/questions (small controlled chunks)
  -> Sources | Browser | terminal/process | coding diffs | rich media
  -> Creative scene/editor/runtime
```

Mobile Chat may share runtime/data modules with desktop, but does not import a
desktop shell, desktop composer, route monolith, or optional row implementation.
Route chunks own route API calls. Hover/focus/intent may prefetch one route chunk;
an idle timer may not fetch route data.

## Cursor and history protocol

PR 4 adds `GET /api/sessions/:sessionId/history` with:

- `limit`: bounded number of normalized turns, not an ever-growing message suffix;
- `before`: opaque base64url cursor returned by the gateway;
- `include`: explicit lightweight detail policy for tool/process payloads;
- response `{ items, pageInfo: { nextCursor, hasMore, start, end }, total }`.

Cursor payload version 1 contains the exclusive logical boundary, a stable anchor
fingerprint/ID when available, and a history revision hint. It is authenticated as
an opaque server token rather than treated as a client-provided array offset. On an
append-only tail, the boundary is stable. If compaction/reconciliation changes the
array, the gateway resolves the anchor; if it cannot, it returns a typed stale-cursor
response so the client can refresh one bounded tail page. Cursors contain no message
content.

Turns are the paging unit: a user message and its assistant/tool lifecycle are not
split merely to satisfy an item count. The response includes stable row keys. Live
events reconcile into the newest page by key and final responses replace the active
stream projection without duplicating it. The legacy `historyLimit` route remains
temporarily for old clients and is instrumented/deprecated, then can be removed only
after released-client compatibility evidence.

## Rendering and windowing algorithm

Each normalized row has a render weight. Plain short text is one unit; long text,
reasoning, tool cards, process lists, diffs, media, and Creative artifacts add
bounded cost. Weight is derived from semantic shape and size buckets, not DOM height
alone, so expensive hidden/collapsed state is still accounted for.

For every visible pane:

1. Keep an anchor key plus pixel offset. At live tail the anchor is sticky-bottom;
   after the user scrolls away it becomes the first stable visible row.
2. Walk keys around the anchor until the materialization budget is spent. Preserve
   half-page slack so one token does not recut the window.
3. Paint only a smaller DOM weight budget. “Show earlier” spends already materialized
   slack first, then requests exactly one older cursor page.
4. Insert older rows above the anchor, measure the height delta, and restore the
   anchor offset. Backfill is stepped rather than replacing the transcript.
5. Hidden documents retain a smaller tail budget and commit accumulated deltas on
   visibility change. Multiple panes divide a global paint budget with a minimum
   floor for the focused pane and smaller floors for background panes.
6. Keyed row elements survive order-preserving updates. Token/tool/approval/question
   changes call the matching row updater; structural completion may replace only
   that row. Selection and copy are allowed to temporarily pin intersecting rows.

The initial budgets are deliberately configurable and measured. Defaults begin at
roughly four visible screens of materialized weight and two screens of painted DOM,
then are tuned by the committed 100/500/1000-turn scenarios.

## Adaptive streaming algorithm

The scheduler stores pending deltas per runtime/row. For a visible document:

```text
target interval = clamp(max(responsive floor, last write+paint cost * cost factor),
                        responsive floor,
                        maximum latency)
```

The first delta after idle schedules immediately. A flush patches only dirty rows,
records synchronous write cost, then samples the following animation frame for paint
cost. The next interval uses the measured value. Tool starts/ends, approvals,
questions, errors, interruption, final reconciliation, and done are structural and
flush immediately. The maximum gap prevents starvation. Hidden documents use a
timer, not paused `requestAnimationFrame`, and deliver one bounded coalesced state on
visibility return. Input latency is sampled independently so the scheduler can shed
background-pane frequency when composer typing exceeds its budget.

## Service worker and production build migration

PR 1 canonicalizes precache URLs and keeps API/SSE/WS network-only. PR 2 gives
mobile navigation its own document and offline shell. PR 3 introduces the smallest
production-only pipeline needed for two HTML entries, content-hashed feature chunks,
a manifest, and CSS extraction. Development may keep direct ES modules.

The gateway selects `mobile.html` for `/mobile` and `/mobile/*`; desktop navigation
continues to receive `index.html`. The public-build preparation step emits the
manifest and copies only declared public assets. Hashed assets receive immutable
cache headers; HTML/manifests/service worker revalidate. A service worker version
activates only after all required manifest entries are cached. Old caches are
deleted after claim. Deep links, pairing query/hash state, install source, and update
reload coordination are exercised in both source and public-distribution modes.

No vendor-only split is accepted. Chunk names follow feature owners so a plain chat
trace can demonstrate which optional owner did or did not evaluate.

## Compatibility, flags, and rollback

The server additions are backward compatible. New client paths are introduced behind
independent flags initially defaulting on in development/benchmark builds:

- `promMobileEntryV2`: mobile document/router selection;
- `promProductionChunksV1`: manifest-based public assets;
- `promSharedChatRuntimeV1`: shared runtime adapters;
- `promHistoryCursorV1`: cursor endpoint/client;
- `promWeightedTimelineV1`: keyed weighted materialization;
- `promAdaptiveStreamingV1`: measured stream scheduler;
- `promLazyChatFeaturesV1`: optional renderer chunks.

Flags are read once at an ownership boundary, never inside every token path. A PR can
be reverted independently; a runtime flag can temporarily restore the immediately
preceding path while telemetry is inspected. State schemas are additive, cursors are
versioned, and service-worker cache names are versioned. There is no destructive
client migration.

## Performance budgets and methodology

The benchmark runner generates deterministic seeded traces with 100, 500, and 1000+
turns; mixtures include long reasoning, many tool cards, concurrent foreground and
background streams, typing during two streams, and session switching. It records
navigation/resource transfer and decoded bytes, module count, DOM nodes, transcript
commits, long tasks, update-to-paint, input latency, and heap where Chromium exposes
it. Results include environment, browser, sample count, seed, and scenario version.

Hard CI gates are reserved for deterministic signals (scenario integrity, forbidden
boot requests/API calls, bounded DOM/commit behavior, manifest/chunk ownership, and
large regressions against a committed reference). Hardware-sensitive latency and
heap are tracked diagnostics until a stable hosted reference runner exists.

| Metric | End-state budget | PR 1-3 staged gate |
| --- | ---: | ---: |
| Cold Mobile Chat initial JS | <250 KiB gzip | monotonically lower; report exact graph |
| Cold Mobile Chat initial CSS | <100 KiB gzip | mobile document excludes desktop CSS |
| Unrelated mobile route API calls | 0 | hard zero from PR 2 |
| Composer typing with two streams | p95 <16 ms, p99 <32 ms | tracked until PR 5 |
| Stream update-to-paint | p95 <75 ms | tracked until PR 5 |
| Recurring main-thread tasks | none >100 ms | tracked, hard after PR 5 |
| Warm session switch | <100 ms | tracked until shared runtime |
| Cold cached session switch | <250 ms | tracked until shared runtime |
| 500-turn DOM | bounded by paint budget | hard after PR 5 |
| Heap growth vs history | sublinear after window fills | diagnostic plus slope gate after PR 5 |
| Second chat app/router/socket | 0 additional | hard in PR 6 |

Before/after comparisons use the same SHA-built source mode, Chromium version,
viewport, CPU conditions, seed, and repetitions. Medians plus p95/p99/max are kept;
one best run is never used. Live gateway diagnostics are reported separately from
the deterministic local scenarios.

## Test matrix

| Area | Unit/behavior | Browser/integration | Distribution |
| --- | --- | --- | --- |
| Boot/import graph | mobile guard, canonical URL identity, route owner purity | requested modules and API ledger | source and generated paths |
| Auth/pairing | token scope, expired/recovery states | QR/manual pairing, deep links | HTTP/HTTPS/PWA |
| Routing | all mobile and desktop routes | direct navigation, back/forward, reload | manifest and source mode |
| Service worker | install/fetch/activate/cache behavior | offline start, upgrade/takeover | old-to-new cache version |
| Runtime | keyed isolation, reconciliation, queue/retry/interruption, pin/evict | concurrent/background streams, side pane | reconnect/reload |
| History | cursor encode/verify, turn grouping, stale cursor | repeated earlier pages plus live append | legacy client fallback |
| Timeline | weights, anchors, slack, backfill, multipane division | selection/copy/search/unread/scroll-to-bottom | mobile accessibility |
| Scheduler | floor/cost/cap/terminal/hidden behavior | typing during two streams, long tasks | foreground/background |
| Optional chunks | registry and fallback | plain chat absence, on-use evaluation | CSP and packaging |
| Performance | deterministic trace integrity and budget comparator | CDP metrics and heap when available | committed baseline report |

New seams are tested through exports, DOM behavior, requests, events, and cache
effects. Existing source-text tests are migrated when the behavior they describe
moves; new architecture is not locked to a monolith line or regex.

## PR dependency graph

```text
main@f19b299
  └─ PR 1 foundation
      └─ PR 2 mobile entry/routes
          └─ PR 3 production chunks
              └─ PR 4 shared runtime/cursors
                  └─ PR 5 keyed timeline/scheduler
                      └─ PR 6 lazy owners/runtime reuse
```

The linear graph is intentional because generated public assets and behavior tests
otherwise create misleading cross-PR conflicts. A later PR is not merged before its
base. If review requires parallel landing, the later branch is rebased and its PR
base is retargeted; the implementation boundary stays the same.

## Risks and deliberate deferrals

- Cursor paging must preserve old sessions with messages lacking IDs. The versioned
  fingerprint fallback and stale-cursor response are required before client cutover.
- DOM windowing can break selection, browser find, accessibility order, and scroll
  anchoring. Selection pinning, explicit search behavior, ARIA live boundaries, and
  anchor tests are release gates.
- Dynamic imports change CSP and offline/update behavior. PR 3 does not land without
  packaged-public verification and a service-worker upgrade test.
- Shared runtime migration can double-apply events during transition. Adapters use a
  single-writer flag and parity assertions before the legacy cache is removed.
- Heap values are noisy. Only slopes after warm-up and repeated scenario samples are
  compared; a single `performance.memory` value is diagnostic.
- Electron shell paint is investigated in PR 6. It is implemented only if gateway
  readiness is currently on the critical paint path and a safe degraded shell can
  preserve auth/update behavior. Otherwise an evidence-backed follow-up is recorded.
- Rich global search across non-materialized history is not silently weakened. If
  gateway-backed search cannot fit this sequence safely, the existing search path is
  retained and its dedicated indexed replacement is documented separately.
- Native durable mobile outbox/background delivery beyond the existing web/PWA
  lifecycle is not invented here; T3’s native implementation is evidence for state
  boundaries, not a promise that browsers expose equivalent background execution.

The program is complete only when every PR reports its measured delta, tests and
rollback, the full stack passes, all six PRs are open, and none has been merged.
