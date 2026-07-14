---
name: "google-workspace-expansion"
description: "Extend Prometheus Google Workspace connectors for Calendar, Docs, Sheets, Drive, Gmail, or Contacts using OAuth-backed typed tools. Use when implementing or broadening Google Workspace integration; do not invoke for ordinary email, document, or spreadsheet content work."
---

# Google Workspace Expansion

Use this skill when adding or extending Google Workspace capabilities in Prometheus.

## Prometheus Fit

Build this as connector coverage, not browser automation. Prometheus should authenticate through its Connections panel and vault, then expose typed tools for Gmail, Drive, Calendar, Docs, Sheets, and Contacts.

## Connector Scope

Prefer these tool groups:

- Calendar: list calendars, search events, create/update events, availability lookup.
- Gmail: search messages, read thread, draft email, send only after explicit confirmation.
- Drive: search files, read metadata, upload/download files, create folders, permission inspection.
- Docs: create document, append/replace content, export document.
- Sheets: read ranges, write ranges, append rows, create sheets, export CSV/XLSX.
- Contacts: search people, read contact profile, create/update contacts with confirmation.

## Rules

- Reuse any existing Google connector before adding a new one.
- Use OAuth scopes as narrowly as possible and declare them in the connector manifest.
- Never store OAuth tokens in skill files, workspace files, logs, or generated docs.
- Any send, share, delete, permission change, or bulk write action requires explicit user confirmation.
- Prefer Google API structured calls over browser automation.
- Normalize dates and time zones before creating Calendar events.
- Return stable source links for Drive, Docs, Sheets, Gmail threads, and Calendar events.

## Implementation Route

1. Inspect existing Prometheus Google/Gmail/Drive tools and avoid duplicate names.
2. Use `connector-builder` to create or extend a data-dir connector.
3. Put credentials behind Connections/vault access.
4. Add pagination handling for list/search tools.
5. Add smoke tests using mocked API responses first; live tests should be opt-in.

## Acceptance Check

Prometheus can safely read, search, draft, and create Workspace artifacts without needing the user to open Google in a browser.
