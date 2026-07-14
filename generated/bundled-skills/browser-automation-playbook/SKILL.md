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

## Input and extraction

- Use fill-style actions for normal inputs and type-style actions for editors, search boxes, and controls that depend on key events.
- Use browser-native upload/download actions rather than manipulating OS dialogs.
- Use structured extraction for repeated records with a known schema.
- Use page-text collection for prose and broad reading inside a dynamic page.
- Use scroll collection only when pagination or ordinary extraction cannot retrieve the data.
- Use JavaScript or network interception as a fallback inspection route, not as the default interaction path.

## Recovery

When a ref is stale, the page navigated, or a click appears ineffective, stop and refresh the observation. Do not repeat blind actions. If the DOM is sparse or misleading, capture fresh visual evidence and use vision-guided interaction. If authentication requires an existing user-owned browser profile, confirm the appropriate browser surface instead of silently switching profiles.

For direct assets, use the direct download tool. For supported social/video pages, use the media download path. Verify file existence and content before reporting success.

## Read details only when needed

- Read [detailed-guide.md](references/detailed-guide.md) for advanced browser tools, observation modes, download/media decisions, and recovery patterns.
- Read [session-hygiene-browser-close.md](references/session-hygiene-browser-close.md) before deciding whether to close a session.
- Read the relevant topic under `references/workflows/` only for the matching workflow; do not load all historical recipes.

Finish with evidence from the current page or downloaded artifact, not an assumption based on the requested action.
