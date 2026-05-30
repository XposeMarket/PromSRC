---
name: Dev Debugging
description: Use this skill when User wants Prometheus to hand off a Prometheus development/debugging task to the Codex desktop app. Default handoff is Ctrl+N, type a simple action-oriented prompt, then Enter; after submitting, always maximize Codex, capture/send screenshot proof to Telegram, write a note, and schedule Telegram follow-up timers to check the Codex window response.
emoji: "🛠️"
version: 1.6.0
---

# Dev Debugging

Use this skill when Prometheus needs to send a development/debugging request about Prometheus to the Codex desktop app.

---

## Hard Default: Ctrl+N → Type → Enter

For Codex handoffs, the default interaction path is always:

1. Focus Codex if needed with `desktop_focus_window({ name: "Codex" })`.
2. Press `desktop_press_key({ key: "Ctrl+N" })` to open a fresh chat.
3. Type the exact prepared prompt with `desktop_type({ text })`.
4. Press `desktop_press_key({ key: "Enter" })` to submit.
5. Immediately maximize the Codex window with `desktop_window_control({ action: "maximize", name: "Codex" })` when possible, or `desktop_window_control({ action: "maximize", active: true })` if Codex is already focused.
6. Verify the handoff actually went through with a fresh Codex window screenshot:
   - Prefer `desktop_window_screenshot({ name: "Codex" })` or `desktop_window_screenshot({ active: true })` if Codex is focused.
   - Always immediately send the most recent desktop screenshot to Raul on Telegram with `desktop_send_to_telegram({ caption: "Codex handoff submitted and running." })`.
7. Write a `write_note` entry summarizing the handoff, exact issue/prompt, screenshot proof sent, and timer status.
8. Create the required 2-minute follow-up timer.
9. Then report briefly.

Do not add coordinate clicks, UI probing, installed-app searches, clipboard checks, or recovery steps before this path unless the path actually fails or Codex is not open/focusable. A post-submit screenshot is required because it verifies that the message reached Codex.

This rule exists because Raul explicitly changed the desired workflow on 2026-04-27/28 and reinforced it on 2026-05-04 after Prometheus treated screenshot proof as conditional. The expected behavior is simple and mandatory: **Ctrl+N, type, Enter, screenshot-send to Telegram, note, timer.**

---

## Explicit User Instructions Still Win

If Raul gives a narrower instruction, obey that exact instruction:

- "Just hit Ctrl+N and then type. Nothing else, let me see what happens." → Press `Ctrl+N`, type, and stop. Do not press Enter.
- "Press enter." → Press `Enter` only.
- "Don't submit" / "draft only" → Do not press Enter.
- "Don't send a screenshot" / "skip proof" → do not send the Telegram screenshot for that handoff.
- "Don't set a timer" / "skip follow-up" → do not set the follow-up timer for that handoff.
- "Codex is open already, just focus and type" → focus/type only unless he also asked to submit.

Otherwise, for normal Codex/dev-debug handoffs, use the hard default: `Ctrl+N` → type → `Enter` → screenshot-send → note → timer.

---

## Mandatory Screenshot + Telegram Follow-up Timer After Successful Submit

When the prompt has been submitted successfully and Codex is visibly working/responding, maximize the window, capture proof, send it to Raul, write a note, and schedule a follow-up instead of just saying it worked:

1. Immediately call `desktop_window_control({ action: "maximize", name: "Codex" })` when possible, or `desktop_window_control({ action: "maximize", active: true })` if Codex is focused. This happens after the message is sent, not before.
2. Call `desktop_window_screenshot({ name: "Codex" })` when possible, or `desktop_screenshot(...)` if the Codex window cannot be isolated.
3. Always immediately send the most recent desktop screenshot to Raul on Telegram with `desktop_send_to_telegram({ caption: "Codex handoff submitted and running." })`. Do not wait for Raul to ask for proof.
4. Write a `write_note` entry with the handoff context, the fact that screenshot proof was sent, and the timer/follow-up status.
5. Always create a 2-minute one-off timer with Telegram delivery semantics to check the Codex window again. Use `timer({ action: "create", delay_seconds: 120, label: "Check Codex debugging response", instruction: "Check the Codex desktop window for the debugging handoff response. Focus Codex if needed, maximize the Codex window, take a fresh screenshot/window screenshot, send the screenshot to Raul on Telegram, read what Codex responded, and report the result to Raul in Telegram. If Codex is still working and this is the first follow-up timer for this handoff, create exactly one more 2-minute follow-up timer after writing a note. If Codex is still working after the second follow-up timer, do not create another timer; reply to Raul that Codex is still working and it's taking a bit." })`. The current Telegram session is the delivery context for this timer.
6. The follow-up timer must inspect the real Codex UI with desktop tools: focus Codex if needed, maximize it, take a fresh screenshot/window screenshot, send screenshot proof to Telegram, and read the visible response/status.
7. Maximum timer chain: initial post-submit timer + one retry timer. On the second check, if Codex is still running/thinking, stop scheduling and reply in Telegram with wording like: "Codex is still working — it's taking a bit."
8. Do not use this screenshot/timer routine as an excuse to delay the actual handoff. The order is: submit first, screenshot-send second, note third, timer fourth, report fifth.

This is specifically for successful Codex handoffs where Raul wants automatic evidence that the message went through and Codex is working, plus automatic follow-up so the Codex answer is not missed.

---

## Prompt Shape for Codex

The Codex prompt should be simple, direct, and action-oriented. Codex is allowed to inspect the repo and fix small/safe issues directly.

Default structure:

- Start with: "Hi Codex, it's Prometheus on behalf of my user."
- State the issue in plain language with the most relevant concrete clues Prometheus already found.
- Ask Codex to verify the issue, identify the problem, and report back clearly.
- If the fix is small and safe, explicitly tell Codex it may proceed and apply the fix.

Preferred wording for most debugging handoffs:

> Please go and verify the issue and let me know what the problem is. If it's a small/safe fix, please proceed and do so.

Do not overload Codex with Prometheus proposal constraints, "no edits" rules, or excessive process instructions unless Raul specifically asks for a read-only investigation. Codex is not bound to Prometheus proposal workflow in these desktop handoffs.

---

## Recovery / Fallback Rules

Only use fallback actions after the default path fails or Codex is genuinely unavailable.

- If focus fails, inspect visible windows/processes and then report the exact blocker.
- If typing fails, try `desktop_type_raw` once.
- If Ctrl+N does not open a new chat, then use a screenshot-anchored coordinate click on the new-chat control; Raul previously identified it around `(75,75)` when the Codex app coordinate space matches the visible window.
- Use screenshots only to recover from uncertainty/failure, not as a preflight ritual before submit.
- Follow-up timers are mandatory after submitted Codex debugging handoffs. Only skip the timer when Raul explicitly says not to schedule a follow-up.
- Screenshot proof is mandatory after submitted Codex debugging handoffs. Only skip the Telegram screenshot when Raul explicitly says not to send proof.

---

## Desktop Rules

- Use desktop automation, not browser automation, for Codex tasks.
- Prefer keyboard shortcuts; `Ctrl+N` is confirmed for Codex new chat.
- For native Codex window management, use `desktop_window_control` instead of title-bar coordinate clicks. Example: maximize the focused Codex window with `desktop_window_control({ action: "maximize", active: true })`, or target Codex directly with `desktop_window_control({ action: "maximize", name: "Codex" })`.
- Do not click around just to "make sure".
- Do not use clipboard inspection unless Raul asks or typing fails.
- Do not modifier-click unless the UI explicitly requires it.

---

## Anti-patterns

- Do not open a browser for Codex desktop tasks.
- Do not start with app discovery/search if Raul indicates Codex is already open.
- Do not reuse an existing Codex chat unless Raul specifically asks; default to fresh chat via Ctrl+N.
- Do not send vague prompts like "fix this." Include enough concrete symptoms/clues for Codex to verify the issue quickly.
- Do not over-explain Prometheus context in the prompt; Codex already has full Prometheus context in new chats.
- Do not inject Prometheus proposal workflow, broad "no edits" constraints, or excessive caution into Codex handoffs unless Raul explicitly asks for read-only investigation.
- Do not add clicks, screenshots, launches, timers, or UI poking before the default `Ctrl+N` → type → `Enter` flow. The required screenshot-send, note, and 2-minute Telegram follow-up timer happen only after the debugging message has been submitted.
