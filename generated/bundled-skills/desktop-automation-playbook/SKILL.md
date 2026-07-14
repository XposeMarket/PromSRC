---
name: "desktop-automation-playbook"
description: "Inspect or operate native Windows applications through Prometheus's six desktop wrappers, including exact-window actions, native-resolution region recapture, accessibility controls, deterministic waits, macros, and isolated background automation. Use for native apps, OS UI, or desktop modals; use browser tools for ordinary web pages and terminal tools for shell work."
---

# Desktop Automation Playbook

Use the six model-facing wrappers; granular compatibility handlers such as `desktop_screenshot` and `desktop_window_click` are internal.

| Need | Wrapper |
| --- | --- |
| screenshots, monitors, visual waits, pixel changes | `desktop_screen` |
| apps, processes, windows, launch, close | `desktop_apps` |
| exact-window state, capture, accessibility, and input | `desktop_window` |
| global or capture-anchored input and fixed waits | `desktop_input` |
| record or replay stable flows | `desktop_macro` |
| isolated Windows Sandbox/VM work | `desktop_background` |

## Canonical exact-window workflow

1. Discover the target with `desktop_apps({action:"list_windows"})`. Use `list_apps` when installed identity or launch information matters.
2. Select the exact window and call `desktop_window({action:"state", window_token, include_screenshot:true})`. Prefer `window_token` over the compatibility `window_id`; the token rejects recycled HWNDs.
3. Act against that same token with `click`, `type`, `key`, `scroll`, or `drag`.
4. Re-observe when geometry changed, the result is ambiguous, or the next action depends on fresh state.

Keep short related actions on one verified token. A user focus change can invalidate assumptions, so stop and re-ground after focus, stale-state, or cancellation errors.

## Grounding and verification

Follow **observe → anchor → act → verify**:

- Choose points from the freshest relevant screenshot and carry its `screenshot_id` with `coordinate_space:"capture"`.
- Never pass screenshot pixels as window coordinates.
- Prefer fresh accessibility state plus `invoke`, `set_value`, `select`, `toggle`, or `focus_element` when UI Automation exposes the control reliably. Accessibility element IDs are single-state references; recapture after each semantic action.
- A successful click, key injection, or generic pixel change does not prove the requested page, chat, document, or panel opened. Verify its exact visible identity.
- An unchanged result is not permission to click nearby pixels. Re-observe or report the blocker.

For tiny text, ribbons, sidebars, or dense controls, orient with one full-window capture and then use `desktop_window({action:"region_screenshot", window_token, region:[x1,y1,x2,y2]})`. The crop comes from the native source before normalization. Use `locate_text` or atomic `click_text` against that crop when accessibility exposes only app chrome. After one failed click, allow at most one tighter recapture before reporting the specific failure. Completion proof should show the full exact window, not only the targeting crop.

## Surface and safety rules

- Normal Chrome/Edge page → browser wrappers.
- Native app, modal, or OS UI → desktop wrappers.
- Build, git, scripts, or files → terminal/workspace tools.
- Work that must not disturb host focus → `desktop_background`; host and worker tokens, screenshots, logins, and coordinates never transfer between them.
- Use native window control for maximize, restore, minimize, and close rather than clicking title-bar chrome.
- Prefer `wait_for_change`, `pixel_watch`, or `diff_screenshot` over blind sleeps.
- Macros are only for stable repetition; re-ground afterward when side effects matter.
- Stop on `DESKTOP_CANCELLED`, a locked desktop, or unavailable input. Never resume automatically.

## Recovery

- `STALE_WINDOW` → list windows and acquire a new token.
- `STATE_STALE` → recapture accessibility state.
- Missing window → rediscover; never reconstruct a handle from memory.
- No accessibility data → use a fresh screenshot or keyboard fallback.
- Launch accepted but no window → wait briefly, inspect processes/windows, and report only what is proven.
- Background timeout → inspect worker readiness instead of silently switching to host input.

Read [references/detailed-guide.md](references/detailed-guide.md) only when the task needs full command recipes for coordinate spaces, region OCR, accessibility actions, deterministic waits, macros, background workers, or detailed failure recovery. Load only the matching historical note or example, never the whole resource bundle.
