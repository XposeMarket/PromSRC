## 24) Terminal Command and Approval System

Terminal execution depends on the active runtime surface. In current Codex desktop sessions, the canonical terminal tool is `shell_command`; older Prometheus gateway/chat runtimes still expose `run_command`, which sits under policy, approval, and path-scope gates.

Current Codex desktop terminal behavior:

- `shell_command` runs PowerShell commands and returns captured output inline
- set `workdir` explicitly when project or workspace context matters
- use `read_thread_terminal` to inspect an already-open app terminal for the current desktop thread
- use `load_workspace_dependencies` when scripts need bundled Node.js, Python, or document/PDF helper paths
- use short, non-interactive commands for builds, tests, git/status, diagnostics, and local inspection
- do not use shell commands for manual file edits when native edit tools are available; use `apply_patch` for manual code edits

Legacy Prometheus `run_command` behavior:

- dev CLI commands run captured by default
- `visible: true` opens a terminal window only when needed
- GUI apps open visibly
- Chrome/Edge should not be launched through `run_command`; use `browser_open`
- `run_command` should be used for tests, builds, git/status, package installs, diagnostics, and transformations that native file tools cannot do
- ad hoc shell/Python/Node/PowerShell file edits are blocked as native-file-tool bypasses; use read/grep/stats plus file edit tools instead
- cwd resolution defaults to the project root when the active workspace is the primary workspace and the project root has `package.json`
- absolute paths referenced in commands are checked against allowed roots and blocked roots

Command safety/runtime details:

- `chat-helpers.ts` maintains `SAFE_COMMANDS`
- `chat-helpers.ts` maintains `BLOCKED_PATTERNS`
- `isAllowedShellCommand(...)` checks whether a shell command is allowed
- `subagent-executor.ts` blocks bad patterns before approval logic
- `findCommandPermissionGrant(...)` can auto-allow repeated approved command/browser/desktop actions scoped to cwd, browser page, or desktop window
- approvals are created through `getApprovalQueue()` and can be delivered to Telegram when `telegramChannel.sendCommandApproval` exists

Policy engine tiers from `src/tools/registry.ts`:

- `read` = execute immediately
- `propose` = create/stage proposal instead of executing
- `commit` = require explicit approval before executing

Important split:

- `src/tools/registry.ts` has its own policy-gated `ToolRegistry.execute(...)` / `executeBypass(...)` path for registry tools and standalone Reactor-style agents
- chat/background/team/subagent tool calls generally flow through `src/gateway/agents-runtime/subagent-executor.ts`, which performs its own policy/audit/approval pass before capability dispatch and fallback switch handling
- `run_command_supervised` exists in the standalone tool registry/process-tools layer, while chat-facing tool definitions use `start_process` and `process_*` for supervised process control

Approval system facts:

- approvals are stored in-memory via `ApprovalQueue`
- approval resolutions are audit-logged
- web approval APIs are gateway-auth protected
- tasks can pause with `awaiting_command_approval`
- background task status is pushed to `needs_assistance` while awaiting approval
- Telegram can receive and resolve command approvals too

Current approval routes:

- `GET /api/approvals`
- `POST /api/approvals/:id`
- `POST /api/approvals/:id/approve`
- `POST /api/approvals/:id/deny`

## 24A) Managed Process Supervisor

Prometheus now has a persisted process supervisor in `src/gateway/process/`.
The singleton is exposed by `getProcessSupervisor()` and stores records/logs under `<configDir>/processes`.

Current process routes:

- `GET /api/processes`
- `POST /api/processes`
- `GET /api/processes/:runId`
- `GET /api/processes/:runId/log`
- `POST /api/processes/:runId/kill`
- `POST /api/processes/:runId/write`
- `POST /api/processes/:runId/submit`
- `POST /api/processes/:runId/close`

Process supervisor facts:

- supports foreground and background runs
- captures stdout/stderr into persisted log files
- broadcasts `process_run_started`, `process_run_update`, `process_run_output`, and `process_run_exited` WebSocket events
- supports overall timeout and no-output timeout termination
- supports stdin pipe/write/submit/close for interactive commands
- marks stale starting/running/exiting records as exited on supervisor startup
