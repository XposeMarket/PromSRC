---
name: "teams-meeting-pipeline"
description: "Design or implement a Microsoft Graph-backed Teams meeting ingestion pipeline, or process a transcript the user already supplied. Use for Teams-specific integration work; use meeting-notes for ordinary meeting summaries and document-to-action-items for extracting tasks from an available transcript."
---

# Teams meeting pipeline

**Availability check first.** No bundled Microsoft Teams connector or `teams_*` tools currently ship in Prometheus. Do not call or promise `teams_list_meetings`, `teams_get_transcript`, `teams_summarize_meeting`, or `teams_sync_actions_to_tasks`. Use `connector_list` or `tool_search` to check whether the user has since connected a Teams/Graph integration. If not, ask for an authorized transcript export or offer to design the connector; do not claim account access.

## Process an available transcript

1. Confirm meeting identity, source, time, attendees when known, privacy constraints, and the requested output.
2. Extract a source-grounded summary, decisions, open questions, actions with named owners and deadlines only where explicit; mark inferred assignments for confirmation. Use `meeting-notes` and `document-to-action-items` for their respective procedures.
3. Draft follow-up messages, never send or mutate tasks without authorization and applicable tool approval.
4. Verify quotes and action references against the supplied transcript, preserve its provenance, and report gaps.

## Build an integration only when requested

1. Verify connected tools and narrow Microsoft Graph OAuth scopes, tenant licensing, and admin policy for transcript/recording access. Use `connector-builder` for an implementation project; do not invent tool names before registration.
2. Implement read-only discovery and transcript retrieval first. Summarization and action extraction are Prometheus-side processing, not a Graph API promise.
3. Add explicit approval boundaries for follow-up email, task sync, sharing, and storing private transcripts.
4. Test missing transcripts, permission denial, duplicate imports, redaction, attendee mismatch, and confirmed write paths using mocks before live connection.
5. Acceptance: a real authorized read yields a traceable summary/actions, and denied access fails closed.
