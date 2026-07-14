---
name: "chatgpt-desktop-restart"
description: "Close, relaunch, refocus, and visually verify the ChatGPT desktop app on Windows when the user explicitly asks to restart or reopen it. Do not invoke for ordinary ChatGPT or coding requests."
---

# ChatGPT Desktop Restart

Restart ChatGPT only after an explicit user request. Closing an application is destructive to unsaved UI state, so do not use this workflow as a generic troubleshooting step.

## Workflow

1. Call `desktop_list_windows` and select the ChatGPT window by stable `window_id`.
2. Close that window with `desktop_window_control(action:"close")`.
3. Re-list windows and confirm the selected window closed before launching another instance.
4. Resolve the installed application with `desktop_find_installed_app(query:"ChatGPT")`. Never depend on a remembered app ID; package identifiers can change even when the visible name remains ChatGPT.
5. Launch the exact installed-app match with `desktop_launch_app`.
6. Re-list windows, focus the new ChatGPT window, and verify its visible state with a fresh screenshot.
7. When the request originated remotely, send fresh proof with `delivery_send_screenshot(source:"desktop_new", target:"origin")`.

## Failure rules

- If no installed ChatGPT application is found, report that exact blocker.
- If the old window remains after close, do not launch duplicate instances blindly.
- If launch succeeds but no usable window appears, report launch acceptance without claiming restart success.
- If proof delivery fails, distinguish that failure from the restart result.
- Never terminate all ChatGPT processes unless the user explicitly authorizes a force-close.

Completion requires a newly resolved, visible ChatGPT window after the close-and-launch sequence. A successful launch command alone is insufficient.
