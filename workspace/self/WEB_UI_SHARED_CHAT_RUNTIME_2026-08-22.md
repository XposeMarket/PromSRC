# Shared chat runtime and cursor paging

Date: 2026-08-22

Program baseline: `f19b299b82dfc2feb10ea1b6a4a7a02f81a46da9` (`fix(mobile): rebase status-edge theme sync onto current main (#181)`)

PR base: `perf/web-ui-production-modules` / PR #193
Program design: `workspace/self/WEB_UI_PERFORMANCE_PROGRAM_2026-08-22.md`

## Outcome

This change creates the framework-neutral state authority needed by desktop,
mobile, and side-chat views without rewriting their DOM in the same step. A
runtime is keyed by the ordered pair `{gatewayId, sessionId}`, so equal session
IDs on different gateways cannot share state. The runtime owns normalized keyed
turns and order, stream reconciliation, retry/interruption state, queued prompts,
approvals, questions, attachments, background work, paging metadata, reference
tracking, and safe retention.

The gateway now exposes an opaque, anchor-based older-history cursor. Desktop
and mobile request only the next older page. They no longer increase a suffix
limit and redownload all already-loaded turns.

## Ownership boundary

| Owner | Owns now | Does not own |
| --- | --- | --- |
| Gateway session | Durable transcript/process state and cursor page source | View references, DOM, scroll position |
| Shared chat runtime | Normalized turn map/order, live stream/final reconciliation, queues, retry/interruption, approvals/questions, attachments, background state, paging, retention | Markup, presentation window, transport creation |
| Desktop/mobile compatibility bridges | Translate current view/session records into runtime operations while legacy renderers remain | A second copy of canonical chat semantics |
| Desktop/mobile views | Markup, accessibility, scroll anchors, composer ergonomics | Durable history protocol and session retention policy |
| Gateway connection layer | Existing authenticated HTTP/event transport per gateway | Transcript state and DOM |

The implementation is deliberately incremental. Existing session objects remain
readable during this PR so current desktop and mobile behavior is preserved.
Queues and attachments use mutable proxy bridges backed by the runtime, and all
stream terminal paths reconcile through the shared canonical final-response
functions. PR5 will consume the normalized keyed turns directly for bounded DOM;
PR6 will finish moving optional feature and secondary-pane ownership out of the
orchestrators.

Primary implementation points:

- `web-ui/src/features/chat/runtime/chat-runtime.js:132` — runtime state and narrow selector subscriptions.
- `web-ui/src/features/chat/runtime/chat-runtime.js:605` — keyed registry; acquisition, sweeping, and one shared eviction timer follow at lines 615-657.
- `web-ui/src/features/chat/runtime/desktop-chat-adapter.js:10` and `mobile-chat-adapter.js:10` — owned compatibility/view adapters; entry wiring is at `ChatPage.js:149` and `mobile-pages.js:550`.
- `desktop-chat-adapter.js:173` and `mobile-chat-adapter.js:171` — desktop/mobile older-page consumers; view-specific scroll restoration stays in the route owners.
- `web-ui/src/mobile/mobile-api.js:1919` — mobile gateway-aware page request.

## Runtime behavior

Turn identity first uses durable message/turn/client-request IDs. Legacy records
without one receive a deterministic role/timestamp/source/content key with
occurrence disambiguation. Normalization preserves record identity when semantic
fields and the source object are unchanged. An active stream updates its indexed
turn in O(1), rather than rebuilding every normalized row for each token.

Subscriptions accept a selector and equality function. A listener is called only
when its selected slice changes. The deterministic stream benchmark subscribes
to the queue while updating a 1,000-turn active stream; it records zero unrelated
queue notifications.

Final text is reconciled through the existing shared final-response contract, so
delta replay and a canonical terminal response cannot duplicate text. Retry,
interruption, approval/question resolution, attachment, queue, and background
state are separate narrow slices.

A view retains a runtime with an owner token and releases it at unmount. The
registry will not evict a referenced runtime, active stream, non-empty queue,
pending approval/question, or active background record. Unreferenced settled
sessions have a two-minute TTL; other idle sessions have a fifteen-minute TTL;
the registry target is 48 entries. These are safe defaults, not persistence
boundaries—the gateway remains durable authority.

## Cursor protocol

`GET /api/sessions/:id/history-page?limit=N&before=CURSOR` returns:

```json
{
  "sessionId": "session-id",
  "items": [],
  "pageInfo": {
    "olderCursor": null,
    "hasOlder": false,
    "totalCount": 0,
    "startIndex": 0,
    "endIndex": 0,
    "startKey": null,
    "endKey": null
  }
}
```

The cursor is versioned base64url JSON plus a deterministic corruption checksum.
It contains a digest of the session ID, the first-message anchor of the current
page, and an index hint. It is opaque to clients. It is scoped to a session and
stable when newer turns append. A duplicate anchor resolves to the occurrence
nearest its hint. If the anchor was edited or removed, the bounded index hint is
used so paging still progresses without an unbounded scan or suffix redownload.
Malformed, cross-session, or modified cursors return HTTP 400 with
`INVALID_CHAT_HISTORY_CURSOR`.

The checksum detects accidental/client modification; it is not presented as an
authentication mechanism. Existing route authentication and safe-session checks
remain authoritative. Page responses reuse the current desktop/mobile process,
attachment, and tool-log sanitization budgets.

The existing `GET /api/sessions/:id` response is backward compatible: `history`,
`historyTruncated`, and `totalHistoryCount` remain, and `historyPage` is additive.
`full=1` still returns the full history with no older cursor. Ordinary desktop
initial history drops from 200/300-style requests to 80 turns; mobile retains its
bounded initial page. Exact implementation is at
`src/gateway/chat/history-cursor.ts:63-133` and
`src/gateway/routes/chat.router.ts:22194`.

## Retention and failure behavior

- Concurrent identical page requests are coalesced unless the caller supplies a
  distinct abort signal.
- The client validates response shape and session identity before merging.
- Desktop prepends a page and restores the prior visible offset from the change
  in scroll height.
- Mobile preserves its existing anchor snapshot and supports explicit and
  near-top loading.
- A client talking to an older gateway keeps the bounded initial suffix and does
  not fall back to the wasteful progressively larger suffix request.
- Page errors keep existing transcript state and expose retryable UI/runtime
  error state.

## Performance evidence

Reference environment: Windows x64, Node `v20.20.2`; command
`npm run benchmark:chat-runtime`. The benchmark uses deterministic 100, 500, and
1,000-turn histories, 400 stream chunks, narrow subscriptions, and equivalent
gzip payloads for the old growing-suffix and cursor-page strategies.

| Metric | Budget | Captured result |
| --- | ---: | ---: |
| Hydrate 1,000 turns p95 | <= 40 ms | 1.054 ms |
| Active stream delta p95 over 1,000 turns | <= 1 ms | 0.0131 ms |
| Active stream delta max | diagnostic | 0.1928 ms |
| Unrelated queue notifications during 400 deltas | 0 expected | 0 |
| Cursor paging gzip reduction | >= 55% | 71.37% |
| Messages transferred to load 480 older/current turns | diagnostic | 480 cursor vs 1,680 suffix |
| Gzip bytes for the same paging sequence | diagnostic | 316,134 cursor vs 1,104,077 suffix |

Committed thresholds are in `benchmarks/chat-runtime-budgets.json`; the captured
reference is `benchmarks/chat-runtime-baseline.json`. This measures normalized
state and protocol transfer. Paint, DOM, update-to-paint, typing, and multi-pane
budgets remain owned by the browser benchmark and PR5.

## Tests and compatibility matrix

`scripts/test-shared-chat-runtime.mjs` behaviorally covers gateway isolation,
stable normalized identities, narrow selectors, queue and attachment bridges,
approval/question/background slices, canonical stream completion, retry and
interruption, page prepend, request coalescing, frozen source records, and safe
eviction.

`src/gateway/chat/history-cursor.regression.ts` covers page order, append-stable
cursors, no overlap, anchor deletion fallback, cross-session rejection, and
checksum rejection. The normal backend typecheck/build validates route wiring.
The stacked web production, mobile recovery/routing/realtime, chat final-response,
architecture, and performance suites are run before the PR is opened.

The source-byte architecture ratchet is unchanged and passes: `ChatPage.js` is
2,435,059 / 2,435,115 normalized bytes and `mobile-pages.js` is 1,738,202 /
1,738,241. Runtime, adapter, cursor-client, and queue behavior live in owned
modules rather than increasing either monolith ceiling.

Compatibility targets are desktop browser/Electron, mobile browser/PWA, paired
and direct gateways, deep-linked sessions, background streams, queued prompts,
approvals/questions, and full-history diagnostics. No persisted session schema is
migrated.

## Rollback and follow-on

The protocol is additive. A rollback removes client page consumption and the new
route while the old initial-session fields remain valid. Runtime bridges can be
disabled independently because the views still own their current render models
in this PR. No service-worker cache schema or persistent data conversion is
introduced here.

PR dependency graph:

`#184 foundation -> #191 mobile route chunks -> #193 production modules -> this PR -> PR5 keyed timeline -> PR6 optional ownership/side-chat reuse`

Deliberately deferred:

- Weighted materialization, distinct DOM paint budgets, sticky anchors, stepped
  backfill, hidden-document policy, multi-pane budget division, and measured
  adaptive stream delivery are PR5.
- Direct renderer consumption of normalized records, removal of compatibility
  mirrors, optional Creative/Browser/Sources/terminal/diff chunks, and proving a
  second chat creates no transport/router/timer are PR6.
- Cursor persistence across destructive transcript rewrites is not promised;
  bounded anchor fallback is the safe behavior for the current mutable history
  store.

## Reference evidence

The full program plan records exact Prometheus, historical PR, T3 Code, and Hermes
references. The concepts used here are supported by T3 Code commit
`30be31195883635aba96031a8d79c255fb28b438`—scoped thread identity at
`packages/client-runtime/src/state/entities.ts:52`, narrow projections at
`threadDetail.ts:76-189`, idle retention in `threadRetention.ts` and
`runtime.ts:487-548`, and older-turn request keys in `threads.ts:119`. Hermes
commit `530028c213ae9eed5d7f1a826451e0edf24a11d2` supplies the authority/materialization
separation later consumed by PR5; its weighted transcript design is at
`apps/desktop/src/app/chat/transcript-window.ts:9-29,81-115,137-159`.

Those repositories are evidence, not copied implementations. This runtime stays
vanilla ES modules and preserves the current gateway and DOM architectures.
