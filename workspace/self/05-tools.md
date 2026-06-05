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

Tool observation/context facts:

- `src/gateway/tool-observations.ts` is the canonical compact record layer for tool results used as future prompt context
- the storage record is deliberately small: `id`, `sessionId`, `turnId`, `stepNum`, `toolName`, `category`, `status`, `argsPreview`, `resultPreview`, optional `resultRawRef`, `artifacts`, `pathsTouched`, `exitCode`, and `createdAt`
- categories are inferred from tool name prefixes, including `shell_process`, `file`, `web`, `browser`, `desktop`, `memory`, `skill`, `media`, `agent_task`, `approval`, `connector`, `creative`, and `other`
- args/results are scrubbed for secret-looking keys before preview formatting
- huge results over roughly 6000 characters are written to a raw sidecar file and the observation gets a `tool-observation-raw:<session>/<file>` reference
- `formatToolObservationsForContext(...)` ranks observations before injection: errors, approvals, file mutations, shell/process results, browser/desktop actions, artifacts, and raw refs receive extra priority
- formatted observations use the `[RECENT_TOOL_OBSERVATIONS]` block name; avoid introducing new plural/singular variants
- `session.ts` exposes `getRecentToolObservationsForContext(...)`, which reads the JSONL observation store and falls back to legacy `getRecentToolLog(...)` if no observations exist
- `chat.router.ts` persists observations after tool turns with `persistToolResultsAsObservations(...)` and injects observation context into future model calls
- `brain-runner.ts` has three tool-loop sites that now persist/format observations through the same helper instead of maintaining separate 8-result/80-arg/120-preview logic
- `formatCompactionToolResults(...)` and rolling compaction now consume observation formatting rather than dumping raw tool result strings

Important boundary:

- observations are for saved/future context and compaction, not a replacement for the active tool-result message delivered inside the currently running model call
- do not "optimize" current-turn browser/desktop/screenshot/approval result delivery by swapping it to observation previews unless active-turn compression is intentionally designed and tested
- if a future model needs raw large output recovery, add an explicit retrieval mechanism before treating `resultRawRef` as model-readable


Run-command/system-control policy facts to preserve:

- `run_command`, `terminal`, and `start_process` remain `workspace_write` tools, but the command token policy now distinguishes base command tokens from Windows diagnostics/read-only tokens and Windows local-control tokens
- token allowlists are assembled in `src/gateway/chat/chat-helpers.ts` from defaults plus config-backed arrays under `tools.permissions.shell.*`
- config/schema/type support exists for `allowed_commands`, `allowed_windows_read_commands`, `allowed_windows_system_commands`, and `allowed_custom_commands`
- local-control additions such as `powercfg` and `taskkill` are still commit-tier shell actions; allowing the token only permits them to reach normal policy/approval/audit, not to run silently
- hard-deny policy remains separate in `src/gateway/tool-deny-policy.ts` and must continue blocking destructive or machine-interrupting patterns even if their leading token is otherwise allowed
- when adding future computer-control capability, prefer typed capability executors or first-class tools that wrap validated command shapes instead of adding broad arbitrary shell access

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
- web/media: `web_search*`, `web_fetch`, `web_fetch_batch`, `download_url`, `download_media`, `generate_image`, `generate_video`, `analyze_image`, `analyze_video`, `video_analyze_imported_video`, `save_site_shortcut`

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
- `web_fetch_batch`
- `download_url`
- `download_media`
- `generate_image`
- `generate_video`
- `analyze_image`
- `analyze_video`
- `video_analyze_imported_video`

Current behavior:

- `web_fetch` reads full page content for one URL after `web_search`
- `web_fetch_batch` reads several URLs in parallel and returns one result per URL with partial-failure details; default guidance is small focused batches, usually 2-5 URLs, hard-capped in the tool implementation
- `web_search`, `web_search_single`, and `web_search_multi` accept `fetch_top_k` and `fetch_max_chars` so a search can fetch its top result URLs in the same call
- `web_fetch` has special handling for X/Twitter status URLs and attempts attached-media download plus analysis automatically
- for multiple X/Twitter status URLs, route first to `web_fetch_batch`; for one X/Twitter status URL, route first to `web_fetch`
- `download_url` is for direct file/image/PDF links
- `download_media` is for media-page extraction via `yt-dlp`
- `generate_image` supports provider override `auto | openai | openai_codex | xai`
- `generate_video` supports the configured video generation provider/model path, currently xAI-backed by default
- `analyze_video` samples frames and can extract audio/transcripts when local tools are available
- web/media execution is now handled by `webMediaCapabilityExecutor` before the fallback switch path
- `webMediaCapabilityExecutor` handles `web_fetch_batch` for subagents and capability-routed sessions, not only the top-level registry
- Image/video provider selection must not be tied to the current chat LLM provider. If the user is chatting with Grok, Claude, or another model, `generate_image` and `generate_video` should still be able to use any configured media endpoint whose credentials exist in config/vault/OAuth.

Implementation facts for the 2026-06-05 batch research update:

- runtime implementation lives in `src/tools/web.ts` as `executeWebFetchBatch(...)` plus `maybeAttachFetchedSearchResults(...)`
- top-level registry import/registration is in `src/tools/registry.ts`
- chat tool schemas are exposed in `src/gateway/tools/defs/file-web-memory.ts`
- subagent/capability routing is in `src/gateway/agents-runtime/capabilities/web-media-executor.ts`
- `web_fetch_batch` args are `urls`, optional `max_chars`, and optional `concurrency`
- `web_search` batch-read args are `fetch_top_k` and `fetch_max_chars`
- verification run after implementation: `npm run build:backend`, plus a local compiled runtime smoke test of `executeWebFetchBatch` using two `data:text/plain` URLs; both passed

## 12) Product Carousel

`show_product_carousel` renders a horizontal scrollable product card UI in the chat — exactly like ChatGPT's product preview cards.

**When to use:** Any time the user asks to find, compare, or show products from a website (Amazon, Best Buy, Google Shopping, etc.).

**The correct workflow (always do this in order):**
1. Use `browser_open` to navigate to the site/search results
2. Use `browser_extract_structured`, `browser_scroll_collect_v2`, or `browser_run_js` to extract product data (title, price, rating, image URL, product URL)
3. Curate: pick the 3–8 best/most relevant items — do NOT dump all results
4. Call `show_product_carousel({ title: "...", items: [...] })` — the UI renders the cards automatically

**Item fields:**
- `title` (required), `productUrl` (required)
- `price` — string like "$38.49"
- `description` — one short line, e.g. "Top-rated for overall cleaning and durability."
- `rating` — number 0–5
- `reviews` — review count
- `tag` — badge like "Best overall", "Best budget", "Editor's pick"
- `imageUrl` — direct image URL from the page (preferred — use the product image src you find in the DOM)
- `imagePath` — only if you downloaded the image to workspace with browser tools
- `merchant` — "Amazon", "Best Buy", etc.

**Important rules:**
- Always call `show_product_carousel` AFTER doing your own extraction — the tool is just the display step
- You decide the curation (which products, how many, what tags) — not the tool
- `imageUrl` from the page is fine to pass directly; you do NOT need to download images unless the URL is behind auth
- Keep descriptions short and factual — one line per card maximum
- If the user says "show me X on Amazon" and you can browse, always use the carousel rather than a plain list
