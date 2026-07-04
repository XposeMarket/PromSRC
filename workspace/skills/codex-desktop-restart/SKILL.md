---
name: Codex Desktop Restart
description: Use this skill when Raul asks Prometheus to close, reopen, relaunch, restart, reset, or refocus the Codex desktop app on Windows. Triggers on phrases like “close and reopen Codex,” “restart Codex,” “relaunch Codex,” “Codex is stuck,” “reset the Codex app,” “open Codex again,” and “focus Codex after restarting.” It preserves Raul’s preference for immediate desktop execution, screenshot-grounded verification, and mobile/origin screenshot proof after visible desktop actions.
version: 1.0.0
triggers: close and reopen Codex, restart Codex, relaunch Codex, reset Codex, Codex is stuck, Codex froze, open Codex again, focus Codex, reopen Codex desktop app, restart the Codex app, close Codex and open it, fix Codex window
---

---
name: Codex Desktop Restart
description: >
  Use this skill when Raul asks Prometheus to close, reopen, relaunch, restart, reset, or refocus the Codex desktop app on Windows. Triggers on phrases like “close and reopen Codex,” “restart Codex,” “relaunch Codex,” “Codex is stuck,” “reset the Codex app,” “open Codex again,” and “focus Codex after restarting.” It preserves Raul’s preference for immediate desktop execution, screenshot-grounded verification, and mobile/origin screenshot proof after visible desktop actions.
version: 1.0.0
triggers: close and reopen Codex, restart Codex, relaunch Codex, reset Codex, Codex is stuck, Codex froze, open Codex again, focus Codex, reopen Codex desktop app, restart the Codex app, close Codex and open it, fix Codex window
---

# Codex Desktop Restart

Use this for Raul’s quick desktop request: close Codex, reopen it, focus it, and send proof. Do the work first. Keep the final reply very short.

## Required Tools

- `desktop_automation`
- `delivery_send_screenshot`

## Workflow

1. **Activate desktop tools** if they are not already active.
2. **Find the current Codex window** with `desktop_list_windows` filtered by Codex / process `Codex`.
3. **Close Codex if it is open** using `desktop_window_control` with `action: "close"` and the discovered `window_id`.
   - If more than one Codex window appears, close the active/main Codex window first, then re-list if needed.
   - Do not use modifier-clicks. Raul prefers normal desktop tool/window controls and screenshot-grounded actions.
4. **Find the installed Codex app** with `desktop_find_installed_app({ query: "Codex" })` if the app id is not already known.
   - Prior known app id may be `app_f12896def73ae577`, but always recover by finding the installed app if launch by id fails.
   - Do not launch `proc:codex`; that is a process/window id, not an installed app id.
5. **Launch Codex** with `desktop_launch_app` using the installed app id, usually with a short wait such as 3000-5000 ms.
6. **Verify focus/window state** by re-listing or focusing the Codex window.
   - If using `desktop_focus_window`, provide the required `name` or use `desktop_window_control` with the `window_id` instead. Avoid the known failure pattern where `desktop_focus_window` errors with “name is required.”
7. **Send fresh visual proof** to Raul’s origin surface with `delivery_send_screenshot({ source: "desktop_new", target: "origin", caption: "Codex reopened and focused." })`.
8. **Final reply:** one sentence, e.g. `Done. Codex is reopened, focused, and I sent the screenshot.`

## Recovery

- If closing does not remove the window, wait briefly and list windows again before launching.
- If launch by app id fails, run `desktop_find_installed_app` for `Codex`, choose the exact Codex match, and relaunch with that app id.
- If there is no installed Codex match, report the exact blocker and leave the closest proof available, such as a screenshot of the failed app search.
- If screenshot delivery fails, still report the restart result and mention the delivery failure explicitly.

## Raul-Specific Preferences

- This is a direct-action request. Do not ask follow-up questions.
- Use fresh screenshots/proof for visible desktop actions, especially from mobile/voice sessions.
- Keep mobile replies short.
- Record any tool reliability issue or improvement opportunity if one occurs during the workflow.