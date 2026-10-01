# Interaction and Failure Evidence

Use this checklist for the changed route and one adjacent path. The rendered page is the source of truth; DOM inspection alone is not enough.

## Interaction assertions

For each primary flow, record the starting state, exact user action, expected visible result, actual result, and screenshot or other evidence. Cover keyboard activation where relevant, focus movement, disabled/loading states, validation errors, retry/cancel behavior, and back/forward or reload persistence when applicable.

## Browser and accessibility checks

Check semantic landmarks, accessible names, keyboard reachability, visible focus, contrast-sensitive states, target size, zoom/reflow, reduced motion, and meaningful error text. Treat a visual pass as sampled evidence, not a claim that every route or breakpoint is accessible.

## Console and network capture

Record console errors and warnings, failed requests, status codes, blocked resources, and whether each is application-caused or an expected browser restriction. Redact tokens, cookies, personal data, and query strings that contain secrets. Distinguish a clean sample from proof that no intermittent failure exists.

## Media and state evidence

Verify local fonts, images, iframes, canvases, uploads, downloads, and storage-dependent behavior when used. For login-dependent flows, use only an authorized test account/state and do not persist or expose credentials. Capture before/after screenshots for meaningful visual changes and note viewport, route, content fixture, and browser.

## Failure report

When a check fails, preserve the smallest reproducible action sequence, visible symptom, console/network evidence, and exact URL/route. Do not silently retry until it passes or switch to a stale/generated copy.