---
name: Desktop Automation Playbook
description: Current operating guide for Prometheus desktop automation on Windows. Covers screenshot-first execution, window targeting, UI Automation, precise clicking, scrolling, typing, verification, and when to use desktop tools versus browser or shell tools.
emoji: 🖥️
version: 3.0.0
triggers: desktop, desktop_screenshot, desktop_window_screenshot, desktop_click, desktop_type, desktop_type_raw, desktop_press_key, desktop_drag, desktop_scroll, desktop_launch_app, desktop_close_app, desktop_focus_window, desktop_get_accessibility_tree, desktop_get_window_text, desktop_pixel_watch, click screen, type into app, open app, automate desktop, GUI automation, screen, windows automation
---

# Desktop Automation Playbook

Read this before any desktop automation task.

This skill is for **native Windows app interaction** and any UI that must be controlled at the OS level.

---

## Core operating rules

### 1) Screenshot first
Before clicking, scrolling, or typing into an unfamiliar desktop UI:
1. identify the right window if needed
2. focus it
3. take a screenshot
4. act
5. verify with another screenshot or another state-reading tool

Preferred grounding tools:
- `desktop_window_screenshot(...)` for a single app window
- `desktop_screenshot(...)` for full desktop / multi-monitor context
- `desktop_get_accessibility_tree(...)` for structured controls and bounds
- `desktop_get_window_text(...)` for reliable readable text

### 2) Prefer the narrowest view that answers the question
- One app window → `desktop_window_screenshot`
- Whole desktop / multi-monitor uncertainty → `desktop_get_monitors` then `desktop_screenshot`
- Need exact controls and coordinates → `desktop_get_accessibility_tree`
- Need text from a UI-heavy window → `desktop_get_window_text`

### 3) Verify after actions
After clicks, scrolls, keypresses, and typing into changing UIs, re-ground before the next decision.

Best verification tools:
- `desktop_window_screenshot`
- `desktop_screenshot`
- `desktop_diff_screenshot`
- `desktop_wait_for_change`
- `desktop_pixel_watch`

### 4) Clipboard is not the default reading strategy
Use desktop visuals and UI inspection first.

For typing:
- `desktop_type(text)` is acceptable for fast paste-style entry
- `desktop_type_raw(text)` is the fallback when paste is blocked

For reading/extraction, prefer screenshots / UI Automation over clipboard tricks unless the user explicitly wants clipboard use or it is clearly the best fallback.

---

## Tool map

### Orientation and capture
- `desktop_get_monitors()` — monitor layout and virtual bounds
- `desktop_screenshot(...)` — full desktop or selected monitor/region
- `desktop_window_screenshot(...)` — crop to one window
- `desktop_diff_screenshot()` — describe change between screenshots
- `desktop_wait_for_change(...)` — wait until screen changes

### Window targeting
- `desktop_find_window(name)` — locate window by title/process
- `desktop_focus_window(name)` — bring target window to front
- `desktop_get_process_list(filter)` — list visible processes/windows
- `desktop_launch_app(app, args)` — open app and wait for window
- `desktop_close_app(name)` — close app/window

### UI understanding
- `desktop_get_window_text(window_name)` — extract visible text via UI Automation
- `desktop_get_accessibility_tree(window_name, max_depth, max_nodes)` — controls, roles, states, bounds

### Actions
- `desktop_click(...)`
- `desktop_drag(...)`
- `desktop_scroll(...)`
- `desktop_press_key(...)`
- `desktop_type(...)`
- `desktop_type_raw(...)`
- `desktop_wait(...)`

### Precision waiting
- `desktop_pixel_watch(...)` — wait for color change at one pixel

---

## Standard workflow

### A. Native app interaction
1. `desktop_find_window` or `desktop_launch_app`
2. `desktop_focus_window`
3. `desktop_window_screenshot(..., focus_first:true)` or `desktop_screenshot`
4. inspect UI
5. click/type/keypress/scroll
6. take another screenshot or use another inspection tool to verify

### B. Unknown window layout
1. `desktop_window_screenshot` for the active or named window
2. if controls are unclear, call `desktop_get_accessibility_tree`
3. use control bounds for precise clicking
4. verify visually afterward

### C. Multi-monitor workflow
1. `desktop_get_monitors()`
2. use `monitor_index` or virtual coordinates correctly
3. screenshot the relevant monitor or region before acting

---

## When to use each tool

### `desktop_window_screenshot`
Use this first when you know which app matters.

Best for:
- VS Code
- desktop chat apps
- Explorer
- dialog boxes
- settings windows

This is usually better than full-desktop capture because it gives a cleaner, more focused visual.

### `desktop_screenshot`
Use when:
- you do not know which monitor/window is relevant
- a popup/menu may be outside the app window
- you need the whole desktop context

### `desktop_get_accessibility_tree`
Use when you need exact UI structure.

Best for:
- finding named buttons or fields
- checking if a control is enabled/disabled
- getting coordinates from bounding boxes
- navigating dense native UIs more reliably than OCR alone

### `desktop_get_window_text`
Use when the goal is to read what a window says, not necessarily click it.

Best for:
- terminals
- editors
- dialog text
- forms with readable labels/values

### `desktop_click`
Use after you are grounded in a screenshot or accessibility bounds.

If the click changes the UI, verify before choosing the next action.

### `desktop_scroll`
Use for scrollable panes, but remember:
- wheel events go to the control under the cursor
- in multi-pane apps, first click inside the pane you want to scroll
- optional x/y targeting matters

### `desktop_type`
Fast paste-style typing.

Use when:
- regular text entry is fine
- app accepts paste
- speed matters

### `desktop_type_raw`
Fallback for:
- password fields
- terminals that reject paste
- apps that intercept or block clipboard paste
- situations where per-key events matter

### `desktop_press_key`
Use for:
- Enter / Escape / Tab
- shortcuts like Ctrl+S, Ctrl+C, Ctrl+V
- app navigation when pointer use is slower or less reliable

### `desktop_pixel_watch`
Use when a single visual indicator signals readiness.

Great for:
- loading spinners
- enabled/disabled button color changes
- completion indicators

Cheaper than repeatedly screenshotting.

---

## Precision patterns

### Click a named control accurately
1. `desktop_get_accessibility_tree(window_name)`
2. locate the control and its bounds
3. click the center point with `desktop_click`
4. verify with screenshot

### Read a window without OCR guesswork
1. `desktop_focus_window(name)`
2. `desktop_get_window_text(name)`
3. if needed, pair it with `desktop_window_screenshot`

### Scroll the correct pane
1. take screenshot
2. click inside the actual scrollable area
3. `desktop_scroll(..., x, y)` over that area
4. verify content moved

### Multi-monitor click safety
1. `desktop_get_monitors()`
2. use monitor-relative coordinates when appropriate
3. screenshot that monitor before clicking

---

## Desktop vs browser vs shell

| Situation | Best tool |
|---|---|
| Website interaction in Chrome session | browser tools |
| Native Windows app | desktop tools |
| Terminal / build / git / scripts | `run_command` |
| Reading website content only | `web_search` + `web_fetch` |
| Need exact desktop UI bounds | `desktop_get_accessibility_tree` |

If it is a normal website, browser tools are usually better than desktop tools.
If it is a native app or OS dialog, desktop tools are the right path.
If it is a shell job, use `run_command` instead of clicking around a terminal.

---

## Common mistakes to avoid

- Clicking before taking a screenshot on an unfamiliar UI
- Using full-desktop screenshots when a window screenshot would be clearer
- Scrolling without first putting the cursor over the intended pane
- Using clipboard-based reading when screenshot/UI Automation would be cleaner
- Assuming focus is correct without `desktop_focus_window`
- Repeating blind clicks instead of re-grounding visually

---

## Quick decision table

| Situation | Best tool / workflow |
|---|---|
| Need to see one app clearly | `desktop_window_screenshot` |
| Need whole desktop context | `desktop_get_monitors` → `desktop_screenshot` |
| Need exact control names and bounds | `desktop_get_accessibility_tree` |
| Need visible text from a window | `desktop_get_window_text` |
| Need to wait for UI to finish changing | `desktop_wait_for_change` or `desktop_pixel_watch` |
| Paste-style text entry | `desktop_type` |
| Paste blocked | `desktop_type_raw` |
| Need to scroll a pane | click pane → `desktop_scroll` |

---

## Bottom line

Desktop automation should be driven by what is **currently visible**.
Screenshot first. Focus correctly. Act carefully. Verify after each meaningful change.
Prefer precise window capture and UI Automation over guesswork.
