# 05 — Tools & categories

> **Last verified:** 2026-10-07 against PromSRC `a48712ccc` · **Owner area:** `src/gateway/tool-builder.ts`, `src/gateway/tools/defs/`, `src/runtime/tool-category-manifest.ts`, `src/tools/`
> **Read this when:** adding a model-callable tool, changing what appears in a turn, debugging category activation, connector/MCP discovery, tool-result context, or approval routing.

## TL;DR
- `buildTools()` in `src/gateway/tool-builder.ts` assembles model-visible schemas from three checked-in definition modules, conditional wrappers, then dynamic connector/MCP/composite definitions. It returns schemas, not tool implementations.
- Tool implementations and execution/policy routing live elsewhere: chiefly `src/tools/`, extension/MCP registries, and `executeTool()` in `src/gateway/agents-runtime/subagent-executor.ts`.
- `TOOL_CATEGORY_IDS` and aliases are canonical in `src/runtime/tool-category-manifest.ts`; category policy prose is in `src/gateway/prompt-context.ts`'s `CATEGORY_POLICIES` / `TOOL_BLOCKS`.
- By default, the model sees core tools only. Call `request_tool_category` before expecting a gated category's schemas. Use the shortest scope: `turn`, `next_turn`, `ttl` (1–12 user turns), or explicit `session`.
- `prometheus_source_write` is doubly gated: a prior approved dev-source edit/proposal is required; asking for the category alone does not grant it. Public builds suppress private source tools/categories.
- The `workspace_write` runtime surface is several typed wrappers—read/edit/run/git/safety/code-navigation—not one shell-shaped supertool. Respect their bounded IO, workspace path and approval behavior.
- `tool_search`, `tool_describe`, and `tool_call` are always-on narrow discovery/dispatch bridges for connected-app, MCP and saved-composite tools. `tool_call` re-enters the executor with the actual tool so its ordinary gates still apply.
- Prior tool outputs may be elided in later model rounds. A `[TOOL_RESULT_BOUNDED]` notice has a same-chat `tool_result_read` path; read only the needed byte range.
- Generated lists: [tools inventory](generated/tools.md), [category inventory](generated/tool-categories.md). The current category generator leaves `${TOOL_BLOCKS.*}` uninterpolated; source below, not that table, is the mapping authority.

## Map
| Concern | Where (file → symbol) | Notes |
|---|---|---|
| Category IDs, aliases, labels | `src/runtime/tool-category-manifest.ts` → `TOOL_CATEGORY_IDS`, `TOOL_CATEGORY_MANIFEST`, `normalizeManifestToolCategory()` | Model-visible names; legacy aliases normalize to canonical IDs. |
| Category policy prose | `src/gateway/prompt-context.ts` → `TOOL_BLOCKS`, `CATEGORY_POLICIES` | Source has template-literal expansions; generated markdown currently prints raw placeholders. |
| Build visible definitions | `src/gateway/tool-builder.ts` → `buildTools()` | Adds static defs, filters public/dev/workspace surfaces, then core + active categories. |
| Definition modules | `src/gateway/tools/defs/file-web-memory.ts` → `getFileWebMemoryTools()`; `cis-system.ts` → `getCisSystemTools()`; `agent-team-schedule.ts` → `getAgentTeamScheduleTools()` | Schemas, argument docs and grouped families. |
| Category-to-tool classifier | `src/gateway/tool-builder.ts` → `getToolCategory()`, name sets and `getCreativeToolCategory()`; `src/runtime/tool-category-manifest.ts` → manifest classifier | Classifier determines gating; update it when adding a gated definition. |
| Category activation | `src/gateway/tools/defs/cis-system.ts` → `request_tool_category`; `src/gateway/tool-category-request.ts` → `handleRequestToolCategory()`; `src/gateway/session.ts` → `activateToolCategory()` | Lifetime and protected source-write guard are applied server-side. |
| Invocation and dynamic dispatch | `src/gateway/agents-runtime/subagent-executor.ts` → `executeTool()` | Handles core special cases, tool-search bridge, policy/approval and implementation dispatch. |
| Connector/MCP/composite discovery | `src/gateway/tool-search.ts` → `handleToolSearchTool()`; executor bridge in `subagent-executor.ts` | Three always-on lightweight tool schemas; direct schemas remain category-gated. |
| Tool result reader | `src/gateway/tool-builder.ts` → `tool_result_read`; `src/gateway/routes/tool-result-elision.ts` | Old successful outputs may be compacted; errors, recent results and multimodal content receive special treatment. |
| Workspace implementations | `src/tools/` and runtime wrappers | Typed file, terminal, process, Git, code-navigation and safety functions. |
| Approval engine and audit | `src/gateway/policy.ts` → default policy tiers; `src/gateway/approval-actions.ts`; `src/gateway/agents-runtime/subagent-executor.ts` | Not bypassed by listing a tool or by tool discovery. See [21 Security](21-security-approvals-permissions.md). |

## How it works

### Definition assembly, gating, execution
1. `buildTools(deps, activatedCategories, options)` reads the current config/extension revisions, normalizes activated category aliases and computes the workspace mode. It builds schemas from `getFileWebMemoryTools()`, inline core wrappers and the two other `defs/*` factories. Browser/desktop definitions and Creative schemas are constructed only when their categories are active.
2. Core process, delivery, connector inventory and tool-search/read helpers are appended. Dynamic definitions are appended only when `external_apps`, `mcp_server_tools`, or `composite_tools` is active; they are sorted by tool name for stable provider prompt prefixes.
3. Public-build hard blocks and Prometheus-dev-tool visibility are applied, then workspace-mode filtering and schema compaction. If `activatedCategories` is supplied, final output is core (`getToolCategory(name) === null`) plus tools whose canonical category is active; source-read is a controlled exception using the manifest.
4. At execution, `executeTool()` handles special orchestration wrappers and calls the selected implementation. Dynamic wrapper targets are normalized before capability/approval evaluation. A schema's presence is not evidence that the requested side effect passed its runtime policy.

### Core versus category-gated surface
- Core is the tool builder's assembled definitions with no category classification. Examples include planning/skill/memory helpers, `request_tool_category`, `connector_list`, `tool_search`/`tool_describe`/`tool_call`, `tool_result_read`, selected process controls and native delivery.
- Do not infer core status just from a wrapper sounding general. `workspace_read/edit/run/git`, browser and desktop wrappers, integration setup, media assets/generation and the creative wrappers require their current category according to the classifier. Some older runtime aliases exist only for normalization.
- Canonical categories at this source revision: `browser_automation`, `desktop_automation`, `agents_and_teams`, `prometheus_source_read`, `prometheus_source_write`, `workspace_write`, `advanced_memory`, `media_assets`, `media_generation`, `automations`, `automation_scheduling`, `automation_tasks`, `automation_recovery`, `automation_sessions`, `runtime_admin`, `external_apps`, `integration_admin`, `social_intelligence`, `proposal_admin`, `mcp_server_tools`, `composite_tools`, `creative_basic`, `creative_image`, `creative_video`, `creative_hyperframes`, `creative_quality`, `skills`, `model_management`, and `business`.
- Registry aliases are useful when reading older code/config, but requests should use the canonical `id` (for example `file_ops` resolves to `workspace_write`; `browser` resolves to `browser_automation`). Read `TOOL_CATEGORY_MANIFEST` for the full alias/hint mapping.

### Category → tool/workflow mapping (source-verified)
The generated table cannot expand `TOOL_BLOCKS` template strings, and static tool inventories cannot express every dynamic schema. Use this concise source mapping; for exact current individual names use [generated/tools.md](generated/tools.md) and inspect the cited source file.

| Canonical category | Runtime tool families / implementation owner |
|---|---|
| `browser_automation` | `browser_*` session/observe/act/extract and browser inspection tools; browser definitions are in browser automation modules, gated before construction. |
| `desktop_automation` | `desktop_*` screen/apps/window/input/macro/background wrappers and model-visible desktop operations. |
| `agents_and_teams` | Agent, team and schedule schemas from `getAgentTeamScheduleTools()`; agent/task and managed-team dispatch/runtime wrappers. |
| `prometheus_source_read` | `dev_source_read` and approved read-only source inspection surface (`src/`, `web-ui/`, allowlisted project-root files); public distribution hides this category. |
| `prometheus_source_write` | `request_dev_source_edit` and scoped source edit/apply tools, plus guarded sync/build operations; a successful dev-source approval is required to activate; public distribution hides it. |
| `workspace_write` | `workspace_read`, `workspace_edit`, `workspace_run`, `workspace_git`, `workspace_safety`, `workspace_code_nav`; supported compatibility names are normalized to these wrappers. |
| `advanced_memory` | Memory graph/timeline/related-record/project-search/index-refresh utilities; basic memory and note tools are not a reason to load advanced memory. |
| `media_assets` | Download, inspect and analyze images/video/audio/remote assets. |
| `media_generation` | `media_generate`, `video_project`, `game_project`; `media_generate` is a compatibility alias that normalizes image/video actions to `generate_image` / `generate_video`. The canonical manifest tags the alias; concrete image/video tools are core overrides. |
| `automations` | Broad scheduler/automation administration, diagnostics, dashboard and Prometheus peer-session controls. |
| `automation_scheduling` | Create/inspect/update recurring schedule definitions. |
| `automation_tasks` | Inspect/run/watch background task and automation executions. |
| `automation_recovery` | Recover interrupted requests, approvals and failed automation runs. |
| `automation_sessions` | Create/send/steer Prometheus sessions and threads. |
| `runtime_admin` | Prometheus diagnostics, incident packets, controlled gateway restart. |
| `external_apps` | Connector wrappers (`connector_<app>`, selected consolidated wrappers), connected extension-backed tools; only active category constructs live dynamic definitions. |
| `integration_admin` | MCP server configuration, webhooks and integration setup/quick-start operations. |
| `social_intelligence` | Social profile analysis and recommendations. |
| `proposal_admin` | Create/manage pending approval proposals. |
| `mcp_server_tools` | Dynamic `mcp__<server>__<tool>` definitions discovered from connected servers. |
| `composite_tools` | Saved multi-step composite execution and composite management. |
| `creative_basic` | Creative project/scene control; base category also enables shared Creative definitions. |
| `creative_image` | Creative image operations. |
| `creative_video` | Creative video operations and video composition helpers. |
| `creative_hyperframes` | HyperFrames operations. |
| `creative_quality` | Creative/image/video QA and quality operations. |
| `skills` | Skill authoring/packaging/import/export/resource maintenance/audit via `skill_ops`. |
| `model_management` | Manage agent model defaults and reusable model templates. |
| `business` | Structured business entities/events; `business_context_mode` is core for BUSINESS.md injection. |

The manifest menu label is descriptive, not an exact full tool list. Category assignment is partly an explicit set in `tool-builder.ts`, partly prefixes and wrappers; when it drifts from actual definitions, update both mapping/classifier and regression tests.

### Requesting a category and its lifetime
`request_tool_category` requires a category ID; its optional scope defaults to `turn`:
- `turn`: valid for the current user turn only.
- `next_turn`: activation spans two user-turn counters (the current and next turn); choose only when a follow-up needs it.
- `ttl`: keep for `turns` user turns, clamped 1–12. Set a short duration, not a speculative maximum.
- `session`: persistent for the session. Use only for a stated continuing workflow, then stop requesting long-lived exposure when finished.

`handleRequestToolCategory()` validates/canonicalizes the ID, checks the runtime-visible category allowlist, and refuses `prometheus_source_write` unless the session already has an approved source-edit scope. Success changes the current session's category activation; it does not approve a tool call. Unknown scope normalizes to `turn`. Category activation state is saved with the session.

### Workspace wrappers and file safety
- `workspace_read` is for locate/inspect first: `grep`/`search`/`stats`, bounded `read`, `batch_read`, `tree`, `list`, `validate`. For huge/minified files prefer search plus an exact line window over full reads.
- `workspace_edit` is the mutation surface for small file changes and reviewable patchsets; its guardrails/post-edit context are useful evidence. Do not substitute arbitrary scripts to edit files where the native edit wrapper is suitable.
- `workspace_run` is process control: use `run` for bounded commands, `start` for supervised interactive/long-running processes, and manage returned IDs with `status`/`log`/`wait`/`kill`/`submit`. Windows `elevated:true` is a separate hard gate requiring fresh approval.
- `workspace_git` handles repository status/diff/log/branch/commit/push/PR. Do not commit unspecified paths or use Git CLI when the user-directed workflow requires the GitHub connector for PRs.
- `workspace_safety` supplies snapshots/restores, patch previews, risk scans and operation planning; use before destructive/bulk edits. `workspace_code_nav` provides symbol outline/definition/references.
- In Default permission mode, outside-workspace paths need approval. Lite may permit broad computer access for bounded commands, but hard-blocked commands still fail. See [21 Security](21-security-approvals-permissions.md).

### Connector/MCP/composite bridge
`buildTools()` includes a small always-on search bridge even when full connector schemas are not in the tool list. `tool_search({query})` returns matching tool names/schema hints; `tool_describe({name})` reads a full schema; `tool_call({name, arguments})` dispatches a registered tool. For writes, the bridge calls the real executor, preserving policy/approval checks on the actual resolved action. If execution reports no registered action, confirm the extension/MCP/composite is connected and enabled; do not invent a connector name.

### Results, elision and observations
- Tool messages retain their IDs and ordering; only stale successful textual content can be compacted. Errors stay verbatim for retry decisions; multimodal image parts are left intact; the latest provider round and short outputs are retained. `tool-result-elision.ts` defines the recency/budget thresholds and behavior—do not rely on one hard-coded preview size.
- The tool-result envelope can save an oversized raw result as a same-session artifact and returns `[TOOL_RESULT_BOUNDED]` with `raw_ref`/byte continuation metadata. Call `tool_result_read({raw_ref, offset_bytes, max_chars})` only when the omitted part matters; follow `next_offset_bytes`. Maximum range is 16000 characters. The reader is exempt from ordinary stale-result elision so returned chunks remain usable.
- Tool observations are a separate compact learning/audit surface; see `src/gateway/tool-observations.ts` and `observation-policy.ts`. Observation code stores tool call summaries/results into the session history according to its observation filter; it does not replace full current tool results or authorize repeating a previous side effect. Avoid putting secrets or sensitive payloads in observations.
- If a tool returns an artifact/attachment as well as text, use the artifact field/path and user-facing delivery surface rather than trying to inline a huge raw payload.

### Connector/MCP/composite bridge
`tool_search`, `tool_describe` and `tool_call` are separate from full category-contributed schemas: their definitions are assembled as a compact core bridge, and the executor's `handleToolSearchTool()` does catalog lookup for the first two and resolves/executes the selected registered name for the third. Confirm the integration is connected before relying on a search result; actual `tool_call` execution re-enters normal authorization.

### Approval and policy hook-in
Tool definitions do not themselves guarantee execution. `executeTool()` resolves wrappers/aliases and then routes into policy/approval and tool-specific permission code. `src/gateway/policy.ts` describes baseline READ/PROPOSE/COMMIT tiers and audit entries; exact runtime checks may be more restrictive. High-impact final UI operations require the one-shot final-action approval contract. Elevated command, path access and Prometheus source-edit requests have their own authorization paths. Never use `tool_call` as a way around them. See [21](21-security-approvals-permissions.md) and [13 Browser & desktop](13-browser-desktop.md).
## Config & knobs
| Key / value | Effect |
|---|---|
| `tools.workspace_mode` | `prometheus` (default) exposes native workspace file wrappers; `terminal-first` filters that file-wrapper set only. It is not the shell permission mode. |
| `tools.permissions.shell.approval_mode` | `default` or `lite`; controls command approval policy (not category/tool visibility). |
| `PROMETHEUS_PUBLIC_BUILD` / package `prometheusBuild: "public"` | Makes `isPublicDistributionBuild()` true. Source read/write categories and named dev tools are hidden/blocked in public distributions. |
| Category `scope`, `turns` | `request_tool_category` arguments; only `ttl` uses `turns`; `session` should be exceptional. |
| `TOOLS_*` source sets and `tool-builder` conditions | Update the actual owner/classifier instead of adding a duplicate alias schema. |

Dynamic connector/MCP definitions are built from live extension registration, current connection state and server tool snapshots—not a static provider-name allowlist. A cached filtered tool list is keyed by public/dev/workspace mode, category set, extension revision and MCP signature.

## Gotchas / sharp edges
- **Generated category policy is incomplete.** It contains raw `${TOOL_BLOCKS.*}` because its generator does not expand the template. Verify category prose in `prompt-context.ts` and keep the manual map here source-backed.
- **Registry membership and per-tool classification are separate.** Adding a category ID/menu entry is not enough: wire the activation hint/policy and the tool-name mapping in `tool-builder.ts`; test the build result with only core plus that category active.
- **Aliases are input compatibility, not canonical policy names.** Normalize through the manifest; report canonical ID in new docs/config and avoid maintaining independent alias lists.
- **`prometheus_source_write` cannot unlock itself.** Request the scoped edit/approval first; the category guard is a deliberate second boundary, not a stale model-visible schema.
- **Dynamic tools are volatile.** A successful `tool_search` does not guarantee a server stayed connected by call time. `tool_call` re-enters actual policy for the resolved name.
- **Workspace mode ≠ permissions mode.** `terminal-first` changes the visible native file-tool set, not path, command, approval or source-access permissions.
- **Media category and image tool visibility differ.** `media_generate` is tagged `media_generation`; concrete `generate_image`/`generate_video` are core overrides in the canonical manifest. Confirm schemas and dispatcher before assuming the alias is present as a direct model-visible function.
- **Large results are not missing merely because the preview is short.** Look for the explicit bounded marker and use the same-turn reader with exact byte offset.
- **Don't “fix” changing definition order casually.** Dynamic definitions are sorted for provider prefix stability and caching; preserve core deliberate order.

## How to change it safely
1. Decide whether the new capability belongs in core (small, broadly useful, safe discovery/control) or a canonical category (specialist, large schema, side-effect-rich). Prefer gated.
2. Add/modify the parameter schema in the correct `src/gateway/tools/defs/*.ts` module or the smallest existing builder owner. Keep descriptions precise about outputs, approvals and scope.
3. Implement it in the existing `src/tools/*`, gateway dispatcher, or dynamic provider; wire `executeTool()` dispatch. Do not put secrets in schema descriptions or logs.
4. If gated, add the canonical category in `src/runtime/tool-category-manifest.ts` (aliases, label, hint), tool assignment/classifier in `src/gateway/tool-builder.ts`, and category prompt policy in `src/gateway/prompt-context.ts`. Consider public-build hide lists, workspace mode, schema compaction, saved definition cache key and policy/approval metadata.
5. Add regression coverage for category activation and filtering (`test:tool-category-routing`, `test:tool-category-manifest`, `test:tool-category-activation`), execution/permission behavior, and result bounding if relevant. Locate exact checks in [test inventory](generated/tests.md).
6. Run the relevant regression(s), `npx tsc --noEmit`, then the required build/sync checks for touched surfaces. Compare the produced tool list for both core-only and activated-category cases. Avoid a source build in a routine doc-only update.
7. When adding or retiring a generated definition, rerun `node self/_tools/generate-inventories.mjs` in the source workflow; do not hand-edit generated inventories.

### End-to-end checklist for a new tool
- Write down intended visibility, category, provider-call name, implementation owner, argument normalization, side-effect class and result shape before coding.
- Put a narrow tool schema in the owning `defs/*` or builder module; use the canonical function name for executor dispatch and document only arguments that implementation validates.
- Implement the actual operation in its existing layer. Keep schema, dispatch and implementation separated so connector/MCP wrapper resolution cannot silently change the underlying operation.
- If dynamic: register it with the extension/MCP/composite lifecycle, handle disconnect/disabled state, keep the model-facing wrapper compact and ensure target name is resolved before policy checks.
- If gated: add category registry metadata/policy, classifier set/manifest ownership and allowed-category behavior. Check source-write approval and public build filters before completion.
- Add a category regression that compares core-only versus activated lists, a classification case, and an executor test proving allow/deny behavior. Test alias/invalid input too.
- If output can be large, define bounded previews and raw artifact persistence. Test absent raw persistence, bad/forged refs, path traversal, byte offsets and omitted-range continuation.
- If tool can mutate or spend, hook it into the existing approval tier and audit summary; never trust prompt-only “ask first” wording as enforcement.
- Re-run the generated inventory only in the normal source PR workflow after code changes. These workspace reference files link to the inventories and must not rewrite them.

## Related
- [03 Prompt assembly & context](03-prompt-assembly-and-context.md) · [04 Chat pipeline & providers](04-chat-pipeline-and-providers.md)
- [07 Source editing & PR workflow](07-source-editing-and-pr-workflow.md) · [08 Agents & background](08-agents-tasks-background.md)
- [12 Connectors/MCP](12-connectors-mcp-integrations.md) · [13 Browser & desktop](13-browser-desktop.md) · [21 Security/approvals](21-security-approvals-permissions.md)
- [Tools inventory](generated/tools.md) · [Tool categories inventory](generated/tool-categories.md) · [Tests inventory](generated/tests.md)
