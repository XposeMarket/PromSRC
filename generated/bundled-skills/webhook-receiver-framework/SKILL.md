---
name: "webhook-receiver-framework"
description: "Use when configuring or extending Prometheus inbound webhook endpoints, including authenticated wake events and agent dispatch. Do not invoke for ordinary API calls or outbound integrations."
---

# Webhook Receiver Framework

Use Prometheus's mounted receiver for authenticated inbound events. Keep it localhost-only unless the user deliberately configures ingress. This is not a generic outbound API skill.

## Existing runtime

The router is implemented in `src/gateway/comms/webhook-handler.ts` and mounted at the configured webhook path by `src/gateway/routes/goals.router.ts`.

Core endpoints:

- `POST /wake` — validate a message and submit an immediate or next-heartbeat wake event.
- `POST /agent` — validate an agent task and dispatch it through the agent runtime.
- `GET /status` — report receiver state without triggering work.
- `POST /provider/github` — verify `x-hub-signature-256` against the exact raw body.
- `POST /provider/stripe` — verify `Stripe-Signature`, including its five-minute timestamp window.
- `POST /provider/slack` — verify Slack v0 signatures, including its five-minute timestamp window.

Authentication accepts either `Authorization: Bearer <token>` or `x-prometheus-token`. Query-string tokens are rejected. Disabled receivers return `503`; missing or invalid input returns `4xx`.

Provider endpoints use their provider signature instead of the core bearer token. They require a delivery/event ID, reject unmapped event types, cap payloads at 1 MiB, and reserve accepted delivery IDs in `webhooks/deliveries.sqlite`. Replays remain blocked after restart. Metadata-only accepted/rejected records go to `audit/webhooks/events.jsonl`; secrets and bodies are not retained there.

## Provider configuration

Configure only the providers and events the user needs. Store `secret` as a vault reference in persistent config.

```json
{
  "hooks": {
    "enabled": true,
    "token": "vault:hooks.token",
    "path": "/hooks",
    "providers": {
      "github": {
        "enabled": true,
        "secret": "vault:hooks.providers.github.secret",
        "events": { "push": "audit", "issues": "agent" },
        "deliver": false
      }
    }
  }
}
```

Event actions are `audit`, `wake`, `agent`, or `ignore`. `*` is allowed as an explicit fallback. No mapping means reject with `422`; never guess a task from an event. `agent` payloads are marked untrusted and outbound delivery stays off unless `deliver: true` is explicitly configured.

## Workflow

1. Read the configured mount path and enabled state; never assume a public URL.
2. Keep the receiver localhost-only unless the user deliberately configures external exposure.
3. Require header authentication before processing the body.
4. For providers, require the exact raw request bytes. Never verify a re-serialized object.
5. Validate the provider envelope and configured event mapping before reserving its delivery ID.
6. Hand accepted work to the configured wake/task runtime instead of executing side effects inside the handler.
7. Return an honest non-2xx result for disabled configuration, bad signatures, stale signatures, missing IDs, unmapped events, oversized bodies, or replays.
8. Test locally before exposing ingress. Use a disposable secret and delivery ID.

## Verification status

Verified locally: route mounting, core header authentication, query-token rejection, malformed JSON, input validation, disabled mode, next-heartbeat wake dispatch, exact-body GitHub signatures, Stripe and Slack timestamped signatures, tamper/stale/missing-ID rejection, explicit event mapping, 1 MiB limit, metadata-only auditing, untrusted agent context, and SQLite replay rejection across a reopened ledger.

Run `node scripts/test-phase3-fail-closed.mjs` and `node scripts/test-webhook-provider-security.mjs` after a backend build. Public DNS, TLS, reverse-proxy setup, and real provider secret registration remain deployment-specific; never claim those are configured without checking.
