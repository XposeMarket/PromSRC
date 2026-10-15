# Security model

Prometheus is a local agent with real authority on the machine it runs on:
files, terminal, browser, desktop, connected accounts. This document states
what the runtime enforces, where, and what it does not claim. The model can
*request* actions; it cannot grant itself authority.

## Trust model

| Party | Trusted for | Not trusted for |
|---|---|---|
| The owner (local user) | Approving actions, configuring permissions | — |
| Model output (any provider) | Proposing tool calls and text | Choosing its own permissions, approving its own actions, deciding which tools exist |
| Tool results, web pages, files, emails | Data | Instructions. Content returned by tools is never treated as a user turn. |
| Bundled skills and prompts | Guidance on judgment | Enforcement. No security property depends on a prompt being obeyed. |
| Installed extensions / connectors | Code you chose to install (runs in-process) | Bypassing dispatch policy or approvals |

## What is enforced in code

All of these are checked by the runtime, independent of what the model says.

| Control | Enforced in | Behaviour |
|---|---|---|
| **Offered-surface authority** | `src/gateway/chat/tool-dispatch-policy.ts` (`evaluateToolDispatch`) | A tool call runs only if that tool was in the surface the model was offered this turn (or was unlocked by `request_tool_category` earlier in the turn). Unknown tools are refused without raising an approval card. |
| **Agent allowlists** | `tool-dispatch-policy.ts` (`allowedTools`) | Subagents and team members with `allowed_tools` cannot run anything outside it, even if the tool exists. |
| **Malformed calls** | `tool-dispatch-policy.ts` | Calls whose arguments are not valid JSON are refused and the model is told why; they never run with empty arguments. |
| **Approvals** | `src/gateway/verification-flow.ts`, `src/gateway/approval-actions.ts` | High-risk tools pause for an owner decision bound to that exact call. Stopping a turn rejects that turn's pending approvals. |
| **Final UI actions** | `src/gateway/final-action-approvals.ts` | Post/Send/Publish/Purchase/Delete clicks need a one-shot grant bound to the exact next browser/desktop action. |
| **Shell boundary** | `src/gateway/command-permissions.ts`, `src/gateway/tool-deny-policy.ts` | Commands crossing the workspace boundary need approval in Default mode; hard-denied patterns are blocked in every mode, including Lite. |
| **Path boundary** | `src/gateway/path-permissions.ts` | File access outside the workspace needs approval; blocked paths stay blocked. |
| **Administrator execution** | `src/gateway/process/elevated-command.ts` | Every elevated command needs a fresh one-shot owner approval. Goals, Lite mode and saved grants cannot bypass it. |
| **Loop limits** | `src/gateway/routes/chat.router.ts` | Repeated identical calls are blocked; a turn ends after a run of rounds where nothing was allowed to execute. |
| **Secrets** | `src/security/vault.ts`, `src/security/log-scrubber.ts` | Credentials live in the vault, not config or prompts; logs are scrubbed. CI scans the tree and history (`scripts/audit-repo-privacy.mjs`). |
| **Public builds** | `src/runtime/distribution.ts` | Public distribution builds hide self-development tools and refuse forged calls to them. |

## No model-written code execution engine

Earlier versions executed model-generated JavaScript inside a Node VM context
(`node_call`). A VM context is not a security boundary, so that engine was
removed entirely (PR #600) along with its second tool registry (PR #608).
Agents act only through declared tools that pass the controls above. Running
code is an explicit terminal tool call, subject to the shell boundary and
approvals.

## Escape hatches

`PROMETHEUS_TOOL_SURFACE_ENFORCEMENT` (`enforce` | `warn` | `off`) exists to
recover from a false refusal. Default is `enforce`. See the mediation notes in
[TESTING.md](TESTING.md) for how each mode is covered.

## Verification

Every row above is backed by a deterministic test that runs in CI; the table in
[TESTING.md](TESTING.md#security-coverage) maps controls to tests. Those include
adversarial replay scenarios (`src/testing/replay/scenarios.ts`) that force a
scripted model to request unknown tools, un-offered tools, malformed JSON and
endless refused rounds, and check the runtime refuses them.

## Mandatory final actions and worker ceilings

| Control | Enforced in | Behaviour |
|---|---|---|
| **Final-action gate** | `src/gateway/final-action-gate.ts`, called from every consequential handler in `agents-runtime/handlers/browser-desktop.ts` | Before a click / accessibility invoke / click-by-text runs, the runtime classifies the *runtime-derived* target label with `ui-action-policy.ts`. Send/post/publish/purchase/delete/account-creation/financial/permission/install targets fail closed unless the call carries a one-shot grant from `request_final_action_approval` (bound to session, tool and arguments, single use). CAPTCHA, password-change and safety-bypass targets are refused and handed to the user. Lite mode does not disable it; the owner can (`security.final_action_gate: "off"` or `PROMETHEUS_FINAL_ACTION_GATE=off`). |
| **Worker tool ceiling** | `src/gateway/agents-runtime/tool-ceiling.ts`, `routes/chat/pipeline/handle-chat.ts`, `tasks/task-runner.ts` | Every restricted session records its effective allowlist. Background workers run under their spawner's allowlist, and the ceiling propagates down spawn chains, so a narrowed agent cannot spawn a worker with tools it lacks. An empty intersection is deny-all, never unrestricted. |
| **Proxy-aware network auth** | `src/gateway/gateway-auth.ts` (`isProxiedRequest`), `core/server.ts` | Loopback trust applies only to direct local sockets with no forwarding headers. Covers HTTP, WebSocket, voice sockets, pairing admin and the raw status fast path. |

## Limitations (stated, not hidden)

- Extensions and connectors run in the gateway process. Installing one is
  trusting its code. Their *tool calls* still go through dispatch policy and
  approvals; their *code* is not sandboxed.
- Prometheus is single-user and local-first. Remote access through Tailscale
  Funnel is a **public** HTTPS URL, not an authenticated tunnel: the gateway
  itself must authenticate every request. Requests relayed by a local reverse
  proxy (Funnel/Serve, tunnels, nginx; detected by forwarding headers) never
  receive loopback trust and must carry a paired-device token or the gateway
  token. Unauthenticated callers get only a liveness stub from `/api/status`.
- The final-action gate classifies targets it can label (DOM snapshot refs,
  accessibility names, OCR text, set-of-marks labels). Raw pixel clicks and
  selector-only clicks with no resolvable label are not classifiable and are
  not gated by it; keyboard submits are gated only when an approval id is
  supplied. Generic tool approvals still apply to those paths.
- The final-action gate is a coverage control, not a universal guarantee: a
  target with an empty or unclassifiable intent is allowed through it by
  design. Do not describe it as blocking every consequential click.
- Plugin permission manifests fail closed only when present. An extension with
  no `permissions` manifest runs in **legacy unrestricted mode** (allowed, one
  warning per extension per process) for compatibility. Treat an installed
  extension without a manifest as fully trusted code; prefer extensions that
  declare permissions. See `docs/PLUGIN_SDK.md`.
- Shell confinement is a command/path policy, not an OS sandbox. Commands run
  as the host user. See THREAT_MODEL.md.
- Lite permission mode deliberately trades some approval prompts for speed on a
  trusted machine. It never bypasses hard-denied commands or elevated approval.

## Reporting a vulnerability

Open a private security advisory on the GitHub repository
(Security → Advisories → Report a vulnerability). Please do not file public
issues for security problems.

## Plugin permissions and MCP environment isolation

Extension manifests constrain SDK tool dispatch, credential access, and connector raw API requests. MCP processes inherit only a minimal environment plus explicitly configured values or `envPassthrough` names. See [Plugin SDK security contract](docs/PLUGIN_SDK.md) for compatibility and isolation limits.
