---
name: "Google Drive connector"
description: "Find, read and inspect files in the connected Google Drive via the connector_google_drive wrapper, and connect Drive through the in-app browser login card when it is not connected yet."
triggers: ["google drive", "my drive", "drive file", "google doc", "connect google drive"]
requiredTools: ["connector_google_drive"]
---

# Google Drive connector

Call `connector_google_drive({action, ...args})`, or `tool_search({query:"drive <task>"})` then `tool_call`.

| Task | action |
|---|---|
| Recent / folder listing | `list_files` |
| Search by name or text | `search` |
| Metadata | `get_file` |
| Read contents (Docs export as text) | `read_file` |
| Anything else in the Drive v3 API | `api_request` (read-only unless the user asked) |

## Not connected yet (works from the phone)

1. `connection_ops({action:"plan", service:"google_drive"})`, then `connect`. Drive reuses Gmail's saved Google OAuth app.
2. The result has an authorization URL. Open it in the in-app browser (`browser_session` open), then `request_browser_login({site:"Google Drive", url})` so the user taps **Allow** on the login card. The in-app browser runs on the PC, so the `localhost` callback works.
3. `connection_ops({action:"continue"})` then `verify`. Confirm with `connector_list` (google_drive connected, 5/5 tools).
4. If Google says the Drive API is disabled, the user must enable it in the same Google Cloud project Gmail uses.
