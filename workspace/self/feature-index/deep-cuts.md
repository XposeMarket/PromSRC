# Prometheus Feature Index Deep Cuts

Last reviewed: 2026-06-04

This file extends `findings.md` with the less-obvious product features that are easy to miss if you only scan pages and top-level tools.

## 1. In-App Browser Surface

Prometheus has an in-chat browser canvas, not just browser tools. The browser surface lives inside the Chat page/right panel and can switch between file/canvas work and live browser work.

Feature findings:

- Browser canvas state is persisted in `window.browserCanvasState`.
- Browser sessions are tracked per chat/session.
- Browser target URL and session metadata are stored in the chat UI state.
- Browser mode has at least three user-facing lanes: agent, co-pilot, and teach.
- Agent mode lets Prometheus drive the browser while the surface follows tool activity.
- Co-pilot mode is framed as a handoff lane for shared human/agent browser control.
- Teach mode is the browser workflow capture lane.
- Browser state syncs into chat context so browser work can continue across turns.
- Browser transient highlights, queued text input, queued wheel input, and stream heartbeat timers exist in the UI.
- Browser preview/canvas panel can expand differently in teach mode.
- Browser session context is injected into prompting when relevant.
- Browser DOM deltas and vision screenshots can be injected after browser tools.
- `browser_open` gets both DOM and visual treatment when possible.
- Browser advisor logic tracks collected feed items, dedupes observations, stabilizes snapshots, probes focus with Tab, and can route continuation steps.

Browser tools observed in runtime prompt/tool policy:

- `browser_wait`
- `browser_get_page_text`
- `browser_get_focused_item`
- `browser_click`
- `browser_fill`
- `browser_upload_file`
- `browser_press_key`
- `browser_key`
- `browser_drag`
- `browser_click_and_download`
- `browser_scroll_collect`
- `browser_scroll`
- `browser_open`
- `browser_vision_click`
- `browser_snapshot`
- `browser_snapshot_delta`
- `browser_vision_screenshot`
- `browser_vision_type`
- `browser_send_to_telegram`
- `browser_run_js`

Source anchors:

- `src/gateway/browser-tools.ts`
- `src/gateway/routes/chat.router.ts`
- `web-ui/src/pages/ChatPage.js`
- `workspace/self/02-startup-runtime.md`
- `workspace/self/04-browser.md`

## 2. Browser Teach Mode

Teach mode is not a separate execution mode. It is activated by caller context containing `[TEACH_SESSION]`, which changes prompt behavior to the `teach_mode` profile.

Feature findings:

- Teach mode objective is to capture, verify, and package reusable browser workflows.
- Teach session state has phases such as idle, recording, approval pending, and verified.
- Teach state tracks start URL, start title, recorded steps, pending step, executing step, approval request time, review request time, completion time, and verification data.
- Recorded teach steps have tool previews, including browser actions.
- Verification tracks status, mode, boundary label, stop-before-step, verifier session ID, executed count, total recorded steps, risky step indexes, failed step, failure summary, final URL, final title, start time, and completion time.
- User approval is expected before replay/verification boundaries.
- The prompt explicitly says to call `browser_teach_verify` once the user approves verification.
- Prometheus may recommend a composite, a skill, both, or neither after verification.
- Prometheus must not create a composite tool or skill from teach mode unless the user explicitly asks.
- Teach mode is connected to reusable browser memory/workflow packaging.

Product framing:

- Teach mode is Prometheus learning a repeatable browser workflow from the user.
- It is useful for turning “watch me do this once” flows into reusable automation.
- It should be marketed separately from generic browser automation because it includes capture, boundary approval, verification, and packaging recommendations.

Source anchors:

- `workspace/self/03-execution-and-prompting.md`
- `src/gateway/routes/chat.router.ts`
- `web-ui/src/pages/ChatPage.js`

## 3. Side Chats

Side chats are linked, bounded chat branches that let the user explore or ask follow-ups without polluting the main thread or continuing the parent plan.

Feature findings:

- Side chat links are persisted under local storage key `prometheus_side_chats_v1`.
- Side chats get generated IDs with a `side_` prefix.
- A side chat can be created from a parent session and optionally anchored to a parent message index.
- Side chats copy selected parent/project context.
- Side chat sessions preserve canvas project root, project label, and project link from the parent.
- Side chats are marked with `sideChat: true` and `sideChatBoundary: true`.
- Side chats use channel label `side chat`.
- The side-chat system explicitly tells the assistant not to continue old plans, edits, tool calls, approvals, or implementation work from the parent unless the user asks inside that side chat.
- A split-pane side chat UI can open beside the main chat.
- The side-chat toggle shows the number of linked side chats.
- Side chat history syncs to the server with compaction reset.
- Side chat prompts can be sent with `sessionIdOverride` and `sideChat: true`.

Product framing:

- Side chats are Prometheus’s “branch this conversation” feature.
- Useful for asking “explain this”, “draft copy from this result”, or “investigate this tangent” without derailing the active work.
- Especially useful for complex builds where the main thread has live plans, approvals, and tool state.

Source anchors:

- `web-ui/src/pages/ChatPage.js`

## 4. Interactive Visuals In Chat

Prometheus’s chat UI is not just text. It renders operational and creative state as interactive cards, canvases, previews, approvals, and progress surfaces.

Interactive visual surfaces found:

- Process run cards with logs and controls.
- Inline approval cards with approve/reject/session/always actions.
- Session approval cards.
- Main goal strip.
- Progress panel and checklist rendering.
- Agent execution panel.
- Process pills.
- File pills and upload attachments.
- Assistant-generated image blocks.
- Artifact rendering.
- Browser canvas surface.
- Creative workspace surface.
- Canvas project preview.
- Rendered creative frame/image previews injected into context.
- Product carousel via `show_product_carousel`.
- Memory graph canvas with pan, zoom, draggable/interactive nodes, hub nodes, and record selection.
- Hub cards for Brain skill suggestions and Thought/Dream activity.
- Creative render job status and export progress bars.
- Creative editor viewport canvas with zoom/pan, drag-to-preview assets, handles, context menus, inline text editing, keyframe graph editor, subtitle overlay, effects browser, asset browser, and export dialog.
- Hyperframes preview with seek/play/pause, pick mode, element picking, and iframe-to-canvas coordinate conversion.

Product framing:

- Chat can become an operations dashboard, browser viewport, approval queue, memory graph, creative editor, or artifact viewer depending on the work.
- This is important for marketing: Prometheus is not a terminal wrapper; it has live visual state tied to agent work.

Source anchors:

- `web-ui/src/pages/ChatPage.js`
- `web-ui/src/components/ProcessRunCard.js`
- `web-ui/src/pages/MemoryPage.js`
- `web-ui/src/pages/HubPage.js`
- `web-ui/src/components/creative/*`
- `src/gateway/tools/defs/cis-system.ts`

## 5. Background Spawn Agent And Background Work

Prometheus can run independent background tasks/agents while the main chat remains free.

Feature findings:

- `background_spawn` starts independent background work.
- `background_wait` waits for completion or progress.
- `background_status` reports task state.
- `background_progress` reports progress.
- `background_join` attaches back to the background result.
- Background tasks have status, progress, evidence, stream, message, pause, resume, restart, delete, and join endpoints.
- Background tasks can create skill proposals from completed or reusable workflows.
- Background tasks can receive messages while running.
- Background tasks can trigger error-response workflows.
- Background task streams emit live events to UI.
- Background task journals can include heartbeat entries.
- Quick follow-up resume can trigger after step completion instead of waiting the full heartbeat interval.
- Background tasks are modeled as independent runtime/sessions when they can run independently.

Background tools and aliases:

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

Source anchors:

- `src/gateway/tools/defs/agent-team-schedule.ts`
- `src/gateway/routes/tasks.router.ts`
- `workspace/self/07-source-editing.md`
- `workspace/self/08-tasks-and-agents.md`

## 6. Composite Tools And Tool Categories

Prometheus assembles tools from core tools, category tools, connector tools, composite tools, and MCP tools. Composite tooling matters because it turns repeated workflows into higher-level capabilities.

Feature findings:

- `src/gateway/tool-builder.ts` assembles the active tool surface.
- Tool categories are inferred from prefixes and include shell/process, file, web, browser, desktop, memory, skill, media, agent/task, approval, connector, creative, and other.
- Category tools can be requested dynamically through `request_tool_category`.
- `automations` is a category for scheduling and automation operator tools.
- `schedule_job` is core; deeper schedule tools are loaded under automations.
- Teach mode can recommend composite tools after workflow verification.
- Prompt guidance says Prometheus may recommend composite, skill, both, or neither after browser workflow verification.
- Composite tools appear in architecture as part of the normal tool-building stack, not as a separate runtime.

Composite-adjacent feature areas:

- Browser teach replay can become a composite automation.
- Creative tools act like composite production steps over canvas/media/render APIs.
- Background tasks can become skill proposals.
- Skill gardener/curator can turn repeated tool-order lessons into skill updates rather than ad hoc memory.

Source anchors:

- `src/gateway/tool-builder.ts`
- `workspace/self/02-startup-runtime.md`
- `workspace/self/05-tools.md`
- `src/gateway/tools/defs/cis-system.ts`
- `src/gateway/routes/chat.router.ts`

## 7. Heartbeat

Heartbeat is a first-class continuation/automation system, no longer just a legacy cron job.

Feature findings:

- `heartbeat` is an execution mode and is intentionally terse and continuation-oriented.
- Heartbeat is no longer treated as a normal CronJob; attempts to create legacy heartbeat cron tasks are rejected with guidance to use Settings > Heartbeat.
- Heartbeat settings live at `/api/settings/heartbeat`.
- Legacy-compatible heartbeat config endpoints also exist at `/api/heartbeat/config` and `/api/bg-tasks/heartbeat/config`.
- Heartbeat runner config can be read and updated.
- Agent-specific heartbeat configs can be listed, read, updated, registered, and manually ticked.
- Agent heartbeat instructions can be stored per agent.
- Heartbeat updates broadcast `heartbeat_agent_config_updated`.
- Team event SSE endpoints send low-level connection heartbeats to keep streams alive.
- Background task stream/journal can use heartbeat entries for continuation.

Heartbeat endpoints found:

- `GET /api/settings/heartbeat`
- `POST /api/settings/heartbeat`
- `GET /api/heartbeat/config`
- `PUT /api/heartbeat/config`
- `GET /api/bg-tasks/heartbeat/config`
- `PUT /api/bg-tasks/heartbeat/config`
- `GET /api/heartbeat/agents`
- `GET /api/heartbeat/agents/:agentId`
- `PUT /api/heartbeat/agents/:agentId`
- `POST /api/heartbeat/agents/:agentId/tick`

Source anchors:

- `workspace/self/03-execution-and-prompting.md`
- `src/gateway/routes/tasks.router.ts`
- `web-ui/src/pages/SettingsPage.js`
- `web-ui/src/pages/TasksPage.js`

## 8. Scheduled Jobs And Automation Operator Tools

Scheduled jobs are broader than calendar reminders. They can drive team work, automation, history review, stuck-job handling, and memory.

Feature findings:

- Schedules can be listed, created, updated, deleted, parsed, and manually run.
- Schedule run logs are available.
- Schedule memory is available.
- Legacy heartbeat schedules cannot be run manually.
- Schedule parser can turn natural language schedule descriptions into structured jobs.
- Schedule tools expose history, detail, log search, patching, outputs, and stuck-control.
- Automation dashboard summarizes automation state.
- Schedule jobs are separate from heartbeat, though both are automation systems.

Tools:

- `schedule_job`
- `schedule_job_history`
- `schedule_job_detail`
- `schedule_job_log_search`
- `schedule_job_patch`
- `schedule_job_outputs`
- `schedule_job_stuck_control`
- `automation_dashboard`
- `update_schedule_memory`

Endpoints:

- `GET /api/schedules`
- `POST /api/schedules`
- `PUT /api/schedules/:id`
- `DELETE /api/schedules/:id`
- `POST /api/schedules/:id/run`
- `POST /api/schedules/parse`
- `GET /api/schedules/:scheduleId/memory`
- `GET /api/schedules/:scheduleId/run-log`

Source anchors:

- `src/gateway/routes/teams.router.ts`
- `src/gateway/routes/tasks.router.ts`
- `src/gateway/tools/defs/agent-team-schedule.ts`
- `src/tools/schedule-memory-tool.ts`
- `workspace/self/05-tools.md`

## 9. Computer Use And Desktop Control

Prometheus has a large Windows computer-use surface that goes beyond screenshots and clicks.

Feature findings:

- Host desktop tools control the user’s active Windows environment.
- Background desktop tools target an isolated Windows Sandbox worker so automation can run without stealing host focus.
- Browser automation is separately isolated through browser/CDP control.
- Desktop doctor reports monitor/DPI, screenshot budget, OCR, UI Automation, active window, and stale screenshot state.
- Screenshot modes include primary/all monitor capture and SOM/numbered element overlays.
- Window-scoped tools prefer `window_id` / handle based control when possible.
- Desktop app inventory includes installed and running apps, with running apps first.
- Window list includes `window_id` values based on HWND.
- Window state includes metadata, screenshot, text, and accessibility data.
- Window-specific tools wrap older coordinate primitives with better targeting.
- Clipboard supports text, image file, and file-list operations.
- Macro recording/replay is available.
- Pixel watch can wait for UI color changes.
- Native window control supports minimize, maximize, restore, and close.
- Accessibility tree extraction provides roles, names, enabled/focused state, and bounds.
- Desktop environment can be configured by `PROMETHEUS_DESKTOP_CAPTURE_BACKEND`.

Host computer-use tools:

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

Background desktop tools:

- `desktop_background_status`
- `desktop_background_prepare_sandbox`
- `desktop_background_command`

Source anchors:

- `src/tools/desktop.ts`
- `docs/BACKGROUND_DESKTOP_AUTOMATION.md`

## 10. Brain, Thought, Dream, And Self-Improvement

Prometheus has a Brain runner with Thought and Dream loops for self-reflection, pulse cards, memory/skill evolution, and self-improvement governance.

Feature findings:

- Brain state/thought/dream artifacts live under `workspace/Brain/`.
- Brain status is available through `/api/brain/status`.
- Brain pulse cards are available through `/api/brain/pulse-cards`.
- Brain config can update thought/dream enablement and thought/dream models.
- Brain can be manually run as either `thought` or `dream`.
- Hub displays Brain skill suggestions and Thought/Dream activity.
- Brain pulse cards can be authored in thought files or extracted from recent thought sections.
- Pulse cards can derive from Opportunity Seeds, Improvement Candidates, and “I wonder” summary text.
- Pulse cards include title, body, prompt, source, and source path.
- Brain runner persists and formats recent tool observations through the same tool-observation helper used by main chat.
- Old self-improvement API/engine files are gone; the current mental model is Brain runner plus prompt mutation.
- Brain Dream reconciliation is explicitly tied to entity events and durable context.
- Thought-applied skill updates are provisional until Dream audits them.
- Dream cleanup is a model-backed Skill Curator Critic.
- Dream can revert/refine bad auto-applied curator resources.
- High-risk work should remain proposal-gated.
- New skill creation is Dream-only and proposal-gated.
- Brain Dream should file `skill_evolution` proposals when new skills are warranted, not directly create new skills.
- Prompt mutation is a proposal type alongside skill evolution.

Brain endpoints:

- `GET /api/brain/status`
- `GET /api/brain/pulse-cards`
- `PATCH /api/brain/config`
- `POST /api/brain/run`

Brain paths:

- `workspace/Brain/`
- `workspace/Brain/thoughts/`
- `workspace/Brain/skill-episodes/<date>/episodes.jsonl`
- `workspace/Brain/skill-gardener/<date>/`
- `workspace/Brain/skill-curator/suggestions.json`
- `workspace/Brain/skill-curator/reports/`

Source anchors:

- `src/gateway/brain/brain-runner.ts`
- `src/gateway/brain/brain-state.ts`
- `src/gateway/routes/teams.router.ts`
- `web-ui/src/pages/HubPage.js`
- `workspace/self/05-tools.md`
- `workspace/self/12-telegram-and-brain.md`
- `workspace/self/15-paths-and-sharp-edges.md`

## 11. Skill Gardener And Skill Curator

Skill evolution is not just a manual skill editor. Prometheus has an evidence-backed skill improvement loop.

Feature findings:

- Skills are treated as living workflow playbooks.
- Before browser/desktop automation, file edits, or execution-heavy work, agents are instructed to call `skill_list`.
- If a relevant skill exists, agents should call `skill_read(id)` and follow it.
- Agents can use skill resources through `skill_resource_list` and `skill_resource_read`.
- Subagents support skills through explicit `agent.skills` or relevance-based fallback.
- Skill-guided failures should be recovered through an alternate route before offering a skill update.
- Existing skill evolution can be automatic only for low-risk, evidence-backed, scoped changes.
- Skill changes are snapshotted and ledgered.
- Thought and Dream can both apply low-risk skill evolution.
- Curator should auto-apply only typed low-risk lessons.
- Curator should auto-reject weak legacy workflow/troubleshooting dumps.
- Dream audits Thought-applied skill updates for usefulness, scope, duplication, and skill-bloat risk.
- Imported/upstream-managed skills should prefer overlays or additive Prometheus-owned resources.
- Procedural workflow/tool-order lessons belong in skills/resources/proposals rather than memory pollution.
- Background tasks can draft a skill proposal from a reusable task workflow.
- Hub surfaces skill suggestions and curator activity.

Skill evolution paths:

- `workspace/skills/`
- `generated/bundled-skills/`
- `workspace/skills/.manifests/`
- `workspace/skills/.history/<skillId>/`
- `workspace/skills/.history/skill-change-ledger.jsonl`
- `workspace/Brain/skill-episodes/<date>/episodes.jsonl`
- `workspace/Brain/skill-gardener/<date>/`
- `workspace/Brain/skill-curator/suggestions.json`
- `workspace/Brain/skill-curator/reports/`

Source anchors:

- `src/agents/reactor.ts`
- `src/agents/spawner.ts`
- `src/tools/skills.ts`
- `src/gateway/routes/skills.router.ts`
- `src/gateway/routes/tasks.router.ts`
- `web-ui/src/pages/HubPage.js`
- `workspace/self/15-paths-and-sharp-edges.md`

## 12. Hub Usage And Self-Improvement Dashboard

The Hub is a product surface for Prometheus usage, skills, Brain activity, and future achievement surfaces.

Feature findings:

- Hub powers skill usage.
- Hub includes tool heatmaps.
- Hub includes skill content previews.
- Hub includes achievement stubs.
- Hub loads Brain skill suggestions and Thought/Dream activity.
- Hub renders curator suggestion first sentences.
- Hub labels sources such as Brain.

Source anchors:

- `src/gateway/routes/hub.router.ts`
- `web-ui/src/pages/HubPage.js`
- `workspace/self/02-startup-runtime.md`
- `workspace/self/15-paths-and-sharp-edges.md`

## 13. More Feature Areas To Preserve In The Index

These are feature clusters that should remain explicit in future docs/copy:

- Browser visual grounding policy: use fresh snapshots/screenshots when UI state changes or is ambiguous.
- Text-first browser/desktop policy for non-vision models.
- Creative mode remains a normal main-chat tool category, not a separate assistant runtime.
- Recent tool observations are structured and reused by main chat, boot context, compaction, goal runner, and Brain loops.
- Each independently running main chat, mobile chat, Telegram chat, background task, subagent/team run, scheduled task, heartbeat, brain thought, or dispatch run should be modeled as its own runtime/session.
- Backend channel classification should normalize by session ID prefix, not just transient frontend source fields.
- Browser login connection flows exist for browser-session connectors, including X/Twitter.
- XURL setup flow can launch/approve browser login commands.
- Obsidian, memory, projects, canvas, migration, processes, coding, chat, onboarding, skills, tasks, channels, teams, settings, goals, proposals, audit log, connections, and extensions are all first-class gateway route families.
