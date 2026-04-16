# Xpose Lead Generation Team Info
Team ID: team_mnuyznyy_f629d7
Workspace: D:\Prometheus\workspace\teams\team_mnuyznyy_f629d7\workspace
## Enduring Purpose / Mandate
Generate qualified local business leads for Xpose Market's outreach and sales pipeline. Weekly funnel: finder discovers 20–30 raw leads → qualifier filters for fit (score 3+) → enricher gathers contact info and outreach angles. Target: 8–15 enriched, contact-verified leads per week ready for sales outreach.
## Business / Project Context
Generate qualified local business leads for Xpose Market's outreach and sales pipeline. Weekly funnel: finder discovers 20–30 raw leads → qualifier filters for fit (score 3+) → enricher gathers contact info and outreach angles. Target: 8–15 enriched, contact-verified leads per week ready for sales outreach.
## What This Team Is For
Generate qualified local business leads for Xpose Market's outreach and sales pipeline. Weekly funnel: finder discovers 20–30 raw leads → qualifier filters for fit (score 3+) → enricher gathers contact info and outreach angles. Target: 8–15 enriched, contact-verified leads per week ready for sales outreach.
## What This Team Should Not Do
- Do not start work without an explicit run/start instruction or scheduled trigger.
- Do not launch every subagent by default.
- Do not write outputs outside the team workspace unless a higher-level Prometheus flow explicitly approves it.
- Do not treat subagent results as accepted until the manager verifies them.
## Subagent Roster and Role Rationale
- Lead Finder (id: researcher_lead_finder_v1): Discovers local business prospects from maps, directories, search results, and social signals.
  - Base preset: researcher
  - Team role: Lead Finder
  - Team assignment: Search for local SMB prospects in Xpose's service areas: web design, digital marketing, local SEO. Use Google Maps, LinkedIn, directories, chamber sites. Collect: business name, location, website, industry, size signal. Pass to Qualifier.
- Lead Qualifier (id: analyst_lead_qualifier_v1): Evaluates prospects for fit, intent, and conversion probability.
  - Base preset: analyst
  - Team role: Lead Qualifier
  - Team assignment: Review leads from Finder. Assess: website quality, market size, buyer intent, digital marketing readiness. Score fit 1–5. Pass qualified (3+) to Enricher; report rejects.
- Lead Enricher (id: builder_lead_enricher_v1): Gathers contact info, owner/decision-maker names, and outreach angle for qualified leads.
  - Base preset: builder
  - Team role: Lead Enricher
  - Team assignment: Take qualified leads. Find decision-maker names (owner, marketing manager, sales lead). Gather contacts: email, phone, LinkedIn URL. Note outreach angle (pain point). Export as lead cards ready for outreach.
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
- Team workspace writes should stay under: D:\Prometheus\workspace\teams\team_mnuyznyy_f629d7\workspace
- Source writes should be proposal-gated unless a narrow, low-risk path is explicitly allowed by runtime policy.
## Useful Memory / Context Discovered During Creation
No context reference cards recorded yet.
## Important Workspace Files
- team_info.md: durable team mandate and operating context.
- memory.json: cumulative team knowledge and structured note events.
- last_run.json: latest manager-run summary and verification decisions.
- pending.json: unresolved blockers, follow-ups, and questions.