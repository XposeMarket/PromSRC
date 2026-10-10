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

## Limitations (stated, not hidden)

- Extensions and connectors run in the gateway process. Installing one is
  trusting its code. Their *tool calls* still go through dispatch policy and
  approvals; their *code* is not sandboxed.
- Prometheus is single-user and local-first. The gateway is not designed to be
  exposed to untrusted networks; remote access goes through an authenticated
  tunnel (Tailscale) with pairing.
- Lite permission mode deliberately trades some approval prompts for speed on a
  trusted machine. It never bypasses hard-denied commands or elevated approval.

## Reporting a vulnerability

Open a private security advisory on the GitHub repository
(Security → Advisories → Report a vulnerability). Please do not file public
issues for security problems.
