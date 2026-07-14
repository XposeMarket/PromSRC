---
name: "teams-meeting-pipeline"
description: "Build a Microsoft Graph-backed Teams meeting pipeline for meeting discovery, transcript or recording ingestion, action extraction, follow-up drafting, and explicit task sync. Use when implementing Teams meeting integration or processing Teams meeting data with user intent."
---

# Teams Meeting Pipeline

Use this skill when Prometheus needs Microsoft Teams meeting context, transcripts, recordings, action items, or follow-up workflows.

## Prometheus Fit

Build this on Microsoft Graph connectors. The pipeline should feed Prometheus memory, tasks, and document/email drafting, while respecting meeting privacy and tenant permissions.

## Tool Scope

Start with:

- `teams_list_meetings`
- `teams_get_meeting`
- `teams_get_transcript`
- `teams_get_recording_metadata`
- `teams_summarize_meeting`
- `teams_extract_actions`
- `teams_draft_followup`
- `teams_sync_actions_to_tasks`

## Rules

- Use Microsoft Graph OAuth through Connections/vault.
- Declare required scopes clearly and keep them narrow.
- Do not ingest private transcripts or recordings without explicit user intent.
- Preserve meeting IDs, organizer, attendees, timestamps, transcript source, and links.
- Follow-up emails, chat messages, task creation, and file sharing require confirmation.
- Store generated summaries/actions as workspace artifacts or memory records according to user intent.
- Handle tenant policy failures gracefully; Teams transcript access is often admin-restricted.

## Implementation Route

1. Use `connector-builder` for Graph REST calls or extend an existing Microsoft connector.
2. Add meeting discovery and transcript read tools first.
3. Add summarization/action extraction as Prometheus-side processing, not provider-side magic.
4. Add confirmation-gated follow-up and task sync.
5. Add mocked tests for missing transcript, permission failure, and action extraction.

## Acceptance Check

Prometheus can turn Teams meetings into searchable context, action items, and follow-ups while keeping private meeting data under explicit user control.
