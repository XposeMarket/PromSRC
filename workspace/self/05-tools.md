## 10) Tool Architecture

The chat/runtime tool system is now "core tools + activated categories + dynamic injections + capability executors".

Runtime categories:

- `browser_automation`
- `desktop_automation`
- `agents_and_teams`
- `prometheus_source_read`
- `prometheus_source_write`
- `workspace_write`
- `advanced_memory`
- `media_assets`
- `automations`
- `external_apps`
- `integration_admin`
- `social_intelligence`
- `proposal_admin`
- `mcp_server_tools`
- `composite_tools`
- `creative_basic`
- `creative_image`
- `creative_video`
- `creative_hyperframes`
- `creative_quality`
- `skills`
- `model_management`
- `business`

Legacy aliases still map onto the current category IDs, including `browser`, `desktop`, `team_ops`, `teams`, `agents`, `source_read`, `source_write`, `file_ops`, `files`, `shell`, `commands`, `run_commands`, `memory`, `media`, `schedule`, `scheduling`, `integrations`, `connectors`, `mcp`, `composites`, `creative`, `creative_mode`, `image_mode`, `video_mode`, `hyperframes`, `creative_qa`, `media_quality`, `skill_authoring`, `models`, `agent_models`, and `entities`.

Key rules:

- categories are activated through `request_tool_category` with scoped lifetimes: `turn` by default, `next_turn` for the current turn plus one follow-up, `ttl` with `turns`, or explicit `session`
- auto-detected categories in main chat use `scope:"turn"` so browser/desktop/workspace/etc. tools do not stay loaded after the current user turn
- creative categories are requestable manually but are not auto-activated from generic image/video/design wording
- some tools are always core and never category-gated
- MCP tools are injected dynamically as `mcp__<serverId>__<toolName>`
- saved composite tools are injected dynamically too
- `connector_list` is always available
- `ask_team_coordinator` is always available
- `deploy_analysis_team` lives under `agents_and_teams`
- `browser_automation` is wrapper-first: the model-facing surface is `browser_session`, `browser_observe`, `browser_act`, and `browser_extract`
- `desktop_automation` is wrapper-first: the model-facing surface is `desktop_screen`, `desktop_apps`, `desktop_window`, `desktop_input`, `desktop_macro`, and `desktop_background`
- Desktop wrapper performance behavior (2026-07-13): `desktop_screen(action:"doctor")` is a fast health check by default; pass `deep:true` only for live screenshot/OCR/UI Automation probes. Exact-window input skips redundant focus when the target is already foreground. `desktop_window(action:"text")` supports `query`, `max_chars`, and `max_lines`; `desktop_input(action:"clipboard_get")` supports `query`, `max_chars`, `head`, `tail`, and `metadata_only` to bound model-facing output. A conservative 250ms desktop-context cache and 500ms generation-safe exact-window frame cache remove duplicate enumeration/capture inside tightly grouped actions. Structured accessibility results classify chrome-only surfaces and direct callers to screenshot/OCR instead of a redundant full-tree probe.

- Windows exact-window input uses strong `window_token` identity (HWND + PID + process start), persistent native capture/input helpers, and a single prepared-window hot path. Screenshot-anchored clicks reuse the freshly validated window for coordinate safety instead of re-enumerating the whole desktop; stale token, geometry, generation, and screenshot checks still fail closed. Ordinary wrapper screenshots discard degenerate/1×1 schema-placeholder regions, while `region_screenshot` preserves explicit native crops.
- `external_apps` is wrapper-first for the large bundled connectors: X/xAI uses `x_search_ops`, `x_posts`, `x_users`, `x_lists`, `x_dm`, and `x_admin`; Vercel uses `vercel_ops`
- `agents_and_teams` is wrapper-first for non-core agent/team operations: `agent_ops`, `agent_chat_ops`, `team_ops_wrapper`, and `team_collab_ops`
- `team_ops_wrapper` is the current model-facing managed-team wrapper name; a future cleanup may expose `team_ops` as the friendlier primary name while keeping `team_ops_wrapper` as an alias
- `workspace_write` is wrapper-first: the model-facing surface is `workspace_read`, `workspace_edit`, `workspace_run`, `workspace_git`, `workspace_safety`, and `workspace_code_nav`
- `workspace_run` is the canonical model-facing command/process/check wrapper under `workspace_write`; hidden compatibility tools `terminal`, `run_command`, `start_process`, `process_status`, `process_log`, `process_wait`, `process_kill`, and `process_submit` remain executable internals
- Media-assets behavior (2026-07-13): `analyze_video` preserves `analysis_mode` (`quick`, `detail`, or `both`) and detail budgets through the shared executor, uses compact probe/audio summaries by default, and only returns full ffprobe JSON when `include_raw_probe:true`. Transcription uses the configured speech-to-text provider and returns explicit requested/available/provider/note status. `download_media` resolves Prometheus-bundled FFmpeg/FFprobe and passes their location to yt-dlp, including audio-only extraction.
- `prometheus_source_read` is wrapper-first: `dev_source_read` covers src/, web-ui/, and allowlisted prom-root list/stats/read/batch/grep actions; old granular read helpers remain executable internals
- `prometheus_source_write` is wrapper-first after approval: `dev_source_edit` covers approved src/web-ui patchsets, surgical edits, full writes, deletes, verification, and apply-live; old granular write helpers remain executable internals
- `schedule_job` is core; deeper schedule operator tools such as history/detail/output/patch/stuck-control live under `automations`
- granular workspace file/read/write/git/run/safety/code-nav tools such as `read_file`, `list_directory`, `grep_file`, `file_stats`, `find_replace`, `apply_workspace_patchset`, `git_status`, `run_typecheck`, `snapshot_workspace`, and `code_outline` remain executable compatibility internals but are hidden from the normal exposed schema surface
- granular browser/desktop tools such as `browser_open`, `browser_snapshot`, `browser_click`, `browser_run_js`, `desktop_screenshot`, `desktop_click`, `desktop_window_click`, and `desktop_background_command` remain executable compatibility internals but are hidden from the normal exposed schema surface
- granular X/Vercel, agent/team, and Creative tools remain executable compatibility internals but are hidden from the normal exposed schema surface when their wrapper surface exists
- `search_files`, `read_files_batch`, and `file_tree` remain visible helper tools because they are shared by `workspace_write` and `prometheus_source_read`; `clone_repo` also remains visible because repo intake has special first-use guidance
- legacy `creative_mode` normalizes to `creative_basic`; `image_mode`, `video_mode`, `hyperframes`, `creative_qa`, and `media_quality` normalize to the narrower creative buckets
- `creative_basic` exposes `creative_project` and `creative_scene`; `creative_image` exposes `creative_image_ops`; `creative_video` exposes `creative_video_ops`; `creative_hyperframes` exposes `creative_hyperframes_ops`; `creative_quality` exposes `creative_quality_ops`
- `media_generate` is the core model-facing wrapper for one-shot image/video generation; hidden compatibility aliases `generate_image` and `generate_video` still execute and still emit generated media metadata for chat/mobile renderers
- only `skill_list` and `skill_read` are core skill tools; `skill_ops` is the model-facing `skills` category wrapper for inspect, resource list/read/write/delete, metadata repair/update, manifest overlays, authoring, import/export, and source refreshes; trigger changes expose and require positive/negative routing-evaluation prompts; old skill maintenance leaves remain executable compatibility aliases but are hidden from the exposed schema surface
- `model_management` covers agent model defaults/routes/templates; current-model switching remains core through `switch_model` / `set_current_model`
- `business` covers structured entity lifecycle tools; `business_context_mode` remains core so BUSINESS.md can be injected without activating the entity mutation surface
- the model-facing web surface is unified: use `web_search` for preferred-provider, forced-provider, or multi-provider search; use `web_fetch` with either `url` or `urls` for single or batch fetch
- the model-facing card surface is unified as `show_ui_card`; older `show_*` card tool names remain executable as compatibility aliases but are hidden from the exposed schema surface
- the model-facing delivery surface is unified around `delivery_send`: `action:"send"` sends text/files/images, `action:"screenshot"` replaces `delivery_send_screenshot`, and `action:"present_file"` replaces direct `present_file`; batch file presentation/delivery accepts `paths`, `files`, or `attachmentPaths`; legacy `send_telegram`, `browser_send_to_telegram`, `delivery_send_screenshot`, and `present_file` remain executable compatibility aliases but are hidden from the exposed schema surface
- the model-facing Prometheus repo sync surface is unified around core `prom_repo_ops`: `action:"push"` replaces `prom_repo_push`, `action:"pull"` replaces `prom_repo_pull`, and `action:"sync"` replaces `prom_repo_sync`; the old leaf names remain executable compatibility aliases but are hidden from the exposed schema surface
- the model-facing plan surface is gated: `declare_plan` stays core, while `complete_plan_step` is hidden from the base schema and injected turn-locally by `src/gateway/routes/chat.router.ts` after a valid 2+ step declaration or resumed manual plan; `step_complete` remains task/proposal compatibility and `bg_plan_declare`/`bg_plan_advance` are injected only for background-agent sessions
- gated tool injection pattern: keep canonical schemas in `src/gateway/tools/defs/*`, hide non-entry tools with `SCHEMA_HIDDEN_COMPAT_TOOL_NAMES` in `src/gateway/tool-builder.ts`, then re-add exact definitions inside `handleChat` with a local turn flag and a tool-array refresh. Use this for tools that should appear only after an enabling tool call, not for broad user-requested categories where `request_tool_category` is the right mechanism.
- the 2026-06-19 core schema compaction pass reduced the always-on core surface from 47 tools / ~15.9k estimated schema tokens to 45 tools / ~13.3k by shortening verbose descriptions and hiding legacy delivery aliases
- the 2026-06-19 workspace command unification pass made `terminal` cover bounded commands (`action:"run"`), supervised starts (`action:"start"`), and process management (`status`, `log`, `wait`, `kill`, `submit`). The hidden legacy names still route to the same executor for compatibility, while `terminal` command runs reuse the existing run-command deny policy, cwd/boundary analysis, Lite terminal permission mode, command permission grants, approval queue/cards, task pause/resume flow, Telegram approvals, and audit logging.
- the 2026-06-29 workspace wrapper compaction pass added six unified model-facing workspace tools: `workspace_read`, `workspace_edit`, `workspace_run`, `workspace_git`, `workspace_safety`, and `workspace_code_nav`. The direct executor normalizes those wrapper actions to the existing granular handlers before execution, so path scope, mutation guards, command policy, approval cards, snapshots, git shell-outs, and code-nav behavior remain centralized in the old handlers while the active `workspace_write` schema becomes much smaller.
- the 2026-06-29 dev source wrapper compaction pass added `dev_source_read` under `prometheus_source_read` and `dev_source_edit` under `prometheus_source_write`. The dev-source approval trio (`request_dev_source_edit`, `update_dev_source_edit`, `await_dev_source_edit_approval`) is exposed with `prometheus_source_read` so the model inspects files and prepares scope before requesting approval. `dev_source_edit` is still gated by the existing dev source approval flow: the write category cannot be activated until `request_dev_source_edit` or an approved `code_change` proposal grants access, and each delegated granular handler still runs the old session/scope/syntax checks.
- the 2026-06-29 browser/desktop wrapper compaction pass added `browser_session`, `browser_observe`, `browser_act`, and `browser_extract` under `browser_automation`, plus `desktop_screen`, `desktop_apps`, `desktop_window`, `desktop_input`, `desktop_macro`, and `desktop_background` under `desktop_automation`. The executor normalizes wrapper actions to the existing granular handlers, preserving browser final-action approvals, observe/capture behavior, desktop screenshot freshness, coordinate validation, scoped window helpers, macro/background lanes, policy checks, and audit logging.
- Tool-stream vision previews (2026-07-16): browser and desktop screenshot captures both emit `vision_injected` with a `preview.dataUrl` for the live tool stream. Desktop vision injection accepts both granular handlers (`desktop_screenshot`, `desktop_window_screenshot`, `desktop_click_text`) and model-facing wrappers (`desktop_screen` / `desktop_window` screenshot actions). `isDesktopToolName` treats all `desktop_*` tools as desktop tools so observation/auto-screenshot routing does not miss wrapper-era names.
- the 2026-06-29 external/agents/creative wrapper compaction pass added X/xAI and Vercel wrappers under `external_apps`, agent/team wrappers under `agents_and_teams`, and wrapper tools for each Creative bucket. The executor normalizes wrapper actions to existing extension/direct/capability handlers so connector auth, team state, Creative project state, policy checks, and audit logging stay centralized.
- the 2026-06-29 voice wrapper compaction pass made the Realtime voice tool surface wrapper-first: `voice_ops`, `voice_browser`, and `voice_desktop` are exposed alongside canonical `skill_*` and rich `show_*` card tools. Granular `voice_web_*`, `voice_browser_*`, `voice_desktop_*`, screenshot/status, and simple generation tools remain executable compatibility handlers behind `executeVoiceAgentToolWithTrace(...)` normalization.
- the 2026-06-29 wrapper smoke/fix pass corrected wrapper routing edges: `workspace_read(action:"grep")` now supports directory/glob search, `workspace_read(action:"search")` handles glob paths such as `dir/*.txt`, `workspace_safety(action:"snapshot", path)` scopes snapshots to the requested path, and `desktop_window` normalizes `title/name`, `window_id/window_handle/handle`, and exact-window input targets consistently.
- the 2026-06-29 browser speed pass made `browser_act(action:"click"|"key"|"scroll", observe:"none")` true fast-ack paths. Browser click/key no longer pay hardcoded settle waits on `observe:"none"`, and browser status broadcasts for fast paths run in the background instead of blocking the tool result.
- the 2026-06-29 desktop wrapper speed/ergonomics pass made desktop click/scroll verification opt-in by default, combined Windows pointer move plus click/scroll into one PowerShell invocation for verify-off actions, added fast exact-HWND lookup for window-scoped input, and added a safe `modifier:"none"` schema/default path. Runtime strips `modifier:"none"` before execution and only keeps `shift|ctrl|alt` when explicitly requested.
- the 2026-06-29 web/connector wrapper performance pass added `provider_timeout_ms` to `web_search`/compat search aliases, defaults provider attempts to a bounded 6000ms timeout, and caches `connector_list` status text briefly inside the extension runtime registry so repeated connector discovery does not re-probe every connector.
- the 2026-06-19 creative split replaced the old single `creative_mode` bucket (~28.9k schema tokens) with narrower buckets: `creative_basic` ~6.2k, `creative_image` ~3.6k, `creative_video` ~9.0k, `creative_hyperframes` ~7.1k, and `creative_quality` ~3.9k
- the 2026-06-19 scoped category activation pass removed accidental sticky activation from main chat: `request_tool_category` defaults to `scope:"turn"`, while direct internal `activateToolCategory(...)` calls still default to session scope for dev approvals/background runners that intentionally need persistence
- the 2026-06-19 file/dev read-output pass made active file results capped by default: `read_file` returns 240 lines unless windowed or `full:true`, `read_source`/`read_webui_source`/`read_prom_file` return 300 lines by default, `read_files_batch` defaults to 8 files x 200 lines, and `read_dev_sources` defaults to 8 files x 220 lines. Use `start_line`/`num_lines` for chunks; use `full:true` only when the whole file is genuinely needed.
- grep/search defaults are now leaner: single-file grep defaults to 50 matches and multi-file/source/prom grep defaults to 50 matches, with runtime hard caps of 80 returned matches and 3 context lines even if `max_results` asks for more. Broad calls should narrow path/glob/pattern instead of requesting huge result sets.
- `skill_list` is compact by default: it returns ids/names/count metadata, supports `query` and `limit`, and only includes descriptions when `include_descriptions:true` is explicitly needed.
- large tool outputs are summarized before reinjection into the active model loop; full/raw output remains available through tool observation raw storage for audit/recovery.
- the context-window endpoint includes last-turn usage telemetry: provider delta plus grouped tool-result output by tool, so oversized outputs such as repeated `grep_source` calls are visible in desktop/mobile context-window UI.
- the context-window ring/bar is based on the compaction trigger/current context limit, not the model's full context window. The detailed rows still expose the full model window as an out-of-band reference.
- desktop and mobile context-window UI apply a live current-turn overlay from streamed `tool_result` telemetry, so long-running tool loops can visibly grow before the backend finalizes/persists the assistant turn.
- the 2026-06-28 tool stopwatch pass makes `ToolResult.extra.telemetry.durationMs` first-class: streamed `tool_result` events expose `durationMs`/`elapsedMs`/`elapsed_ms`, model-facing tool observations include a compact `[TOOL_STOPWATCH] elapsed_ms=...` line, and context-window last-turn/live tool rows show elapsed timing suffixes such as `browser_open x1 · 2.4s`. Use this for browser/desktop/tool performance benchmarking instead of guessing from wall-clock feel.

- active skill reminder accounting mirrors the `[ACTIVE_SKILLS]` prompt block and persists `activatedSkillResources`; full `skill_read` content is accounted as tool-result/observation context, not as the lightweight active-skill reminder row.

Tool definition sources:

- `src/gateway/tools/defs/file-web-memory.ts`
- `src/gateway/tools/defs/agent-team-schedule.ts`
- `src/gateway/tools/defs/cis-system.ts`
- `src/gateway/tools/defs/creative-tools.ts`
- `src/gateway/tools/defs/xai-tools.ts`
- browser tool definitions from `src/gateway/browser-tools.ts`
- desktop tool definitions from `src/gateway/desktop-tools.ts`
- connected connector definitions from `src/extensions/legacy-connector-adapter.ts` and `src/extensions/runtime-registry.ts`
- extension runtime definitions from `src/extensions/runtime-registry.ts`
- MCP definitions from `src/gateway/mcp-manager.ts`
- composite definitions from `src/gateway/tools/composite-tools.ts`

Extension-runtime facts:

- Prometheus now has a first-pass OpenClaw-style extension substrate under `src/extensions/`
- `src/extensions/runtime-api.ts` defines the typed runtime API: tools, connectors, providers, MCP presets, routes, hooks, memory sources, and context providers
- `src/extensions/runtime-registry.ts` is the central runtime registry for extension manifests, registered tools, connector records, provider records, MCP presets, and connector status
- `src/extensions/runtime-loader.ts` loads manifest-owned native runtime modules when `prometheus.extension.json` declares `runtime.entrypoint`
- `src/extensions/activation-planner.ts` plans extension activation from startup hints, tool contracts, tool patterns, capability contracts, capability hints, and connected connector state
- `src/extensions/schema.ts` and `src/extensions/types.ts` now allow extension manifests to declare `trustLevel`, `activation`, `contracts`, and `runtime.entrypoint`
- `src/extensions/legacy-connector-adapter.ts` bridges the old hard-wired connector system into the new extension registry; this keeps current Gmail/GitHub/Slack/etc. tools working while native extension modules are migrated one by one
- connector schemas exposed to chat now come from `getExtensionRuntimeRegistry().listToolDefinitions()` in `src/gateway/tool-builder.ts`
- connector execution now routes through `getExtensionRuntimeRegistry().executeTool(...)` in `src/gateway/agents-runtime/subagent-executor.ts`
- the standalone `src/tools/registry.ts` also registers extension tools from `getExtensionRuntimeRegistry().listTools()`
- the old `CONNECTOR_TOOL_MAP`, `getConnectorToolDefs`, and `handleConnectorTool` are still compatibility inputs to the adapter, not the desired long-term source of truth

Executor routing facts from `src/gateway/agents-runtime/subagent-executor.ts`:

- despite the filename, this is the main injected tool executor used by chat, background tasks, team agents, and subagents
- proposal/source write gates run before normal policy execution
- every tool call is evaluated by `getPolicyEngine().evaluateAction(...)` and audit-logged through `appendAuditEntry(...)`
- `commit`-tier `terminal(action:"run")` calls normalize through the run-command policy path: native file-tool bypass checks, blocked shell patterns, allowed command policy, cwd, absolute path scope, command permission grants, and approval queue/cards
- other `commit`-tier tools can use scoped browser-page or desktop-window permission grants for repeat approvals
- approval requests flow through `ApprovalQueue`, WebSocket events, task `needs_assistance` state, task journal entries, and Telegram command approval when configured
- after policy/approval, `executeRegisteredCapabilityTool(...)` gets first chance to handle registered capability families
- unhandled tools fall back to the direct switch handlers in `subagent-executor.ts`

Durable tool-effect/resource boundary (2026-07-15):

- `chat.router.ts::executeToolWithTelemetry(...)` now wraps its normal `executeTool(...)` call with a journaled logical effect: tool/call identity, argument hash, attempt, execution count, referenced result, and replay policy from `src/gateway/turn-jobs/resource-policy.ts`.
- Only the explicit built-in read/query/status allowlist is `safe_retry`; unknown plugin, composite, and future tool names fail closed to `verify_before_retry` even when their names begin with `get_`, `read_`, or `list_`. Send/publish/payment/click/delete/restart/deploy-style effects are `never_replay`. A succeeded effect can reuse its referenced result, while an uncertain non-safe effect must go to review instead of executing blindly after a lost lease.
- Lease expiry, cancellation, and ordinary failed-attempt settlement convert a still-running effect to `unknown`; any such non-safe failed/expired effect puts the job in `needs_review`, so a retryable error cannot strand it as `running` or silently pass it into another attempt. A job cannot persist its final while any effect remains prepared/running.
- The central tool telemetry path normalizes, compresses, writes, and fsyncs large effect results asynchronously before committing the succeeded effect/checkpoint. Small inline lifecycle results use the synchronous journal hook so their effect is committed before the corresponding `tool_result` event is published.
- Before execution, the durable context leases shared browser-per-session, global desktop-input, scheduler-store, and lifecycle/dev-apply resources. File-path and repository-command leases are available only with `PROMETHEUS_ENABLE_FILE_RESOURCE_LEASES=1`: they are off by default so otherwise independent sessions retain the existing shared-workspace/concurrent workflow. When enabled, bounded file inference recognizes path-bearing fields (including rename `old_path`/`new_path`, direct `filename`, and patchset `edits[].filename`), normalizes/deduplicates them, and fails closed to a repository lease when traversal is truncated. All leases are ordered, fenced to the turn attempt, heartbeat-extended, and released in reverse order.
- Task/team tools continue using their gateway manager locks rather than holding a durable task/team lease across a synchronously awaited child turn; doing both would create a bounded-pool dependency inversion.
- Inline goal complete/block, plan declare/advance/step completion, subagent-spawn, outer `start_task`, and `request_secondary_assist` branches now use the same durable prepared/running/result boundary. This closes the known bypasses, but it does not make arbitrary mid-tool crash replay complete: child commands/processes launched by a turn still need an explicit ownership and verification contract before automatic resume can be enabled safely.
- Tools and approvals still execute in the gateway. Current child workers own provider/model calls; a future full-turn child will call gateway-owned tools through the turn-worker RPC protocol.

Tool observation/context facts:

- `src/gateway/tool-observations.ts` is the canonical compact record layer for tool results used as future prompt context and profiling data.
- the storage record is deliberately small: `id`, `sessionId`, `turnId`, `stepNum`, `toolName`, `category`, `status`, `argsPreview`, `resultPreview`, optional `resultRawRef`, `artifacts`, `pathsTouched`, `exitCode`, telemetry fields (`durationMs`, `startedAt`, `finishedAt`), token estimate fields (`argsTokens`, `resultTokens`, `totalTokens`, chars/bytes), and `createdAt`.
- categories are inferred from tool name prefixes, including `shell_process`, `file`, `web`, `browser`, `desktop`, `memory`, `skill`, `media`, `agent_task`, `approval`, `connector`, `creative`, and `other`.
- args/results are scrubbed for secret-looking keys before preview formatting.
- huge results over roughly 6000 characters are written to a raw sidecar file and the observation gets a `tool-observation-raw:<session>/<file>` reference.
- `chat.router.ts` wraps direct `executeTool(...)` calls with universal wall-clock telemetry so every normal tool result gets `extra.telemetry` before observation persistence; capability tools can still attach richer internal phase telemetry first.
- `formatToolObservationsForContext(...)` ranks observations before injection: errors, approvals, file mutations, shell/process results, browser/desktop actions, artifacts, and raw refs receive extra priority.
- formatted observations use the `[RECENT_TOOL_OBSERVATIONS]` block name; avoid introducing new plural/singular variants.
- `session.ts` exposes `getRecentToolObservationsForContext(...)`, which reads the JSONL observation store and falls back to legacy `getRecentToolLog(...)` if no observations exist.
- Gateway prompt/Goal callers use the async counterpart, which reads backward from the file tail under byte and per-line caps. The synchronous reader remains for isolated child/diagnostic compatibility and must not be restored to hot gateway paths.
- normal context injection is intentionally lean: timing/token lines are stored on every observation but omitted from default prompt context unless `includeTelemetry: true` is explicitly requested by compaction/debug/profiling callers.
- turn-level persisted `toolLogText` and compaction formatting request `includeTelemetry: true`, so workflow profiling and post-run summaries can still produce exact per-tool duration/token tables without bloating every future prompt.
- `brain-runner.ts` has three tool-loop sites that persist/format observations through the same helper instead of maintaining separate 8-result/80-arg/120-preview logic.
- `formatCompactionToolResults(...)` and rolling compaction consume observation formatting rather than dumping raw tool result strings.

Important boundary:

- observations are for saved/future context and compaction, not a replacement for the active tool-result message delivered inside the currently running model call
- do not "optimize" current-turn browser/desktop/screenshot/approval result delivery by swapping it to observation previews unless active-turn compression is intentionally designed and tested
- raw/JSONL observation persistence runs in a bounded child pool. It is optional metadata: after a 25 ms fast path it may attach to the exact assistant message post-terminal, and worker queue/crash/size failure must degrade to a bounded warning rather than fail the user's final response.
- observation `artifacts` contain bounded identifiers only; never put base64, complete blobs, or arbitrary nested artifact payloads into the JSONL.
- if a future model needs raw large output recovery, add an explicit retrieval mechanism before treating `resultRawRef` as model-readable


Run-command/system-control policy facts to preserve:

- `workspace_run` is the model-facing command/process/check schema in `workspace_write`; hidden compatibility aliases, including `terminal`, still execute through the same command handling. Command handling separates default approval routing from Lite terminal permissions.
- token allowlists are assembled in `src/gateway/chat/chat-helpers.ts` from defaults plus config-backed arrays under `tools.permissions.shell.*`; in default mode, an unknown or non-allowlisted token should reach the normal command approval queue instead of hard-blocking before approval
- config/schema/type support exists for `allowed_commands`, `allowed_windows_read_commands`, `allowed_windows_system_commands`, and `allowed_custom_commands`; those lists are enforced as hard/auto-block boundaries only when `tools.permissions.shell.approval_mode === "lite"`
- local-control additions such as `powercfg` and `taskkill` are still commit-tier shell actions; allowing the token only permits them to reach normal policy/approval/audit, not to run silently
- hard-deny policy remains separate in `src/gateway/tool-deny-policy.ts` and must continue blocking destructive, credential-access, security-disabling, privilege-escalating, or machine-interrupting patterns even if default command permissions would otherwise ask for approval
- future diagnostic commands such as WMI/CIM, `dxdiag`, GPU probes, or vendor CLIs should be added as typed capability tools when they become common, but default terminal permissions must not reject them solely because their leading token is unfamiliar

Registered capability executors currently live under `src/gateway/agents-runtime/capabilities/`:

- `skillsCapabilityExecutor`
- `automationCapabilityExecutor`
- `teamAgentCapabilityExecutor`
- `memoryCapabilityExecutor`
- `platformCapabilityExecutor`
- `webMediaCapabilityExecutor`

Capability-handled families currently include:

- skills: core `skill_list`/`skill_read`, plus `skill_ops` under the `skills` category; hidden compatibility leaves include `skill_resource_*`, `skill_create*`, `skill_import_bundle`, `skill_export_bundle`, `skill_update_from_source`, `skill_update_metadata`, `skill_manifest_write`, `skill_inspect`, `skill_audit_all`, and `skill_repair_metadata`
- automations/tasks: `background_ops` core wrapper; hidden executable compatibility aliases `background_*`; `task_control`, `timer`, `internal_watch`, `schedule_job`, `schedule_job_*`, `automation_dashboard`; plan-step tools are hidden/injected by `chat.router.ts` rather than capability category activation
- teams/agents: `agent_*`, `spawn_subagent`, `message_subagent`, `dispatch_team_agent`, `team_manage`, `ask_team_coordinator`, `set_agent_model`, `get_agent_models`, team chat/status/artifact tools
- memory: `business_context_mode`, `memory_*`, `write_note`
- platform: `mcp__*`, `mcp_server_manage`, `connector_*`, `connector_list`, composite management and saved composites
- web/media: `web_search`, `web_fetch`, `download_url`, `download_media`, `media_generate` plus hidden `generate_image`/`generate_video` compatibility aliases, `analyze_image`, `analyze_video`, `video_analyze_imported_video`, `save_site_shortcut`

Direct executor switch handlers still own lower-level or specialized families:

- file and workspace surgery tools
- Prometheus source read/write tools
- git/test/lint/format helpers
- supervised process tools
- browser and desktop automation tools
- Creative, HTML Motion, HyperFrames, and composition tools

Desktop wrapper performance/behavior notes (2026-07-13):

- `desktop_screen(action:"doctor", deep:false)` is the routine health path; deep screenshot/OCR/UIA probes remain opt-in with `deep:true`.
- Exact-window screenshot capture keeps a short-lived native frame cache keyed by strong `window_token` plus visual generation and bounds. Reuse is intentionally invalidated by input/window mutations so speed does not weaken stale-state safety.
- A successful exact-window focus updates the active-window cache, allowing the next matching click to skip redundant foreground activation while retaining strong PID/process-start identity validation.
- `desktop_input(action:"clipboard_get")` supports `query`, `max_chars`, `head`, `tail`, `metadata_only`, and `include_length`; use bounded or metadata-only reads unless full clipboard content is necessary.
- `desktop_window(action:"accessibility_state")` classifies shallow UIA results as `chrome_only` and returns a screenshot/OCR routing hint. Avoid following that with a redundant full accessibility-tree probe.
- Model-facing desktop wrappers remain six unified tools; runtime argument normalization forwards only action-relevant values to canonical executors even though the provider-visible JSON schema is intentionally broad for compatibility.

- proposal/admin fallback tools and legacy compatibility names

Video-mode tool guard to preserve:

- in Video mode, `creative_apply_ops`, scene element tools, scene asset placement, scene-graph animations/effects/masks, and `creative_trim_clip` are intentionally rejected by the executor
- Video mode should use HTML Motion, HyperFrames, Remotion motion templates, composition tools, and Pretext/text-fit QA instead

Composite tools are a real first-class tool layer, not just an informal pattern.
Current composite-tool facts from `src/gateway/tools/composite-tools.ts`, `tool-builder.ts`, `prompt-context.ts`, and the runtime dispatch path:

- composite management is its own category lane: `composite_tools` (`composites` remains an alias)
- composite management tools are not core; the prompt context explicitly says to activate the `composites` category when the user wants to create, inspect, edit, delete, list, or run saved multi-step tools
- saved composites are loaded from `.prometheus/composites/` under either `PROMETHEUS_DATA_DIR` or the current working directory
- each saved composite is a JSON definition with:
  - `name`
  - `description`
  - `parameters`
  - `steps`
- each step is a `{ tool, args }` pair
- step args support runtime placeholder substitution with `{{param_name}}`
- parameter schemas can be partially auto-inferred from placeholders discovered inside the step payloads

Current built-in composite management tools:

- `create_composite`
- `get_composite`
- `edit_composite`
- `delete_composite`
- `list_composites`

Execution behavior:

- saved composite definitions are injected back into the live tool surface as callable dynamic tools
- runtime execution is sequential, step-by-step, not parallel fanout
- missing required params can be resolved from recent session history through an LLM-assisted pass before execution
- unresolved placeholders get one more targeted resolution attempt before the run continues
- each executed step emits synthetic tool-call and tool-result events tagged with composite metadata and step numbering
- the composite stops immediately on the first step failure

Operational rule to preserve:

- composite creation is intentionally conservative
- `create_composite` tells the model to manually run every step first, verify refs/selectors/arguments in a successful live run, and only then save the composite
- chat runtime guidance also says not to create composites automatically unless the user explicitly asks
- in other words, composites are treated as saved, verified tool playbooks rather than speculative generated automation

## 11) Web, Media, Image, and Video Tools

Current model-facing web/media tool surface includes:

- `web_search`
- `web_fetch`
- `download_url`
- `download_media`
- `media_generate`
- `analyze_image`
- `analyze_video`
- `video_analyze_imported_video`

Current behavior:

- `web_search` defaults to the preferred provider from Settings for low-latency searches. Use `provider: "multi"` or `multi_engine: true` for wide/deep research across all configured providers; use `provider: "tinyfish" | "tavily" | "google" | "brave" | "ddg" | "xai"` for a forced single-provider check. `shopping_search_products` follows the same fast preferred-provider default and accepts `provider: "multi"` when broader product discovery is worth the extra latency.
- `web_search` accepts `fetch_top_k` and `fetch_max_chars` so a search can fetch its top result URLs in the same call
- `web_search` accepts `provider_timeout_ms` for diagnostics/provider checks. Default per-provider timeout is 6000ms, clamped to 1000-15000ms, so single-provider failures such as TinyFish timeouts fail fast instead of dragging the whole tool loop.
- `web_fetch` reads full page content for one URL after `web_search`, or reads several URLs in parallel when called with `urls`
- `web_fetch` has special handling for X/Twitter status URLs and attempts attached-media download plus analysis automatically
- for multiple X/Twitter status URLs, call `web_fetch({ urls: [...] })`; for one X/Twitter status URL, call `web_fetch({ url })`
- `download_url` is for direct file/image/PDF links
- `download_media` is for media-page extraction via `yt-dlp`
- `media_generate(action:"image")` supports provider override `auto | openai | openai_codex | xai`
- `media_generate(action:"video")` supports the configured video generation provider/model path, currently xAI-backed by default
- `analyze_video` samples frames and can extract audio/transcripts when local tools are available
- web/media execution is now handled by `webMediaCapabilityExecutor` before the fallback switch path
- old `web_search_single`, `web_search_multi`, `web_fetch_batch`, `generate_image`, and `generate_video` remain executable compatibility aliases but are hidden from the exposed schema surface
- Image/video provider selection must not be tied to the current chat LLM provider. If the user is chatting with Grok, Claude, or another model, `media_generate` should still be able to use any configured media endpoint whose credentials exist in config/vault/OAuth.

Implementation facts for the 2026-06-17 workspace batch-file-tools update:

- `src/tools/files.ts` exports standalone registry tools for `read_files_batch`, `apply_workspace_patchset`, and `file_tree`
- `src/tools/registry.ts` imports and registers `readFilesBatchTool`, `applyWorkspacePatchsetTool`, and `fileTreeTool` after `fileStatsTool` so registry-based execution paths can call them directly
- direct chat/subagent fallback handlers for these tools remain in `src/gateway/agents-runtime/subagent-executor.ts`
- chat tool schemas for these tools live in `src/gateway/tools/defs/file-web-memory.ts`
- `src/gateway/tool-builder.ts` exposes `search_files`, `read_files_batch`, and `file_tree` in both `workspace_write` and `prometheus_source_read` contexts so source/self-edit sessions can use the token-saving helpers without activating the full workspace write category
- `src/gateway/tool-builder.ts` exposes `workspace_read`, `workspace_edit`, `workspace_run`, `workspace_git`, `workspace_safety`, and `workspace_code_nav` under `workspace_write`, while hiding most granular workspace schemas through `SCHEMA_HIDDEN_COMPAT_TOOL_NAMES`
- `src/gateway/tool-builder.ts` exposes `dev_source_read` under `prometheus_source_read` and `dev_source_edit` under `prometheus_source_write`, while hiding the granular source/web-ui/prom-root read/write schemas through `SCHEMA_HIDDEN_COMPAT_TOOL_NAMES`
- `src/gateway/tool-builder.ts` exposes wrapper-only browser/desktop schemas under `browser_automation` and `desktop_automation`, while hiding granular browser/desktop schemas through `SCHEMA_HIDDEN_COMPAT_TOOL_NAMES`
- `search_files(directory:"src/..."|"web-ui/...")` delegates to `grep_source`/`grep_webui_source` in the direct executor; `file_tree(path:"src/..."|"web-ui/...")` renders compact trees from the Prometheus project source roots
- broad workspace `search_files` is asynchronous and yields to the event loop; it skips individual files larger than 5 MiB by default (configurable per call with `max_file_bytes`, hard cap 25 MiB) and reports representative skipped paths so giant audit indexes/logs cannot freeze gateway health
- `read_files_batch` accepts `src/...` and `web-ui/...` entries and delegates those reads through the source-read handlers, keeping Prometheus self-edit inspection batched and read-only

- `workspace_read(action:"batch_read")` should be preferred over serial reads when inspecting two or more workspace files before an edit
- `workspace_edit(action:"patchset")` delegates to `apply_workspace_patchset`, which supports grouped workspace file mutations (`find_replace`, `replace_lines`, `insert_after`, `delete_lines`, `write_file`, `create_file`) and returns per-edit results
- `file_tree` returns a compact indented directory tree for fast project orientation, with depth, glob, and exclude controls
- `workspace_code_nav(action:"outline")` uses the TypeScript module through a CJS/ESM-safe normalization path; keep that if touching code outline because runtime TypeScript may expose `ScriptKind` under `default`.
- Dev apply-live source edits still rely on `prom_apply_dev_changes` and the hot-restart continuation path. After a dev self-edit restart, the guarded continuation may call `write_note` to record completion/summary notes, but other hot-restart tools remain blocked.

Implementation facts for the 2026-06-05 batch research update:

- runtime implementation lives in `src/tools/web.ts` as `executeWebFetchBatch(...)` plus `maybeAttachFetchedSearchResults(...)`
- top-level registry import/registration is in `src/tools/registry.ts`
- chat tool schemas are exposed in `src/gateway/tools/defs/file-web-memory.ts`
- subagent/capability routing is in `src/gateway/agents-runtime/capabilities/web-media-executor.ts`
- `web_fetch` batch args are `urls`, optional `max_chars`, and optional `concurrency`
- `web_search` batch-read args are `fetch_top_k` and `fetch_max_chars`
- verification run after implementation: `npm run build:backend`, plus a local compiled runtime smoke test of `executeWebFetchBatch` using two `data:text/plain` URLs; both passed

## 12) Product Carousel

`show_ui_card({ type: "product_carousel", payload: ... })` renders a horizontal scrollable product card UI in the chat — exactly like ChatGPT's product preview cards.

**When to use:** Any time the user asks to find, compare, or show products from a website (Amazon, Best Buy, Google Shopping, etc.).

**The correct workflow (always do this in order):**
1. Call `shopping_search_products` first. It preserves provider thumbnails, fetches page metadata, extracts JSON-LD/Open Graph/large page images, and caches usable images locally.
2. Use `browser_open` plus `browser_extract_structured`, `browser_scroll_collect_v2`, or `browser_run_js` only when the structured result is incomplete, the page is JS-only, or visual/login verification is needed.
3. Curate the 3–8 best/most relevant items — do NOT dump all results.
4. Call `show_ui_card({ type: "product_carousel", payload: { title: "...", items: [...] } })`. The display tool normalizes common field aliases and performs a final best-effort metadata/image enrichment pass.

**Item fields:**
- `title` (required), `productUrl` (required)
- `price` — string like "$38.49"
- `listPrice` — optional original/MSRP price
- `description` — one short line, e.g. "Top-rated for overall cleaning and durability."
- `rating` — number 0–5
- `reviews` — review count
- `tag` — badge like "Best overall", "Best budget", "Editor's pick"
- `imageUrl` — direct image URL from the page (preferred — use the product image src you find in the DOM)
- `imagePath` — only if you downloaded the image to workspace with browser tools
- `merchant` — "Amazon", "Best Buy", etc.
- `availability`, `seller`, `sku`, `asin`, `confidence` — optional normalized provider/product metadata retained on the card payload

**Important rules:**
- Always gather real product URLs first; the display tool may fill missing fields, but it does not invent products.
- You decide the curation (which products, how many, what tags) — not the tool
- Pass any image already supplied by the provider/page. The tool caches it under `downloads/product-carousel/` when possible so expiring or hotlink-protected URLs remain renderable.
- Keep descriptions short and factual — one line per card maximum
- If the user says "show me X on Amazon" and you can browse, always use the carousel rather than a plain list
