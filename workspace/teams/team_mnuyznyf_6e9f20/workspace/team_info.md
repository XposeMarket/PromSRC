# Xpose Website Rebuild Team Info
Team ID: team_mnuyznyf_6e9f20
Workspace: D:\Prometheus\workspace\teams\team_mnuyznyf_6e9f20\workspace
## Enduring Purpose / Mandate
Continuously improve Xpose Market's website so it better converts visitors into clients. Focus: clear service messaging, social proof, call-to-action optimization, and SEO fundamentals. Weekly audit cycle: auditor reports blockers and opportunities → builder implements → analyst measures impact and feeds back into next audit.
## Business / Project Context
Continuously improve Xpose Market's website so it better converts visitors into clients. Focus: clear service messaging, social proof, call-to-action optimization, and SEO fundamentals. Weekly audit cycle: auditor reports blockers and opportunities → builder implements → analyst measures impact and feeds back into next audit.
## What This Team Is For
Continuously improve Xpose Market's website so it better converts visitors into clients. Focus: clear service messaging, social proof, call-to-action optimization, and SEO fundamentals. Weekly audit cycle: auditor reports blockers and opportunities → builder implements → analyst measures impact and feeds back into next audit.
## What This Team Should Not Do
- Do not start work without an explicit run/start instruction or scheduled trigger.
- Do not launch every subagent by default.
- Do not write outputs outside the team workspace unless a higher-level Prometheus flow explicitly approves it.
- Do not treat subagent results as accepted until the manager verifies them.
## Subagent Roster and Role Rationale
- Site Auditor (id: researcher_site_audit_v1): Audits Xpose website for UX, conversion blockers, SEO gaps, and competitor positioning.
  - Base preset: researcher
  - Team role: Site Auditor
  - Team assignment: Inspect Xpose Market website for UX issues, broken elements, unclear messaging, SEO gaps. Compare against 2–3 competitor agencies. Identify top 3–5 improvements and prioritize by impact. Report with screenshots and concrete recommendations.
- Site Builder/Executor (id: builder_site_executor_v1): Implements website improvements: copy edits, design tweaks, UX fixes, and deployment.
  - Base preset: builder
  - Team role: Site Builder
  - Team assignment: Receive audit recommendations and priority items. Edit xposemarket-site/ files: update copy, fix broken elements, add components. Test locally, deploy to production, verify live. Communicate progress to team.
- Performance Analyst (id: analyst_site_performance_v1): Tracks website metrics: traffic, conversions, engagement, and improvement velocity.
  - Base preset: analyst
  - Team role: Performance Analyst
  - Team assignment: Pull website analytics: traffic, bounce rate, pages per session, conversions, device breakdown. Track week-over-week impact of auditor recommendations and builder deployments. Report patterns and recommend next audit focus.
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
- Team workspace writes should stay under: D:\Prometheus\workspace\teams\team_mnuyznyf_6e9f20\workspace
- Source writes should be proposal-gated unless a narrow, low-risk path is explicitly allowed by runtime policy.
## Useful Memory / Context Discovered During Creation
No context reference cards recorded yet.
## Important Workspace Files
- team_info.md: durable team mandate and operating context.
- memory.json: cumulative team knowledge and structured note events.
- last_run.json: latest manager-run summary and verification decisions.
- pending.json: unresolved blockers, follow-ups, and questions.