# 21 — Security, approvals & permissions

> **Last verified:** 2026-10-07 against PromSRC `a48712ccc` · **Owner area:** `src/security/`, `src/gateway/policy.ts`, `src/gateway/command-permissions.ts`, `src/gateway/approval-actions.ts`, `src/gateway/dev-source-approvals.ts`, `src/runtime/distribution.ts`
> **Read this when:** changing command/file permissions, approval cards, final browser/desktop actions, dev-source access, elevated execution, secrets, policy tiers or public-distribution gates.

## TL;DR
- Treat tool schemas as affordances, not authorization. Runtime approval, category activation, path policy and tool-specific checks remain authoritative even if a model can see/call a wrapper.
- `tools.permissions.shell.approval_mode` is `default` or `lite`. Default requests approval for commands that cross external/workspace boundaries or are otherwise high-risk; Lite can auto-allow some bounded terminal operations after the blocked-command guard. **Lite never bypasses hard-denied dangerous patterns or elevated administrator approval.**
- `tools.workspace_mode` (`prometheus` or `terminal-first`) only decides whether native file wrappers are exposed. It is explicitly not the permission setting.
- Workspace path access is checked separately. Default mode requests path approval for outside-workspace resources; Lite permits broader terminal access but does not bypass blocked paths/commands or explicit elevated gates.
- Elevated Windows command execution routes through `src/gateway/process/elevated-command.ts` / installed admin broker and requires fresh one-shot user approval. Broker setup may invoke UAC once; goals, saved grants and Lite cannot auto-approve it.
- `request_final_action_approval` is a separate one-shot grant immediately before high-impact Post/Send/Publish/Submit/Purchase/Transfer/Delete/Checkout UI actions. It binds the exact next browser/desktop action and must be consumed on that next call.
- Dev-source writes have their own request, approval queue, path-scoped grant and apply boundary. Approving a command or enabling `prometheus_source_write` does not approve arbitrary files.
- `src/gateway/policy.ts` defines READ/PROPOSE/COMMIT policy tiers and audit entries; scoped permission grants and tool-specific hard checks may further restrict any tier.
- Secrets belong in managed config/auth/vault systems—not source, logs, proposals, prompts, tool results or documentation. `src/security/vault.ts` and `log-scrubber.ts` implement protected storage/redaction plumbing.
- `isPublicDistributionBuild()` is driven by `PROMETHEUS_PUBLIC_BUILD` or package metadata `prometheusBuild: "public"`; public builds hide private Prometheus source/self-development tools and source categories.
- Approval is a specific decision over a specific action/context, not blanket authorization for future or adjacent actions. Recheck fresh UI and actual post-action result after every high-impact action.

## Map
| Concern | Where (file → symbol) | Notes |
|---|---|---|
| Default policy tiers | `src/gateway/policy.ts` → `DEFAULT_POLICY_RULES`, evaluation APIs | Baseline READ/PROPOSE/COMMIT tier, risk score and audit. |
| Tool capabilities | `src/gateway/tool-capabilities.ts` → capability metadata resolvers | Capability and risk semantics feed policy classification. |
| Approval mode setting | `src/config/config-schema.ts` → `ToolPermissionsSchema.shell.approval_mode`; `src/gateway/agents-runtime/subagent-executor.ts` → `getShellApprovalMode()` | `default`/`lite` is terminal permission mode. |
| Command boundary and grants | `src/gateway/command-permissions.ts` | Cwd/path/environment/package-manager boundaries and scoped command grants. |
| Path access | `src/gateway/path-permissions.ts`, `src/gateway/agents-runtime/subagent-executor.ts` | Configured blocked/allowed paths plus session-scoped grants. |
| Approval cards/actions | `src/gateway/approval-actions.ts` | Pending approval ID/action-kind validation and one-shot handling. |
| High-impact UI | `src/gateway/final-action-approvals.ts`; `cis-system.ts` → `request_final_action_approval` | Exact next-tool binding/consumption and expiry. |
| Elevated Windows execution | `src/gateway/process/elevated-command.ts`; executor terminal path | Administrator broker with fresh approval; not normal shell elevation. |
| Dev-source change scope | `src/gateway/dev-source-approvals.ts`; `src/gateway/tools/defs/cis-system.ts` | File-list request, approval lifecycle, proposal/continuation, write-category activation. |
| Command deny policy | `src/gateway/tool-deny-policy.ts`, executor `maybeBlockShellTokenPolicy()` | Hard-blocked pattern check; Lite does not suppress it. |
| Secrets | `src/security/vault.ts`, `vault-key-bootstrap.ts`, `log-scrubber.ts` | Credential persistence/bootstrap and scrubbed logs. |
| Public distribution filter | `src/runtime/distribution.ts` → `isPublicDistributionBuild()`, disabled name/category sets; `tool-builder.ts` | Filters visible tool schemas; executor must enforce matching hidden/blocked actions. |
| UI approval/tier proposal flow | `src/gateway/proposals/`, browser/desktop routes, `src/gateway/ui-action-policy.ts` | Proposal approvals are distinct from immediate one-shot final-action grants. |
| Relevant tests | [generated tests](generated/tests.md) | Search for `approval`, `permission`, `path`, `elevated`, `distribution`, `vault`. |

## How it works

### Three different “mode” concepts
Do not collapse these settings:
1. **Terminal approval mode** — `tools.permissions.shell.approval_mode` (`default` / `lite`) controls whether some terminal command-boundary approvals are required or skipped after policy checks.
2. **Workspace tool mode** — `tools.workspace_mode` (`prometheus` / `terminal-first`) filters native file wrappers from the model-visible list. `src/runtime/workspace-tool-mode.ts` explicitly says it changes the editing surface, not filesystem, command, approval or source-access permissions.
3. **Tool category activation** — `request_tool_category` exposes a specialist tool schema for a selected turn/session lifetime. It doesn't authorize the operation.

Always report which setting or grant is involved. A terminal-first configuration is not Lite. A session-active category is not permission. A shell grant is not final UI approval.

### Policy tiers and enforcement order
`src/gateway/policy.ts` ships default rule examples for reads, file writes, shell, browser and integration writes. Policy evaluation assigns a `read`, `propose` or `commit` tier plus a risk score; audit logging records tool/approval outcomes. These are baseline tier labels, not a sole universal allow/deny engine. Tool-specific path checks, capability metadata, hard denials, scoped grants and one-shot requirements can still block or demand approval.

The safe mental sequence is:
1. Resolve tool name, aliases and wrapper target.
2. Normalize/validate arguments and classify capability/risk.
3. Apply hard deny and path/command policy.
4. Determine whether current scope/grants satisfy the action; if not, create the correct approval record/card.
5. Verify approval status, target and lifetime at execution, then perform the specific operation.
6. Audit and inspect the tool’s returned evidence; never infer success from approval alone.

For connector/MCP wrappers, the target is resolved before policy so the actual operation is checked. `tool_call` discovery/dispatch is not a privileged escape hatch. See [05 Tools](05-tools-and-categories.md).

### Default versus Lite terminal permissions
- **Default** is the review-oriented shell mode. Commands in the workspace may be allowed when policy/boundary checks deem them routine; outside-workspace paths, packages, environment/system changes or commit-tier actions may require approval. Exact boundary reasons come from `command-permissions.ts` and executor command analysis.
- **Lite** bypasses generic approval for some non-elevated terminal commands after `maybeBlockShellTokenPolicy()` checks configured blocked patterns. It is deliberately broader convenience, not a sandbox removal or blanket trust claim.
- Hard-blocked command patterns still reject in Lite. Tools that are COMMIT-tier/high-risk may retain approval requirements. Workspace path access policy, source-dev scope and final UI grants remain separate.
- Use visible command/cwd, do not conceal pipelines or command substitutions, and do not use Lite to justify a destructive/unreviewed command. Prefer bounded `workspace_run` commands; long-running work uses supervised process IDs.

### Path and file permissions
`src/gateway/path-permissions.ts` tracks configured `tools.permissions.files.allowed_paths` and `blocked_paths` and can add session- or persistent allowed roots. Runtime tools also constrain their accepted roots/operations. For an outside-workspace path, default mode should request the appropriate explicit path approval; path authorization should be narrow and scoped to the minimum directory/file needed.

Do not use a broad persistent grant when a temporary/session approval suffices. Verify normalized Windows paths, symlink/junction targets and descendant matching; a path that lexically looks inside a project can resolve elsewhere. Never infer path approval from an unrelated dev-source or command approval.

### Approval cards, queues and one-shot actions
The gateway stores pending approvals with IDs and action/tool metadata. `approval-actions.ts` validates the request and treats elevated-command, dev-source-edit/live-apply and final-action approval records as one-shot. A card “approved” state is not by itself proof that a later tool call used the exact grant correctly.

`request_final_action_approval` is intentionally late in the flow: prepare the target UI first, show a concise exact summary, identify account/surface/recipient/content and exact next tool, then ask. When approved, put the returned `final_action_approval_id` on the bound next browser/desktop click/press call, and inspect post-action UI evidence before reporting. The grant is not for “send anything” or a whole session. If the page/recipient/composer changed, obtain a new approval for the new action context.

Proposal approval is a separate review-and-execute workflow and may create a scoped execution task. Do not substitute a proposal card for a one-shot Post/Send/Publish/Purchase/Delete action where the immediate final-action rule applies.

### Elevated Windows administrator broker
For the `terminal` tool, `elevated:true` is a separate Windows-only path. The executor creates an `elevated_command` approval candidate marked `admin_required` and one-shot, then forwards only after approval to `src/gateway/process/elevated-command.ts` and its installed broker. Broker installation may require one UAC prompt. A fresh approval is needed for every elevated invocation; Lite, autonomous goals, remembered permissions or generic command grants do not bypass it. Background `start` is not supported for elevated execution.

Treat the elevated command string, working directory and expected effect as approval scope. Do not mutate a command after approval, hide the actual target behind a helper script, or chain unrelated work under one admin prompt. Check broker availability/setup failures distinctly from command failures.

### Dev-source approvals and source protection
Prometheus source edits (`src/`, `web-ui/`) are not ordinary workspace writes. The flow uses `request_dev_source_edit` (exact file list and reason), an approval queue/continuation in `dev-source-approvals.ts`, guarded `dev_source_edit`/patchset operations, and `prom_apply_dev_changes` for verify/apply. The tooling may expose `dev_source_read` separately under read-only source category.

A write request is the user-visible permission event; category activation is a second gate. `handleRequestToolCategory()` refuses `prometheus_source_write` unless the current source-edit scope or approved source proposal is active. Respect approved file list and batch boundaries; overlapping edits/apply require coordination. For repo and deployment workflow details see [07](07-source-editing-and-pr-workflow.md).

### Public-distribution hardening
`isPublicDistributionBuild()` returns true when `PROMETHEUS_PUBLIC_BUILD` is set to a truthy supported value or package metadata has `prometheusBuild: "public"`. `src/runtime/distribution.ts` defines private-only tool names and source categories. `buildTools()` filters model-visible definitions, while the execution layer also blocks actions that should not run publicly; keep both lists aligned when changing source/dev APIs.

Voice prompt-context also suppresses workspace `self/index.md` and `self/06-image-voice.md` in public distributions. Do not rely on hiding a tool schema alone as a security barrier. Add or update tests proving both visibility and execution denial; public build must not leak private source tools or allow a forged direct call.

### Secrets and audit hygiene
- Store credentials with the config/auth integration/vault mechanism. `src/security/vault.ts` and `vault-key-bootstrap.ts` own secret persistence/key bootstrap; `log-scrubber.ts` is part of the redaction path.
- Avoid including keys/tokens/passwords in tool args unless necessary for a secure credential API; never print secrets in command output, debug progress, error payload, audit summary, observation, generated document or PR diff.
- Scrubbing is defense in depth, not permission to log raw secrets. Prefer references/IDs and safe summaries. Keep sample configs synthetic.
- Audit records are valuable for tracing authorization, but need minimized tool args/result summaries and privacy-safe handling. See [11 Memory/Brain](11-memory-notes-brain.md) for persisted history and [12 Connectors](12-connectors-mcp-integrations.md) for external auth.


### Approval records and safe denial handling
Approval requests may be pending asynchronously while a user reviews a card. Preserve their ID and scope when resuming; on deny, timeout, stale ID or mismatch, stop before the side effect and tell the user which action was not performed. Do not automatically create a broader replacement request unless the intended change is clear and the new scope is described. `resolveApprovalDecision()` accepts saved grant scopes only for reusable permission kinds; it rejects `session`/`always` on one-shot approval kinds.

Approval lifetime differs by kind. Ordinary scoped command/path grants can be session-, action- or otherwise policy-scoped; final UI, elevated command, dev-source write and live-apply approvals are explicitly one-shot. Check the approval record's `approvalKind`, tool name, session/task and bound target rather than treating all queue entries as interchangeable.

On retries, verify whether the operation partially succeeded before repeating it. This is especially important for payment, publishing, deleting, package installation, database migration and source apply. A timeout after click/command may leave the effect committed even when the local response is missing. Use an idempotency key or read-only state check where supported; otherwise surface uncertainty and ask before another irreversible attempt.


### Security regression matrix
For any change touching tool visibility or authority, check at least these dimensions when applicable:
| Dimension | Positive case | Negative/stale case |
|---|---|---|
| Category | Correct canonical category active; expected schema present | Alias typo, category inactive, or hidden public-build category |
| Path | Exact approved path within allowlist | Parent traversal, sibling path, blocked path or changed junction target |
| Shell | Bounded allowed command/cwd | Destructive token, external path, altered args after approval |
| Approval record | Current session/task, pending then explicitly approved | Denied, stale, reused, wrong tool, wrong session or expired record |
| Final UI action | Exact approved next tool and target | Recipient/composer/page changes before click; duplicate retry after timeout |
| Elevated broker | Fresh approved command reaches broker once | Lite/autonomous/saved grant attempts bypass; broker absent; repeated call |
| Public distribution | Private tool hidden and executor rejects forged call | Direct tool invocation when category/schema is absent |
| Secret output | Synthetic canary remains protected | Canary appears in raw output, error, audit, observation, artifact or PR diff |

Keep tests deterministic and avoid actual paid API calls, OS-admin operations, public posts, file deletion or purchase unless a test harness mocks the side effect or an explicit owner-approved integration test requires it.



## Config & knobs
| Key | Meaning |
|---|---|
| `tools.permissions.shell.approval_mode` | `default` or `lite` command approval mode. |
| `tools.permissions.shell.workspace_only` | Workspace-only boundary intent for terminal; actual check is in command/path permission flow. |
| `tools.permissions.shell.blocked_patterns` | Deny patterns, still applied to Lite-mode commands. |
| `tools.permissions.shell.confirm_destructive` | Destructive-command confirmation behavior; inspect current path before relying on it. |
| `tools.permissions.shell.allowed_commands` and Windows-specific allowlists | Configured allowed command families, subject to broader policy. |
| `tools.permissions.files.allowed_paths` / `blocked_paths` | Configured filesystem roots permitted or prohibited by file path policy. |
| `tools.workspace_mode` | UI/tool exposure: `prometheus` or `terminal-first`, independent of shell approval mode. |
| `PROMETHEUS_PUBLIC_BUILD` | Explicit build-distribution override; package metadata is an additional public-build detector. |
| `tools.permissions.*` | Schema source is `src/config/config-schema.ts`; verify parsed defaults in config class before editing. |

## Gotchas / sharp edges
- **Schema visibility is not authorization.** Dynamic wrappers resolve their real name before policy; a forged direct call must meet the same checks.
- **Approval mode names are easy to confuse.** “Lite permissions” refers to terminal approvals. “terminal-first” refers to which native workspace editing tools appear.
- **Lite is not “allow anything.”** Unsafe blocked patterns and elevated/admin operations remain blocked or approval-gated; policy can independently require approval.
- **A card must bind to one action.** Do not reuse final-action ID, change its target/recipient, or report success before post-action UI evidence.
- **Do not use remembered approval for elevated commands.** Each command is fresh one-shot; saved grants never elevate.
- **Source-write category is not the first approval step.** Request and receive scoped dev edit approval first.
- **Public-build filter must exist in both model-visible and runtime execution layers.** Test a forged invocation, not only absence from tool schemas.
- **Vault/log scrubbing does not make secrets safe to echo.** Keep secrets out of logs and persisted summaries entirely.
- **Persistent path grants and junctions can broaden access unexpectedly.** Resolve real path and explain minimum scope.
- **Batch approvals can be too broad.** Keep file list, command, UI target and approval summary aligned to the exact action; request a fresh narrower approval after scope changes.

## How to change it safely
1. Read [05 Tools & categories](05-tools-and-categories.md) and [07 Source editing & PR workflow](07-source-editing-and-pr-workflow.md); trace schema, wrapper normalization, executor and authorization code.
2. State the threat model: actor, target resource, trust boundary, persistence/lifetime, expected legitimate use, denial behavior and public-build exposure.
3. Add regression cases for allowed and denied paths, Default and Lite, forged direct/dynamic wrapper calls, stale/reused approval IDs, changed target args, and public distribution as relevant.
4. For final-action flows, test exact next-tool binding, mismatch, expiry, rejection and returned UI evidence. For elevated commands, test missing broker, denial, fresh grant consumption, Lite and non-Windows behavior.
5. For path/source rules, test traversal, case normalization on Windows, directory descendants, symlink/junction resolution, unapproved file and category-without-edit-approval.
6. For secret handling, use synthetic credentials, verify vault lifecycle and ensure logs/errors/audit/results redact them; run privacy scanning.
7. Run targeted regressions from [generated tests](generated/tests.md), `npx tsc --noEmit`, relevant package build/sync and `.github/workflows/pr-regression.yml` checks. Inspect logs for actual decision reasons.
8. Update this doc when policy behavior changes; avoid documenting an unverified security guarantee as fact. For every “always/never” claim, cite a direct guard/test.

## Related
- [05 Tools & categories](05-tools-and-categories.md) · [07 Source editing & PR workflow](07-source-editing-and-pr-workflow.md)
- [12 Connectors/MCP](12-connectors-mcp-integrations.md) · [13 Browser & desktop](13-browser-desktop.md)
- [18 Mobile app](18-mobile-app.md) · [23 Rich output/cards](23-rich-output-cards-artifacts.md) · [25 Sharp edges](25-sharp-edges.md)
- [Generated tools](generated/tools.md) · [Generated categories](generated/tool-categories.md) · [Generated tests](generated/tests.md)

### Maintain one policy truth across layers
- Schema builders decide what's offered; canonical manifest/legacy classifier decides category; provider adapters convert call names; executor enforces boundaries; approval actions bind a specific request; audit records outcome. A change may need coordinated edits across several layers.
- When adding a blocked command pattern, normalize case/quoting/argument variants and include a safe near-miss that remains usable. A broad substring deny can break harmless commands; an exact example-only deny is easy to evade.
- When adding a capability, document whether it reads private data, changes local state, calls a remote service, spends money, posts publicly or changes OS privileges. Similar function names may have very different risk.
- When changing policy defaults, record migration behavior for old config values and preserve validation for unknown/malformed values. Fail closed for privileged actions without disabling safe read-only functionality.
- Test user-visible denial cards for a clear reason, exact requested scope and next safe action. Do not reveal hidden path allowlists, broker tokens or secret values in the denial itself.
- Keep final-action action-kind enum aligned with exact UI verbs and resulting tool enforcement; adding a new dangerous verb should update both the prompt/tool schema and server-side check.
- Check public distribution mode at startup/build and runtime; tests should toggle the explicit env flag and package metadata separately so one detector cannot mask a broken second branch.
- On auth/vault refactors, test encrypted/OS key availability and failure/recovery paths without printing decrypted values. A safe vault read does not imply permission to disclose the secret to a model or UI.
- New audit fields should be bounded, stable and redacted before persistence. Avoid attaching whole HTTP bodies, screenshots or command output when an identifier and safe summary are enough.
- Do not broaden session/persistent grants to avoid asking again. If an operation legitimately needs sustained access, explain the duration and add explicit revocation/expiry behavior.
- After changing a permission guard, inspect all direct tool-name dispatch branches as well as wrapper fallback paths; authorization that only runs on the first alias can be bypassed by another registered name.
