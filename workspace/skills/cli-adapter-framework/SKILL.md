# CLI Adapter Framework

Use this skill when Prometheus needs to add, wrap, or harden an external command-line tool.

## Prometheus Fit

Prometheus is an Electron app with gateway tools, connectors, jobs, Brain, and a UI. Do not expose a CLI as "the assistant can run shell". Turn it into a Prometheus-facing adapter with typed actions, visible setup state, clear artifacts, and bounded side effects.

## Adapter Shape

Every CLI adapter should define:

- `status`: checks whether the binary exists, what version is installed, and whether required models/config files are present.
- `setup`: returns install guidance or launches a safe installer flow; never installs silently.
- `run`: accepts typed JSON input, validates paths and flags, runs the tool, and returns structured output.
- `cancel`: stops long-running work through Prometheus job/process control when available.
- `artifacts`: writes generated files under a declared workspace or data-dir output path.

## Rules

- Prefer a connector/plugin tool over free-form terminal use.
- Keep an allowlist of commands and flags. Reject arbitrary command strings.
- Use absolute paths internally, but present user-facing paths as workspace artifacts where possible.
- Parse machine-readable output first: JSON, CSV, XML, or known log formats.
- Do not pass secrets as command-line arguments. Use Prometheus credentials/vault plumbing.
- Include Windows path handling and binary discovery because Prometheus runs as a desktop app.
- For long work, use background jobs with progress events instead of blocking chat.
- Add a dry-run or preview mode for destructive or expensive operations.

## Implementation Route

1. Search existing connectors and skills for a matching integration.
2. If no native connector exists, scaffold a data-dir plugin through `connector-builder`.
3. Define the CLI contract before adding code: inputs, outputs, artifacts, permissions, and failure modes.
4. Add smoke tests for `status`, invalid input rejection, and a minimal successful run.
5. Surface the adapter in UI only after the status/setup flow can explain missing prerequisites.

## Acceptance Check

The adapter is ready when Prometheus can answer:

- Is the tool installed?
- What can it do?
- What exact action will run?
- Where did outputs go?
- How can the user stop or retry it?
