# Keyed weighted chat timeline and adaptive stream delivery

Date: 2026-08-23

Program baseline: `f19b299b82dfc2feb10ea1b6a4a7a02f81a46da9` (`fix(mobile): rebase status-edge theme sync onto current main (#181)`)

PR base: `perf/shared-chat-runtime` / PR #194 at `bcf1cedcf31b6e67d74f230d755dfb86d548758f`

Program design: `workspace/self/WEB_UI_PERFORMANCE_PROGRAM_2026-08-22.md`

## Outcome

Desktop, mobile, and desktop side-chat transcripts now paint bounded weighted
windows over stable runtime turn keys. State materialization and DOM paint have
separate budgets. A settled row keeps its outer DOM node, disclosure state,
selection, decoded media, and interactive visual while another row changes.
Cursor prepends and stepped local backfill retain a stable key/pixel anchor.

The fixed desktop 180 ms stream timer and mobile 50/90 ms timers are removed.
Delivery starts at a responsive 33 ms desktop / 16 ms mobile floor, measures
write-to-frame cost, moves toward `cost EMA * 2.6`, adds input-pressure slack,
and caps at 240/220 ms. Final/error/stop transitions flush synchronously.
Hidden documents retain a reduced transcript and receive coalesced delivery;
pending output flushes immediately on visibility restoration.

This PR does not change the history protocol, persistent session schema,
framework, gateway transport, CSS system, or service-worker cache schema.

## Ownership and module map

| Owner | Responsibility |
| --- | --- |
| `weighted-timeline.js:35-340` | Semantic turn weights, lazy rich-state materialization, desktop/mobile/hidden budgets, multi-pane division, tail/anchor windows, selection pins, stepped backfill, focus and tail state |
| `keyed-dom.js:1-221` | Selected-row discovery, keyed scroll snapshots, row-shell reconciliation, pixel-anchor restoration, pane-local reconciliation, commit diagnostics |
| `adaptive-stream-scheduler.js:5-217` | Per-session coalescing, input-pressure tracking, measured write-to-frame EMA, hidden delivery, visibility flush, structural flush, diagnostics |
| `desktop-timeline-view.js:4-85` | Desktop pager/tail controls, bounded navigator sampling, runtime-key bridge, main/side scroll ownership |
| `mobile-timeline-view.js:8-20` | Mobile budgets/scheduler and runtime-key bridge |
| `ChatPage.js:13502,14156` | Existing desktop markup and rich feature behavior; consumes bounded entries and reconciles pane-local rows |
| `mobile-pages.js:8535,9023,9428` | Existing mobile markup and active-row patch behavior; consumes bounded entries and delegates scheduling |
| Shared runtime from PR #194 | Canonical `{gatewayId, sessionId}` turn order and stable keys; no DOM ownership |

The view adapters are intentionally small ES modules. They do not create a
router, socket, application root, or second copy of chat state.

## Weight, materialization, and paint algorithm

Every visible turn has a minimum weight of one. Content adds bounded 1,200-byte
buckets; tool/process/step records, approvals, questions, media, files, diffs,
artifacts, and voice workgroups add higher bounded costs. A turn is capped at 20
weight units, so one pathological card cannot starve its entire window.

The base budgets are:

| Surface | Materialized weight | Painted weight | Hidden materialized | Hidden painted |
| --- | ---: | ---: | ---: | ---: |
| Desktop | 180 | 96 | 48 | 26 |
| Mobile | 92 | 52 | 38 | 22 |

Turn keys and cheap weights are computed for loaded state. Render-bearing row
signatures are computed only inside the materialization window. HTML is created
only for the smaller paint window. This makes materialization a real boundary,
not a second name for DOM virtualization.

Tail mode walks backward from the newest turn until each budget is spent.
Anchor mode keeps the requested key and apportions slack before and after it,
slightly favoring earlier context. A selection spanning rows pins its endpoint
keys even outside the normal range; pinned rows do not alter pager boundaries.
Search/message navigation calls `focusIndex`, while “Jump to latest” explicitly
returns to tail mode. The parallel desktop navigator is itself capped at 120
evenly sampled markers and retains the oldest/newest range endpoints.

Desktop split view divides one global budget 62/38 between primary and side
panes. Hidden split panes divide the reduced hidden budget rather than each
receiving a full hidden allowance. Matching panes reconcile their message
containers independently; switching pane identity performs the safe shell
replacement.

## Keyed reconciliation and anchoring

Rows use shared runtime turn keys plus render-bearing signatures. An unchanged
signature and unchanged original index reuses the entire row. A changed turn
updates only that row's contents while retaining its outer shell and using the
existing visual-preservation helper. A cursor prepend changes original indexes,
so index-bearing nested copy/edit/fork controls are refreshed even when message
content is unchanged.

Before a commit, the reconciler records the first visible keyed row and its
pixel offset, bottom slack, and selected-row keys. After insert/reorder/remove it
restores the same key/offset synchronously and once on the next animation frame.
Tail mode instead follows the bottom. A monotonically increasing restore token
prevents an older animation-frame callback from fighting a newer commit.

“Show earlier” spends already loaded state first by moving an anchor backward by
a bounded weight step. It does not grow the DOM. When no older loaded turn
remains, the existing opaque cursor request from PR #194 fetches exactly one
older page. The former desktop scroll-height delta and mobile post-render
distance restoration were removed because the keyed anchor is now authoritative.

Accessibility and interaction compatibility:

- original history indexes remain on rows and action controls;
- user selection pins rows and survives unrelated updates;
- `<details>` state, process scroll positions, approval/question drafts,
  terminals, decoded images, and visual iframes retain their existing guards;
- explicit earlier/latest controls remain keyboard buttons with navigation
  labels;
- current copy/edit/fork/speak actions and mobile long-press behavior are
  unchanged;
- reduced-motion scroll behavior remains owned by the existing views.

## Adaptive delivery algorithm

Each `{surface, session}` scheduler state retains one latest pending callback,
last delivery time, measured cost EMA, interval, and diagnostics. A delivery:

1. waits until the current adaptive interval and optional caller floor;
2. executes the active-row patch (or bounded structural render fallback);
3. measures through the next animation frame, with a capped timer watchdog if
   visibility changes before the frame;
4. updates `EMA = 0.72 * previous + 0.28 * measured`;
5. chooses `clamp(floor, ceiling, EMA * 2.6 + input penalty)`.

Recent input/keydown activity and `navigator.scheduling.isInputPending()` add a
24 ms penalty so typing wins main-thread contention. The optional browser API is
guarded and cannot stall delivery if it throws. Hidden pages use a timer-backed
180 ms interval because animation frames may be suspended. Terminal transitions
call `flush`; an off-window mobile active row is recognized as intentionally
unpainted and does not cause repeated bounded-window rebuilds.

Diagnostics are exposed at `window.__PROM_CHAT_STREAM_DIAGNOSTICS` and
`window.__PROM_CHAT_TIMELINE_DIAGNOSTICS` for the CDP runner without changing
production semantics.

## Performance evidence

Reference environment: Windows 11 `10.0.26200`, Node `20.20.2`. Command:
`npm run benchmark:keyed-chat-timeline`.

The rich deterministic histories include long text, 12-card tool groups, file
changes, generated media, and pending questions. Synthetic DOM counts come from
the actual selected entries rendered into a DOM, not from source line counts.

| Turns | Legacy plain transcript rows | Desktop rich rows / nodes | Mobile rich rows / nodes | Plain-row reduction desktop / mobile |
| ---: | ---: | ---: | ---: | ---: |
| 100 | 100 | 48 / 330 | 24 / 180 | 4.0% / 48.0% |
| 500 | 500 | 48 / 294 | 26 / 156 | 80.8% / 89.6% |
| 1,000 | 1,000 | 53 / 312 | 29 / 165 | 90.4% / 94.8% |
| 2,000 | 2,000 | 52 / 309 | 30 / 168 | 95.2% / 97.4% |

Additional captured results:

| Metric | Captured result | Gate |
| --- | ---: | ---: |
| Weighted selection p95, 100/500/1,000/2,000 | 0.629 / 0.600 / 0.574 / 0.624 ms | diagnostic target 5 ms |
| Desktop retained view bytes, 500 -> 2,000 turns | 3,744 -> 4,091 (1.09x) | <= 1.5x |
| Single active-turn commit p95 | 4.789 ms | diagnostic target 8 ms |
| Maximum rows changed per active-turn commit | 1 | 1 |
| Average settled rows reused per 96-row commit | 95 | diagnostic |
| Equivalent row-write reduction | 98.958% | diagnostic |

Portable hard gates are in `scripts/keyed-chat-timeline-budgets.json`; the
reference capture is `scripts/keyed-chat-timeline-baseline.json`. Timing stays a
tracked diagnostic until CI has a pinned hardware runner. Structural row,
weight, synthetic-node, retained-view-growth, and single-row commit caps are
hard gates.

The existing PR #184 deterministic benchmark remains as the pre-windowing
full-DOM comparison. Its 500-turn mobile scenario reported 502 transcript rows
and 2,263 DOM nodes; its 1,200-turn desktop multi-pane reference reported 1,202
rows and 5,814 nodes. It remains green and is now followed by the keyed suite in
`npm run test:web-ui-performance`.

Production validation still reports the mobile entry shell at 88,719 gzip JS
bytes and 76,252 gzip CSS bytes before the Chat route chunk. The new timeline
does not move Chat into the initial mobile shell.

## Test matrix

`scripts/test-keyed-chat-timeline.mjs` behaviorally covers:

- exact desktop/mobile/hidden materialization and paint budgets;
- semantic rich-turn weights and stable/revised row signatures;
- selection pins, stepped backfill, focused navigation, pane budget division;
- bounded 120-marker navigation with oldest/newest endpoints;
- keyed reuse/update/removal and index shifts after cursor prepend;
- disclosure and decoded-row identity retention;
- independent main/side pane reconciliation;
- scheduler coalescing, cheap/costly adaptation, cap, structural flush, hidden
  delivery, and visibility flush.

Validation commands before opening the PR:

- `npm run test:keyed-chat-timeline`
- `npm run test:web-ui-performance`
- `npm run test:web-ui-production`
- all 32 `scripts/test-mobile*.mjs`
- `npm run test:shared-chat-runtime`
- `npm run test:desktop`
- `node scripts/test-background-agent-side-chat-contract.mjs`
- `node scripts/test-desktop-subagent-chat-ui.mjs`
- `node scripts/test-web-ui-architecture-guardrails.mjs`
- syntax checks for every changed browser module

`test-mobile-chat-recovery.mjs` no longer locks the old
`.slice(firstRenderedIndex)` or full-innerHTML source locations. It now executes
the window and keyed DOM behavior, including latest-row retention, bounded older
state, decoded image identity, and a one-row terminal commit.

## Compatibility, rollout, and rollback

No storage or protocol migration is required. The stable runtime key and cursor
protocol are supplied by parent PR #194. Existing markup renderers and active-row
patchers remain compatibility authorities for rich cards, so rollback is the
single PR revert; durable histories need no repair. The previous timers and full
rebuild paths are not retained behind a runtime flag because they would double
ownership and invalidate the performance invariant. Risk is bounded by the
stacked-PR base and hard behavioral tests.

The architecture byte ratchets were not raised. At validation time:

- `ChatPage.js`: 2,434,665 / 2,435,115 bytes;
- `mobile-pages.js`: 1,738,127 / 1,738,241 bytes;
- CSS and index baselines unchanged;
- every new module remains below the 400,000-byte ceiling.

## Risks and deliberately deferred work

- Rows are bounded without estimated-height spacer elements. The explicit
  earlier/latest controls and pixel anchor are correct for the current DOM; a
  future variable-height scrollbar projection can be added if product research
  requires a scrollbar representing unloaded pixels.
- Timing budgets remain diagnostic on unpinned machines. The existing CDP runner
  can consume the new diagnostics when a production-like authenticated fixture
  is available.
- The desktop navigator samples very large histories to avoid recreating a
  parallel unbounded DOM. Full text search remains a state-level concern rather
  than one hidden DOM node per turn.
- Optional Creative, Browser, Sources, terminal/process, diff, and rich renderer
  evaluation is PR6. This PR bounds their retained rows but does not change their
  chunk ownership.
- Native side chat shares keyed view state here; proving that it creates no
  duplicate router/socket/full boot and removing remaining heavyweight
  orchestrator imports is PR6.

## Dependency graph and references

`#184 foundation -> #191 mobile routes -> #193 production modules -> #194 shared runtime/cursor -> this PR -> PR6 optional ownership/runtime deduplication`

Prometheus evidence on the exact parent commit:

- `web-ui/src/pages/ChatPage.js:13494-13594,13937-13966,14176-14356` held
  full-history rendering, fixed 180 ms scheduling, rebuild ownership, and a DOM-
  sourced navigator;
- `web-ui/src/mobile/mobile-pages.js:8530-8675,8813-9023,9418-9451` held the
  count-sliced full render, active-row patch, and fixed timers;
- `web-ui/src/features/chat/runtime/chat-runtime.js:43-99,253-278` supplied the
  shared stable turn keys and normalized order from PR #194.

Reference repositories were read-only evidence:

- T3 Code commit `30be31195883635aba96031a8d79c255fb28b438` demonstrates stable
  keyed rows/structural sharing and bounded turn-aware history, including
  `packages/client-runtime/src/state/entities.ts:52`,
  `threadDetail.ts:76-189`, and `threads.ts:119`.
- Hermes Agent Desktop commit
  `530028c213ae9eed5d7f1a826451e0edf24a11d2` separates render-weight
  materialization from DOM paint in
  `apps/desktop/src/app/chat/transcript-window.ts:9-29,81-115,137-159`, uses
  stepped backfill in `transcript-backfill.ts:5-36,64-120`, and measures adaptive
  stream delivery in `use-message-stream/utils.ts:67-73` and
  `use-message-stream/index.ts:193-329` with visibility behavior at line 386.

The algorithms were adapted to Prometheus's vanilla ES modules, existing rich
DOM, and gateway authority; no React/runtime code was copied.
