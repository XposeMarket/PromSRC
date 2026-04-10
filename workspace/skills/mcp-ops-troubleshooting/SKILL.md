---
name: MCP Ops Troubleshooting
description: >
  Diagnose and recover MCP server failures in Prometheus with transport-aware triage
  for stdio, sse, and http configurations. Use when MCP tools are missing, servers
  fail to connect, namespaces disappear, tool discovery is empty, integrations become
  unstable after config edits, or credentials/env vars may be malformed. Includes
  config validation, environment sanitization, safe log redaction, deterministic
  rollback, and post-fix verification.
emoji: 🧰
version: 1.0.0
triggers: mcp troubleshooting, mcp server failed, mcp connect error, tool discovery failed, namespace missing, stdio transport error, sse transport error, http transport error, mcp config validation, sanitize env vars, mcp rollback, mcp diagnostics, mcp tools not showing, reconnect mcp server, mcp server manage
---

# MCP Ops Troubleshooting

Transport-aware MCP diagnostics and safe recovery playbook for Prometheus.

---

## 1) When to Use This

Use this skill when any of the following occurs:
- MCP server shows disconnected, flapping, or repeatedly failing to start.
- Expected MCP tools/namespaces are missing after setup.
- `mcp_server_manage(action:"connect", ...)` fails without clear cause.
- `mcp_server_manage(action:"list_tools", ...)` returns empty or unexpected output.
- A config/env update caused a regression and you need deterministic rollback.

Do **not** use this skill for general API debugging unrelated to MCP transport wiring.

---

## 2) Core Principles

1. **Stabilize first, optimize later**: restore known-good operation before tuning.
2. **One variable at a time**: isolate transport, then auth/env, then endpoint/tooling.
3. **No secret leakage**: redact keys/tokens in every message or log excerpt.
4. **Deterministic rollback**: keep exact last-known-good config and reapply cleanly.
5. **Verify via observable behavior**: connected status + tool discovery + test call.

---

## 3) Fast Triage Sequence (Always Follow in Order)

### Step A — Snapshot Current MCP State

Run in this order:
1. `mcp_server_manage(action:"list")`
2. `mcp_server_manage(action:"status")`
3. If specific server suspected: `mcp_server_manage(action:"list_tools", id:"<server-id>")`

Capture:
- Server ID, transport type, enabled flag, current connection state.
- Whether tools are discovered.
- Any immediate transport/auth error text.

### Step B — Validate Static Config Shape

For each failing server, validate:
- `id` is stable and matches intended references.
- `transport` is one of `stdio`, `sse`, `http`.
- Required fields exist per transport:
  - stdio: `command` (and optional `args`)
  - sse/http: `url`
- No malformed URL schemes (`htp://`, missing protocol, trailing invalid chars).
- No accidental whitespace in critical fields (`id`, `url`, env names).

### Step C — Sanitize Environment Inputs

Before reconnecting, check env wiring:
- Ensure all required env vars are present and non-empty.
- Normalize accidental wrapper quotes in values where not required.
- Remove trailing spaces/newlines from token values.
- Confirm vault references resolve (if using `vault:` indirection).

### Step D — Reconnect with Minimal Change

Attempt lowest-risk recovery first:
1. `mcp_server_manage(action:"disconnect", id:"<server-id>")`
2. `mcp_server_manage(action:"connect", id:"<server-id>")`
3. Re-check `status` and `list_tools`.

If still failing, continue with transport-specific diagnostics below.

---

## 4) Transport-Specific Diagnostic Flow

## 4.1 stdio Transport

Use when server runs as a local process (`command` + `args`).

### Common Failure Signatures
- Process spawn error / command not found.
- Immediate exit with non-zero code.
- Handshake timeout.
- Works manually but not via MCP (environment mismatch).

### Checks
1. **Binary resolution**
   - Verify `command` exists in PATH for the gateway runtime context.
   - Prefer absolute path for unstable environments.
2. **Argument integrity**
   - Ensure each arg is a separate token (no shell-joined accidental quoting).
3. **Runtime prerequisites**
   - Node/uv/python/etc available for the invoked server package.
4. **Env parity**
   - Confirm required env vars are supplied at launch.
5. **Process-level noise**
   - Excessive stdout/stderr startup noise can break protocol startup in some servers.

### Recovery Pattern
- Update only command/args/env for that server via `mcp_server_manage(action:"upsert", ...)`.
- Reconnect and validate tool discovery.
- If package/version regression suspected, pin known-good version in args.

---

## 4.2 sse Transport

Use when server exposes an SSE endpoint.

### Common Failure Signatures
- Connect succeeds then drops quickly.
- 401/403 unauthorized.
- No events received / idle timeout.
- Proxy or TLS termination issues.

### Checks
1. **Endpoint correctness**
   - Validate exact SSE URL path and scheme (`https://` preferred for remote).
2. **Auth headers/tokens**
   - Confirm token validity and formatting (no hidden whitespace).
3. **Reachability**
   - Ensure host/port accessible from Prometheus runtime.
4. **Intermediary behavior**
   - Reverse proxies/load balancers must allow streaming and keep-alive.
5. **Cert and TLS**
   - Verify certificate trust chain for HTTPS endpoints.

### Recovery Pattern
- Correct URL/auth material.
- Reconnect server.
- Confirm stable connection duration and non-empty `list_tools`.

---

## 4.3 http Transport

Use when server communicates over HTTP transport (non-SSE streamable MCP endpoint).

### Common Failure Signatures
- 404/405 due to wrong path/method expectations.
- 401/403 auth mismatch.
- 415/500 from payload incompatibility or upstream server error.
- Connection resets due to gateway/proxy mismatch.

### Checks
1. **URL and route contract**
   - Confirm base URL and required MCP route path exactly.
2. **Auth mechanism**
   - API key/bearer placement and header name correctness.
3. **Protocol expectations**
   - Ensure endpoint is actually MCP-compatible, not a generic REST endpoint.
4. **Network boundary**
   - Firewall/private network restrictions between Prometheus and endpoint.
5. **Timeout behavior**
   - Validate server response time is within gateway expectations.

### Recovery Pattern
- Correct URL/auth/path contract.
- Reconnect and run tool discovery.
- If intermittent, isolate network/proxy path and retry with minimal moving parts.

---

## 5) Namespace & Tool Discovery Troubleshooting

When connection reports healthy but tools are missing:

1. Run: `mcp_server_manage(action:"list_tools", id:"<server-id>")`
2. Verify namespace prefix expectations in downstream callers.
3. Check for server-side capability flags that gate tool exposure.
4. Confirm role/token scope authorizes the expected tool set.
5. Re-read imported config for accidental ID change causing namespace drift.

### Deterministic Fixes
- If namespace changed due to ID drift, restore previous stable `id` via upsert.
- Reconnect and verify callers reference the corrected namespace.
- If tool set changed after upgrade, pin previous version and revalidate.

---

## 6) Config & Env Sanitization Rules

Apply these before any reconnect attempts in sensitive environments:

- Redact secrets in output (`****`), never echo full values.
- Normalize line endings and trim whitespace on tokens/keys.
- Remove duplicate env keys that create ambiguity.
- Keep key names case-correct (`API_KEY` ≠ `api_key` unless server expects lowercase).
- Avoid embedding secrets in URLs when header auth is supported.
- Do not persist raw secrets in markdown/task notes.

Safe redaction examples:
- `sb_publishable_abc...xyz` → `sb_publishable_***xyz`
- `Bearer eyJ...` → `Bearer ***`
- `https://user:pass@host` → `https://***:***@host`

---

## 7) Recovery and Rollback Playbook

Use this when recent edits caused regression.

### A) Identify Last-Known-Good

Collect prior stable values for:
- `id`, `transport`
- `command`/`args` or `url`
- required env key names (not secret values)
- any version pinning previously used

### B) Apply Rollback Atomically

1. `mcp_server_manage(action:"upsert", id:"<server-id>", ...known-good-config...)`
2. `mcp_server_manage(action:"disconnect", id:"<server-id>")`
3. `mcp_server_manage(action:"connect", id:"<server-id>")`

### C) Verify Rollback Success

- `mcp_server_manage(action:"status")` shows connected/stable.
- `mcp_server_manage(action:"list_tools", id:"<server-id>")` returns expected tools.
- Execute one safe read-only tool call if available.

If rollback fails, stop applying additional changes and escalate with current state snapshot.

---

## 8) Minimal Incident Report Template

Use this concise structure after resolution:

- **Server**: `<id>`
- **Transport**: `stdio|sse|http`
- **Symptom**: `<what failed>`
- **Root cause**: `<single confirmed cause>`
- **Fix applied**: `<exact config/env correction>`
- **Verification**: `status + list_tools (+ optional test call)`
- **Rollback readiness**: `known-good snapshot confirmed`

---

## 9) Hard Safety Rules

- Never rotate/delete credentials unless explicitly required for resolution.
- Never post full logs containing potential secret material.
- Never make simultaneous multi-server risky edits without a known rollback path.
- Prefer targeted fix on one failing server before global config edits.
- Stop once deterministic recovery is achieved; avoid speculative churn.

---

## 10) Completion Checklist

- [ ] State snapshot collected (`list`, `status`, `list_tools`).
- [ ] Transport-specific checks completed for failing server.
- [ ] Config/env sanitized with secrets redacted.
- [ ] Fix or rollback applied with minimal blast radius.
- [ ] Post-fix verification passed (connected + tools visible).
- [ ] Incident summary recorded with root cause and deterministic steps.
