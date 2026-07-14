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

- `chat-helpers.ts` maintains default command-token allowlists plus config-backed shell command extensions
- legacy `BLOCKED_PATTERNS` text exists, but hard-deny behavior is now primarily enforced through config `tools.permissions.shell.blocked_patterns` and `src/gateway/tool-deny-policy.ts`
- `isAllowedShellCommand(...)` checks whether a shell command token can proceed to later policy/approval gates
- `subagent-executor.ts` blocks bad patterns before approval logic
- `findCommandPermissionGrant(...)` can auto-allow repeated approved command/browser/desktop actions scoped to cwd, browser page, or desktop window
- approvals are created through `getApprovalQueue()` and can be delivered to Telegram when `telegramChannel.sendCommandApproval` exists


Windows command-policy expansion facts from `src/gateway/chat/chat-helpers.ts`, `src/config/config.ts`, `src/config/config-schema.ts`, `src/types.ts`, and `src/gateway/tool-deny-policy.ts`:

- command allowlisting is token-based: `isAllowedShellCommand(...)` splits shell input on `&&`, `||`, pipes, and `;`, then `isAllowedShellSegment(...)` checks the first command token from each segment
- base cross-platform tokens live in `DEFAULT_ALLOWED_SHELL_COMMANDS`; Windows-specific diagnostics/read-only tokens live in `DEFAULT_WINDOWS_READ_SHELL_COMMANDS`; Windows local-control tokens live in `DEFAULT_WINDOWS_SYSTEM_SHELL_COMMANDS`
- config can extend or override the token pool through `tools.permissions.shell.allowed_commands`, `allowed_windows_read_commands`, `allowed_windows_system_commands`, and `allowed_custom_commands`
- config `tools.permissions.shell.blocked_patterns` can also remove exact command tokens from the dynamically built allow set when the blocked pattern is a simple token
- current default Windows read/diagnostic command tokens include `ipconfig`, `ping`, `tracert`, `nslookup`, `netstat`, `tasklist`, `systeminfo`, `driverquery`, PowerShell `get-process` / `get-service` / `get-computerinfo` / `get-winevent`, networking diagnostics, device/disk readers, `sc`, and `schtasks`
- current default Windows local-control command tokens include `powercfg`, `taskkill`, PowerShell process/service/task mutators, `winget`, `displayswitch(.exe)`, `control`, `rundll32`, clipboard commands, and `reg`
- being token-allowed only means the command can proceed to normal policy, path-scope, audit, command-permission-grant, and approval handling; it is not automatic execution
- `approval_mode: "lite"` only changes repeated approval friction; it does not bypass token allowlisting, native-file-tool bypass detection, path-scope checks, audit logging, or hard-deny patterns
- `tool-deny-policy.ts` still hard-denies machine-interruption/destructive patterns such as shutdown/restart/logoff and `powercfg /hibernate on|off` during autonomous goal execution
- future “Jarvis” work should prefer first-class typed system tools over ever-wider raw shell: power management, process management, service control, network diagnostics, event-log inspection, device/display control, package management, and firewall/security diagnostics should wrap command execution with validation, approval copy, verification, and audit output

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
- `src/gateway/process/command-outcome.ts` is the canonical success classifier. Success requires a normal `exit` with code 0; overall/no-output timeout, signal, manual cancellation, spawn failure, nonzero exit, and unknown/null termination all fail closed even if an exit code happens to be 0.
- Captured `run_command`, wrapper command execution, and `process_wait` surface the structured termination reason/signal in `ToolResult.extra`; persisted process records use the same classifier for completion/failure summaries.
- supports stdin pipe/write/submit/close for interactive commands
- marks stale starting/running/exiting records as exited on supervisor startup

## 24B) Gateway Liveness and Recovery

- `npm run gateway` starts through the CLI gateway supervisor; supervision and health-based restart are enabled by default and can be explicitly disabled with `PROMETHEUS_SUPERVISOR=0` or `PROMETHEUS_SUPERVISOR_RESTART=0`
- the supervisor probes `/api/health` every fifteen seconds after startup with a five-second timeout and restarts the gateway after two consecutive failed health checks; both values are configurable with `PROMETHEUS_SUPERVISOR_HEALTH_TIMEOUT_MS` and `PROMETHEUS_SUPERVISOR_HEALTH_FAILURE_LIMIT`
- a current runtime heartbeat defers recovery briefly, but a frozen `modelBusyAgeMs` no longer grants unlimited busy grace; recovery also accounts for heartbeat age and `modelBusySince`
- the gateway's internal event-loop stall recovery is enabled by default and requests a managed restart after a 45-second stall; set `PROMETHEUS_GATEWAY_STALL_AUTORESTART=0` only for diagnostics
- supervised children hand graceful/internal stall restarts back to the existing supervisor instead of spawning a second detached `prom` tree; detached replacements explicitly clear the child-only supervision flag so supervision cannot be lost across restart
- Electron has an independent main-process health watchdog, so a renderer-visible app with an unresponsive gateway is recovered even though the child process is still alive
- recursive workspace `search_files` uses asynchronous filesystem calls and yields periodically, preventing large Brain/audit scans from monopolizing the Node event loop
