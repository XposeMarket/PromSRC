# Mobile live-turn identity regression — 2026-08-23

## Symptom

On a fresh mobile/PWA chat, one physical send can render incorrectly while the turn is live:

1. the optimistic user bubble disappears,
2. two assistant `Working for …` rows appear,
3. the same assistant answer can render twice,
4. reopening the chat restores the correct persisted transcript (one user row + one assistant row).

This means the durable/server transcript is healthy while the live client reconciliation is corrupting row ownership.

## Why #207 was not sufficient

#207 correctly hardened iOS duplicate-send admission and recovery dedupe. The remaining failure is below that layer in the shared chat runtime introduced by the Web UI/mobile performance refactor.

Mobile intentionally stamps both the optimistic user row and speculative assistant row with the same `_clientRequestId`. That id describes the request pair; it is not a unique transcript-row id.

The shared runtime, however, treats `clientRequestId` as a turn identity. During mobile sync the pair therefore becomes two occurrence keys derived from the same base. When streaming begins, `beginStreaming({ clientRequestId })` resolves the unqualified base key — the user row — and can replace/reconcile that user row as an assistant row. The result is exactly the live-only corruption visible on device even though the persisted history remains correct.

## Fix

The mobile runtime adapter now projects request-owned rows into the shared runtime with role-scoped synthetic row ids when no real message/turn id exists:

- `mobile-request:<clientRequestId>:user`
- `mobile-request:<clientRequestId>:assistant`

Stream begin and allow-start delta paths use the same assistant-scoped id. The canonical mobile thread objects are not rewritten; this identity projection exists only at the shared-runtime boundary.

## Regression contract

`scripts/test-mobile-chat-runtime-request-identity.mjs` reproduces the exact invariant:

- optimistic user and speculative assistant share one request id,
- runtime sync must retain both roles,
- stream ownership must bind to the assistant row,
- a delta must not create a third row,
- the user text must remain intact.

The source and generated public-web adapter mirrors remain identical.
