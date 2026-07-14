# Claude Terminal Approval Loop Recovery — 2026-05-28

## Observed failure
the user asked Prometheus to drive a top-left Windows Terminal running Claude, not the Claude desktop app and not the Prometheus terminal. Prometheus initially targeted the wrong surface, causing user frustration, then entered a long approval loop around Claude's `accept edits on (shift+tab to cycle)` / `auto mode on` prompt.

Symptoms observed:
- Normal `desktop_press_key("Enter")` repeated without advancing the approval prompt.
- `desktop_type_raw("\n")`, `desktop_type_raw("y\n")`, Space, Tab, Shift+Tab, and Ctrl+Enter sometimes changed local prompt state but did not start the requested restart/test.
- One `y` was interpreted by Claude as a literal chat message, not approval.
- Focus sometimes jumped back to Edge after raw typing attempts.
- The safe stopping point was to report the blocker and stop repeating approval attempts unless a new visible option appeared.

## Safer future pattern
1. Use `desktop_screenshot` for full-layout truth when the user distinguishes between multiple similar windows.
2. If the user says “terminal, not app,” prefer `desktop_find_window` / `desktop_focus_window` with the terminal title, then verify with `desktop_window_screenshot` or visible title/context before typing.
3. For a one-time terminal approval, click into the actual terminal prompt, send one intended key/input, then immediately re-ground with a screenshot.
4. If the same approval line remains after two distinct methods, stop repeating keys. Report the exact visible blocker and ask/route for a different path instead of continuing blind approval loops.
5. Treat mode labels like `accept edits on` / `auto mode on` as state indicators, not guaranteed submit controls. Verify that Claude actually starts working after input.

## Evidence
- `audit/chats/transcripts/25320b24-1196-491e-8f28-5b2ce28b0930.md:7-48` — wrong-surface correction and eventual correct terminal targeting.
- `audit/chats/transcripts/mobile_mppswj1j_m3ziqd.md:77-220` — repeated timer/approval loop, raw newline attempts, y interpreted as chat input, final blocker report.
- `Brain/skill-gardener/2026-05-28/live-candidates.jsonl:24-36` — live candidates captured repeated desktop approval-loop evidence and suggested a focused playbook note.
