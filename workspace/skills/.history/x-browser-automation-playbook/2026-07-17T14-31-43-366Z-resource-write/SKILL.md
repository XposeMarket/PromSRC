---
name: "x-browser-automation-playbook"
description: "Operate X/Twitter interactively in an authenticated browser session: search, navigate, post, reply, like, inspect bookmarks, and recover from X-specific UI state. Use only when the user requests live X interaction; use x-post-fetch-and-media for reading a known post and general browser automation for non-X sites."
---

# X browser automation

Use the least invasive X-capable route that completes the request.

## Route first

- Known post/thread URL and read-only analysis: use `x-post-fetch-and-media` or direct web fetch before browser interaction.
- Live authenticated posting, replying, liking, searching, or bookmarks: use this skill.
- Account strategy or scheduled account operation: use the relevant explicit X operator skill.
- Non-X website: use the general browser skill.

## Interactive loop

1. Open or observe the intended X page and confirm the authenticated account when an action will publish or engage.
2. Use fresh refs from the current snapshot.
3. Draft content separately when practical, then place it in the composer.
4. Before a public side effect, verify text, media, target post/account, and action type.
5. Perform the action once and confirm the resulting post/reply/engagement from current UI evidence.

Use direct X-specific composites when available and appropriate. Fall back to ordinary browser controls only when the composite is unavailable or the user requests direct UI operation.

## Collection

For search/result collection, prefer structured text extraction and bounded scrolling. Deduplicate by post URL or ID. Stop when the requested count or search boundary is reached; do not scroll indefinitely.

## Recovery

If X changes layout, a ref becomes stale, or a composer action appears ineffective, re-observe instead of repeating the click. If authentication is missing, stop and report the required login rather than attempting an unintended account. Treat rate limits, verification prompts, and action blocks as blockers—not invitations to bypass platform controls.

## Read details only when needed

- Read [detailed-guide.md](references/detailed-guide.md) for composer paths, keyboard collection, bookmarks, and fallback patterns.
- Read [no-em-dash-x-copy.md](references/no-em-dash-x-copy.md) when generating account copy that follows that style constraint.
- Read [scheduled-x-jobs-and-composer.md](references/scheduled-x-jobs-and-composer.md) only when a live X action intersects a scheduled workflow.

Never publish, reply, like, or otherwise mutate X unless the user’s request authorizes that specific external action.
