# TOOLS.md — Available Tools & Usage Guide

Last updated: 2026-05-20

## Session Sync (2026-03-27)

Aligned to current runtime after this session's cleanup:

- Removed legacy memory stack registration (`memory_search` + old markdown-backed memory tools in `src/tools`).
- Canonical memory tools are now the USER/SOUL/MEMORY category tools executed in `subagent-executor`:
  - `memory_browse(file)`
  - `memory_read(file)`
  - `memory_write(file, category, content)`
- Removed stale file assumptions from docs/runtime:
  - No `IDENTITY.md`
  - No `ROUTING.md`
  - No `facts.md` markdown fallback
- Background/task and main runtime now document the same category-driven tool model in this file.

---

## Environment

- **Platform:** Windows 11
- **Workspace:** D:\Prometheus\workspace
- **Gateway:** http://127.0.0.1:18789

---

## Tool Category System

Tools are split into **core** tools that are always available and **17 on-demand runtime categories**.
Activate a category once per session with `request_tool_category` and it stays active for that session.

| Category | What it unlocks |
|---|---|
| `browser_automation` | Browser UI control, DOM extraction, screenshots, network hooks, site shortcuts |
| `desktop_automation` | OS/window automation, app launch/focus, clipboard, screenshots, macro tools |
| `agents_and_teams` | Standalone subagents, managed teams, team chat, dispatches, agent updates |
| `prometheus_source_read` | Prometheus `src/`, `web-ui/`, and allowlisted root source inspection |
| `prometheus_source_write` | Prometheus source editing tools for approved dev proposal tasks |
| `workspace_write` | Workspace file mutation, git/test/lint helpers, command/process tools |
| `advanced_memory` | Memory graph, timeline, project search, related records, index maintenance |
| `media_assets` | Download and analyze images, video, audio, and remote media assets |
| `media_quality` | Image/video QA: contrast, text overflow, frame renders, caption/audio timing |
| `automations` | Schedule detail/history/outputs/patch/stuck-control/dashboard tools |
| `external_apps` | Connected connector tools such as Gmail, GitHub, Slack, Notion, Drive, Reddit, HubSpot, Salesforce, Stripe, GA4, Obsidian, X/Twitter, xAI/Grok |
| `integration_admin` | MCP server setup, webhooks, and integration quick setup/admin |
| `social_intelligence` | Social profile intelligence and reporting |
| `proposal_admin` | Pending proposal inspection/editing |
| `mcp_server_tools` | Dynamic `mcp__<serverId>__<toolName>` tools from connected MCP servers |
| `composite_tools` | Saved multi-step composite tools plus composite management |
| `creative_mode` | Creative editor, HTML Motion, HyperFrames, composition, and creative QA tools |

Common aliases still normalize to those category IDs:
`browser`, `desktop`, `team_ops`, `teams`, `agents`, `source_read`, `source_write`, `file_ops`, `files`, `shell`, `commands`, `run_commands`, `memory`, `media`, `schedule`, `scheduling`, `connectors`, `integrations`, `mcp`, and `composites`.

**Core tools (always available without activation):** file read/search, web search/fetch, basic memory, skills, tasks, `schedule_job`, `write_proposal`, model switching, plan/progress tools, `send_telegram`, delivery tools, `connector_list`, `ask_team_coordinator`, `deploy_analysis_team`, `get_creative_mode`, `switch_creative_mode`, `generate_image`, `generate_video`, `background_spawn`, `background_status`, `background_progress`, `background_wait`, and `background_join`.

**Important routing note:** `run_command`, `terminal`, `start_process`, and `process_*` are under `workspace_write` in the current Prometheus gateway runtime. They are not core in the category-gated builder.

### Current Category Inventory

The current live builder maps tools roughly like this:

| Category | Current tools |
|---|---|
| `advanced_memory` | `memory_accept_claim`, `memory_consolidate`, `memory_debug_search`, `memory_embedding_backfill`, `memory_embedding_status`, `memory_get_related`, `memory_graph_snapshot`, `memory_index_refresh`, `memory_provider_status`, `memory_read_record`, `memory_reject_claim`, `memory_review_claims`, `memory_search_project`, `memory_search_timeline`, `memory_supersede_record` |
| `agents_and_teams` | `agent_info`, `agent_list`, `agent_update`, `delete_agent`, `dispatch_team_agent`, `dispatch_to_agent`, `get_agent_result`, `manage_team_context_ref`, `manage_team_goal`, `message_main_agent`, `message_subagent`, `post_to_team_chat`, `reply_to_team`, `request_context`, `request_manager_help`, `request_team_member_turn`, `share_artifact`, `spawn_subagent`, `talk_to_manager`, `talk_to_subagent`, `talk_to_teammate`, `team_manage`, `update_my_status`, `update_team_goal` |
| `automations` | `automation_dashboard`, `schedule_job_detail`, `schedule_job_history`, `schedule_job_log_search`, `schedule_job_outputs`, `schedule_job_patch`, `schedule_job_stuck_control` |
| `browser_automation` | All `browser_*` tools plus `inspect_console`, `run_accessibility_check`, and `save_site_shortcut` |
| `desktop_automation` | All `desktop_*` tools |
| `media_assets` | `analyze_image`, `analyze_video`, `download_media`, `download_url` |
| `media_quality` | `image_check_contrast`, `image_check_text_overflow`, `image_detect_empty_regions`, `image_get_bounds_summary`, `image_get_element_at_point`, `image_get_overlaps`, `video_check_audio_sync`, `video_check_caption_timing`, `video_render_contact_sheet`, `video_render_frame` |
| `prometheus_source_read` | `grep_prom`, `grep_source`, `grep_webui_source`, `list_prom`, `list_source`, `list_webui_source`, `prom_file_stats`, `read_prom_file`, `read_source`, `read_webui_source`, `source_stats`, `src_stats`, `webui_source_stats`, `webui_stats` |
| `prometheus_source_write` | `delete_lines_prom`, `delete_lines_source`, `delete_lines_webui_source`, `delete_prom_file`, `delete_source`, `delete_webui_source`, `find_replace_prom`, `find_replace_source`, `find_replace_webui_source`, `insert_after_prom`, `insert_after_source`, `insert_after_webui_source`, `replace_lines_prom`, `replace_lines_source`, `replace_lines_webui_source`, `write_prom_file`, `write_source`, `write_webui_source` |
| `workspace_write` | Workspace mutation tools, git/test/lint/format helpers, `terminal`, `run_command`, `start_process`, `process_status`, `process_log`, `process_wait`, `process_kill`, `process_submit` |
| `integration_admin` | `integration_quick_setup`, `mcp_server_manage`, `webhook_manage` |
| `social_intelligence` | `social_intel` |
| `proposal_admin` | `edit_proposal` |
| `composite_tools` | `create_composite`, `get_composite`, `edit_composite`, `delete_composite`, `list_composites`, plus saved composite definitions from `.prometheus/composites/` |
| `creative_mode` | `creative_*`, `hyperframes_*`, and creative video QA tools such as `video_analyze_frame`, `video_analyze_timeline`, `video_check_keyframes`, `video_extract_clip_frames`, `video_analyze_imported_video` |
| `external_apps` | Connected extension/connector tools, including `connector_*` and `x_api_*` tools |
| `mcp_server_tools` | Dynamic `mcp__server__tool` functions from connected MCP servers |

---

## File Tools

Read/list/search tools are core. Mutation tools such as `create_file`, `replace_lines`, `insert_after`, `delete_lines`, `find_replace`, and `delete_file` require `workspace_write`.

| Tool | What it does |
|------|-------------|
| `list_files` | List files in a directory (workspace-relative) |
| `read_file` | Read file contents |
| `create_file` | Create or overwrite a file |
| `replace_lines` | Replace specific line range with new content |
| `insert_after` | Insert content after a specific line |
| `delete_lines` | Delete a line range |
| `find_replace` | Find and replace text in a file |
| `delete_file` | Delete a file |
| `mkdir` | Create a directory |
| `list_directory` | List directory contents (detailed) |

## Source Code Tools (reach `src/` — read-only by default)

| Tool | What it does |
|------|-------------|
| `read_source` | Read Prometheus source code files from `src/` |
| `list_source` | List Prometheus source directory contents |
| `grep_source` | Search file contents in `src/` by regex or literal pattern. Returns file:line:content matches (like `rg -n`). Supports `path` (subdirectory), `glob` (file filter), `case_insensitive`, `context` (N lines around match), `max_results`. **Always use this before writing a proposal** to find exactly what to change. |
| `grep_files` | Same as grep_source but searches workspace files instead of `src/`. |

### Source Write Tools — `src/` (proposal execution sessions only)

| Tool | When to use |
|------|-------------|
| `find_replace_source` | **First choice for edits.** Find exact text and replace it. Must match whitespace/newlines exactly — call `read_source` first to confirm. |
| `replace_lines_source` | Replace a line range. Use when the text is whitespace-sensitive or `find_replace_source` can't match uniquely. |
| `insert_after_source` | Insert new lines after line N (use 0 to prepend). Best for adding new functions, imports, or blocks without touching surrounding code. |
| `delete_lines_source` | Delete a line range. Use for removing dead code, old imports, or deprecated blocks. |
| `write_source` | Create or fully overwrite a `src/` file. Use for new files or when the edit is so large a full rewrite is cleaner. |

### Source Write Tools — `web-ui/` (proposal execution sessions only)

| Tool | When to use |
|------|-------------|
| `find_replace_webui_source` | Surgical text-swap in a `web-ui/` file. Call `read_webui_source` first to confirm exact text. |
| `replace_lines_webui_source` | Replace a line range in a `web-ui/` file. |
| `insert_after_webui_source` | Insert new lines after line N in a `web-ui/` file. |
| `delete_lines_webui_source` | Delete a line range from a `web-ui/` file. |
| `write_webui_source` | Create or fully overwrite a `web-ui/` file. |

**Decision guide:** prefer `find_replace_*` for targeted changes → `replace_lines_*` when find can't match uniquely → `insert_after_*` / `delete_lines_*` for structural additions/removals → `write_*` only for new files or full rewrites.

## Terminal / Shell

In Prometheus gateway sessions, command/process tools require `workspace_write`. In current Codex desktop sessions, use `shell_command` from the desktop tool layer.

| Tool | What it does |
|------|-------------|
| `shell_command` | Execute a PowerShell command and return captured output inline. Use for builds, tests, git/status, diagnostics, short scripts, and local inspection. Set `workdir` explicitly when context matters. |
| `read_thread_terminal` | Read the current app terminal output for this desktop thread. Use when a visible/app terminal is already running and you need its latest prompt or output before deciding the next step. |
| `load_workspace_dependencies` | Locate bundled workspace runtime paths for Node.js, Python, and document/PDF helpers. Use when scripts need the managed runtime rather than assuming global binaries. |

Legacy Prometheus runtimes may expose `run_command`; current Codex desktop sessions expose `shell_command` instead.

## Web Tools

| Tool | What it does |
|------|-------------|
| `web_search` | Search the web |
| `web_fetch` | Fetch and parse a URL (no browser needed) |

## Communication Tools

| Tool | What it does |
|------|-------------|
| `send_telegram` | Send message or screenshot to user's Telegram. Works from ANY session. Also links the Telegram↔Session bridge so replies continue this conversation. |
| `save_site_shortcut` | Save a browser site shortcut for quick access |

## Memory Tools

| Tool | What it does |
|------|-------------|
| `memory_browse` | List categories in `USER.md`, `SOUL.md`, or `MEMORY.md` |
| `memory_write` | Write a memory entry to `USER.md`, `SOUL.md`, or `MEMORY.md` under a category (`file`, `category`, `content`) |
| `memory_read` | Read full contents of `USER.md`, `SOUL.md`, or `MEMORY.md` |
| `write_note` | Write timestamped note to today's intraday notes file. Only use during tasks or when something genuinely worth remembering happened. |

## Task & Scheduling Tools

| Tool | What it does |
|------|-------------|
| `task_control` | List, update, pause, resume, complete tasks |
| `schedule_job` | Create, update, delete, list, run cron jobs |
| `declare_plan` | Declare a multi-step plan (shown in UI progress tracker) |

## Background Agent Tools *(core — always available)*

One-shot ephemeral parallel agents with full tool access. No profile files, no persistent identity. Use for work that is **independent** of your primary tool sequence and can start immediately with everything it needs.

### Main agent tools

| Tool | What it does |
|------|-------------|
| `background_spawn` | Spawn an ephemeral background agent. `prompt` required. **Result auto-merged at turn end — never call background_join.** |
| `background_status` | Check state (`queued`, `in_progress`, `completed`, `failed`). Only poll if you need to branch on state mid-turn. |
| `background_progress` | Alias of `background_status`. |
| `background_join` | **Do not call.** System-only — finalization gate runs this automatically. |

### Spawn decision rule — ALL 3 must be true
1. Work is **independent** of your primary tool sequence (no shared dependencies)
2. Can **start right now** with all context embedded in the prompt
3. You **don't need the result** to proceed with your next tool call

If any condition fails → do it inline.

### Prompt must be fully self-contained
The bg agent has **no session history**. Include exact file paths, specific content, which tools to call, and all parameters.

```
BAD:  "Update the note about what we just did"
GOOD: "Call write_note with content='Tested bg agents 2026-03-27. Result: working.' tag='testing'"
```

### How it works
1. `background_spawn(prompt)` → agent starts, your turn continues in parallel
2. Do your primary work
3. Finalization gate **automatically** joins all agents at turn end and merges results into final reply
4. Late completions inject into the reply via WebSocket — no polling needed

### Join policies (set on spawn)
- `wait_until_timeout` *(default, 15s)* — waits up to `timeout_ms` at turn end
- `wait_all` — blocks finalization until agent finishes; use for multi-step bg tasks
- `best_effort_merge` — merges if already done, skips otherwise

### Mid-plan spawning
You can call `background_spawn` during any active `declare_plan` step. The bg agent runs in parallel with your remaining steps and is collected at turn end. Only do this when the side-work doesn't gate any subsequent step.

### Background agent plan tools *(bg agents only — not available to main agent)*

For multi-step bg agent tasks (2+ meaningful phases), bg agents should plan their own work:

| Tool | What it does |
|------|-------------|
| `bg_plan_declare` | Declare step plan (2–8 steps). Isolated from main plan panel. Call at start of complex tasks. |
| `bg_plan_advance` | Mark current step done, advance to next. Returns next step or confirms completion. |

### Parallel work pattern (like Claude Code's parallel subagents)
```
User: "Refactor module X and update the docs for it"

Spawn: background_spawn("Read D:/Prometheus/src/X.ts [paste content].
        Refactor foo() to use async/await using replace_lines.
        Exact lines to change: [lines N-M]. New content: [exact new code].")

Primary: update the docs directly

Gate: merges both outcomes into one reply
```

## Agent & Team Tools

| Tool | What it does |
|------|-------------|
| `spawn_subagent` | Create/spawn a subagent with optional create_if_missing config |
| `agent_list` | List all configured agents with IDs and descriptions |
| `agent_info` | Get full details on a specific agent by ID |
| `delete_agent` | Remove an agent from config |
| `team_manage` | Create, update, delete, list, pause, resume teams. Also: `run_round` (collaborative planning→execution→sync→review cycle) and `run_session` (multi-round until done). |
| `talk_to_subagent` | Send a message to a running subagent (legacy dispatch model) |
| `talk_to_manager` | Send a message to a team manager (legacy dispatch model) |
| `dispatch_to_agent` | Dispatch a one-off task to a specific agent |
| `update_heartbeat` | Update an agent's heartbeat instructions |

## Team Communication Tools (for subagents)

| Tool | What it does |
|------|-------------|
| `post_to_team_chat` | Post a message to the shared team channel mid-task. Visible in the Teams UI. |
| `dispatch_team_agent` | Dispatch another agent on the team. `background=false` blocks until done; `background=true` returns a `task_id` immediately. |
| `get_agent_result` | Collect the result of a background agent dispatch by `task_id`. `block=false` for a status check. |
| `talk_to_teammate` | Legacy round-based: send a message to a teammate. |
| `update_my_status` | Legacy round-based: update status on the team board. |
| `update_team_goal` | Legacy round-based: propose or update a team goal. |

## Browser Tools

| Tool | What it does |
|------|-------------|
| `browser_open` | Open a URL in the automation browser. **Auto-captures a vision screenshot** after page load and injects it for vision-capable models — AI sees both DOM elements and visual rendering in one call. |
| `browser_snapshot` | Screenshot + interactive element refs |
| `browser_click` | Click an element by ref number |
| `browser_fill` | Fill a form field |
| `browser_press_key` | Press a keyboard key |
| `browser_wait` | Wait N milliseconds |
| `browser_scroll` | Scroll page up or down |
| `browser_scroll_collect` | Scroll multiple times and collect all text — single-call scraping for infinite-scroll pages |
| `browser_close` | Close browser session |
| `browser_get_focused_item` | Get the currently focused element |
| `browser_get_page_text` | Extract full page text content including iframes |
| `browser_vision_screenshot` | Viewport PNG for sparse-DOM / vision mode |
| `browser_vision_click` | Click at pixel (x,y) from screenshot coordinates |
| `browser_vision_type` | Click-focus at (x,y) then type |
| `browser_send_to_telegram` | Send viewport screenshot to Telegram |
| **`browser_run_js`** | **Execute arbitrary JS in the page context.** Top-level `await` works. Returns JSON-serialized result. Use to read React/Vue state, trigger events, inspect hidden vars, call browser APIs. Example: `return window.__STORE__.getState()` |
| **`browser_intercept_network`** | **Hook into Playwright network layer** — capture XHR/fetch responses. `action="start"` to begin; `action="read"` to inspect; `action="stop"` to disable. Optional `url_filter` to narrow to specific endpoints. JSON/text bodies captured. |
| **`browser_element_watch`** | **Wait for a DOM element to appear/disappear/contain text** — no polling snapshots. Uses native `waitForSelector`. Much cheaper than repeated `browser_wait + browser_snapshot` loops. |
| **`browser_snapshot_delta`** | **Return only what changed** since the last snapshot. Shows added/removed elements and URL/title changes. 60–80% token reduction on SPAs. Prefer over `browser_snapshot` when you already have a snapshot in context. |
| **`browser_extract_structured`** | **Extract structured JSON from page** using a CSS schema. Define `container_selector` + `fields` (each with CSS selector + extraction type). Returns typed array. One call instead of parsing page text manually. |

**Real Chrome profile reuse:** Set `CHROME_USE_REAL_PROFILE=true` in `.prometheus/config.json` env to connect to your actual Chrome profile (`AppData/Local/Google/Chrome/User Data`). Reuses existing logins. Chrome must be fully closed first.

## Desktop Tools

| Tool | What it does |
|------|-------------|
| `desktop_screenshot` | Screenshot the entire desktop. `region=[x1,y1,x2,y2]` crops to a specific area at full resolution. `monitor_index=N` for single display. |
| `desktop_find_window` | Find a window by process name |
| `desktop_focus_window` | Focus a window by process name. `screenshot=true` captures a screenshot immediately after. |
| `desktop_click` | Click at x,y coordinates. `modifier=shift/ctrl/alt`, `verify=true` to auto-screenshot after. |
| `desktop_drag` | Drag from one point to another |
| `desktop_type` | Type text via clipboard paste |
| `desktop_type_raw` | Type raw keystrokes (for apps that block paste) |
| `desktop_press_key` | Press a key combination |
| `desktop_wait` | Wait N ms |
| `desktop_scroll` | Scroll at a position |
| `desktop_get_clipboard` | Read clipboard |
| `desktop_set_clipboard` | Write to clipboard |
| `desktop_launch_app` | Launch an application |
| `desktop_close_app` | Close an application |
| `desktop_get_process_list` | List running processes |
| `desktop_wait_for_change` | Poll until screen content changes |
| `desktop_diff_screenshot` | Compare last two screenshots for differences |
| `desktop_get_window_text` | Extract readable text from a window via UI Automation (more reliable than OCR) |
| `desktop_send_to_telegram` | Send desktop screenshot to Telegram |
| **`desktop_get_accessibility_tree`** | **Full Windows UI Automation tree** — roles, names, enabled/focused states, bounding boxes for every control. Far richer than `desktop_get_window_text`. Use to find controls by role/name or check disabled states. `max_depth` and `max_nodes` control output size. |
| **`desktop_pixel_watch`** | **Wait for a pixel color to change** at virtual-screen (x,y). Uses 1×1 pixel sampling — 100× cheaper than full screenshots. Optionally specify a `target_color` hex to wait FOR; otherwise waits for ANY change. |
| **`desktop_record_macro`** | **Start recording a desktop macro.** All subsequent `desktop_click`, `desktop_type`, `desktop_press_key`, `desktop_scroll` calls are logged with timing. Call `desktop_stop_macro` when done. |
| **`desktop_stop_macro`** | Stop recording and save the macro by name. |
| **`desktop_replay_macro`** | **Replay a saved macro.** `speed_multiplier` controls playback speed (default 1.0). |
| **`desktop_list_macros`** | List all saved macros and their action counts. |

## Skills Tools

| Tool | What it does |
|------|-------------|
| `skill_list` | List installed skills (34+ available) |
| `skill_read` | Read a skill's playbook content |
| `skill_create` | Create a new skill |

## CIS Intelligence Tools

| Tool | What it does |
|------|-------------|
| `deploy_analysis_team` | Deploy a one-shot 5-agent website intelligence team (SEO, Performance, GEO, Backlinks, Content). Pass a URL, get a full audit report delivered to main chat. Team self-deletes after delivery. |
| `social_intel` | Analyze a social media profile. Pass platform (instagram/tiktok/x/linkedin/facebook) + handle. Returns engagement metrics, growth analysis, content recommendations. Persisted to `entities/social/[platform].md`. |

## CIS Entity Tools *(Block B — coming soon)*

These tools let agents read and write structured business knowledge during a session. Until they're built, use `read_file` / `create_file` directly on `workspace/entities/`.

| Tool | What it does |
|------|-------------|
| `read_entity(type, id)` | Read a business entity file — e.g. `read_entity("client", "acme-corp")` reads `entities/clients/acme-corp.md` |
| `write_entity(type, id, content)` | Create or update an entity file. Use for clients, projects, vendors, contacts, social profiles. |
| `list_entities(type?)` | List all entity files. Pass a type to filter: `list_entities("project")` → all project files. |

**Entity types:** `client`, `project`, `vendor`, `contact`, `social`
**Naming:** lowercase hyphenated slug — "Acme Corp" → `acme-corp`
**Templates:** Each folder has `_template.md` — use it as the starting structure for new entities.

## Integration Tools

| Tool | What it does |
|------|-------------|
| `mcp_server_manage` | Add, remove, list MCP servers |
| `webhook_manage` | Create, list, delete webhooks |
| `integration_quick_setup` | Quick-setup an integration by name |

## Self-Maintenance & Lifecycle Tools

| Tool | What it does |
|------|-------------|
| `write_proposal` | Submit a code change proposal for human approval |
| `gateway_restart` | Build TypeScript + gracefully restart the gateway. Use after applying src changes. Writes restart context so the next boot knows what changed. |

---

## Decision Table — Which Tool to Use

| What you need | Use this |
|---|---|
| Read a website, GitHub, Reddit, docs | `web_search` + `web_fetch` |
| Log into a site or interact with a web form | `browser_open` + `browser_click/fill` (vision mode: `browser_vision_screenshot` + `browser_vision_click` / `browser_vision_type` — primary model drives all steps) |
| Read or create local files | `read_file` / `create_file` / `find_replace` / `replace_lines` |
| Run a command or script | `request_tool_category("workspace_write")`, then `terminal` or `run_command`; in Codex desktop use `shell_command` |
| Interact with a desktop app | `request_tool_category("desktop_automation")`, then `desktop_screenshot` + `desktop_click/type` |
| Remember something permanently | `memory_write` |
| Update persona/user model | `memory_write` or edit USER.md/SOUL.md directly |
| Search what you already know | `memory_browse` or read the persona files |
| Temporary note during a task | `write_note` |
| Send user a message on Telegram | `send_telegram` (also bridges session) |
| Send user a screenshot on Telegram | `desktop_screenshot` then `send_telegram({ screenshot: true })` |
| Create or manage a task | `task_control` |
| Run side work in parallel with main response | `background_spawn` → do primary work → finalization gate merges automatically |
| Schedule a recurring job | `schedule_job` |
| Create or message a standalone subagent | `request_tool_category("agents_and_teams")`, then `spawn_subagent` / `message_subagent` |
| Create a team | `team_manage({ action: "create" })` (agents must exist first) |
| Run a collaborative round | `team_manage({ action: "run_round", team_id, objective })` |
| Run a full collaborative session | `team_manage({ action: "run_session", team_id, objective, max_rounds })` |
| Build + restart gateway | `gateway_restart({ reason, title, affected_files })` |
| Read your own source code | `read_source` / `list_source` |
| Search source code for a function/pattern/symbol | `grep_source({pattern, path?, glob?})` |
| Search workspace files for a pattern | `grep_files({pattern, path?, glob?})` |
| Edit `src/` files (proposal session) | `find_replace_source` (surgical) → `replace_lines_source` (line range) → `insert_after_source` / `delete_lines_source` (add/remove blocks) → `write_source` (new file or full rewrite) |
| Edit `web-ui/` files (proposal session) | Same pattern: `find_replace_webui_source` → `replace_lines_webui_source` → `insert_after_webui_source` / `delete_lines_webui_source` → `write_webui_source` |
| Propose a src change (non-proposal session) | `write_proposal` |
| Add an MCP integration | `mcp_server_manage` or `integration_quick_setup` |
| Audit a website (SEO, performance, GEO) | `deploy_analysis_team({ url })` |
| Analyze a social media profile | `social_intel({ platform, handle })` |
| Read a client/project/vendor record | `read_entity(type, id)` *(Block B — use `read_file` for now)* |
| Update a client/project/vendor record | `write_entity(type, id, content)` *(Block B — use `create_file` for now)* |
| Check business context | `read_file("BUSINESS.md")` for a one-off read, or `business_context_mode({ action: "enable" })` to auto-inject it for the rest of the session |

---

## Critical Rules

**NEVER use `run_command` to open a browser.** Use `browser_open(url)` instead.

**Desktop focus:** Use short process name — `"msedge"`, `"chrome"`, `"code"` — never the full window title. Fail twice → stop and report, do not loop.

**Line-based edits:** Use `replace_lines` for existing files — more reliable than find/replace for whitespace-sensitive content.

**Telegram bridge:** When you call `send_telegram`, the session bridge is automatically updated. The user's Telegram replies will route through your current session and see the full conversation history.

**Terminal commands are captured by default.** In current Codex desktop sessions, use `shell_command`; output returns inline and no visible window opens unless you deliberately start a background/visible process. In older Prometheus runtimes, the equivalent guidance is `run_command` with captured output by default and `visible: true` only when the user needs to see the terminal.

**gateway_restart is the LAST thing you call.** It kills the current process. Apply all code changes first, then call `gateway_restart` as your final action.

**Reddit:** Always `web_search` with `site:reddit.com "keyword"` then `web_fetch` individual post URLs. Never use the browser for Reddit.

---

## When TOOLS.md is Injected

TOOLS.md is **not** always injected (saves context tokens). It is referenced when:
- You make 3+ consecutive tool failures
- You explicitly ask "what tools do I have"
- System detects tool uncertainty in reasoning

Otherwise, you should know your tools without being reminded.

---

*Last updated: 2026-05-20*
