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
- `media_quality`
- `automations`
- `external_apps`
- `integration_admin`
- `social_intelligence`
- `proposal_admin`
- `mcp_server_tools`
- `composite_tools`
- `creative_mode`

Legacy aliases still map onto the current category IDs, including `browser`, `desktop`, `team_ops`, `teams`, `agents`, `source_read`, `source_write`, `file_ops`, `files`, `shell`, `commands`, `run_commands`, `memory`, `media`, `schedule`, `scheduling`, `integrations`, `connectors`, `mcp`, and `composites`.

Key rules:

- categories are activated per session through `request_tool_category`
- some tools are always core and never category-gated
- MCP tools are injected dynamically as `mcp__<serverId>__<toolName>`
- saved composite tools are injected dynamically too
- `connector_list` is always available
- `ask_team_coordinator` is always available
- `deploy_analysis_team` is always available
- `run_command`, `terminal`, `start_process`, `process_status`, `process_log`, `process_wait`, `process_kill`, and `process_submit` are under `workspace_write` in the category-gated builder
- `schedule_job` is core; deeper schedule operator tools such as history/detail/output/patch/stuck-control live under `automations`
- `get_creative_mode` and `switch_creative_mode` are core
- `creative_*`, `hyperframes_*`, and creative video QA tools live under the `creative_mode` category

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
- `commit`-tier `run_command` calls validate native file-tool bypasses, blocked shell patterns, allowed command policy, cwd, absolute path scope, and command permission grants before queuing approval
- other `commit`-tier tools can use scoped browser-page or desktop-window permission grants for repeat approvals
- approval requests flow through `ApprovalQueue`, WebSocket events, task `needs_assistance` state, task journal entries, and Telegram command approval when configured
- after policy/approval, `executeRegisteredCapabilityTool(...)` gets first chance to handle registered capability families
- unhandled tools fall back to the direct switch handlers in `subagent-executor.ts`

Registered capability executors currently live under `src/gateway/agents-runtime/capabilities/`:

- `skillsCapabilityExecutor`
- `automationCapabilityExecutor`
- `teamAgentCapabilityExecutor`
- `memoryCapabilityExecutor`
- `platformCapabilityExecutor`
- `webMediaCapabilityExecutor`

Capability-handled families currently include:

- skills: `skill_list`, `skill_read`, `skill_resource_*`, `skill_create*`, `skill_import_bundle`, `skill_export_bundle`, `skill_update_from_source`
- automations/tasks: `background_*`, `task_control`, `timer`, `internal_watch`, `schedule_job`, `schedule_job_*`, `automation_dashboard`
- teams/agents: `agent_*`, `spawn_subagent`, `message_subagent`, `dispatch_team_agent`, `team_manage`, `ask_team_coordinator`, `set_agent_model`, `get_agent_models`, team chat/status/artifact tools
- memory: `business_context_mode`, `memory_*`, `write_note`
- platform: `mcp__*`, `mcp_server_manage`, `connector_*`, `connector_list`, composite management and saved composites
- web/media: `web_search*`, `web_fetch`, `download_url`, `download_media`, `generate_image`, `generate_video`, `analyze_image`, `analyze_video`, `video_analyze_imported_video`, `save_site_shortcut`

Direct executor switch handlers still own lower-level or specialized families:

- file and workspace surgery tools
- Prometheus source read/write tools
- git/test/lint/format helpers
- supervised process tools
- browser and desktop automation tools
- Creative, HTML Motion, HyperFrames, and composition tools
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

Current web/media tool surface includes:

- `web_search`
- `web_search_single`
- `web_search_multi`
- `web_fetch`
- `download_url`
- `download_media`
- `generate_image`
- `generate_video`
- `analyze_image`
- `analyze_video`
- `video_analyze_imported_video`

Current behavior:

- `web_fetch` reads full page content after `web_search`
- `web_fetch` has special handling for X/Twitter status URLs and attempts attached-media download plus analysis automatically
- `download_url` is for direct file/image/PDF links
- `download_media` is for media-page extraction via `yt-dlp`
- `generate_image` supports provider override `auto | openai | openai_codex | xai`
- `generate_video` supports the configured video generation provider/model path, currently xAI-backed by default
- `analyze_video` samples frames and can extract audio/transcripts when local tools are available
- web/media execution is now handled by `webMediaCapabilityExecutor` before the fallback switch path
- Image/video provider selection must not be tied to the current chat LLM provider. If the user is chatting with Grok, Claude, or another model, `generate_image` and `generate_video` should still be able to use any configured media endpoint whose credentials exist in config/vault/OAuth.
