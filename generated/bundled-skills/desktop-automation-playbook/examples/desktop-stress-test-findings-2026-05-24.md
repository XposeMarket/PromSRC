# Desktop stress-test findings — 2026-05-24

Evidence: Raul explicitly asked Prometheus to navigate and stress-test the Windows desktop tools broadly, then update/create desktop skill resources from what actually happened.

## Environment observed

- Platform: Windows desktop automation supported.
- Monitor layout: one primary monitor, 3440x1440 virtual desktop at `(0,0)`.
- Active desktop tools are foreground-only: clicks/keys/focus affect Raul's real desktop unless a separate background worker is configured.
- Background lane status: Windows Sandbox and Hyper-V were not found; Remote Desktop service was running; no external desktop worker URL was configured.
- OCR was enabled in doctor output, but screenshots repeatedly reported no cached OCR/OCR unavailable.
- `desktop_get_window_text`, `desktop_get_accessibility_tree`, and `desktop_list_macros` returned `Unknown tool` in this runtime even though the playbook lists them. Treat them as optional/runtime-dependent.

## Tools successfully exercised

- `desktop_doctor` — passed platform, monitor/DPI, screenshot budget, UI Automation probe, and active-window detection.
- `desktop_get_monitors` — correctly reported one 3440x1440 primary display.
- `desktop_screenshot(..., mode:"som")` — produced clickable SOM elements for Edge/Prometheus.
- `desktop_find_window` — found Codex, Settings, msedge, Calculator; correctly reported no File Explorer before launch.
- `desktop_get_process_list` — listed visible windows/processes.
- `desktop_window_screenshot` — captured Codex and Calculator, including SOM overlays for Calculator controls.
- `desktop_window_control` — maximized Codex and closed Notepad.
- `desktop_scroll` — scrolled Codex and confirmed target-region change.
- `desktop_diff_screenshot` — detected screen content changed while active window stayed the same.
- `desktop_find_installed_app` — found Notepad, Calculator, and File Explorer app IDs.
- `desktop_launch_app` — launched Calculator and Notepad successfully.
- `desktop_focus_window` — focused Calculator and Settings.
- `desktop_click` — clicked Calculator controls by SOM and capture coordinates.
- `desktop_press_key` — used `Ctrl+N`, number key `8`, `Enter`, and `Escape` successfully.
- `desktop_close_app` — closed Calculator.
- `desktop_background_status` — correctly identified the missing non-disruptive worker path.

## Gotchas discovered

### 1. Do not pass a modifier unless intentionally required

One Calculator click accidentally sent `modifier:"alt"` while clicking SOM element Seven. The click still worked, but this is exactly the kind of unnecessary modifier Raul dislikes. For ordinary clicks, omit `modifier` entirely or set it empty only if the schema requires a value. Never use Alt/Ctrl/Shift unless the UI task explicitly requires it.

### 2. Screenshot IDs go stale after UI changes

After clicking Calculator Seven, reusing the same SOM screenshot ID for the next Calculator click failed with a stale screenshot error. Recovery:

1. Stop the click loop immediately.
2. Recapture the target window with `desktop_window_screenshot` or the desktop with `desktop_screenshot`.
3. Click using the new `screenshot_id`, or use keyboard shortcuts/keypresses when the focused app supports them.

Best practice: every meaningful desktop mutation invalidates screenshot anchors. Recapture before another screenshot-anchored action unless the tool returned a new `capture_after` screenshot and you are using the matching coordinate space.

### 3. Keyboard input is often more stable than repeated visual Calculator clicks

Calculator accepted keyboard input after focus. `desktop_press_key("8")` and `desktop_press_key("Enter")` completed `7 + 8 = 15` after the visual click path hit stale screenshots. When a native app has obvious keyboard semantics, prefer keyboard for follow-up deterministic actions after initial visual grounding.

### 4. Notepad launch can restore/open a recent file

Launching Notepad opened `_state.json - Notepad`, not a blank note. Do not assume Notepad launches empty. If using Notepad as a safe text-entry target, verify the title/content first and avoid destructive edits. Close with `desktop_window_control` if no changes were made.

### 5. File Explorer app_id launch can fail, raw explorer can still work

`desktop_launch_app({ app_id:"app_602e908822d41409" })` failed with: `This command cannot be run completely because the system cannot find all the information required.` A fallback `desktop_launch_app({ app:"explorer.exe" })` initially reported no window within 6000ms, but a File Explorer Home window appeared afterward. For Explorer:

1. Try installed app discovery first.
2. If app_id launch fails, fallback to raw `explorer.exe`.
3. If launch says no window appeared, wait or inspect/focus before declaring failure.
4. Prefer `desktop_find_window("Home")`, `desktop_find_window("File Explorer")`, or a fresh screenshot to confirm.

### 6. Window focus and screenshot proof can disagree temporally

Tool results sometimes reported an active window change while the user-visible screenshot still included layered windows or changed shortly afterward. Trust the freshest visual screenshot for final UI truth, but record tool-reported focus/window metadata as useful evidence.

### 7. Loop detector is useful and should be respected

Repeated identical `desktop_window_screenshot` calls triggered a loop warning. When this happens, change tactics: use keyboard input, a full desktop screenshot, process/window list, native window control, or conclude that enough evidence has been collected.

## Safe stress-test recipe for future desktop capability checks

Use this sequence when Raul asks to broadly test desktop reliability without doing destructive work:

1. Read `desktop-automation-playbook`.
2. `desktop_doctor()`.
3. `desktop_get_monitors()`.
4. `desktop_screenshot({ capture:"all" or monitor_index:0, mode:"som" })`.
5. `desktop_get_process_list({ filter:"" })` and `desktop_find_window` for visible apps.
6. Pick safe apps only: Calculator, Settings, File Explorer, Notepad if verified read-only/blank.
7. Launch Calculator with `desktop_find_installed_app` + `desktop_launch_app`.
8. Use a window screenshot/SOM once, then prefer keyboard math (`7`, `+`, `8`, `Enter`) or recapture between click steps.
9. Close Calculator with `desktop_close_app` or `desktop_window_control`.
10. Test Notepad launch only as read-only unless a blank buffer is verified; close without saving.
11. Test File Explorer with app_id first, then raw `explorer.exe` fallback, then verify with screenshot/find_window.
12. Test Settings focus and screenshot, but avoid changing system settings unless explicitly requested.
13. Check `desktop_background_status` and report whether non-disruptive desktop automation is actually available.
14. Update this skill with any new runtime/tool mismatches or recovery patterns discovered.

## Reporting template

When finished, report:

- What worked.
- What failed or is runtime-dependent.
- Exact recovery path for each failure.
- Whether host desktop control is foreground-only or background-safe.
- What skill resource was updated.

Keep it concise; Raul mostly wants the capability improved, not a novel.