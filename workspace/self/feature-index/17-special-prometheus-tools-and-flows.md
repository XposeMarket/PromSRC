# Special Prometheus Tools and Flows

This is the narrative companion to the raw tool indexes. It explains the Prometheus-specific “little systems” that are easy to miss when you only read individual function names. Last source verification: 2026-07-22.

## Research, web fetch, and X/Twitter URLs

### `web_search` and `web_fetch`

`web_search` is the preferred research entry point. It selects the configured preferred search provider by default, can force a named provider, or use multi-provider research. `fetch_top_k` can retrieve top result pages in the same research call. It is for discovering sources and, optionally, bringing back the first layer of page content.

`web_fetch` is for known URLs. It accepts one `url` or parallel `urls`, with bounded character/concurrency controls. Use it for articles, docs, static pages, and several known references before opening a browser. It avoids the cost and state of an interactive browser when clicking/filling/visual inspection is not needed.

### X/Twitter status fetch path

An X/Twitter status URL is a special `web_fetch` case. For one status URL, fetch that URL; for several, pass the URL list. Prometheus attempts post/thread extraction and attached-media recovery. `include_media:true` attempts X-media extraction even if post-text/thread extraction cannot complete. A media-only recovery is deliberately reported as usable media with unavailable text, rather than forcing an unnecessary manual `download_media` detour.

This is **not** the same as X API access. Fetching a public status URL is web retrieval; authenticated posting, social-graph operations, DMs, lists, usage, and raw API paths use the configured X connector wrappers.

## X connector, xAI, and xurl

Prometheus treats the bundled X connector as the owner of official X API/xurl-style capabilities. Its gateway wrappers include `x_search_ops`, `x_posts`, `x_users`, `x_lists`, `x_dm`, and `x_admin`; these are unified action wrappers over the current X API/social functions. Their capability page is [15-gateway-core-and-agent-builder-tools.md](15-gateway-core-and-agent-builder-tools.md).

**xurl** is the local X Developer CLI/OAuth helper, not a general web browser. The recommended setup is button-driven xurl authentication: add/update the `prometheus` app, set its exact callback URI, complete OAuth 2.0, select it as default, then verify identity. Prometheus can use the `~/.xurl` `prometheus` user-context token when vault credentials are unavailable. X Developer app credentials and a valid user-context OAuth token are required for X API operations.

xAI/Grok OAuth is separate: it provides Grok model/live-search and voice-media provider paths, not automatic X API authorization. Do not describe “xAI connected” as “can post to X.”

## Shopping and product artifacts

`shopping_search_products` is product discovery, not checkout automation. It follows the web provider strategy, can use multi-provider search, preserves provider thumbnails, fetches product-page metadata, extracts JSON-LD/Open Graph/large page images, and caches usable local images. `show_product_carousel` renders a rich interactive product result for chat. It presents selections; it does not purchase anything.

Other read-only rich artifact tools (`show_chart`, `show_comparison`, `show_map`, `show_market`, `show_prediction_market`, `show_sources`, `show_stocks`, `show_weather`, `show_agent_work`, `show_run_result`, and `show_ui_card`) turn structured data into interactive chat cards. They are presentation/output tools, not separate data authorities.

## Downloads, media, analysis, and generated output

- `download_url` downloads a direct URL into the controlled workspace.
- `download_media` handles media-page extraction through `yt-dlp`; it resolves Prometheus-bundled FFmpeg/FFprobe so downloads/audio-only extraction do not depend on a random global installation.
- `analyze_image` and `analyze_video` produce bounded analysis. Video supports quick/detail/both modes; full raw ffprobe data is opt-in. Transcription reports requested/available/provider/note status instead of fabricating a transcript.
- `media_generate`, image/video generation and Creative generation are provider-backed output paths. They save/project outputs through the media/Creative system and still need QA for production use.
- `present_file` behavior is unified under `delivery_send(action:"present_file")`; presenting a file embeds/delivers an artifact, it does not publish it externally.

## Delivery and channel routing

`delivery_send` is the canonical delivery wrapper. `action:"send"` delivers text/files/images, `action:"screenshot"` captures/reuses browser/desktop screenshots, and `action:"present_file"` renders local files as assistant artifacts and can deliver them. Default target is `origin`: the system returns to the channel that started the work unless the user names a destination.

Legacy `send_telegram`, `browser_send_to_telegram`, `delivery_send_screenshot`, and `present_file` remain compatibility routes but are not the recommended model-facing API. Sending to Telegram/mobile does not mean the local host screenshot source ceased to exist; it controls delivery, not capture ownership.

## Durable goal continuation

Main-chat `/goal` is a persistent thread-scoped completion contract. It stores objective, lifecycle, plan, evidence, checkpoints and budget. Continuation is deterministic: it only starts at safe turn boundaries when the thread is idle, no newer user message is queued, budget remains, and the preceding turn made measurable tool progress. This stops goal runs from spinning after empty turns.

`complete_goal` asks an isolated verifier to assess acceptance criteria, artifacts, tests and limitations; rejected evidence becomes focused continuation feedback. `block_goal` is for real missing authority/credentials/essential choices/external state—not a way to stop because work is difficult.

## Background tasks, internal watches, and automation dashboard

`background_ops` creates/steers/waits/status-checks ephemeral parallel workers; its legacy `background_*` names are compatibility aliases. `internal_watch` is different: it stores a bounded typed condition watch (file, task, schedule job or event queue) and wakes/alerts the originating session when it matches or times out. A watch observes; it does not secretly approve or rerun work. Its action policy controls what any follow-up may mutate.

`automation_dashboard` is a read-only cross-system snapshot of priorities, agents, schedules, tasks, Prometheus threads, teams, watches, outputs and update status. It is the special “what is going on?” operator tool rather than a chain of unrelated list calls.

Timers are one future user-like main-chat message. Schedules are one-shot/recurring automation. Heartbeat is per-agent continuation policy. These are three different systems and should never be collapsed in product copy.

## Evidence, diagnostics, audit, and task recovery

`diagnostic_packet` creates/reads/lists/resolves sanitized incident packets under the diagnostics workspace. It records evidence/recovery attempts but never edits application source. `prometheus_audit_ops` reconstructs interrupted work from bounded/redacted audit and continuity evidence; it is read-only. `prometheus_request_ops` reads/recover durable requests across sessions, including source edits, approvals, proposals and questions.

Task recovery is explained in detail in [pages/02-tasks.md](pages/02-tasks.md): task journal, managed-process logs, and evidence bus are separate records. That separation prevents a final summary, a tool event and an OS stdout line from being misrepresented as the same thing.

## Source editing, proposals, and verification

Prometheus source edits have a separate read/evidence/approval path from normal workspace edits. A source proposal carries inspected-file evidence, current state/fix, allowed files/directories, plan steps and verification expectations. Desktop, mobile and Telegram approval cards show that scope. Build-failure repair has a constrained proposal follow-up path; it does not grant unrestricted automatic edits.

`write_proposal` creates a pending governed change. `request_final_action_approval` and command/source approvals establish an explicit external/consequential boundary. Approval is part of the feature, not an error state.

## Repo, deployment, self-update, and repair

`prom_repo_ops` is the unified Prometheus repo synchronization wrapper (push/pull/sync); old leaf names are compatibility aliases. `vercel_ops` and configured Vercel connector tools manage deployment state, projects, deployments, redeploy, environment and domains. `deploy_analysis_team` creates a focused agent-team analysis/deployment workflow and renders its intended result inline rather than treating it as an arbitrary file attachment.

`self_update` and `self_repair` are release/maintenance capabilities, not ordinary user-workspace tools. Public packaging, generated UI synchronization and installer dependencies have their own operational references under `../public-runtime-release/`.

## Browser Teach, composites, skills, and Brain

Browser Teach records a user-demonstrated browser workflow, requests explicit verification boundaries, runs detached replay verification, then may recommend a composite tool, a skill, both or neither. It must not silently create either reusable asset. Composites save multi-step tool behavior; skills are maintained playbooks with resources, version/ledger history and governance.

Brain Thought/Dream, Skill Gardener and Curator are the self-improvement side: they gather evidence, verify current state before proposing anything, store continuity context, generate low-risk typed lessons where allowed, and proposal-gate higher-risk changes/new skills. They do not treat an old chat observation as proof that a problem still exists.

## Connections, MCP, and dynamic tools

`connector_list` is the discovery/status call before using external-app tools. Bundled connector tools appear only when their connector is configured and connected; MCP tools use dynamic `mcp__<server>__<tool>` names supplied by the live server. A complete static list is impossible by design for arbitrary MCP servers, so documents should list the installed connection plus its runtime-discovered tools rather than claiming an unknown server’s schema.

## Source map

`src/tools/`, `src/gateway/tool-builder.ts`, `src/gateway/tools/defs/`, `src/auth/x-api-oauth.ts`, `src/gateway/routes/chat.router.ts`, `../04-browser.md`, `../05-tools.md`, `../07-source-editing.md`, `../08-tasks-and-agents.md`, `../10-mcp-and-connections.md`, `../12-telegram-and-brain.md`.
