# Gateway Core and Agent Builder Tool Index

Generated from the gateway assembly sources on 2026-07-22. The first group is always assembled by `tool-builder.ts` (subject to normal public-build and role filtering). The second group is registered only when `agent_builder.enabled=true` and the Agent Builder service is reachable.
**Total:** 29 gateway-assembly tools (21 core/dynamic-wrapper tools, 8 optional Agent Builder tools).

## `src/gateway/tool-builder.ts` — 21 tools

| Tool | Source-derived capability |
|---|---|
| `connector_list` | List all available connectors (Gmail, GitHub, Slack, Notion, Google Drive, Reddit, HubSpot, Salesforce, Stripe, Google Analytics, Obsidian, X/Twitter, xAI/Grok when configured) and their connection status. Shows which connectors are connected and what tools are available for each. Use this before activating the external_apps category to check what\'s available. |
| `delivery_send` | Unified delivery/presentation wrapper. action="send" sends a message, file, or image through an origin-aware delivery channel; action="screenshot" captures/reuses a screenshot and delivers it; action="present_file" presents a local file as an inline assistant artifact and optionally delivers it. Prefer target="origin" unless the user explicitly names a destination. |
| `delivery_send_screenshot` | Capture or reuse a desktop/browser screenshot and deliver it through the origin-aware delivery router. Prefer target="origin" unless the user explicitly names a destination. Using mobile/Telegram as the origin does not mean desktop capture is unavailable; Prometheus still captures from the local computer. |
| `process_kill` | Kill a running supervised process by runId. |
| `process_log` | Read stdout/stderr logs for a supervised process run. |
| `process_status` | Inspect supervised command runs. Pass runId for one process, or omit it to list recent process cards. |
| `process_submit` | Send one line of stdin to a running supervised process. Use for prompts in interactive CLIs started with start_process({stdin:true}). |
| `process_wait` | Wait for a running supervised process to exit and return its captured output. |
| `run_command` | Run shell commands or open apps. Dev CLI commands (git, npm, node, python, etc.) run CAPTURED by default — output is returned inline, no new window. Pass visible:true only if the user explicitly needs to see a terminal window. For GUI apps (notepad, code, explorer) a visible window opens automatically. NEVER use for Chrome/Edge — use browser_open instead. **GIT BEST PRACTICES FOR PROMETHEUS**: (1) For submodule (workspace/xposemarket-site), ALWAYS use full path: `git -C workspace/xposemarket-site status` NOT `cd xposemarket-site` which fails with "path not found". (2) Use `git -C <path>` pattern for reliable automation. (3) Initialize submodules: `git submodule update --init --recursive`. |
| `send_telegram` | Proactively send a message or screenshot to the user\'s Telegram. Works from ANY session — web UI, background task, cron job. Use to notify the user of task completion, errors, or to share a desktop screenshot. For screenshots: call desktop_screenshot first, then send_telegram with screenshot:true. |
| `start_process` | Start a long-running command as a supervised Prometheus process. Use this for dev servers, watchers, interactive CLIs, long builds, renders, or commands the user may want to inspect/kill later. Returns a runId; use process_status/process_log/process_wait/process_kill/process_submit to manage it. |
| `subagent_spawn` | Spawn a child agent in an isolated session to handle a parallel subtask. Use only when the current task must wait for the child result before it can continue. For ASAP, urgent, time-sensitive, or independent parallel work, use background_ops(action:"spawn") instead so the current task can continue without waiting. Do NOT call this recursively from inside a child task. |
| `terminal` | Unified terminal/process tool. action=run runs a bounded captured command; start creates a supervised background process; status/log/wait/kill/submit manage process runIds. Default permissions ask before outside-workspace paths; Lite permissions allow full-computer terminal access except hard-blocked dangerous commands. |
| `tool_result_read` | Read one bounded text range from an oversized tool result saved out-of-band during this same chat session. Use only when the [TOOL_RESULT_BOUNDED] preview says omitted content is required. Follow next_offset_bytes to continue. |
| `vercel_ops` | Unified Vercel connector wrapper for status, teams, projects, deployments, redeploy, env, and domains. |
| `x_admin` | Unified X API admin/escape-hatch wrapper for usage and raw API requests. |
| `x_dm` | Unified X direct-message wrapper. |
| `x_lists` | Unified X list wrapper for list reads, membership, follows, pins, and list mutations. |
| `x_posts` | Unified X post/bookmark/like/repost wrapper. Mutating actions still use the existing X connector handlers and policy. |
| `x_search_ops` | Unified X/xAI search wrapper. Delegates to current X API search/trends/space tools or xAI X search. |
| `x_users` | Unified X user/profile/social graph wrapper. |

## `src/gateway/agents-runtime/agent-builder-integration.ts` — 8 tools

| Tool | Source-derived capability |
|---|---|
| `architect_workflow` | Design and create a new Agent Builder workflow after searching existing templates first; avoid duplicate workflows by reusing a matching template. |
| `create_node_subagent` | Create a persistent Prometheus writing subagent for an AI-authoring workflow node (tweet/email/slack/etc), then attach it to the node via subagent_config. |
| `deploy_workflow` | Activate a workflow and save it to Prometheus\'s persistent registry. After this, the workflow is remembered forever and can be reused with execute_workflow_template(). Call only after test_workflow() passes. |
| `execute_workflow_template` | Execute an existing workflow with runtime inputs. Use this to run any workflow that was previously deployed — no API calls to rebuild, instant execution. |
| `get_workflow_status` | Get the current status and execution history of a deployed workflow. |
| `search_workflow_templates` | Search Prometheus’s local workflow registry first, then Agent Builder, before designing a new workflow; matching templates should be executed rather than rebuilt. |
| `test_workflow` | Run a dry-run test of a workflow to verify it works before deploying. Call after credentials are verified. |
| `verify_workflow_credentials` | Check whether all required API credentials for a workflow are present in Agent Builder. Call this after architect_workflow() returns credentials_needed. |

