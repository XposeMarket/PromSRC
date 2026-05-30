---
name: Desktop Automation Playbook
description: Current operating guide for Prometheus desktop automation on Windows. Covers screenshot-first execution, window targeting, UI Automation, precise clicking, scrolling, typing, verification, macros, and when to use desktop tools versus browser or shell tools.
emoji: 🖥️
version: 4.3.0
triggers: desktop, desktop_screenshot, desktop_window_screenshot, desktop_window_control, desktop_click, desktop_drag, desktop_scroll, desktop_type, desktop_type_raw, desktop_press_key, desktop_find_window, desktop_focus_window, desktop_get_accessibility_tree, desktop_get_window_text, desktop_get_monitors, desktop_find_installed_app, desktop_list_installed_apps, desktop_launch_app, desktop_send_to_telegram, desktop_wait_for_change, desktop_pixel_watch, desktop_record_macro, desktop_replay_macro, click screen, type into app, open app, find installed app, launch app by app_id, automate desktop, GUI automation, windows automation, mouse click, screenshot anchored click, coordinate_space, maximize window, restore window, minimize window
---

# Desktop Automation Playbook

Read this before any desktop automation task.

This skill is for **native Windows app interaction** and any UI that must be controlled at the OS level instead of through browser tools or shell commands.

---

## Core operating doctrine

### 1) Observe before acting
For desktop work, the default loop is:
1. identify the correct monitor/window
2. focus the target window if needed
3. capture the current UI
4. act
5. verify the result before the next action

Preferred grounding tools:
- `desktop_window_screenshot(...)` for one specific app window
- `desktop_screenshot(...)` for full desktop / multi-monitor context
- `desktop_get_accessibility_tree(...)` for structured controls, roles, enabled state, and bounds
- `desktop_get_window_text(...)` for reliable visible text extraction

### 2) Prefer the narrowest view that answers the question
- One app matters → `desktop_window_screenshot`
- Multi-monitor uncertainty → `desktop_get_monitors` then `desktop_screenshot`
- Need exact controls and bounds → `desktop_get_accessibility_tree`
- Need readable text from a window → `desktop_get_window_text`
- Need to know what changed → `desktop_wait_for_change` or `desktop_diff_screenshot`

### 3) Verify after meaningful UI changes
After clicks, drags, scrolls, typing, or keypresses in a changing UI, re-ground before the next decision.

Best verification tools:
- `desktop_window_screenshot`
- `desktop_screenshot`
- `desktop_diff_screenshot`
- `desktop_wait_for_change`
- `desktop_pixel_watch`
- `desktop_get_window_text`
- `desktop_get_accessibility_tree`

### 4) Clipboard is for input convenience, not default reading
For typing:
- `desktop_type(text)` = paste-style text entry through clipboard
- `desktop_type_raw(text)` = per-key fallback when paste is rejected

For reading, prefer screenshots and UI Automation over clipboard tricks unless the user explicitly wants clipboard use or clipboard is the only clean fallback.

### 5) Use the right control surface
- Website in Chrome/Edge → browser tools are usually better
- Native Windows app, modal, or OS dialog → desktop tools
- Terminal/build/git/script work → `run_command`

Do not use desktop clicks to operate a website unless browser automation is unavailable or the user explicitly wants OS-level interaction.

---

## Full desktop tool map

### Orientation and capture
- `desktop_get_monitors()` — list connected monitors, bounds, and virtual desktop coordinates
- `desktop_screenshot(...)` — capture all monitors, primary monitor, a specific monitor, or a cropped region
- `desktop_window_screenshot(...)` — capture one app window with optional focus-first behavior
- `desktop_diff_screenshot()` — describe the change between the two most recent desktop screenshots
- `desktop_wait_for_change(...)` — wait until the screen changes before continuing

### Window and app targeting
- `desktop_find_window(name)` — find windows by title or process name; use returned handles when multiple matches exist
- `desktop_focus_window(name)` — bring a matching window to the foreground
- `desktop_window_control(action, name?, handle?, active?)` — natively minimize, maximize, restore, or close a window without title-bar coordinate clicks; use `active:true` for the focused window and exact `handle` when names collide
- `desktop_get_process_list(filter)` — list visible processes/windows
- `desktop_find_installed_app(query)` — fuzzy-rank installed apps and return stable `app_id` values for deterministic launch
- `desktop_list_installed_apps(filter?, limit?, refresh?)` — list discoverable installed apps and stable launch IDs
- `desktop_launch_app(app_id?, app?, args?, wait_ms?)` — start an app and wait for its window; prefer `app_id` from discovery over guessing raw executable names
- `desktop_close_app(name, force)` — close a window/app or force-kill it

### UI understanding and text extraction
- `desktop_get_window_text(window_name)` — read visible text and values from a window via UI Automation
### Mouse and keyboard actions
- `desktop_click(...)` — actual mouse click at coordinates; supports `coordinate_space:"capture"|"window"|"monitor"|"virtual"`, screenshot/window anchoring, left/right click, double-click, modifiers, and verification modes
- `desktop_drag(...)` — click-and-drag between coordinates using the same coordinate-space model as clicks
- `desktop_scroll(...)` — mouse wheel scroll over the control under the pointer, optionally anchored to screenshot/window/monitor coordinates
- `desktop_press_key(key)` — keyboard key or shortcut like `Enter`, `Escape`, `Ctrl+S`, `Alt+Tab`
- `desktop_type(text)` — fast clipboard-paste text entry into focused control
- `desktop_type_raw(text)` — raw key-by-key entry when paste fails
- `desktop_wait(ms)` — fixed delay when you truly just need time to pass
- `desktop_type_raw(text)` — raw key-by-key entry when paste fails
- `desktop_wait(ms)` — fixed delay when you truly just need time to pass

### Clipboard helpers
- `desktop_get_clipboard()` — read clipboard text

### Telegram proof / sharing
- `desktop_send_to_telegram(caption?)` — send the most recent desktop screenshot to Raul; call `desktop_screenshot` first so there is a fresh image to send
- `desktop_set_clipboard(...)` — place text, image, or file(s) on the clipboard

### Precision waiting
- `desktop_pixel_watch(...)` — watch one pixel until it changes or matches a target color

### Macro automation
- `desktop_record_macro(name)` — begin recording desktop input actions
- `desktop_stop_macro(name)` — stop and save the current macro
- `desktop_replay_macro(name, speed_multiplier)` — replay a saved macro
- `desktop_list_macros()` — list saved macros and action counts

---

## Standard workflows

### A. Native app interaction
1. `desktop_find_window` or `desktop_launch_app`
2. `desktop_focus_window` only when focus is uncertain or the app is not already active
3. `desktop_window_screenshot(..., focus_first:true)` or `desktop_screenshot` when visual grounding is needed
4. inspect UI
5. click / type / keypress / scroll / drag
6. verify with another screenshot or a state-reading tool when the result is ambiguous or risky

### A1. Active chat composer / coding-assistant apps — type-only path
Use this for Codex, Claude, Cursor chat, and similar desktop AI/coding assistant apps when the user has already put the cursor in the composer or explicitly says variants of: “just type”, “don’t click”, “don’t focus”, “type and press Enter”, or “the box is already active”.

Hard rule: **do not click, focus, screenshot, inspect, close, switch windows, read UI, or touch anything else.** The only allowed actions are:
1. `desktop_type(message)`
2. `desktop_press_key("Enter")`

This overrides the normal observe/focus/screenshot loop because the user is intentionally giving a focus-preserving command. Extra desktop actions can steal focus, close the wrong app, trigger the wrong composer, or mutate nearby windows.

**Failure pattern this prevents:** opening/focusing Codex, Claude, or Cursor successfully, then over-automating with screenshots/clicks/close-button guesses and accidentally affecting the wrong app. For these chat apps, once the correct app/composer is ready, the safest workflow is boring: type, Enter, stop.

**Direct send recipe:**
```text
# Preconditions: user says the composer is active, or the target app was just opened/focused and the cursor is already in the composer.
desktop_type("<message>")
desktop_press_key("Enter")
```

Do not “verify” by clicking or refocusing between those two calls. If verification is needed afterward, use a screenshot only after sending, and do not interact with the UI unless the user asks.


If the user says to open Codex/Claude/Cursor first, the minimal safe path is:
1. open or focus the named app only if necessary using `desktop_launch_app` or `desktop_focus_window`
2. stop touching the UI
3. when the user says to send text, use only `desktop_type(message)` then `desktop_press_key("Enter")`

Never click sidebars, title bars, close buttons, chat history, or composer areas in these apps unless the user explicitly asks for that exact click.

### B. Unknown window layout
1. `desktop_window_screenshot` for the active or named window
2. if controls are unclear, use `desktop_get_accessibility_tree`
3. click using control bounds or visible screenshot evidence
4. verify visually afterward

### C. Multi-monitor workflow
1. `desktop_get_monitors()`
2. choose `monitor_index`, `coordinate_space:"monitor"`, or a cropped screenshot region
3. screenshot the relevant monitor/window/region and keep the returned `screenshot_id`
4. prefer screenshot-anchored actions: `coordinate_space:"capture"` + `screenshot_id`
5. if acting directly on monitor coordinates, use `coordinate_space:"monitor"` + `monitor_index`; treat `monitor_relative:true` as legacy alias only
6. verify on that same monitor/window

### D. Text-heavy window workflow
1. `desktop_focus_window(name)` when focus is needed and not already guaranteed
2. `desktop_get_window_text(name)`
3. pair with `desktop_window_screenshot` if layout context matters
4. only fall back to screenshot reading if UI Automation text is incomplete

### E. Repetitive GUI workflow
1. do the task once carefully while recording with `desktop_record_macro`
2. stop with `desktop_stop_macro`
3. confirm available macros with `desktop_list_macros`
4. replay with `desktop_replay_macro`
5. still verify after replay if the workflow has side effects
---

## When to use each tool

### `desktop_get_monitors`
Use first when:
- the machine has multiple displays
- coordinates may be wrong because you do not know monitor bounds
- you need to crop or click on a specific display

This is the orientation tool for multi-monitor safety.

### `desktop_screenshot`
Use when:
- you need full desktop context
- a popup/menu may appear outside the app window
- you do not yet know which window or monitor matters
- you want to crop a specific region of the virtual screen

### `desktop_window_screenshot`
Use this first when you know which app matters.

Best for:
- VS Code
- desktop chat apps
- Explorer
- settings windows
- dialogs
- Electron apps

Targeting options:
- `name` — capture a window by title/process substring
- `handle` — capture the exact HWND when `desktop_find_window` returned multiple candidates
- `active:true` — capture the currently focused window when the user says “current/focused window”
- `focus_first:false` — inspect without stealing focus when focus preservation matters
- `padding` — include a small border around the window crop when title bars or shadows matter

This is usually better than a full-desktop screenshot because it removes irrelevant surroundings.

### `desktop_find_window`
Use when you need to locate a target app by title or process before focusing or capturing it.

### `desktop_focus_window`
Use before typing, keypresses, or app-specific actions whenever focus might be wrong.

Do not assume the intended app is already foregrounded.

### `desktop_window_control`
Use when the task is to minimize, maximize, restore, or close a window. Prefer this native window-management tool over coordinate-clicking title-bar buttons.

Common patterns:
- Maximize the focused window: `desktop_window_control({ action: "maximize", active: true })`
- Maximize a known app: `desktop_window_control({ action: "maximize", name: "Codex" })`
- Restore a known handle: `desktop_window_control({ action: "restore", handle })`

Use exact `handle` from `desktop_find_window` when multiple matching windows exist. For "maximize the focused window" requests, this can be the entire action; do not take screenshots or click the maximize button unless native control fails or visual verification is specifically needed.

### `desktop_find_installed_app` / `desktop_list_installed_apps` / `desktop_launch_app`
Use installed-app discovery before launching apps when the target may have a Start Menu/app registration entry.

Preferred launch flow:
1. `desktop_find_installed_app({ query: "codex" })` or `desktop_list_installed_apps({ filter: "codex" })`
2. choose the best returned `app_id`
3. `desktop_launch_app({ app_id, wait_ms })`

This is more deterministic than guessing raw executable names. Use raw `app` only when discovery cannot find the target or the user gives an explicit executable/path.

### `desktop_get_process_list`
Use when:
- window matching is failing
- you are unsure which process owns the visible window
- you need to discover what is open before focusing or closing something

### `desktop_close_app`
Use when the user explicitly wants a window/app closed, or when cleanup is part of the task.

### `desktop_click`
This is the actual mouse click tool.

Use it when:
- you already know the target coordinates from a screenshot, window screenshot, or accessibility bounds
- you need left-click, right-click, or double-click
- you need a modifier-assisted click like `Shift` or `Ctrl`
- you want post-click verification with `verify:"auto"` or `verify:"strict"`

Coordinate-space rules:
- Prefer `coordinate_space:"capture"` + fresh `screenshot_id` when clicking a point chosen from a screenshot image.
- Prefer `coordinate_space:"window"` with `window_name`/`window_handle` when using app-local coordinates.
- Use `coordinate_space:"monitor"` + `monitor_index` for per-monitor coordinates.
- Use `coordinate_space:"virtual"` only when the virtual desktop coordinate is known and stable.
- Treat `monitor_relative:true` as a legacy alias for monitor coordinates; new instructions should use `coordinate_space`.

### `desktop_drag`
Use for:
- selecting text or files
- resizing panes/windows
- dragging sliders
- drag-and-drop operations

Ground first with a screenshot so start/end coordinates are intentional. Use the same coordinate-space preference as clicks: `capture` + `screenshot_id` when dragging between points chosen from a screenshot, `window` for app-local bounds, `monitor` for monitor-relative movement, and `virtual` only when coordinates are already known.

### `desktop_scroll`
Use for scrollable panes, lists, chats, editors, and menus.

Important rules:
- wheel events go to the control under the cursor
- in multi-pane apps, click the correct pane first when safe
- optional x/y coordinates help target the right scroll region
- prefer `coordinate_space:"capture"` + `screenshot_id` or `coordinate_space:"window"` over raw virtual coordinates when choosing a scroll point from a screenshot
- use `coordinate_space:"monitor"` + `monitor_index` for known-display targeting; `monitor_relative:true` is legacy

Important options for click/drag/scroll:
- `double_click:true` for opening items
- `button:"right"` for context menus
- `modifier:"shift"|"ctrl"|"alt"` only when intentionally needed
- `coordinate_space:"capture"` + `screenshot_id` for screenshot-selected points
- `coordinate_space:"window"` + `window_name`/`window_handle` for app-local points
- `coordinate_space:"monitor"` + `monitor_index` for display-local points
- `verify:"auto"` for normal screenshot/window targeting, `verify:"strict"` for risky actions, `verify:"off"` only for speed or known no-op actions
### `desktop_press_key`
Use for:
- Enter / Escape / Tab
- navigation shortcuts
- save/copy/paste/select-all shortcuts
- app navigation when pointer use is slower or less reliable

### `desktop_type`
Fast paste-style typing.

Use when:
- regular text entry is fine
- the app accepts paste-style input
- speed matters more than per-key realism

### `desktop_type_raw`
Fallback for:
- password fields
- terminals that reject paste
- apps that intercept clipboard paste
- inputs where each keystroke matters

### `desktop_wait`
Use sparingly.

Prefer `desktop_wait_for_change` or `desktop_pixel_watch` when there is a real screen-state signal you can wait on.

### `desktop_wait_for_change`
Use when:
- a click should open something
- a page/app is loading
- a dialog should appear or disappear
- you want to avoid burning screenshots in a blind polling loop

### `desktop_send_to_telegram`
Use when Raul asks to see the screen or when proof after a desktop action is useful in a Telegram session.

Recipe:
1. `desktop_screenshot(...)` or `desktop_window_screenshot(...)` to capture the current state
2. `desktop_send_to_telegram({ caption: "..." })`

Do not send stale screenshots; always capture immediately before sending.

### `desktop_diff_screenshot`
Use after two screenshots when you want a text summary of what visually changed.

Good for debugging subtle UI reactions.
### Click a visible point accurately
1. capture the relevant window/monitor with `desktop_window_screenshot` or `desktop_screenshot`
2. choose the target point from that exact image
3. click with `coordinate_space:"capture"` + the returned `screenshot_id`
4. leave `verify:"auto"` on unless speed matters, or use `verify:"strict"` for risky clicks

### Click a named control accurately
1. `desktop_get_accessibility_tree(window_name)`
2. locate the control and its bounds
3. click the center with `desktop_click` using `coordinate_space:"window"` when bounds are window-local, or `coordinate_space:"virtual"` only when bounds are already virtual-screen coordinates
4. verify with screenshot or tree/text refresh
- loading indicators
- enabled/disabled state changes
- progress completion indicators
- waiting for a button or status light to change color

This is much cheaper than repeated screenshots.
### Safe multi-monitor click
1. `desktop_get_monitors()`
2. pick the correct display
3. screenshot that monitor or region and keep `screenshot_id`
4. click with `coordinate_space:"capture"` + `screenshot_id` when selecting a point from the screenshot
5. if using direct display coordinates, use `coordinate_space:"monitor"` + `monitor_index`
6. treat `monitor_relative:true` as legacy compatibility, not the preferred new style
7. verify after clicking
- preload text for pasting
- copy an image into clipboard
- stage one or more files for paste/file-drop workflows

### Macro tools
Use macro tools only for repetitive, stable GUI flows.

- `desktop_record_macro` — start recording repeated input actions
- `desktop_stop_macro` — end and save the recording
- `desktop_list_macros` — inspect what macros already exist
- `desktop_replay_macro` — replay a saved workflow faster and consistently

Do not rely on macros for fragile, constantly changing UIs unless you also verify the results afterward.

---

## Precision patterns

### Click a named control accurately
1. `desktop_get_accessibility_tree(window_name)`
2. locate the control and its bounds
3. click the center with `desktop_click`
4. verify with screenshot or tree/text refresh

### Read a window without OCR guesswork
1. `desktop_focus_window(name)`
2. `desktop_get_window_text(name)`
3. if layout matters, pair it with `desktop_window_screenshot`

### Scroll the correct pane
1. take a screenshot and keep `screenshot_id`
2. click inside the intended scrollable pane only when safe/needed
3. `desktop_scroll(..., coordinate_space:"capture", screenshot_id, x, y)` over that area if needed
4. verify content moved

### Safe multi-monitor click
1. `desktop_get_monitors()`
2. pick the correct display
3. screenshot that monitor or region and keep `screenshot_id`
4. use `coordinate_space:"capture"` + `screenshot_id` for screenshot-selected points
5. use `coordinate_space:"monitor"` + `monitor_index` only for direct monitor-local coordinates
6. verify after clicking

### Wait intelligently instead of sleeping
- use `desktop_wait_for_change` when any visible change should occur
- use `desktop_pixel_watch` when one indicator pixel is enough
- use `desktop_wait` only when no deterministic signal is available

---

## Desktop vs browser vs shell
| Situation | Best tool / workflow |
|---|---|
| Need one app clearly | `desktop_window_screenshot` |
| Need current/focused app | `desktop_window_screenshot({ active:true })` |
| Need whole desktop context | `desktop_get_monitors` → `desktop_screenshot` |
| Need exact control names and bounds | `desktop_get_accessibility_tree` |
| Need visible text from a window | `desktop_get_window_text` |
| Need to wait for UI to change | `desktop_wait_for_change` or `desktop_pixel_watch` |
| Need a real mouse click from a screenshot | `desktop_click({ coordinate_space:"capture", screenshot_id, x, y })` |
| Need app-local click/scroll/drag | `coordinate_space:"window"` + `window_name` or `window_handle` |
| Need drag-and-drop or slider movement | `desktop_drag` with screenshot/window anchoring |
| Paste-style text entry | `desktop_type` |
| Paste blocked | `desktop_type_raw` |
| Need to scroll a pane | screenshot → click pane if safe → `desktop_scroll` with `coordinate_space` |
| Need launch by installed app | `desktop_find_installed_app` → `desktop_launch_app({ app_id })` |
| Need send screenshot proof to Telegram | fresh `desktop_screenshot` → `desktop_send_to_telegram` |
| Need reusable repeated GUI steps | `desktop_record_macro` → `desktop_stop_macro` → `desktop_replay_macro` |
| Website interaction in Chrome session | browser tools |
| Native Windows app or OS dialog | desktop tools |
| Terminal / build / git / scripts | `run_command` |
| Reading website content only | `web_search` + `web_fetch` |
| Need exact desktop UI roles and bounds | `desktop_get_accessibility_tree` |
| Need visible text from a native app | `desktop_get_window_text` |
| Repetitive desktop input sequence | desktop macro tools |

If it is a normal website, browser tools are usually better than desktop tools.
If it is a native app or OS dialog, desktop tools are the right path.
If it is shell work, use `run_command` instead of clicking around a terminal.

---

## Common mistakes to avoid

- Clicking before taking a screenshot on an unfamiliar UI
- Using full-desktop screenshots when a window screenshot would be clearer
- Typing without ensuring the correct window is focused
- Scrolling without first putting the cursor over the intended pane
- Using clipboard-based reading when screenshot/UI Automation would be cleaner
- Repeating blind clicks instead of re-grounding visually
- Using `desktop_wait` as a habit when `desktop_wait_for_change` or `desktop_pixel_watch` would be more deterministic
- Forgetting to carry forward the fresh `screenshot_id` when using `coordinate_space:"capture"`
- Defaulting to raw virtual coordinates when screenshot/window/monitor coordinate spaces are safer
- Using `monitor_relative:true` in new guidance instead of explicit `coordinate_space:"monitor"`
- Using browser tools for native app dialogs or desktop tools for normal web flows when the other surface is clearly better

---
| Situation | Best tool / workflow |
|---|---|
| Need one app clearly | `desktop_window_screenshot` |
| Need current/focused app | `desktop_window_screenshot({ active:true })` |
| Need whole desktop context | `desktop_get_monitors` → `desktop_screenshot` |
| Need exact control names and bounds | `desktop_get_accessibility_tree` |
| Need visible text from a window | `desktop_get_window_text` |
| Need to wait for UI to change | `desktop_wait_for_change` or `desktop_pixel_watch` |
| Need a real mouse click from a screenshot | `desktop_click({ coordinate_space:"capture", screenshot_id, x, y })` |
| Need app-local click/scroll/drag | `coordinate_space:"window"` + `window_name` or `window_handle` |
| Need drag-and-drop or slider movement | `desktop_drag` with screenshot/window anchoring |
| Paste-style text entry | `desktop_type` |
| Paste blocked | `desktop_type_raw` |
| Need to scroll a pane | screenshot → click pane if safe → `desktop_scroll` with `coordinate_space` |
| Need launch by installed app | `desktop_find_installed_app` → `desktop_launch_app({ app_id })` |
| Need send screenshot proof to Telegram | fresh `desktop_screenshot` → `desktop_send_to_telegram` |
| Need reusable repeated GUI steps | `desktop_record_macro` → `desktop_stop_macro` → `desktop_replay_macro` |
| Paste blocked | `desktop_type_raw` |
| Need to scroll a pane | click pane → `desktop_scroll` |
| Need reusable repeated GUI steps | `desktop_record_macro` → `desktop_stop_macro` → `desktop_replay_macro` |

---

## Bottom line

Desktop automation should be driven by what is **currently visible and verifiable**.

Observe → anchor → act → verify.

Use screenshots for visual truth, accessibility/tree tools for precision, window text extraction for reliable reading, and macro tools only for stable repeated flows. Prefer deterministic waiting and explicit focus over guessing.