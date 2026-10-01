---
name: "external-apps-operations"
description: "Operate connected external services with read-first checks, side-effect boundaries, and readback. Use for cross-app tool execution; not for onboarding a new connection (integration-setup)."
---

# External Apps Operations

Use this for connected-app reads and writes after setup. Use integration-setup for discovery and connection lifecycle, connector-smoke-test-harness for generic connector readiness, and service-specific playbooks when available.

## Preflight

Identify the exact service/account/tenant and intended external postcondition. Inspect connector or connection status, exposed tools, scopes, target identifiers, and current external state. Prefer typed connector or external-app tools over browser automation. Confirm whether the operation is read-only, reversible, idempotent, approval-gated, or irreversible.

## Execute conservatively

Read first. Use preview/dry-run for writes when available. Use an idempotency key or stable external identifier for retriable writes. Never retry send, publish, purchase, delete, transfer, or other non-idempotent mutations until external state is checked. Keep secrets out of prompts, logs, and reports.

## Verify independently

After a write, read the external service back and verify the exact target, content, status, and timestamp or ID. For files/messages/deployments, verify the external artifact and any configured delivery receipt. A connector response or HTTP 2xx alone is not sufficient when the user asked for a real-world change.

## Connected productivity workspaces

For mail, calendars, files, documents, sheets and contacts, resolve the specific service, account, resource type, time zone, destination and exact side effect. Preserve source URLs, resource IDs and pagination cursors. Label drafts as drafts. Before any send, event creation, file sharing/upload, document or sheet write, contact change, permission change, deletion or bulk edit, check the applicable confirmation gate against the exact target and content. Read back the changed resource and distinguish API acceptance from verified state.


## Fallbacks and errors

- no connected tool: use integration-setup rather than inventing credentials; if the task is interactive and authorized, use browser only when a typed route is unavailable;
- auth/scope failure: preserve the durable connection attempt and request the smallest user action; do not broaden scopes blindly;
- rate limit/network: honor Retry-After, apply bounded retries only to idempotent reads, and inspect state before a write retry;
- schema/tool error: inspect the exposed schema and run the smallest safe read;
- browser fallback: re-ground visually, use the service-specific browser playbook, and stop at final-action approval when required;
- external verification failure: report action submitted versus outcome verified separately.
