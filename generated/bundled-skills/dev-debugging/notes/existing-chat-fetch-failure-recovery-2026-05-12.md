# Existing-Chat Codex Handoff + Fetch-Failure Recovery — 2026-05-12

Evidence: Raul explicitly asked Prometheus not to start a new Codex chat, but to go to the existing `implement concurrent desktop controls` chat and type the desktop sandbox findings there. The handoff returned only `Error: fetch failed`, and after restart Prometheus asked whether to continue instead of recovering automatically (`audit/chats/transcripts/telegram_1799053599_1778556678895.md:106-118`).

## When this applies

Use this note when Raul explicitly asks for a Codex handoff into an **existing** chat/thread. The hard default remains Ctrl+N for normal handoffs, but explicit existing-chat instructions override that default.

## Existing-chat flow

1. Preserve Raul's target chat phrase exactly, e.g. `implement concurrent desktop controls`.
2. Use desktop automation to focus Codex and locate/select that existing chat. Prefer visible sidebar/search/history UI grounded in fresh screenshots; do not open a new chat unless Raul changes the instruction.
3. Once the existing chat composer is active, use the simplest safe send path: type the prepared action-oriented prompt and press Enter.
4. After submit, follow the normal proof path: maximize/capture Codex, send screenshot proof to Telegram unless skipped, write a note, and set the follow-up timer unless skipped.

## Fetch-failure recovery

If a desktop/Codex handoff fails with a bare infrastructure error such as `Error: fetch failed`:

1. Do not answer with only the raw error.
2. Immediately inspect recoverable state if tools are available: Codex window screenshot/focus state and whether the draft/prompt appears typed or submitted.
3. If the prompt was not submitted and the target existing chat is still identifiable, retry once using screenshot-anchored desktop steps.
4. If retry is unsafe or Codex cannot be reached, report the exact blocker and include the handoff prompt text in the note so the next restart can resume without reconstructing it.
5. After a restart, if the last user-facing state was this failed handoff and the target/prompt are preserved, continue the recovery path directly instead of asking Raul whether to continue.

## Anti-pattern

Do not collapse this into `Error: fetch failed` or ask a vague restart question when the prior request was specific, recoverable, and already approved.