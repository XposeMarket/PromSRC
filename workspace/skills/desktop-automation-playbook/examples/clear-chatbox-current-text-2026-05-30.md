# Clearing current text from a desktop chat box (Claude example)

Date: 2026-05-30
Context: Raul asked Prom to clear whatever was currently typed in the Claude desktop app chat box without sending anything.

## What worked

1. Use a fresh desktop/window screenshot to confirm the app and input area.
2. If the chat app is known and already focused, click directly inside the composer/input field using plain coordinate-based clicking.
   - Prefer fresh screenshot `coordinate_space="capture"` coordinates when available.
   - If the window geometry is stable and screenshot IDs become stale because of focus changes, use window-local coordinates with `verify:"off"` for the known input field.
3. Press `Ctrl+A` to select only the current text in the focused chat box.
4. Press `Backspace` or `Delete` to clear it.
5. Capture/verify with a fresh screenshot if the user asks or if there is any ambiguity.

## Important guardrails

- Do **not** press Enter. Clearing a composer must never submit/send the current draft.
- Do **not** use modifier-clicks unless the UI truly needs them; Raul prefers normal screenshot-grounded coordinate clicks.
- Avoid clipboard unless explicitly requested or normal keyboard selection fails.
- If `Ctrl+A` appears to select the page/chat history instead of the composer text, re-click deeper inside the input field and retry.
- If the app has focus quirks, double-click/click-drag inside the composer can help re-anchor the caret, then use `Ctrl+A` + `Backspace/Delete`.

## Claude desktop notes from this run

Claude was maximized on monitor 0. The composer sat near the bottom of the window. The successful pattern was:

- Click inside the bottom composer area using fresh screenshot coordinates.
- `Ctrl+A`.
- `Backspace`/`Delete`.
- Verify with screenshot.

This is safe for “clear what’s in the chat box” requests because it removes draft text without triggering a send action.