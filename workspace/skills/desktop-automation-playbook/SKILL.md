---
name: Desktop Automation Playbook
description: The definitive guide to all 22 desktop automation tools — screenshot + OCR, window management, mouse/keyboard input, UI Automation tree, pixel watching, macro recording/replay, vision-guided actions, app lifecycle, clipboard, and multi-step workflows. Read this before ANY desktop automation task.
emoji: 🖥️
version: 2.0.0
triggers: desktop, desktop_screenshot, desktop_click, desktop_type, desktop_press_key, desktop_drag, desktop_scroll, desktop_launch_app, desktop_close_app, desktop_focus_window, desktop_vision_act, desktop_get_accessibility_tree, desktop_pixel_watch, desktop_record_macro, desktop_stop_macro, desktop_replay_macro, desktop_list_macros, click screen, type into app, open app, automate desktop, GUI automation, screen, windows automation, macro, accessibility tree
---

# Desktop Automation Playbook

Read this before any desktop automation task. Covers every desktop tool, the vision system, OCR, UI Automation, macro recording, and tested patterns for working with Windows applications.

---

## 1. Tool Reference — Quick Map

### See (Observation)
| Tool | Purpose | Returns |
|---|---|---|
| `desktop_screenshot()` | Capture full screen + OCR + window list | Text: screen dims, active window, OCR text, window list |
| `desktop_diff_screenshot()` | Describe what changed since last screenshot | Text diff description |
| `desktop_wait_for_change(timeout_ms)` | Wait until screen content changes | Change detected or timeout |
| `desktop_find_window(name)` | Find windows by partial title/process name | Matching window list |
| `desktop_get_process_list(filter)` | List running processes with visible windows | Process list |
| `desktop_get_window_text(name)` | Extract readable text from a window via UI Automation | Reliable text without OCR |
| **`desktop_get_accessibility_tree(name?, max_depth?, max_nodes?)`** | **Full Windows UI Automation tree** — roles, names, states, bounds for every control | Structured control tree |

### Act (Interaction)
| Tool | Purpose | Parameters |
|---|---|---|
| `desktop_click(x, y)` | Click at screen coordinates | x, y, button (left/right), double_click |
| `desktop_type(text)` | Type via clipboard paste (fast) | text |
| `desktop_type_raw(text)` | Type character-by-character (reliable) | text (max 2000 chars) |
| `desktop_press_key(key)` | Press keyboard key or combo | Enter, Escape, Ctrl+S, Alt+Tab, etc. |
| `desktop_drag(from, to)` | Drag mouse between two points | from_x, from_y, to_x, to_y, steps |
| `desktop_scroll(direction)` | Scroll mouse wheel | direction (up/down), amount, optional x/y |
| `desktop_set_clipboard(text)` | Write to clipboard | text |
| `desktop_get_clipboard()` | Read from clipboard | — |

### App Lifecycle
| Tool | Purpose | Parameters |
|---|---|---|
| `desktop_launch_app(app)` | Open an application | app name/path, args, wait_ms |
| `desktop_close_app(name)` | Close a window/app | name (partial title), force |
| `desktop_focus_window(name)` | Bring window to front | name (partial title/process) |

### Composite / High-Level
| Tool | Purpose | Parameters |
|---|---|---|
| `desktop_vision_act(goal)` | Refreshes screenshot + echoes goal (you choose next tools) | goal (plain English) |
| `desktop_wait(ms)` | Simple pause | ms (50-30000) |
| `desktop_send_to_telegram(caption)` | Send last screenshot to user's Telegram | caption |
| **`desktop_pixel_watch(x, y, target_color?, timeout_ms?, poll_ms?)`** | **Wait for pixel color change** — 100× cheaper than screenshot polling | Color change or timeout |

### Macro Recording / Replay (NEW)
| Tool | Purpose | Parameters |
|---|---|---|
| `desktop_record_macro(name)` | Start recording all click/type/key/scroll actions | name (identifier) |
| `desktop_stop_macro()` | Stop recording, save macro with timing | — |
| `desktop_replay_macro(name, speed_multiplier?)` | Replay a saved macro | name, speed_multiplier (default 1.0) |
| `desktop_list_macros()` | List all saved macros and their action counts | — |

---

## 2. How the Desktop Vision System Works

### What the AI Actually Sees

When you call `desktop_screenshot()`, you receive **text output** containing:

```
Desktop screenshot captured (3840x2160).
Active window: "Visual Studio Code (code.exe)".
Open windows: 8.
OCR text (92% confidence):
  import { desktopScreenshot } from './desktop-tools';
  function main() {
    const result = await desktopScreenshot('session1');
  }
  ...
All visible windows:
  1. [code] Visual Studio Code (handle=17300104)
  2. [explorer] C:\Users\rafel\Desktop (handle=18400256)
  3. [chrome] Google Chrome (handle=16400512)
  ...
```

### For Vision-Capable Models (OpenAI, OpenAI Codex)

The actual PNG screenshot is **also injected as an image** into the conversation, so the primary model can SEE the screen. This means on vision-capable providers:
- You can read UI elements visually
- You can identify button positions, icons, and visual state
- You get both the image AND the OCR text for maximum understanding

### For Local Models (Ollama, etc.)

Only the text (OCR + window list) is provided — no image. You rely entirely on OCR text to understand what's on screen. This means:
- OCR accuracy matters (typically 80-95%)
- Layout information is lost — you know WHAT text is on screen but not WHERE
- Prefer `desktop_get_accessibility_tree` for reliable control discovery without OCR

### Architecture note (no separate desktop advisor)

Desktop automation is **primary-driven**: you choose `desktop_click`, `desktop_scroll`, `desktop_focus_window`, etc. after each `desktop_screenshot`. There is **no secondary model** that plans desktop steps for you. `desktop_vision_act` only refreshes the screenshot and echoes your goal — it does not invoke another planner.

---

## 3. Core Workflow Pattern: Screenshot → Read → Act → Verify

Every desktop task follows this loop:

```
1. desktop_screenshot()              → see current screen state
2. Read OCR text + window info       → understand what's on screen
3. desktop_click/type/press_key      → interact with the screen
4. desktop_screenshot()              → verify the action worked
5. Repeat 3-4 until done
```

**Optional:** `desktop_vision_act("…")` refreshes the screenshot and repeats your goal in the tool result (same image injection as `desktop_screenshot`). You still call `desktop_click` etc. yourself.

---

## 4. Clicking — `desktop_click(x, y)`

```
desktop_click({ x: 520, y: 340 })
desktop_click({ x: 520, y: 340, button: "right" })
desktop_click({ x: 520, y: 340, double_click: true })
```

- Coordinates are **screen pixels** (absolute, not relative to any window)
- `desktop_screenshot()` returns screen width and height so you can estimate positions
- For vision-capable models: look at the injected screenshot image to identify positions
- For local models without vision: infer from OCR and screen dimensions, or use rough coordinates and verify with a follow-up screenshot

**How to determine coordinates:**
1. **Vision model (best):** Look at the screenshot image, estimate pixel position of the target
2. **Accessibility tree:** `desktop_get_accessibility_tree` returns bounding boxes (x, y, width, height) for every control — most reliable
3. **OCR-based (fallback):** Use OCR text to understand context, then estimate coordinates and verify

---

## 5. Typing — `desktop_type` vs `desktop_type_raw`

### `desktop_type(text)` — Fast, Clipboard-Based
```
desktop_type({ text: "Hello, this is a long message that types instantly" })
```
- Uses clipboard (Ctrl+V) internally — extremely fast
- Works in most apps: text editors, browsers, chat apps, word processors
- Handles special characters, Unicode, multi-line text
- **Use this by default for everything**

### `desktop_type_raw(text)` — Slow, Character-by-Character
```
desktop_type_raw({ text: "password123" })
```
- Types each character individually via key events
- Max 2000 characters
- **Use ONLY when `desktop_type` doesn't work:**
  - Password fields that block paste
  - Terminal emulators that intercept clipboard
  - Apps that detect and reject pasted content
  - When you need key-by-key input events (e.g., autocomplete triggers)

---

## 6. Keyboard — `desktop_press_key(key)`

```
desktop_press_key({ key: "Enter" })
desktop_press_key({ key: "Ctrl+S" })
desktop_press_key({ key: "Alt+Tab" })
```

**Common keys:**
| Key | Use case |
|---|---|
| `Enter` | Submit, confirm |
| `Escape` | Cancel, close dialog |
| `Tab` | Move to next field |
| `Ctrl+S` | Save (most apps) |
| `Ctrl+C` / `Ctrl+V` | Copy/paste |
| `Ctrl+Z` | Undo |
| `Ctrl+A` | Select all |
| `Alt+Tab` | Switch between windows |
| `Alt+F4` | Close current window |
| `Win+D` | Show desktop |
| `Win+E` | Open File Explorer |
| `PageDown` / `PageUp` | Scroll content |
| `F5` | Refresh (browsers, Excel) |
| `F2` | Rename (Explorer) |

---

## 7. Window Management

### Finding Windows
```
desktop_find_window({ name: "Visual Studio" })
  → returns list of matching windows with process name, title, handle

desktop_get_process_list({ filter: "chrome" })
  → returns all chrome processes with their windows
```

### Focusing a Window
```
desktop_focus_window({ name: "Visual Studio Code" })
  → brings VS Code to the foreground
```
- Matches partial window title or process name
- Must focus a window BEFORE typing into it — `desktop_type` sends keys to the focused window

### Launching Apps
```
desktop_launch_app({ app: "notepad" })
desktop_launch_app({ app: "code", args: "D:\\project" })
desktop_launch_app({ app: "C:\\Program Files\\MyApp\\app.exe", wait_ms: 10000 })
```
- `app`: app name (notepad, code, calc, explorer, cmd, powershell) or full path
- `args`: command-line arguments
- `wait_ms`: max time to wait for window to appear (default 6000ms)

### Closing Apps
```
desktop_close_app({ name: "Notepad" })
desktop_close_app({ name: "hung_process", force: true })
```
- Graceful close by default (sends WM_CLOSE)
- `force: true` kills the process immediately

---

## 8. Scrolling & Dragging

### Scrolling
```
desktop_scroll({ direction: "down", amount: 3 })
desktop_scroll({ direction: "up", amount: 5, x: 800, y: 400 })
```
- `amount`: number of wheel ticks (default 3, max 50)
- Optional `x, y`: move cursor to this **virtual** position first, THEN send wheel events
  - Essential for scrolling specific panels in multi-pane apps (VS Code sidebar, Excel cells, etc.)
- **Electron / webview apps (e.g. Claude desktop):** The wheel only affects the control **under the cursor**. `desktop_focus_window` is not enough — **click inside the conversation / scrollable pane** (use coordinates from a screenshot), then `desktop_scroll` with the same `x, y` over that pane. If you scroll while the pointer sits on the title bar or sidebar, the content will not move.

### Dragging
```
desktop_drag({ from_x: 100, from_y: 200, to_x: 500, to_y: 200, steps: 20 })
```
- Drags from one point to another with smooth mouse movement
- `steps`: interpolation points (default 20, more = smoother but slower)
- Use for: drag-and-drop, slider adjustment, window resizing, selecting text

---

## 9. UI Automation Tree — `desktop_get_accessibility_tree(name?, max_depth?, max_nodes?)`

Returns the full Windows UI Automation control tree for a window — every control's role, name, enabled/focused state, and bounding box (x, y, width, height).

```
desktop_get_accessibility_tree({ window_name: "Notepad" })
desktop_get_accessibility_tree({ window_name: "Chrome", max_depth: 5, max_nodes: 200 })
```

### When to Use
- Find exact click coordinates for any button, input, or control (bounding box gives you center coords)
- Discover what controls exist in a complex UI without taking screenshots
- Check enabled/disabled state of buttons before clicking
- More reliable than OCR for finding named controls
- Essential for local (non-vision) models where screenshot coordinates are hard to determine

### Output Structure
```
Window: "Save As" (hwnd: 12345)
  Pane "Save As" [x:100 y:50 w:600 h:400]
    ComboBox "File name:" [enabled] [x:200 y:300 w:300 h:25]
    Button "Save" [enabled] [x:450 y:350 w:80 h:25]
    Button "Cancel" [enabled] [x:540 y:350 w:80 h:25]
    CheckBox "Hide extensions" [enabled] [x:150 y:380 w:200 h:20]
```

### Pattern — Click a Named Button Precisely
```
desktop_get_accessibility_tree({ window_name: "Save As" })
  → finds "Save" button at x:450 y:350 w:80 h:25
  → center = x: 450+40=490, y: 350+12=362
desktop_click({ x: 490, y: 362 })
```

### Parameters
| Param | Default | Description |
|---|---|---|
| `window_name` | — | Partial match against window title. Omit to get tree from focused window. |
| `max_depth` | 10 | Max tree depth to traverse |
| `max_nodes` | 500 | Max total nodes to return |

---

## 10. Pixel Watch — `desktop_pixel_watch(x, y, target_color?, timeout_ms?, poll_ms?)`

Wait for a specific pixel on screen to change color. Uses 1×1 pixel sampling — **100× cheaper than polling with full screenshots**.

```
desktop_pixel_watch({ x: 800, y: 400 })
desktop_pixel_watch({ x: 800, y: 400, target_color: "#00FF00", timeout_ms: 15000 })
```

### When to Use
- Wait for a loading indicator to disappear (spinner pixel goes from animated to background color)
- Wait for a button to become active (color changes when enabled)
- Wait for a progress bar to complete
- Any async UI state change that has a visible color signal

### Parameters
| Param | Default | Description |
|---|---|---|
| `x, y` | required | Screen pixel coordinates to watch |
| `target_color` | — | Optional hex color to wait FOR (e.g., `"#FF0000"`). If omitted, waits for ANY change from the current color. |
| `timeout_ms` | 30000 | Max wait time in milliseconds |
| `poll_ms` | 100 | How often to sample the pixel (default 100ms) |

### Returns
```json
{ "changed": true, "from_color": "#808080", "to_color": "#00FF00", "elapsed_ms": 2340 }
```

### Pattern — Wait for App to Load
```
desktop_launch_app({ app: "myapp.exe" })
desktop_screenshot()
  → note the coordinates of a loading spinner or status indicator
desktop_pixel_watch({ x: 512, y: 300, timeout_ms: 20000 })
  → returns as soon as that pixel changes (loading done)
desktop_screenshot()
  → app is now ready
```

### vs `desktop_wait_for_change`
| | `desktop_wait_for_change` | `desktop_pixel_watch` |
|---|---|---|
| Cost | Full screenshot every poll | 1 pixel every poll |
| When to use | Don't know where change will be | Know exactly which pixel signals readiness |
| Reliability | Detects any visual change | Detects only the watched pixel |

---

## 11. Macro Recording — Record, Save, Replay

Macros let you record a sequence of click/type/key/scroll actions once, then replay them on demand.

### Record a Macro
```
desktop_record_macro({ name: "login-flow" })
  → starts recording all subsequent desktop actions

desktop_click({ x: 400, y: 300 })
desktop_type({ text: "user@example.com" })
desktop_press_key({ key: "Tab" })
desktop_type({ text: "password123" })
desktop_press_key({ key: "Enter" })

desktop_stop_macro()
  → saves macro "login-flow" with 5 actions and timing data
```

### List Saved Macros
```
desktop_list_macros()
  → { "login-flow": 5 actions, "report-export": 12 actions, ... }
```

### Replay a Macro
```
desktop_replay_macro({ name: "login-flow" })
desktop_replay_macro({ name: "login-flow", speed_multiplier: 2.0 })  → 2× faster
desktop_replay_macro({ name: "login-flow", speed_multiplier: 0.5 })  → half speed (more reliable)
```

### When to Use Macros
- Repetitive workflows you run daily (login, export report, fill standard form)
- Multi-step sequences where you want consistent timing
- Automating steps in apps without API access
- Reduce tool call count for repeated identical flows

### Notes
- Macros are stored in memory for the session — they reset on gateway restart
- Recording captures timing delays between actions for realistic playback
- Replay pauses macro recording (macros don't record themselves replaying)
- `speed_multiplier: 0.5` is useful for apps that are slow or need time to process each action

---

## 12. Composite Tools — When to Use What

### `desktop_vision_act(goal)` — Refresh + context
```
desktop_vision_act({ goal: "Click the File menu in Notepad" })
```
- **Does:** Captures a fresh `desktop_screenshot` and returns the goal plus the same text summary as a normal screenshot.
- **Does not:** Call a separate planner model or auto-click.
- **Use when:** You want the latest pixels in context with a short goal reminder; then call `desktop_click` / `desktop_scroll` yourself.

### When to Use Individual Tools Instead
- When you already know exact coordinates (from a previous screenshot or accessibility tree)
- When you need fine control over timing (e.g., waiting for specific UI changes)
- When the workflow has conditional branches (if X then do Y, else do Z)
- When you want explicit control over each step (most workflows)

---

## 13. Clipboard Operations

```
desktop_set_clipboard({ text: "content to paste" })
desktop_press_key({ key: "Ctrl+V" })  → paste it

desktop_press_key({ key: "Ctrl+C" })  → copy selection
desktop_get_clipboard()               → read what was copied
```

**Use case:** Extract text from any application:
1. `desktop_click` to position cursor
2. `desktop_press_key("Ctrl+A")` to select all
3. `desktop_press_key("Ctrl+C")` to copy
4. `desktop_get_clipboard()` to read the text

---

## 14. Screen Change Detection

### Wait for Change
```
desktop_wait_for_change({ timeout_ms: 10000, poll_ms: 800 })
```
- Polls the screen every `poll_ms` for visual changes
- Returns when change detected OR timeout reached
- **Use instead of hard-coded waits** for:
  - Loading spinners
  - File dialog opening
  - App startup
  - Any async UI operation

**Prefer `desktop_pixel_watch`** if you know which pixel signals the state change — it's 100× cheaper than `desktop_wait_for_change`.

### Diff Description
```
desktop_screenshot()           → first capture
... some action ...
desktop_diff_screenshot()      → describes what changed
```
- Compares the current screenshot to the previous one
- Returns human-readable description of visual changes
- Uses OCR and window list differences

---

## 15. Common Workflow Patterns

### Open App and Type Content
```
desktop_launch_app("notepad")
desktop_wait(1000)
desktop_type("Hello, this is automated content")
desktop_press_key("Ctrl+S")
  → Save dialog opens
desktop_type("filename.txt")
desktop_press_key("Enter")
```

### Switch Between Apps
```
desktop_focus_window("Excel")
desktop_press_key("Ctrl+C")
desktop_focus_window("Chrome")
desktop_press_key("Ctrl+V")
```

### Find + Click a Named Button (Accessibility Tree)
```
desktop_get_accessibility_tree({ window_name: "Dialog Title" })
  → find "OK" button at x:450, y:350 w:80 h:25
desktop_click({ x: 490, y: 362 })  → center of button
```

### Wait for App Ready (Pixel Watch)
```
desktop_launch_app({ app: "heavyapp.exe", wait_ms: 5000 })
desktop_screenshot()
  → identify a pixel that changes when app finishes loading
desktop_pixel_watch({ x: 512, y: 300, timeout_ms: 30000 })
  → returns immediately when pixel changes, not after a fixed sleep
desktop_screenshot()
  → app is ready
```

### Record and Replay a Workflow
```
desktop_record_macro({ name: "daily-export" })
  ... perform the steps manually ...
desktop_stop_macro()
  → macro saved

  [next day]
desktop_replay_macro({ name: "daily-export" })
  → same steps replay automatically
```

### VS Code Workflow
```
desktop_launch_app("code", "D:\\project")
desktop_wait_for_change(8000)
desktop_press_key("Ctrl+P")              → Quick Open
desktop_type("app.js")
desktop_press_key("Enter")
desktop_screenshot()                     → verify file is open
```

---

## 16. Error Handling

| Problem | Solution |
|---|---|
| Wrong window focused | `desktop_focus_window(name)` first |
| App not responding | `desktop_close_app(name, force: true)` → relaunch |
| Clicked wrong spot | `desktop_screenshot()` → re-evaluate coordinates, or use `desktop_get_accessibility_tree` for exact bounds |
| Type went to wrong window | `desktop_focus_window(target)` → try again |
| Dialog blocking | `desktop_press_key("Escape")` or `desktop_press_key("Enter")` |
| Screen hasn't changed | `desktop_wait_for_change(5000)` → retry action |
| OCR unreadable | Use `desktop_get_accessibility_tree` for reliable text, or `desktop_vision_act` with image |
| Password field blocks paste | Switch to `desktop_type_raw(text)` |
| Can't find a button visually | `desktop_get_accessibility_tree` — returns all control names and coordinates |
| Need to wait for loading | `desktop_pixel_watch` on the spinner pixel, not `desktop_wait(5000)` |
| Macro timing too fast | `desktop_replay_macro({ name, speed_multiplier: 0.5 })` |

---

## 17. Desktop vs Browser — When to Use Which

| Task | Tool |
|---|---|
| Navigate a website | **Browser tools** (`browser_open`) — structured DOM, @refs, reliable |
| Fill a web form | **Browser tools** (`browser_fill`) — direct DOM input |
| Interact with a web-based SPA | **Browser tools** — snapshots capture dynamic content |
| Work with a native Windows app | **Desktop tools** — only option for native GUI |
| Work with Excel, Word, PowerPoint | **Desktop tools** — native apps |
| File management (Explorer) | **Desktop tools** or `run_command` for shell operations |
| Terminal / command-line work | `run_command` — faster and more reliable than desktop tools |
| Screenshot + share to Telegram | `desktop_screenshot()` → `desktop_send_to_telegram()` |
| Find exact button coordinates | `desktop_get_accessibility_tree` — bounding boxes for every control |
| Wait for UI state change | `desktop_pixel_watch` (if specific pixel) or `desktop_wait_for_change` (if anywhere) |
| Repeat a multi-step workflow | `desktop_record_macro` / `desktop_replay_macro` |

**Rule of thumb:** If it runs in a browser, use browser tools. If it's a native app, use desktop tools. If it's shell commands, use `run_command`.

---

## 18. Performance Tips

1. **`desktop_pixel_watch` over `desktop_wait_for_change`** — 100× cheaper when you know which pixel to watch.
2. **`desktop_get_accessibility_tree` over screenshot + OCR** — exact control names and coordinates, no vision needed.
3. **`desktop_get_window_text` for reliable text** — more accurate than OCR for complex UIs.
4. **Combine clipboard operations** to extract text faster than OCR.
5. **Record macros for repetitive tasks** — replay is much faster than re-driving the same steps.
6. **Focus the window first** before any typing or keyboard shortcuts.
7. **`desktop_vision_act` only adds a screenshot round** — prefer `desktop_screenshot` when you do not need the goal echoed.
