# Source vs Workspace Tool Routing — 2026-05-30

Observed during the mobile voice context investigation: a Prometheus source-debugging subagent initially used generic workspace file tools against `web-ui/src/mobile` and `src`, which returned “not found” because the task was running from the workspace sandbox rather than the Prometheus source root. It recovered by activating/using Prometheus source-read tools and then produced a useful source-grounded report.

Guidance for future Prometheus source investigations:

- For files under Prometheus app source surfaces (`src/**`, `web-ui/**`, `electron/**`, `scripts/**`, `SELF.md`, etc.), activate `prometheus_source_read` early and use source-specific tools (`grep_source`, `read_source`, `list_source`, `read_webui_source`, `list_webui_source`, etc.).
- Do not treat a generic `list_directory({"path":"src"})` or `list_directory({"path":"web-ui/src/mobile"})` miss as evidence that the source path does not exist. In subagent/workspace contexts, it often means the wrong tool surface was used.
- When a source investigation needs both audit/workspace artifacts and Prometheus source, use workspace file tools for audit/memory/task files and source tools for app source files; cite which surface each path came from.
- If a tool path misses unexpectedly, switch surfaces once and re-run the narrow source search before reporting a blocker.

Evidence: `audit/tasks/state/715e1508-0923-44eb-b488-379b2aabd4cb.json` journal lines 103-122 show generic file tool misses for `web-ui/src/mobile` and `src`; lines 135-140 show recovery by requesting the Prometheus source-read category; lines 672-673 show the final source-grounded diagnosis.