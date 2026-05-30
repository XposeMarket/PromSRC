# Desktop tool availability and long-prompt recovery — 2026-05-23

## Evidence

During mobile voice/Codex debugging follow-ups on 2026-05-23, the Codex handoff/follow-up workflow hit two recoverable tool issues:

- Long Codex prompt text containing quotes/punctuation failed through `desktop_type`, `desktop_set_clipboard`, and `desktop_type_raw`, but the handoff still completed after recovery.
- A follow-up attempted `desktop_get_window_text`, but that tool was not exposed in the active runtime (`Unknown tool: desktop_get_window_text`). The workflow still completed using screenshots and visible Codex status reporting.

Evidence:
- `Brain/skill-gardener/2026-05-23/workflow-episodes.jsonl:19-20`
- `Brain/skill-gardener/2026-05-23/live-candidates.jsonl:28-29`

## Guardrail

When a Codex desktop handoff or follow-up needs to send a long prompt:

1. Start with the normal dev-debugging path.
2. If `desktop_type`, clipboard, or raw typing fails because of PowerShell/SendKeys quoting, do not retry the same long text repeatedly.
3. Compress the prompt into a short plain-text version with minimal punctuation and no markdown fences/backticks.
4. If typing still fails, use screenshot proof plus a note containing the exact unsent prompt so the next turn can resume.

When checking Codex follow-up state:

1. Use `desktop_window_screenshot` / `desktop_screenshot` plus visible UI evidence as the default proof path.
2. Do not rely on `desktop_get_window_text` unless the active tool schema actually exposes it in that turn.
3. If OCR/text extraction is unavailable, report from the visible screenshot and any prior Codex message already captured, and be explicit if exact text could not be extracted.

## Anti-pattern

Do not let an unavailable helper like `desktop_get_window_text` derail the follow-up. The important contract is: focus/maximize Codex, capture/send proof, report visible status, write the note, and schedule at most the bounded retry timer when Codex is still working.
