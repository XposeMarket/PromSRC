# Universal connection workflow

Use this reference when a setup needs OAuth, MCP, an API key, CLI login, a local resource, or a newly researched service.

## Normal setup

1. Discover using the user's natural service name:

   ```json
   {"action":"discover","service":"Robinhood MCP"}
   ```

2. Use the returned canonical `serviceId` to plan with least privilege. Store the returned `connection_attempt_id`.
3. Approve/connect that same attempt. Never supply both an old attempt and a request that creates a replacement.
4. Let the durable card collect secure input or open OAuth. Never place passwords, tokens, authorization codes, or MFA values in chat/tool arguments.
5. Continue the same attempt after user action. `awaiting_oauth` means authorization is pending; it is not connected.
6. Verify authentication, registration, MCP/tool discovery, exposure policy, and a declared safe read.
7. Claim readiness only when the durable attempt is `connected` and the canonical record is verified.

`mcp_server_manage` is an advanced diagnostic/control-plane tool. Do not use it to bypass `connection_ops` for ordinary setup.

## Unknown services

When discovery returns `research_required`:

1. Research official provider documentation and package/registry sources.
2. Capture canonical name, protocol, HTTPS endpoint, authentication type, scopes, platform restrictions, and HTTPS source URLs.
3. Prefer an installed plugin or official MCP package. If implementation is absent, use connector-builder.
4. Submit only validated official metadata to planning. Do not infer `/authorize`, `/token`, MCP routes, environment variables, or packages.
5. Require user review before installing generated code or granting write/high-impact capabilities.

## OAuth and cross-device continuation

- OAuth completion only proves token exchange.
- A desktop-required provider should show instructions on mobile and the verified authorization button on desktop.
- Resume the same attempt across devices.
- If the OAuth transaction expired or the gateway restarted, repair/restart authorization; do not reuse a stale URL.

## MCP verification layers

Verify separately:

1. OAuth token health.
2. MCP `initialize` response and protocol negotiation.
3. `Mcp-Session-Id` propagation when issued.
4. `notifications/initialized` delivery.
5. `tools/list` parsing and non-empty discovery when tools are expected.
6. Conservative read-only exposure/classification.
7. One representative read-only `tools/call`.

For Streamable HTTP/SSE, parse only complete SSE events separated by a blank line. A network stream chunk is not an event boundary.

## Completion report

Report the canonical service, auth state, transport, discovered/exposed tool counts, safe-read result, remaining restrictions, and the durable attempt/connection state. Never say “connected” based solely on a successful OAuth callback.
