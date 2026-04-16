# Nightly Code Bug Hunter Team Info
Team ID: team_mnuyznzb_15d161
Workspace: D:\Prometheus\workspace\teams\team_mnuyznzb_15d161\workspace
## Enduring Purpose / Mandate
Monitor Prometheus codebase for runtime errors, broken integrations, and code quality regressions. Nightly automated scans: scanner finds errors → triager filters and verifies impact → verifier confirms critical bugs and recommends fixes. Goal: catch bugs before they affect production or user sessions.
## Business / Project Context
Monitor Prometheus codebase for runtime errors, broken integrations, and code quality regressions. Nightly automated scans: scanner finds errors → triager filters and verifies impact → verifier confirms critical bugs and recommends fixes. Goal: catch bugs before they affect production or user sessions.
## What This Team Is For
Monitor Prometheus codebase for runtime errors, broken integrations, and code quality regressions. Nightly automated scans: scanner finds errors → triager filters and verifies impact → verifier confirms critical bugs and recommends fixes. Goal: catch bugs before they affect production or user sessions.
## What This Team Should Not Do
- Do not start work without an explicit run/start instruction or scheduled trigger.
- Do not launch every subagent by default.
- Do not write outputs outside the team workspace unless a higher-level Prometheus flow explicitly approves it.
- Do not treat subagent results as accepted until the manager verifies them.
## Subagent Roster and Role Rationale
- Bug Scanner (id: operator_bug_scanner_v1): Automated nightly scans for code errors, broken imports, and syntax issues.
  - Base preset: operator
  - Team role: Bug Scanner
  - Team assignment: Run nightly scans of src/: TypeScript/JS errors, broken imports, syntax issues. Run npm run build, capture errors. Scan logs for console.error patterns. Report with file/line/severity.
- Bug Triager (id: analyst_bug_triager_v1): Reviews scan findings, verifies impact, and prioritizes fixes.
  - Base preset: analyst
  - Team role: Bug Triager
  - Team assignment: Review Scanner findings. Verify each: check git context, assess true impact. Categorize by severity: critical (blocks core), high (data issue), medium (performance), low (dead code). Generate triage report.
- Bug Verifier (id: verifier_bug_reviewer_v1): Validates critical bugs, recommends fixes, and prepares for developer action.
  - Base preset: verifier
  - Team role: Bug Verifier
  - Team assignment: Review critical and high-priority issues from Triager. Verify: bug is real, impact confirmed, root cause understood. Recommend fix. Create bug report with reproduction steps. Hand off to dev team.
## Operating Style
- Dispatch only the agents relevant to the current task.
- Check existing files and memory before doing new work.
- Verify created/modified files when relevant.
- Update memory.json, last_run.json, and pending.json at the end of meaningful runs.
## Quality Bar / Definition of Done
- Outputs are specific, evidence-backed, and usable by the team owner.
- Incomplete, vague, or placeholder subagent outputs are re-dispatched with a specific correction.
- [GOAL_COMPLETE] is used only after the current task is substantively complete and team memory files are updated.
## Target Outputs
- Durable artifacts in this workspace.
- Structured run memory in memory.json, last_run.json, and pending.json.
- Concise manager status in team chat.
## Known Constraints
- Team workspace writes should stay under: D:\Prometheus\workspace\teams\team_mnuyznzb_15d161\workspace
- Source writes should be proposal-gated unless a narrow, low-risk path is explicitly allowed by runtime policy.
## Useful Memory / Context Discovered During Creation
No context reference cards recorded yet.
## Important Workspace Files
- team_info.md: durable team mandate and operating context.
- memory.json: cumulative team knowledge and structured note events.
- last_run.json: latest manager-run summary and verification decisions.
- pending.json: unresolved blockers, follow-ups, and questions.