# Webhook Receiver Framework

Use this skill when adding event-driven inbound webhooks to Prometheus.

## Current State

Status: not 110% usable yet.

Prometheus has partial substrate:

- Runtime API includes `registerRoute(...)` and `registerHook(...)` in `src/extensions/runtime-api.ts`.
- Runtime registry stores routes/hooks in `src/extensions/runtime-registry.ts`.
- I did not find mounted extension routes in `server-v2.ts`.
- Existing channel/event paths already exist for Telegram/mobile/voice/tasks, but not generic third-party webhooks.

## Correct Design

Webhook support needs:

- mounted route bridge for extension routes
- per-extension route namespace, e.g. `/api/extensions/:id/webhooks/:name`
- signature verification helpers
- replay/idempotency key storage
- event queue or task trigger mapping
- audit log entry for every accepted/rejected event
- opt-in external exposure; localhost-only by default

## Do Not Do

- Do not claim extension `registerRoute` makes external webhooks work until routes are mounted.
- Do not expose unauthenticated public endpoints.
- Do not trigger side effects directly in the HTTP handler; enqueue or create a task.

## Implementation Target

Add route mounting in gateway startup, then create a generic webhook event record and task trigger path.
