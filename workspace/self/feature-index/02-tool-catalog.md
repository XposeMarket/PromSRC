# Prometheus Tool Catalog

Last source verification: 2026-07-22. Canonical category ownership: `src/runtime/tool-category-manifest.ts`.

## How the tool system works

The model starts with a core tool surface and can request a targeted category with `request_tool_category`. The gateway builds the active surface from core tools, canonical category tools, configured connector tools, MCP tools, and saved composites. A category is an authorization/documentation grouping, not a promise that every tool in it is active in every turn.

The exact tool schema is authoritative for parameters. This catalog is the complete documentation map: it names every canonical category, the operation families each carries, and the current tool names that define those families.

## Static schema registry coverage

The current gateway builder assembles static schemas from four source modules: `file-web-memory.ts` (**135** names), `agent-team-schedule.ts` (**56**), `cis-system.ts` (**77**), and `creative-tools.ts` (**162**)—**430 static schema names** before dynamic connector/MCP/composite definitions and public-build filtering. The category table below accounts for this product-facing surface by operation family. Use those files for the exact parameter contract, and use the category manifest for ownership/activation; neither hardcodes a promise that a dynamic integration tool is installed.

For an exact, copy-ready list of every one of those 430 names, use [08-static-tool-schema-inventory.md](08-static-tool-schema-inventory.md). The fifth definition module, `xai-tools.ts`, is currently present but contributes no static schema names through this scan.

For the source-derived one-line capability description of each static schema, use [11-static-tool-capability-index.md](11-static-tool-capability-index.md). This lets a document author move from a broad category to a concrete tool without reconstructing intent from the implementation.

## Always-on or core operation families

| Family | Current tools/capability |
|---|---|
| Tool/menu control | `request_tool_category`, tool-loop continuation and result reading |
| Web information | `web_search`, `web_search_single`, `web_search_multi`, `web_fetch`, `web_fetch_batch` |
| Media generation | `generate_image`, `generate_video`, `media_generate` (provider-dependent) |
| Skills discovery/use | `skill_list`, `skill_read`, `skill_resource_list`, `skill_resource_read` |
| Agent handoff/delivery | `spawn_subagent`, `message_subagent`, `chat_with_subagent`, `delivery_send`, `delivery_send_screenshot` |
| Scheduling/continuation | `schedule_job`, `timer`, `internal_watch`, `update_heartbeat` |
| Rich outputs | chart/comparison/map/weather/market/product-carousel and artifact presentation tools where a response requests them |

The always-assembled delivery, process, terminal, Telegram, X/Vercel wrapper, and optional Agent Builder workflow tools are indexed in [15-gateway-core-and-agent-builder-tools.md](15-gateway-core-and-agent-builder-tools.md). They are part of gateway assembly rather than category-factory files, which is why they have a separate reference.

## Canonical 23 on-demand categories

| Category | User-facing purpose | Principal operations / tool names |
|---|---|---|
| `browser_automation` | Operate and inspect a browser session | `browser_session`, `browser_open`, `browser_observe`, `browser_act`, `browser_click`, `browser_fill`, `browser_type`, `browser_press_key`, `browser_key`, `browser_drag`, `browser_scroll`, `browser_scroll_collect`, `browser_upload_file`, `browser_wait`, `browser_snapshot`, `browser_snapshot_delta`, `browser_vision_screenshot`, `browser_vision_click`, `browser_vision_type`, `browser_get_page_text`, `browser_get_focused_item`, `browser_extract`, `browser_extract_structured`, `browser_run_js`, tabs/network/watch/teach/smoke helpers |
| `desktop_automation` | Observe/control Windows applications and the desktop | `desktop_screen`, `desktop_screenshot`, `desktop_doctor`, monitor/window/app/process listing, focus/launch/close, click/type/drag/scroll/key, screenshot diff/change wait, clipboard, OCR/text/accessibility, window-scoped actions, pixel watch, macros, and `desktop_background_*` sandbox controls |
| `agents_and_teams` | Manage agents, chats, runs, teams, context, and dispatch | `agent_ops`, `agent_chat_ops`, `agent_run_ops`, `team_ops_wrapper`, `team_collab_ops`, `team_manage`, `dispatch_to_agent`, `dispatch_team_agent`, `request_team_member_turn`, `talk_to_*`, `message_*`, `share_artifact`, goal/context controls, `deploy_analysis_team` |
| `prometheus_source_read` | Read Prometheus implementation safely | `dev_source_read`, `read_dev_sources`, `read_source`, `list_source`, `grep_source`, `source_stats`, web-UI and root-Prometheus equivalents |
| `prometheus_source_write` | Make approved Prometheus source edits | `dev_source_edit`, `apply_dev_source_patchset`, `prom_apply_dev_changes`, source/web-UI/root find-replace, line insertion/deletion, write/delete operations |
| `workspace_write` | Work in the user workspace and run development operations | `workspace_read/edit/run/git/safety/code_nav`, file/tree/read/search/batch/patch operations, create/move/copy/rename/delete, validation/diff/rollback, Git, test/lint/format/typecheck, process/server control, snapshots, scans, symbols/references |
| `advanced_memory` | Search, inspect, maintain, and govern durable memory | `memory_browse`, `memory_read_record`, project/timeline search, related records, graph snapshot, index/provider/embedding status and backfill, debug search, consolidate/review/accept/reject/supersede claims |
| `media_assets` | Download and analyze externally sourced media | `download_url`, `download_media`, `analyze_image`, `analyze_video` |
| `automations` | Inspect and control schedules, task runs, watches, and managed-thread operations | `schedule_job_detail/history/log_search/outputs/patch/stuck_control`, `task_control`, `run_task_now`, `automation_dashboard`, `prometheus_request_ops`, `prometheus_audit_ops` |
| `external_apps` | Use configured app wrappers and provider-connected systems | `connector_*` tools, `x_search_ops`, `x_posts`, `x_users`, `x_lists`, `x_dm`, `x_admin`, `vercel_ops`, `x_api_*` |
| `integration_admin` | Administer integrations | `connection_ops`, `mcp_server_manage`, `webhook_manage`, `integration_quick_setup` |
| `social_intelligence` | Analyze social profiles/opportunities | `social_intel` |
| `proposal_admin` | Edit an outstanding proposal before approval | `edit_proposal` |
| `mcp_server_tools` | Call tools exposed by a connected MCP server | Dynamic `mcp__<server>__<tool>` functions; connector-dependent |
| `composite_tools` | Save/reuse higher-level multi-step tools | `create_composite`, `get_composite`, `edit_composite`, `delete_composite`, `list_composites` |
| `creative_basic` | Start and manage basic creative editing | `get_creative_mode`, `switch_creative_mode`, `creative_project`, `creative_scene` |
| `creative_image` | Work with visual assets, layers, scenes, and image generation | `creative_image_ops` plus asset/layer/image-generation operations such as import/search/add/fit/select/update/delete, masks, blend/style/brand-kit, image shot generation and extraction |
| `creative_video` | Create/edit video, audio, captions, compositions, and sequences | `creative_video_ops` plus storyboard, shot, sequence, composition/timeline, audio, captions/transcription, stitch/trim/render/export, continuity and motion-template operations |
| `creative_hyperframes` | Author HTML motion/HyperFrames composition work | `creative_hyperframes_ops`, `hyperframes_browse_catalog/insert_clip/apply_patch/set_* /add_animation/lint/qa/materialize/export`, component and HTML-motion template/block lifecycle tools |
| `creative_quality` | Validate creative output and choose/retry better takes | `creative_quality_ops`, image contrast/text/bounds/overlap checks; video frame/contact-sheet/audio/caption/keyframe/timeline checks; layout/composition/preflight/frame-diff/shot-comparison/retry/lint/text-fit reports |
| `skills` | Author, package, inspect, and maintain skills | `skill_ops`, `skill_create`, bundle import/export, update-from-source, manifest/resource write/delete, inspect, audits and metadata repair |
| `model_management` | Manage per-agent model routes and templates | `get_agent_models`, `set_agent_model`, model-template list/save/update/apply/select/delete |
| `business` | Manage structured business entities and event history | `list_entities`, `read_entity`, `write_entity`, `append_entity_event` |

Exact source-derived descriptions for each browser and desktop schema are in [13-browser-and-desktop-tool-index.md](13-browser-and-desktop-tool-index.md). These are conditional capabilities: browser actions require the chosen browser lane/session, and desktop actions require the applicable native Windows path or the background Sandbox bridge.

## Connector and integration capability families

The source includes typed wrappers for Google Drive, Gmail, GitHub, Google Analytics, HubSpot, Notion, Obsidian, Reddit, Salesforce, Slack, Stripe, Vercel, and X/Twitter, plus a generic connection/MCP layer. Common verbs are discover/list/search/read; write/send/create operations exist only where that connector exposes them—for example Gmail preparation/send, Slack send, GitHub issue/repository creation, Notion page creation, HubSpot/Salesforce record creation, Reddit submission, and Vercel redeploy/environment operations.

These are **configured** capabilities. A product document should name supported connection families, then say “when connected,” rather than claim that every tenant, OAuth scope, or endpoint is present by default.

The exact current bundled connector surface is documented tool by tool in [12-bundled-connector-tool-index.md](12-bundled-connector-tool-index.md): 56 dynamic tools across GA4, GitHub, Gmail, Google Drive, HubSpot, Notion, Obsidian, Reddit, Salesforce, Slack, Stripe, and Vercel. Connector directories for other social connection families may supply setup/runtime behavior without a current static `connector_*` model-tool schema.

## Voice tool family

The voice runtime has dedicated wrappers rather than presenting raw desktop/browser power indiscriminately. Current names include `voice_browser_*`, `voice_desktop_*`, `voice_web_search`, `voice_web_fetch`, `voice_generate_image`, `voice_generate_video`, `voice_memory_search`, `voice_timer`, `voice_write_note`, quiet/wake controls, screenshot delivery, and voice workgroup/automation status paths. Voice availability requires compatible browser/device/provider configuration.

## Important boundaries

- Browser/desktop tools can be unavailable without their session/native host and may be approval-sensitive.
- MCP and connectors appear only after configuration; their runtime names are dynamic.
- Creative generation/rendering depends on configured media providers, assets, and local render prerequisites.
- Source writes are a distinct, approval-aware Prometheus code lane; they are not a synonym for arbitrary workspace edits.
- Skills and composites are reusable assets, but creation/import/update can be proposal- or approval-governed.

For policy and tool assembly details, see `../05-tools.md`, `../07-source-editing.md`, `../10-mcp-and-connections.md`, and `../creative/`.
