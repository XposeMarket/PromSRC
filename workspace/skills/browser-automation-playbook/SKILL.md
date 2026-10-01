---
name: "browser-automation-playbook"
description: "Operate interactive websites with Prometheus browser tools, including navigation, clicking, forms, uploads, downloads, dynamic-page extraction, screenshots, and browser UI verification. Use for live browser interaction; do not use for ordinary web research, native desktop apps, or X-specific workflows that have their own skill."
---

# Browser automation

Use browser tools for interactive website state. Use `web_search`, `web_fetch_batch`, or `web_fetch` for normal reading and research; use desktop tools for native apps.

## Core loop

1. Open or observe the page and use the returned snapshot.
2. Choose the narrowest observation that supports the next action.
3. Act with a current DOM reference when possible.
4. Verify meaningful state changes before continuing.
5. Close only sessions Prometheus created when cleanup is appropriate.

Prefer `observe:"compact"` for orientation, `observe:"delta"` for incremental UI changes, `observe:"snapshot"` when the next step needs refs, and screenshots when visual layout or canvas state matters. Do not request another snapshot when the previous action already returned sufficient state.

## Wait and confirm

Prefer waiting for a specific element, visible text, or state condition; next wait for a URL change, then network idle only if suitable. Avoid fixed sleeps longer than needed, especially in SPAs that may never reach network idle. After each click/action, inspect fresh `browser_observe` delta (`snapshot_delta` where available) to confirm what changed; take a full fresh snapshot when delta cannot establish state. Do not act repeatedly on a stale ref. In iframes, obtain a frame-scoped snapshot/ref where supported; for shadow DOM or inaccessible frames, use fresh screenshot evidence and a vision-guided click. Batch independent observations such as screenshot and console in one turn when they do not depend on each other.

For WAF/403/429/paywalls, use `blocked-page-recovery`; for exploratory bug hunting in a web app, use `webapp-dogfood-qa`.

## Input and extraction

- Use fill-style actions for normal inputs and type-style actions for editors, search boxes, and controls that depend on key events.
- Use browser-native upload/download actions when they work; use the native Windows file picker fallback below when the upload bridge fails.
- Use structured extraction for repeated records with a known schema.
- Use page-text collection for prose and broad reading inside a dynamic page.
- Use scroll collection only when pagination or ordinary extraction cannot retrieve the data.
- Use JavaScript or network interception as a fallback inspection route, not as the default interaction path.

## File upload workflow (Windows / in-house browser)

When a page has a file input, use this sequence and verify the selected filename in the page:

1. Observe the current page and identify the visible **Choose File**, **Browse**, or equivalent control.
2. Click the upload button with the browser tool. Clicking the control is supported even when programmatic upload is not.
3. If the browser-native `upload_file` action succeeds, verify the page shows the expected filename and continue.
4. If `upload_file` fails with `No browser session. Use browser_open first.` despite an active, visible browser session, treat it as an upload-bridge/session-handoff failure. Do not repeatedly retry blindly.
5. Use desktop automation to control the native Windows file picker opened by the browser click:
   - Focus the file picker.
   - Enter the full path to the intended file in the filename field, or use the picker search/location field when appropriate.
   - Confirm with **Open** (or the picker’s equivalent confirmation button).
6. Return to the browser and verify the file input now displays the selected filename, commonly as `C:\fakepath\<name>`, or verify the page’s upload state/status changed.
7. If the page has a separate **Upload**, **Submit**, or **Send** button, do not activate an external/irreversible final action without the normal approval requirement. For a local test page, verify the resulting status directly.

Known in-house browser behavior: browser clicks and desktop-driven native file selection work end-to-end. The in-house `upload_file` bridge may report no browser session even while navigation, snapshots, and the file input are working. The native file-picker path is the reliable fallback. Use a real existing path and preserve evidence of the final selected filename.

## Recovery

When a ref is stale, the page navigated, or a click appears ineffective, stop and refresh the observation. Do not repeat blind actions. If the DOM is sparse or misleading, capture fresh visual evidence and use vision-guided interaction. If authentication requires an existing user-owned browser profile, confirm the appropriate browser surface instead of silently switching profiles.

For direct assets, use the direct download tool. For supported social/video pages, use the media download path. Verify file existence and content before reporting success.

## Read details only when needed

- Read [detailed-guide.md](references/detailed-guide.md) for advanced browser tools, observation modes, download/media decisions, and recovery patterns.
- Read [session-hygiene-browser-close.md](references/session-hygiene-browser-close.md) before deciding whether to close a session.
- Read the relevant topic under `references/workflows/` only for the matching workflow; do not load all historical recipes.
