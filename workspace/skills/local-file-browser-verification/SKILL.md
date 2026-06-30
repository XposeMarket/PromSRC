---
name: Local File Browser Verification
description: Use this skill when the user asks Prometheus to test, manually verify, debug, smoke-test, open, inspect, or interact with a local HTML file, web artifact, small browser app, generated page, game, UI prototype, or static file in a real browser. Triggers on requests like: open this HTML and test it, start an HTTP server for this file, check the browser console, click the button and see what happens, manually verify this file, smoke test the local page, debug why the UI does not work, inspect console errors, take a screenshot of the local page, test this mobile HTML game, verify taps/clicks, run it in browser, use browser tools to test it, or check the DOM after clicking. Use this for local-file/browser workflows where visual state, console logs, network/runtime errors, DOM hit-testing, or actual UI interaction matter more than static code review.
version: 1.0.0
triggers: open this html and test it, start an http server for this file, check browser console, click the button and see what happens, manually verify this file, smoke test local page, debug why the ui does not work, inspect console errors, take a screenshot of the local page, test this mobile html game, verify taps and clicks, run it in browser, use browser tools to test it, check the dom after clicking, local html smoke test, browser verify local file
---

# Local File Browser Verification

Use this skill when Raul wants a local file, static page, generated HTML app, mini-game, prototype, or local browser artifact tested in a real browser instead of only inspected as code.

The goal is to reproduce what a human would do: serve the file over HTTP, open it, see it, click/tap it, inspect the console, check DOM/layout/hit-testing when interactions fail, fix if asked, retest, and report concrete evidence.

## Scope

Use this skill for:
- Local HTML/CSS/JS files
- Generated standalone web apps or games
- Static prototypes and exported artifacts
- Mobile-style browser testing from a desktop browser when actual phone automation is not necessary
- Debugging clicks/taps, CSS stacking, z-index, pointer events, overlays, touch controls, runtime errors, and console errors
- Smoke testing after editing a local browser file

Do not use this skill for:
- Full production web app QA requiring authenticated flows unless a separate app-specific skill applies
- Prometheus source/web-ui self-edits; those require Prometheus self-edit runbooks and dev approval routes
- External live websites where no local file/server is involved
- Pure code review with no browser execution requested

## Required Tool Categories

Before acting, activate what is needed:
- `workspace_write` for starting/stopping a local HTTP server and reading/writing workspace files
- `browser_automation` for opening the local URL, screenshots/snapshots, console inspection, clicks, DOM checks, and JS probes
- `desktop_automation` only when the user specifically wants OS-level screenshots/clicks, mobile-origin screenshots, or browser automation is insufficient

Prefer browser automation for local web pages. Use desktop automation only when visual OS state matters or the browser tool cannot interact correctly.

## Default Workflow

### 1. Locate and sanity-check the file

- Identify the exact file path from the user request or recent context.
- Confirm it exists before trying to serve it.
- If the file is HTML, prefer serving the containing directory rather than opening with `file://`, because many browser APIs behave differently under `file://`.
- If the file imports relative assets, serve the nearest project/root directory that preserves those relative paths.

### 2. Start a local HTTP server

Use a bounded or background terminal command depending on the tool environment.

Good defaults:
- Python: `python -m http.server <PORT> --bind 127.0.0.1`
- Node fallback: `npx http-server . -p <PORT> -a 127.0.0.1`

Choose an unused port if possible. Use the file's directory as the server working directory. Record:
- server command
- working directory
- URL opened
- server run/process id if applicable

If one server is already running for the same directory and port, reuse it rather than starting duplicates.

### 3. Open the page in the browser

Open:

`http://127.0.0.1:<PORT>/<relative-file-name>`

For mobile-ish artifacts, emulate the most relevant viewport if the browser tools support it, or at minimum test both:
- portrait/narrow viewport behavior
- landscape/wide behavior if the app is meant to rotate

Take a fresh screenshot or browser vision snapshot before interacting. Treat current visual evidence as the source of truth.

### 4. Capture initial diagnostics

Before clicking anything:
- Check browser console errors/warnings/logs if supported.
- Take a DOM snapshot or page text snapshot.
- Verify expected visible elements exist.
- Note obvious layout blockers: overlays, hidden elements, wrong z-index, disabled buttons, offscreen content, pointer-events issues, modal layers, or loading states.

### 5. Interact like a user

Perform the exact action the user cares about:
- Click the button/link/control
- Tap/click the mobile control region
- Type in fields if relevant
- Press keyboard shortcuts only if the UI requires keyboard interaction
- For visible buttons, prefer screenshot/snapshot-anchored clicks over blind JS invocation

After each meaningful interaction:
- Re-check screenshot/visual state
- Re-check console errors
- Re-check DOM state if behavior is unclear

Do not conclude success from “no console errors” alone. Confirm the UI changed as expected.

### 6. If a click/tap fails, diagnose hit-testing and overlays

When an element exists but clicking does not work, inspect:
- Which element is actually under the click point (`document.elementFromPoint(...)`)
- Bounding boxes for the intended target and covering elements
- `z-index`, `position`, `pointer-events`, `opacity`, `visibility`, and display state
- Whether touch/mouse/pointer event listeners are attached to the right element
- Whether an overlay or control layer intercepts input

Useful JS probes when visual/snapshot evidence is not enough:

```js
const el = document.querySelector('button, [role="button"], #startBtn');
const r = el?.getBoundingClientRect();
const mid = r ? [r.left + r.width / 2, r.top + r.height / 2] : null;
const top = mid ? document.elementFromPoint(mid[0], mid[1]) : null;
({ target: el?.outerHTML, rect: r, topAtCenter: top?.outerHTML });
```

For mobile/touch bugs, check whether the page has overlapping full-screen zones such as `#lookZone`, `#moveZone`, joystick layers, HUD layers, canvases, or transparent controls.

### 7. Fix only when appropriate

If the user asked to fix it, apply the smallest file edit that addresses the reproduced failure, then retest the exact action.

Common fixes:
- Raise the active modal/start card above control overlays with z-index
- Add `pointer-events: none` to non-interactive overlay containers and `pointer-events: auto` to real controls
- Attach `pointerdown`, `touchstart`, and `click` handlers when mobile taps are unreliable
- Stop propagation on important UI buttons when a lower game/control layer also listens for pointer input
- Prevent default touch behavior where needed, but avoid blocking all scrolling/interaction globally unless intentional
- Ensure buttons are not disabled or covered by canvas/HUD elements

After a fix, repeat the full verification loop:
1. reload page
2. screenshot current state
3. console check
4. click/tap target
5. screenshot changed state
6. console check again

### 8. Report concrete evidence

In the final response, keep it practical:
- file tested
- server URL/path
- what actions were performed
- initial console state
- reproduced issue, if any
- root cause if found
- exact fix if edited
- final verification result
- whether an attachment/screenshot/file was sent, if relevant

Avoid vague claims like “should work now.” Prefer “I clicked START, the game state changed from intro screen to gameplay, and console stayed at 0 errors.”

## Mobile/Phone Considerations

When Raul is on mobile and asks for visible proof, send screenshots to origin/mobile after meaningful visible steps if the task involves UI state. Use `delivery_send_screenshot` when available.

For mobile game/prototype testing:
- Test the start flow first in portrait/narrow layout.
- Test landscape controls if the app is meant to be rotated.
- Check that overlays do not intercept the start/menu UI.
- Check touch-specific listeners (`pointerdown`, `touchstart`, `touchmove`) and `touch-action` CSS.
- Be careful not to rely on desktop-only keyboard controls as proof of mobile success.

## Completion Checklist

A local browser verification run is complete only when:
- The file was served over HTTP or a specific blocker was identified
- The page was opened in a real browser
- A fresh screenshot/visual snapshot was inspected
- Console diagnostics were checked before and after the tested action
- The target UI action was attempted through browser/desktop interaction, not just by calling app functions directly
- Any failure was diagnosed with concrete evidence such as the intercepting element, console stack, network error, or DOM state
- If edited, the exact behavior was retested after the edit
- The final answer states what was verified and what remains unverified

## Example Final Report

```md
Tested `games/mobile-sideways-fps/index.html` through a local HTTP server.

- Opened `http://127.0.0.1:8123/index.html`
- Initial console errors: 0
- Screenshot showed the START GAME card visible
- Browser click initially failed because `#lookZone` was above the button and intercepted the tap
- Fixed CSS stacking so the HUD/start card sits above controls
- Retested: clicked START successfully, gameplay screen appeared
- Final console errors: 0
```
