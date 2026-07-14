---
name: "integration-setup"
description: "Research, configure, connect, and verify a Prometheus integration for an external service using an existing connector, MCP preset, or supported definition. Use for installing/configuring a service connection; use connector-builder when implementation is missing and connector-smoke-test-harness for repeatable verification."
---

# Integration setup

Prefer an existing supported connector and prove it works before claiming completion.

1. Call `connection_ops(action:"discover", service:"<natural user name>")`; use its canonical service ID.
2. Call `connection_ops(action:"plan", service_id:"<canonical id>", read_only:true, ...)` and retain the returned attempt ID.
3. Resume that attempt with `connection_ops(action:"connect", connection_attempt_id:"<id>", approved:true)`; never create a second attempt merely to continue.
4. Present the durable user-action card. OAuth, device-code, desktop continuation, and secure input belong there—not in chat.
5. After the user acts, call `continue` on the same attempt until it leaves an `awaiting_*` state.
6. Call `verify` and require `connected`, discovered tools, and one representative safe read before claiming readiness.
7. If discovery returns `research_required`, research official sources and pass validated protocol, endpoint, and HTTPS source URLs into a new plan.
8. Use `mcp_server_manage` only for advanced diagnostics; do not bypass the connection attempt lifecycle during normal setup.

Do not treat OAuth completion, a manifest, or a UI card as proof that tools work. Do not invent credentials/endpoints, over-request scopes, or claim success before verification.

Read [detailed-guide.md](references/detailed-guide.md) for connector/MCP selection, definition schemas, OAuth flow, setup states, and recovery. Read the matching background test only when that connector-first path fails.
