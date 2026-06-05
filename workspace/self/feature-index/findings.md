# Prometheus Feature Index Findings

Last reviewed: 2026-06-04

Scope scanned:

- `workspace/self/*.md`
- `workspace/self/creative/*.md`
- `src/tools`
- `src/gateway/tools/defs`
- `src/gateway/routes`
- `src/config`
- `src/cli`
- `web-ui/src/api.js`
- `web-ui/src/pages`
- `web-ui/src/mobile`
- `web-ui/src/onboarding`
- `docs/TELEGRAM_PERSONA_BOTS.md`
- `docs/BACKGROUND_DESKTOP_AUTOMATION.md`
- `docs/PROMETHEUS_HTML_MOTION_SPEC.md`

This is a feature-level inventory. It intentionally groups capabilities by what Prometheus can do, not by where the source files live.

See also: `deep-cuts.md` for a second-pass inventory of in-app browser, side chats, background spawn agents, composite tools, interactive chat visuals, browser teach mode, heartbeat, scheduled jobs, computer use, Brain/Thought/Dream, and skill gardener/curator features.

## 1. Core Assistant And Chat Runtime

Prometheus is a persistent local AI workspace assistant with a gateway-backed chat runtime, streaming events, tool execution, memory, and multiple client surfaces.

Findings to index:

- Main chat surface in desktop Web UI.
- Cross-channel chat sessions for desktop, Telegram, mobile, CLI, Discord, WhatsApp, and terminal-style channels.
- Live token/tool/result streaming through WebSocket events such as `main_chat_stream_event`.
- Session list and channel switching.
- Channel-origin labels and live toasts for non-desktop activity.
- Prompt queueing.
- Main goal strip and progress/checklist rendering.
- Inline tool/process log rendering.
- Assistant-generated image display.
- File pills and attachments.
- Artifact rendering.
- Approval cards embedded in chat.
- Voice preview sessions.
- Browser canvas surface inside chat.
- Creative workspace embedded in chat.
- Session IDs encode channels, including `telegram_<userId>_<chatId>` and `mobile_*`.

Primary places:

- `src/gateway/routes/chat.router.ts`
- `web-ui/src/pages/ChatPage.js`
- `web-ui/src/ws.js`
- `workspace/self/03-execution-and-prompting.md`
- `workspace/self/17-desktop-web-ui.md`

## 2. Desktop Web UI

Prometheus has a desktop-first web control surface with multiple operational pages.

Pages and major surfaces found:

- Chat
- Hub
- Memory
- Audit
- Projects
- Proposals
- Schedule
- Settings
- Connections
- Tasks
- Teams
- Subagents

Desktop UI features to index:

- Main chat console.
- Sidebar session list.
- Channels panel.
- Process run cards.
- Inline approvals.
- Proposal approval/rejection flows.
- Background task controls.
- Team room controls.
- Subagent management.
- Memory graph and memory record views.
- Audit log browser.
- Project and canvas file browsing.
- Settings panels for providers, models, search, paths, heartbeat, hooks, security, approvals, command permissions, and credentials.
- Connections catalog and auth setup flows.
- Skills management UI.
- Installed app lookup and aliases.
- Canvas/project preview links.
- Creative mode workspace and render status.

Primary places:

- `web-ui/src/pages/*.js`
- `web-ui/src/api.js`
- `web-ui/src/styles/*.css`
- `workspace/self/17-desktop-web-ui.md`

## 3. Mobile And Pairing

Prometheus has a mobile web/PWA-style shell with paired-device token handling.

Mobile surfaces found:

- Chat tab
- Voice tab
- Tasks tab
- Creative tab
- Schedule drawer item
- Teams drawer item
- Subagents drawer item
- Proposals drawer item
- More drawer item

Mobile features to index:

- Mobile-specific API wrapper that attaches paired-device tokens.
- Mobile chat stream catch-up from desktop chat page.
- Mobile voice debug endpoint.
- Mock/first-pass mobile data for schedules, tasks, teams, and activity.
- Pairing-aware auth headers for `/api/*`.
- Mobile route shell and mobile settings.

Primary places:

- `web-ui/src/mobile/mobile-shell.js`
- `web-ui/src/mobile/mobile-router.js`
- `web-ui/src/mobile/mobile-pages.js`
- `web-ui/src/mobile/mobile-api.js`
- `web-ui/src/mobile/mobile-settings.js`
- `web-ui/src/mobile/mobile-data.js`
- `src/gateway/server-v2.ts`
- `workspace/self/16-mobile-app.md`

## 4. Onboarding System

Prometheus includes an onboarding flow for first-run setup, migration, model setup, and memory seeding.

Features to index:

- Tutorial overlay.
- Meet panel.
- Redo onboarding.
- Migration source selection.
- Migration preview.
- Import selected migration data.
- Model picker that opens Settings -> Models.
- Model health polling through onboarding endpoints.
- Memory confirmation step.
- Dry-run memory seed preview.
- Selective memory save into `USER.md`, `BUSINESS.md`, `TOOLS.md`, and `MEMORY.md`.
- Skip flows.
- Dev test mode for memory save.

Primary places:

- `web-ui/src/onboarding/*.js`
- `src/gateway/routes/onboarding.router.ts`
- `workspace/self/19-onboarding-system.md`

## 5. Long-Term Memory

Prometheus has file-backed and indexed long-term memory with operational and evidence layers.

Memory roots and files:

- `workspace/USER.md`
- `workspace/BUSINESS.md`
- `workspace/TOOLS.md`
- `workspace/MEMORY.md`
- `workspace/SOUL.md`
- `workspace/VOICEAGENT.md`
- `workspace/memory`
- `workspace/audit`

Memory features to index:

- Manual memory read/write/browse tools.
- Category-based memory writes.
- Hybrid memory search.
- SQLite/FTS/vector retrieval when available.
- JSON index fallback.
- Operational memory records for decisions, preferences, proposals, task outcomes, and project facts.
- Evidence records from chat sessions, transcripts, compactions, task state, proposal state, memory roots, Obsidian notes, and project state.
- Record reads by `record_id`.
- Project-scoped memory search.
- Timeline memory search.
- Related-record expansion.
- Graph snapshot for UI.
- Index refresh.
- Provider status.
- Embedding provider status.
- Embedding backfill.
- Debug search with ranking diagnostics.
- Memory consolidation from recent evidence.
- Proposed/accepted/rejected/superseded memory claim review.
- Claim acceptance workflow.
- Schedule memory updates.
- Onboarding memory confirmation.

Agent tools found:

- `memory_write`
- `memory_read`
- `memory_browse`
- `memory_search`
- `memory_read_record`
- `memory_search_project`
- `memory_search_timeline`
- `memory_get_related`
- `memory_graph_snapshot`
- `memory_index_refresh`
- `memory_provider_status`
- `memory_embedding_status`
- `memory_embedding_backfill`
- `memory_debug_search`
- `memory_consolidate`
- `memory_review_claims`
- `memory_accept_claim`
- `update_schedule_memory`

Primary places:

- `src/gateway/tools/defs/file-web-memory.ts`
- `src/tools/memory-utils.ts`
- `src/tools/schedule-memory-tool.ts`
- `web-ui/src/pages/MemoryPage.js`
- `workspace/self/13-memory.md`

## 6. Subagents

Prometheus can create and manage subagents with their own identities, workspaces, statuses, and messaging.

Features to index:

- Spawn subagent.
- List agents.
- View agent info.
- Update agent metadata.
- Delete agent.
- Talk to subagent.
- Message subagent.
- Request context from manager.
- Request manager help.
- Talk to teammate.
- Share artifacts.
- Update own status.
- Agent identity generation.
- Voice guidance in generated identities.
- Agent-specific model defaults.
- Agent model templates.
- Subagent runtime workspaces.
- Allowed work paths and default execution workspace.
- Agent history.

Tools found:

- `spawn_subagent`
- `agent_list`
- `agent_info`
- `agent_update`
- `delete_agent`
- `talk_to_subagent`
- `message_subagent`
- `request_context`
- `request_manager_help`
- `talk_to_teammate`
- `share_artifact`
- `update_my_status`
- `dispatch_to_agent`
- `run_task_now`

Primary places:

- `src/gateway/tools/defs/agent-team-schedule.ts`
- `src/tools/agent-control.ts`
- `src/agents/spawner.ts`
- `src/agents/identity-generator.ts`
- `web-ui/src/pages/SubagentsPage.js`
- `workspace/self/08-tasks-and-agents.md`

## 7. Teams And Team Rooms

Prometheus supports multi-agent teams with a manager, shared chat, context references, workspace files, dispatch, runs, and Telegram room bridging.

Features to index:

- Create/update/delete teams.
- Pause/resume teams.
- Start team.
- Run all agents.
- Manager trigger.
- Dispatch work to a team.
- Team chat.
- Streaming team chat.
- Team room state.
- Team event streams.
- Team run history.
- Team workspace files.
- Record workspace reads.
- Context references.
- Context files.
- Suggested teams and dismissals.
- Apply/reject team changes.
- Team goals.
- Team context ref management.
- Team coordinator tools.
- Main-agent/team messaging.
- Telegram team-room binding.
- Team-room persona identity use.

Tools found:

- `talk_to_manager`
- `get_team_logs`
- `manage_team_goal`
- `manage_team_context_ref`
- `team_manage`
- `update_team_goal`
- `ask_team_coordinator`
- `deploy_analysis_team`
- `present_file`
- `dispatch_team_agent`
- `request_team_member_turn`
- `get_agent_result`
- `post_to_team_chat`
- `message_main_agent`
- `reply_to_team`

Primary places:

- `src/gateway/routes/teams.router.ts`
- `src/gateway/tools/defs/cis-system.ts`
- `src/gateway/tools/defs/agent-team-schedule.ts`
- `src/tools/team-tools.ts`
- `web-ui/src/pages/TeamsPage.js`
- `docs/TELEGRAM_PERSONA_BOTS.md`

## 8. Tasks, Background Work, Schedules, And Automation

Prometheus supports task lists, background agents, scheduled jobs, heartbeat agents, stuck-job controls, and automation dashboards.

Features to index:

- CRUD task list.
- Reorder tasks.
- Run task.
- Task config.
- Heartbeat settings.
- Heartbeat agent list/detail/update.
- Manual heartbeat tick.
- Background task list/detail.
- Background task evidence.
- Background task pause/resume/restart/delete.
- Background task message.
- Background task stream.
- Background task join.
- Background progress/status endpoints.
- Skill proposal from background task.
- Error response from background task.
- Schedules CRUD.
- Schedule parse.
- Schedule manual run.
- Schedule memory.
- Schedule run logs.
- Schedule job history/detail/log search/patch/outputs/stuck control.
- Automation dashboard.
- Background spawn/wait/status/progress/join.
- Background plan declaration and advancement.
- Agent plan declaration and step completion aliases.

Tools found:

- `task_control`
- `schedule_job`
- `schedule_job_history`
- `schedule_job_detail`
- `schedule_job_log_search`
- `schedule_job_patch`
- `schedule_job_outputs`
- `schedule_job_stuck_control`
- `automation_dashboard`
- `background_spawn`
- `background_wait`
- `background_status`
- `background_progress`
- `background_join`
- `bg_plan_declare`
- `bg_plan_advance`
- `declare_plan`
- `complete_plan_step`
- `step_complete`
- `update_heartbeat`
- `timer`
- `internal_watch`

Primary places:

- `src/gateway/routes/tasks.router.ts`
- `src/gateway/routes/teams.router.ts`
- `src/gateway/tools/defs/agent-team-schedule.ts`
- `src/tools/task-control.ts`
- `src/scheduler.ts`
- `web-ui/src/pages/TasksPage.js`
- `web-ui/src/pages/SchedulePage.js`

## 9. Approvals, Proposals, And Safety Gates

Prometheus has explicit approval and proposal systems for risky or final actions.

Features to index:

- Pending/all approvals API.
- Approve/deny approval.
- Approve once.
- Trust this session.
- Always allow.
- Command permission persistence.
- Remove command permissions.
- Inline chat approval cards.
- Session approval cards.
- Process-run terminal opening from approvals.
- Proposal list.
- Proposal approve/deny/archive flows.
- Edit proposal.
- Write proposal.
- Request final action approval.
- Request dev source edit.
- Update dev source edit.
- Await dev source edit approval.
- Apply Prometheus dev changes.
- Dev-source edit workflow.
- Error-response approval and retry flow.
- Verification-flow error response.

Tools found:

- `edit_proposal`
- `write_proposal`
- `request_final_action_approval`
- `request_dev_source_edit`
- `update_dev_source_edit`
- `await_dev_source_edit_approval`
- `prom_apply_dev_changes`

Primary places:

- `src/gateway/routes/settings.router.ts`
- `src/gateway/routes/proposals.router.ts`
- `src/gateway/errors/error-response-endpoint-integrated.ts`
- `web-ui/src/pages/ProposalsPage.js`
- `web-ui/src/pages/ChatPage.js`

## 10. Source Editing And Developer Workflow

Prometheus can inspect, edit, patch, test, format, run, and publish code, with separate tool surfaces for workspace files, source files, Web UI source, Prometheus files, and dev-source protected paths.

File/source tools found:

- `list_files`
- `read_file`
- `file_stats`
- `grep_file`
- `search_files`
- `create_file`
- `replace_lines`
- `insert_after`
- `delete_lines`
- `find_replace`
- `delete_file`
- `write_file`
- `rename_file`
- `mkdir`
- `list_directory`
- `grep_files`
- `copy_file`
- `move_file`
- `copy_directory`
- `move_directory`
- `path_exists`
- `read_source`
- `read_dev_sources`
- `list_source`
- `source_stats`
- `src_stats`
- `grep_source`
- `find_replace_source`
- `apply_dev_source_patchset`
- `replace_lines_source`
- `insert_after_source`
- `delete_lines_source`
- `write_source`
- `delete_source`
- `list_webui_source`
- `webui_source_stats`
- `webui_stats`
- `read_webui_source`
- `grep_webui_source`
- `find_replace_webui_source`
- `replace_lines_webui_source`
- `insert_after_webui_source`
- `delete_lines_webui_source`
- `write_webui_source`
- `delete_webui_source`
- `list_prom`
- `prom_file_stats`
- `read_prom_file`
- `grep_prom`
- `find_replace_prom`
- `replace_lines_prom`
- `insert_after_prom`
- `delete_lines_prom`
- `write_prom_file`
- `delete_prom_file`
- `show_diff`
- `preview_patch`
- `apply_patch`
- `format_changed_files`
- `revert_last_tool_change`
- `revert_own_patch`
- `git_status`
- `git_diff`
- `git_log`
- `git_branch`
- `git_commit`
- `git_push`
- `open_pr`
- `run_tests`
- `run_linter`
- `run_formatter`
- `run_typecheck`
- `start_dev_server`
- `stop_process`
- `read_process_output`
- `snapshot_workspace`
- `restore_snapshot`
- `scan_secrets`
- `scan_large_files`
- `operation_plan`
- `code_outline`
- `get_symbols`
- `go_to_definition`
- `find_references`

Primary places:

- `src/gateway/tools/defs/file-web-memory.ts`
- `src/tools/files.ts`
- `src/tools/source-access.ts`
- `workspace/self/07-source-editing.md`

## 11. Process And Shell Execution

Prometheus exposes supervised command/process execution, terminal-like process logs, and kill/submit/rerun controls.

Features to index:

- Run command supervised.
- Start process.
- Process status.
- Process log.
- Process wait.
- Process kill.
- Process submit/write.
- Process close.
- Rerun process.
- Process cards in UI.
- Shell tool with configured command allowlists.
- Windows command allowlists for read/system/custom commands.

Tools found:

- `run_command_supervised`
- `start_process`
- `process_status`
- `process_log`
- `process_wait`
- `process_kill`
- `process_submit`
- `shell`

Primary places:

- `src/tools/process-tools.ts`
- `src/tools/shell.ts`
- `src/gateway/routes/processes.router.ts`
- `src/config/config.ts`
- `web-ui/src/components/ProcessRunCard.js`

## 12. Desktop Automation

Prometheus can inspect and control the Windows desktop, including screenshots, UI Automation trees, windows, input, app launching, macros, and a background sandbox worker.

Desktop tools found:

- `desktop_screenshot`
- `desktop_doctor`
- `desktop_get_monitors`
- `desktop_window_screenshot`
- `desktop_find_window`
- `desktop_focus_window`
- `desktop_click`
- `desktop_drag`
- `desktop_scroll`
- `desktop_wait`
- `desktop_type`
- `desktop_type_raw`
- `desktop_press_key`
- `desktop_get_clipboard`
- `desktop_set_clipboard`
- `desktop_list_installed_apps`
- `desktop_find_installed_app`
- `desktop_launch_app`
- `desktop_close_app`
- `desktop_get_process_list`
- `desktop_wait_for_change`
- `desktop_diff_screenshot`
- `desktop_background_status`
- `desktop_background_prepare_sandbox`
- `desktop_background_command`
- `desktop_window_control`
- `desktop_get_window_text`
- `desktop_get_accessibility_tree`
- `desktop_pixel_watch`
- `desktop_record_macro`
- `desktop_stop_macro`
- `desktop_replay_macro`
- `desktop_list_macros`
- `desktop_list_apps`
- `desktop_list_windows`
- `desktop_get_window_state`
- `desktop_window_click`
- `desktop_window_type`
- `desktop_window_press_key`
- `desktop_window_scroll`
- `desktop_window_drag`

Feature details to index:

- Full virtual desktop vs primary monitor screenshot.
- Specific monitor capture.
- Screenshot-of-marked-elements mode for numbered UI Automation elements.
- Window screenshot by title/process.
- Window-space coordinate actions.
- Screenshot verification modes.
- Clipboard text/image/file-list support.
- App catalog lookup and aliases.
- Native window minimize/maximize/restore/close.
- Accessibility tree extraction.
- Pixel watch.
- Macro recording and replay.
- Background Windows Sandbox preparation.
- Background desktop bridge commands.

Primary places:

- `src/tools/desktop.ts`
- `docs/BACKGROUND_DESKTOP_AUTOMATION.md`
- `workspace/self/04-browser.md`

## 13. Browser And Web Research

Prometheus has web search, fetch, browser/canvas support, and site-memory features.

Tools found:

- `web_search`
- `web_search_single`
- `web_search_multi`
- `web_fetch`
- `shopping_search_products`

Features to index:

- General web search.
- Single-query and multi-query search variants.
- Web fetch.
- Shopping/product search.
- Browser canvas surface in chat.
- Browser memory save flows for host-specific details.
- Project preview routes served through canvas.
- In-app creative/browser preview surfaces.

Primary places:

- `src/tools/web.ts`
- `src/gateway/tools/defs/file-web-memory.ts`
- `web-ui/src/pages/ChatPage.js`
- `workspace/self/04-browser.md`

## 14. Image, Video, Media Analysis, And Generation

Prometheus supports image upload/fetch/generation, video generation, image analysis, and video analysis.

Tools found:

- `upload_image`
- `fetch_image`
- `generate_image`
- `generate_video`
- `analyze_image`
- `analyze_video`
- `download_url`
- `download_media`

Feature details to index:

- Image upload into workspace/cache.
- Fetch image from URL/path.
- AI image generation.
- AI video generation through configured providers such as xAI Grok Imagine Video.
- Text-to-video.
- Image-to-video.
- Reference-image video generation.
- Video edit mode.
- Video extend mode.
- Video aspect ratio choices: landscape, square, portrait.
- Video duration and resolution settings.
- Save-to-workspace option.
- Image analysis with active vision-capable model.
- Video analysis with quick contact sheet.
- Video analysis with detailed chronological frame batches.
- Audio extraction and optional transcription during video analysis.
- Generated image/video default output directories.

Primary places:

- `src/tools/generate-image.ts`
- `src/tools/generate-video.ts`
- `src/tools/image-tools.ts`
- `src/tools/media-analysis.ts`
- `src/video-generation/*`
- `src/gateway/tools/defs/file-web-memory.ts`
- `workspace/self/06-image-voice.md`

## 15. Voice Agent, Speech, And Realtime Voice

Prometheus includes desktop/mobile voice features, TTS/STT routes, and a special voice-agent instruction layer.

Voice features to index:

- Voice status endpoint.
- Voice list endpoint.
- Voice audio cache endpoint.
- TTS endpoint.
- STT endpoint.
- Browser speech synthesis provider.
- Windows SAPI provider.
- OpenAI TTS/STT provider.
- ElevenLabs TTS/STT provider.
- xAI/Grok TTS/STT provider.
- Groq TTS/STT provider.
- xAI audio transcoding fallback.
- iOS/Safari audio URL delivery fallback.
- Voice debug logs.
- Voice-agent tool event stream.
- Realtime voice replies setting.
- Voice screenshot preview sessions.
- Voice agent realtime toggles for agent and xAI realtime.
- Voice-agent routing guidance: use voice browser tools for quick safe web navigation and hand off risky/long tasks to the main worker.

Primary places:

- `src/gateway/routes/voice.router.ts`
- `web-ui/src/pages/ChatPage.js`
- `workspace/VOICEAGENT.md`
- `workspace/self/06-image-voice.md`

## 16. Creative Workspace, Canvas, Hyperframes, And Video Editing

Prometheus has a large creative production surface for scene graphs, assets, HTML motion, Hyperframes, generated clips, compositing, audio, QA, exports, and templates.

Creative UI/API features to index:

- Canvas file read/write/upload/download/inline/preview.
- Project root and project preview sessions.
- Project export/link.
- Publish prepare/execute.
- Creative mode toggle.
- Creative assets list/index/import/analyze/generate.
- Creative layer extraction and mask refinement.
- Creative model status.
- Audio analysis.
- Motion templates preview/apply/variants.
- Creative libraries and library imports.
- Render jobs create/start/progress/cancel/complete/status.
- Creative scene save/load.
- Composition save/render/lint.
- Creative export.
- HTML motion clip create/read/patch/restore/preview/lint/inspect/snapshot/export/export-folder.
- HTML motion adapters, blocks, templates, and block rendering.
- Hyperframes parse/preview/lint/catalog/QA/studio.

Creative generation/editing tools found:

- `creative_register_generation`
- `creative_generation_history`
- `creative_generate_image_shot`
- `creative_generate_video_shot`
- `creative_analyze_generated_video`
- `creative_compare_shots`
- `creative_select_best_take`
- `creative_retry_shot_until_pass`
- `creative_refine_video_shot`
- `creative_generate_sequence`
- `creative_extract_layers_for_generation`
- `creative_pick_continuity_frame`
- `creative_chain_scene`
- `creative_wrap_video_as_html_motion_clip`
- `creative_add_generated_clip_to_composition`
- `creative_render_generated_sequence`
- `creative_stitch_clips`
- `creative_auto_assemble_rough_cut`
- `creative_normalize_layer_specs`
- `creative_validate_composition_layers`
- `creative_preflight_overlay`
- `creative_sample_composite_frames`
- `creative_import_audio`
- `creative_download_audio`
- `creative_extract_audio_from_video`
- `creative_generate_voiceover`
- `creative_transcribe_audio`
- `creative_sync_captions_to_audio`
- `creative_add_audio_track`
- `creative_mix_audio_tracks`
- `creative_add_music_bed`
- `creative_add_sound_effects`
- `creative_generate_motion_graphics_layer`
- `creative_overlay_hyperframes_on_video`
- `creative_composite_video_layers`
- `creative_attach_audio_from_url`
- `creative_attach_audio_from_file`
- `creative_search_assets`
- `creative_generate_asset`
- `creative_render_ascii_asset`
- `creative_add_effect`
- `creative_set_blend_mode`
- `creative_add_mask`
- `creative_trim_clip`
- `creative_apply_brand_kit`
- `creative_search_icons`
- `creative_search_animations`
- `creative_reset_scene`
- `creative_purge_scene`
- `creative_element_inventory`
- `creative_frame_trace`
- `creative_frame_diff`
- `creative_history_status`
- `creative_undo`
- `creative_redo`
- `creative_checkpoint`
- `creative_export_trace`
- `creative_timeline`
- `creative_render_snapshot`
- `creative_export`
- `creative_save_scene`

Creative QA/video/image tools found:

- `video_render_frame`
- `video_render_contact_sheet`
- `video_analyze_frame`
- `video_analyze_timeline`
- `video_check_keyframes`
- `video_check_caption_timing`
- `video_check_audio_sync`
- `video_extract_clip_frames`
- `video_analyze_imported_video`
- `image_get_element_at_point`
- `image_get_overlaps`
- `image_get_bounds_summary`
- `image_check_text_overflow`
- `image_check_contrast`
- `image_detect_empty_regions`
- `creative_validate_layout`
- `creative_quality_report`

Motion/Hyperframes/template tools found:

- `creative_list_motion_templates`
- `creative_preview_motion_template`
- `creative_apply_motion_template`
- `creative_generate_motion_variants`
- `creative_update_element`
- `creative_delete_element`
- `creative_apply_animation`
- `creative_arrange`
- `creative_apply_style`
- `creative_fit_asset`
- `creative_apply_template`
- `creative_list_html_motion_templates`
- `creative_apply_html_motion_template`
- `creative_create_html_motion_clip`
- `creative_save_html_motion_template`
- `creative_save_html_motion_block`
- `creative_promote_scene_to_template`
- `creative_lint_html_motion_clip`
- `creative_measure_text`
- `creative_text_fit_report`
- `creative_list_html_motion_blocks`
- `creative_render_html_motion_block`
- `creative_read_html_motion_clip`
- `creative_patch_html_motion_clip`
- `creative_restore_html_motion_revision`
- `creative_render_html_motion_snapshot`
- `creative_export_html_motion_clip`
- `creative_list_hyperframes_components`
- `creative_import_hyperframes_component`
- `creative_sync_hyperframes_catalog`
- `creative_apply_hyperframes_component`
- `hyperframes_browse_catalog`
- `hyperframes_insert_clip`
- `hyperframes_apply_patch`
- `hyperframes_set_text`
- `hyperframes_set_color`
- `hyperframes_set_timing`
- `hyperframes_set_variable`
- `hyperframes_set_asset`
- `hyperframes_add_animation`
- `hyperframes_lint`
- `hyperframes_qa`
- `hyperframes_materialize`
- `hyperframes_export`
- `creative_list_library_packs`
- `creative_create_library_pack`
- `creative_toggle_library_pack`

Composition tools found:

- `creative_composition_get`
- `creative_composition_add_track`
- `creative_composition_add_clip`
- `creative_composition_move_clip`
- `creative_composition_trim_clip`
- `creative_composition_split_at`
- `creative_composition_delete_clip`
- `creative_composition_set_transition`
- `creative_composition_select_clip`
- `creative_composition_lint`
- `creative_composition_render`
- `creative_composition_save`

Primary places:

- `src/gateway/routes/canvas.router.ts`
- `src/gateway/tools/defs/creative-tools.ts`
- `web-ui/src/components/creative/*`
- `docs/PROMETHEUS_HTML_MOTION_SPEC.md`
- `workspace/self/creative/*.md`
- `workspace/self/14-skills-and-frontend.md`

## 17. Skills

Prometheus has an in-workspace skill system for reusable instructions, resources, bundles, import/export, inspection, and curation.

Features to index:

- List skills.
- Read skill.
- Create skill.
- Inspect skill.
- Scan skills.
- Curate skills.
- Import bundle.
- Export bundle.
- Create bundle.
- Read/list/write/delete resources.
- Write manifest.
- Update from source.
- Skill proposals from background tasks.
- Frontend skill management UI.

Tools found:

- `skill_list`
- `skill_read`
- `skill_create`
- `skill_resource_list`
- `skill_resource_read`
- `skill_inspect`
- `skill_import_bundle`
- `skill_manifest_write`
- `skill_create_bundle`
- `skill_resource_write`
- `skill_resource_delete`
- `skill_export_bundle`
- `skill_update_from_source`
- `skill_scan`
- `skill_curator`

Primary places:

- `src/tools/skills.ts`
- `src/gateway/routes/skills.router.ts`
- `workspace/skills`
- `workspace/self/14-skills-and-frontend.md`

## 18. Integrations, Connections, MCP, And Connectors

Prometheus exposes connections, OAuth/API-key/browser auth flows, bundled provider extensions, MCP server management, and connector tools.

Connections catalog found:

- Gmail
- Slack
- GitHub
- Notion
- HubSpot
- Salesforce
- Stripe
- Vercel
- Google Analytics
- Instagram
- TikTok
- X / Twitter
- LinkedIn
- Reddit
- Google Drive

Connection features to index:

- View connections.
- Credentials status.
- Credentials audit.
- Extensions catalog.
- Save/disconnect credentials.
- OAuth start/poll.
- XURL setup/poll.
- Browser-open/browser-verify connection flow.
- Connection activity.
- MCP server list/detail/actions.
- Webhook management.
- Integration quick setup.
- Obsidian bridge and writeback.

Connection and MCP tools found:

- `view_connections`
- `webhook_manage`
- `mcp_server_manage`
- `integration_quick_setup`
- `connector_obsidian_status`
- `connector_obsidian_connect_vault`
- `connector_obsidian_sync`
- `connector_obsidian_writeback`

Connector tools found:

- Gmail: `connector_gmail_list_emails`, `connector_gmail_get_email`, `connector_gmail_send_email`, `connector_gmail_get_profile`, `connector_gmail_list_labels`
- GitHub: `connector_github_list_repos`, `connector_github_list_issues`, `connector_github_create_issue`, `connector_github_create_repo`, `connector_github_list_prs`, `connector_github_search`
- Slack: `connector_slack_list_channels`, `connector_slack_send_message`, `connector_slack_get_history`, `connector_slack_search`
- Notion: `connector_notion_search`, `connector_notion_get_page`, `connector_notion_create_page`, `connector_notion_query_database`
- Google Drive: `connector_gdrive_list_files`, `connector_gdrive_get_file`, `connector_gdrive_read_file`, `connector_gdrive_search`
- Reddit: `connector_reddit_get_posts`, `connector_reddit_search`, `connector_reddit_submit_post`, `connector_reddit_get_comments`
- HubSpot: `connector_hubspot_list_contacts`, `connector_hubspot_get_contact`, `connector_hubspot_create_contact`, `connector_hubspot_search`, `connector_hubspot_list_deals`
- Salesforce: `connector_salesforce_query`, `connector_salesforce_search`, `connector_salesforce_create_record`, `connector_salesforce_get_record`
- Stripe: `connector_stripe_get_balance`, `connector_stripe_list_customers`, `connector_stripe_list_charges`, `connector_stripe_list_products`
- GA4: `connector_ga4_run_report`, `connector_ga4_realtime_users`, `connector_ga4_list_properties`

Primary places:

- `src/gateway/tools/defs/connector-tools.ts`
- `src/extensions/*`
- `src/extensions/bundled/providers/*/prometheus.extension.json`
- `src/gateway/routes/connections.router.ts`
- `web-ui/src/pages/ConnectionsPage.js`
- `docs/OBSIDIAN_BRIDGE.md`
- `workspace/self/10-mcp-and-connections.md`

## 19. Model Providers, Defaults, And Switching

Prometheus supports multiple model providers and UI/API controls for active model/provider, model health, agent-specific defaults, and reusable templates.

Providers/adapters found:

- OpenAI
- OpenAI Codex
- Anthropic
- Gemini
- Perplexity
- Ollama
- OpenAI-compatible providers
- xAI through provider extension/auth paths
- OpenRouter via bundled extension
- Qwen via bundled extension
- ZAI via bundled extension
- Xiaomi via bundled extension
- Vercel AI Gateway via bundled extension
- OpenCode/OpenCode Go via bundled extension

Features to index:

- Current provider setting.
- Current model setting.
- Search settings.
- Credentialed model providers list.
- Model test endpoint.
- Ollama model listing.
- OpenAI model listing.
- Provider credentials and OAuth flows.
- Agent model defaults.
- Agent model default templates.
- Apply agent model template.
- Set default agent model template.
- Delete model template.
- Switch current model from tool.
- Set agent model.
- Get agent models.

Tools found:

- `switch_model`
- `get_agent_models`
- `set_current_model`
- `set_agent_model`
- `list_agent_model_templates`
- `save_agent_model_template`
- `update_agent_model_template`
- `apply_agent_model_template`
- `select_agent_model_template`
- `delete_agent_model_template`

Primary places:

- `src/providers/*`
- `src/gateway/routes/settings.router.ts`
- `web-ui/src/components/model-provider-credentials.js`
- `web-ui/src/onboarding/model-picker.js`
- `workspace/self/09-providers-and-models.md`

## 20. Auth, Account, Credentials, And Security

Prometheus includes account login/status, provider auth flows, credential vaulting, security settings, command approvals, and log scrubbing.

Features to index:

- Account config/status.
- Account login.
- Password login.
- Account logout.
- Account refresh.
- Gateway auth.
- Paired account access.
- Provider credential status.
- Credential audit.
- Security settings.
- Command permissions.
- Approval persistence.
- OpenAI auth status/start/poll/manual/disconnect.
- xAI auth status/start/poll/manual/disconnect.
- X API credentials/start/poll/manual/disconnect.
- Anthropic status/setup-token/disconnect/test.
- Credential vault.
- Vault key bootstrap.
- Credential handler.
- Log scrubber.
- Error audit.

Primary places:

- `src/gateway/routes/account.router.ts`
- `src/gateway/routes/settings.router.ts`
- `src/security/*`
- `src/auth/*`
- `workspace/self/18-public-release.md`

## 21. Telegram, Channels, Persona Bots, And Team Rooms

Prometheus has a general Telegram command channel, Telegram media handling, persona bots, and Telegram team rooms.

Telegram channel config supports:

- Bot token.
- Allowed user IDs.
- Polling/webhook-style channel behavior.
- Persona bot configs.
- Team-room bindings.
- Legacy top-level Telegram compatibility.

Telegram currently supports:

- Normal chat messages.
- Photos/uploads.
- Documents/uploads.
- Audio/voice/video-style media uploads.
- Command approvals.
- Live token/tool/result streaming to desktop UI.
- Channel session mapping.
- Provider-specific reasoning controls, including Anthropic thinking budget options.

Telegram command surface found in self docs:

- `/start`
- `/help`
- `/status`
- `/settings`
- `/model`
- `/provider`
- `/search`
- `/paths`
- `/heartbeat`
- `/teams`
- `/agents`
- `/tasks`
- `/approvals`

Known mismatch found:

- `/approvals` is implemented but omitted from `buildTelegramCommandsMessage(...)` according to existing self notes.

Persona bot/team-room features:

- One Telegram bot per subagent/persona.
- Main Telegram bot remains general Prometheus command channel.
- Persona accounts under `channels.telegram.personas`.
- Managed Bot support through `managedBotUserId`.
- Persona setup plan endpoint.
- Persona setup apply endpoint.
- Bind managed bot to persona account.
- Persona status and test endpoints.
- Team rooms bind Telegram group/topic to a team.
- Forum topics can map multiple teams in one Telegram group.
- Manager replies go back to the bound Telegram room.
- User messages from Telegram enter same team chat path as Web UI.

Primary places:

- `workspace/self/12-telegram-and-brain.md`
- `docs/TELEGRAM_PERSONA_BOTS.md`
- `src/gateway/comms/telegram-persona-bots.ts`
- `src/gateway/comms/telegram-team-room-bridge.ts`
- `src/config/config-schema.ts`
- `src/gateway/routes/channels.router.ts`
- `src/gateway/routes/teams.router.ts`

## 22. CLI

Prometheus has a command-line surface for onboarding, gateway control, jobs, model management, diagnostics, and update.

CLI commands found:

- `onboard`
- `gateway start`
- `gateway status`
- `gateway agent <mission>`
- `jobs list`
- `jobs show <id>`
- `model list`
- `model set <n>`
- `doctor`
- `update [mode]`

Primary places:

- `src/cli/index.ts`
- `src/cli/ui.ts`

## 23. Channels, Webhooks, And Notifications

Prometheus has generic channel status/config/test/send-test APIs and webhook entrypoints.

Features to index:

- Channels status.
- Channels config.
- Channel test.
- Channel send test.
- Webhook wake endpoint.
- Webhook agent endpoint.
- Webhook status endpoint.
- Telegram/mobile/CLI/Discord/WhatsApp cross-channel handling.
- WebSocket broadcaster for UI events.

Primary places:

- `src/gateway/routes/channels.router.ts`
- `src/gateway/comms/webhook-handler.ts`
- `src/gateway/comms/broadcaster.ts`
- `WEBHOOKS.md`

## 24. Business Context, Entities, And Evidence

Prometheus keeps structured business/entity context and can write evidence.

Features/tools found:

- `business_context_mode`
- `list_entities`
- `read_entity`
- `write_entity`
- `append_entity_event`
- `write_evidence`
- Entity folders for vendors and social accounts.
- Events and audit evidence.

Primary places:

- `src/gateway/tools/defs/cis-system.ts`
- `src/tools/evidence-bus-tool.ts`
- `workspace/entities`
- `workspace/events`
- `workspace/BUSINESS.md`

## 25. Social, Marketing, And Product Intelligence

Prometheus has social intelligence and product carousel/tooling hooks that matter for feature marketing workflows.

Features/tools found:

- `social_intel`
- `show_product_carousel`
- Shopping product search.
- Social connector surfaces for X/Twitter, Instagram, TikTok, LinkedIn, Reddit.
- Reddit submit/search/comments tools.
- X API auth and XURL flow.
- Existing `workspace/prometheus_blog_posting_skill.md`.
- Entity notes for `prometheusai-x` and other social accounts.

Primary places:

- `src/tools/social-scraper.ts`
- `src/gateway/tools/defs/cis-system.ts`
- `src/gateway/tools/defs/connector-tools.ts`
- `workspace/prometheus_blog_posting_skill.md`
- `workspace/entities/social`

## 26. Deployment And Release

Prometheus includes release/public runtime notes, Vercel deploy tools, public workspace packaging, and update/self-repair hooks.

Features/tools found:

- `vercel_deploy`
- `vercel_env`
- `self_update`
- `self_repair` source file present.
- Public runtime release docs.
- Public workspace directory generation.
- Runtime dependency maps.
- Desktop Electron packaging configs.
- Gateway restart tool.
- CLI update command.

Primary places:

- `src/tools/vercel-tools.ts`
- `src/tools/self-update.ts`
- `src/tools/self-repair.ts`
- `src/runtime/*`
- `workspace/self/public-runtime-release/*`
- `workspace/self/18-public-release.md`
- `electron-builder*.yml`
- `electron/*`

## 27. Downloads And Workspace Artifacts

Prometheus has download and artifact handling for URLs, media, uploads, canvas files, generated outputs, and workspace paths.

Features/tools found:

- `download_url`
- `download_media`
- Canvas upload.
- Canvas upload binary.
- Canvas download.
- Canvas inline.
- Telegram upload folders.
- Generated image/video/audio/video-analysis paths.
- Creative project asset import.
- Open path endpoint.
- Present file to user/team.

Primary places:

- `src/tools/download-tools.ts`
- `src/gateway/routes/canvas.router.ts`
- `src/config/public-workspace.ts`
- `workspace/uploads`
- `workspace/generated`
- `workspace/downloads`

## 28. Settings Surface

Prometheus has a broad settings system spanning models, providers, search, paths, heartbeat, hooks, session, features, security, credentials, installed apps, and lifecycle.

Settings/API areas found:

- `/api/settings/search`
- `/api/settings/paths`
- `/api/settings/features`
- `/api/settings/session`
- `/api/settings/model`
- `/api/settings/agent-model-defaults`
- `/api/settings/agent-model-default-templates`
- `/api/settings/security`
- `/api/settings/provider`
- `/api/settings/bulk`
- `/api/settings/hooks`
- `/api/settings/hooks/test`
- `/api/settings/heartbeat`
- `/api/credentials/status`
- `/api/credentials/audit`
- `/api/installed-apps`
- `/api/installed-apps/search`
- `/api/installed-apps/aliases`
- `/api/system-stats`
- `/api/lifecycle/restart`
- `/api/open-path`

Settings concepts to index:

- Provider selection.
- Model selection.
- Search provider/settings.
- Workspace paths.
- Heartbeat/background behavior.
- Hook configuration and hook testing.
- Session defaults.
- Feature flags.
- Security settings.
- Bulk settings save.
- Credential status/audit.
- Installed application aliasing.
- System stats.
- Gateway restart.

Primary places:

- `src/gateway/routes/settings.router.ts`
- `src/config/config.ts`
- `src/config/config-schema.ts`
- `web-ui/src/pages/SettingsPage.js`

## 29. Default Configuration And Workspace Defaults

Important defaults to index:

- Video generation default provider/model: xAI/Grok Imagine Video path with `grok-imagine-video`.
- Video generation default output dir: `generated/videos`.
- Public workspace generated directories include `generated/audio`, `generated/video-analysis`, `generated/videos`, and creative project folders.
- Telegram config is present under `channels.telegram`, with legacy top-level `telegram` compatibility.
- Shell command policy includes allowed command groups for Windows read commands, Windows system commands, custom commands, and general allowed commands.
- Workspace rules tell agents to save creative image/video/canvas work under `creative-projects`, `creatives`, or `generated`.

Primary places:

- `src/config/config.ts`
- `src/config/config-schema.ts`
- `src/config/public-workspace.ts`
- `.env.example`

## 30. Feature Areas That Need A Deeper Second Pass

These areas are clearly present, but the first pass should be followed by a targeted audit if the feature index needs exact route lists, screenshots, copy snippets, or implementation diagrams.

- Full slash-command surface in desktop chat. I found Telegram command docs and CLI commands, but desktop slash commands need a specific scan of `ChatPage.js` and any command parser modules.
- Complete channels router inventory. The route list was truncated by broad scans; `channels.router.ts` should get its own pass.
- Complete creative tool descriptions. The names are indexed here, but each tool deserves a one-line user-facing explanation.
- Complete settings option defaults. `config.ts` and `config-schema.ts` should be summarized field by field.
- Full provider extension catalog. Bundled provider manifests should be read into a provider capability table.
- Voice agent/browser-specific tools. `VOICEAGENT.md` documents routing behavior, but the exact voice browser tool names need a focused scan.
- Public release/package feature list. Existing public-runtime-release docs likely contain marketing-grade capability framing.
- Obsidian bridge. Current inventory includes endpoints/tools, but the Obsidian plugin UX deserves its own feature entry.
- Desktop Electron shell. Electron packaging and preload/main exist; UI shell features need a focused read.
- Error-response system. Endpoints are identified, but the user-facing workflow needs a separate explanation.
- Account/pairing auth. The mobile paired token behavior is visible; account router and pairing flows should be documented as their own feature.
