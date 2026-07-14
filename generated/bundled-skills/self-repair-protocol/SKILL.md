---
name: "self-repair-protocol"
description: "Diagnose and recover Prometheus internal operational problems involving tasks, agents, teams, schedules, providers, connections, configuration, workspace state, startup, or runtime health. Use only when the user explicitly asks Prometheus to diagnose or repair itself; do not invoke for an ordinary isolated tool error."
---

# Self-Repair Protocol

Diagnose from current operational evidence, then use the narrowest governed recovery already available in this build.

## Triage order

1. Start with `system_diagnostics` for the public-safe cross-system snapshot; use `automation_dashboard` when deeper automation detail is needed.
2. Identify the affected domain: task, agent run, team, schedule, provider/connection, configuration, workspace data, startup/restart, dependency, or application defect.
3. Narrow with the matching live tools:
   - agent-owned run: `agent_run_ops(list|get)`;
   - general task: `task_control(list|latest|get)`;
   - schedule: `schedule_job_detail`, `schedule_job_history`, `schedule_job_log_search`, and `schedule_job_outputs(check)`;
   - team/agent coordination: agent and team status or conversation tools;
   - provider/connection: the relevant connection or provider status tool.
4. Use `workspace/audit/` only to reconstruct chronology or corroborate live evidence. Read the smallest relevant index or record and label its timestamp; the audit mirror may be delayed or stale.
5. Classify the root cause before changing anything.

## Recovery boundary

Prefer a bounded domain recovery over a global restart:

- recover, resume, rerun, pause, or cancel the affected task/run;
- preview a schedule correction before applying it;
- clear a confirmed stuck schedule state through its governed control;
- request missing credentials or user action without exposing secrets;
- propose an exact configuration or workspace-state correction with backup and rollback details.

Respect each tool's confirmation requirements. Never retry a write, message, purchase, deletion, or other side effect merely because it failed. Preserve unrelated work and verify the affected subsystem after recovery.

## Evidence rules

- Live tools and canonical runtime stores determine current status.
- Audit records and transcripts provide historical context, not current truth.
- Prefer task journals, failed steps, runtime progress, tool errors, schedule run history, output checks, and provider health over assistant summaries.
- Redact secrets, tokens, credentials, private message content, and unrelated user data.
- Distinguish transient failure, user-action requirement, operational state failure, and reproducible application defect.

## Application defects

If operational recovery cannot resolve a reproducible application defect, call `diagnostic_packet(action:"create", ...)` to create a sanitized packet containing:

- expected and observed behavior;
- minimal reproduction;
- affected subsystem and version/build information;
- relevant live-state and audit evidence with timestamps;
- attempted non-destructive recovery;
- confidence, uncertainty, and user-visible workaround.

Use only an authorized maintenance or support route actually available in the current build. Do not claim that the installed application was modified or repaired when no such capability exists.

## Completion

Call recovery complete only when the affected operation passes a targeted check and the current live state is healthy. A queued retry, attempted restart, successful command, or old audit record is not proof of recovery.
