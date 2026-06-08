---
name: Dev Debugging
description: Use this skill when Raul wants Prometheus to hand off a Prometheus development/debugging task to a desktop AI app: Codex by default when explicitly named, or Claude as a secondary option when explicitly named. If Raul asks for a dev/debugging handoff but does not specify Codex vs Claude, Prometheus must ask which AI to use before doing anything.
version: 1.7.0
---

# Dev Debugging

Use this skill when Prometheus needs to send a development/debugging request about Prometheus to a desktop AI app.

Supported targets:

- **Codex** — primary/default tool when Raul explicitly says Codex, “send to Codex,” “tell Codex,” etc.
- **Claude** — secondary option when Raul explicitly says Claude, “send to Claude,” “ask Claude,” etc.

---

## Target Confirmation Rule — Mandatory

If Raul asks for a dev/debugging handoff but **does not explicitly name which AI desktop app to use**, stop before any desktop action and ask a short confirmation question:

> Which AI should I use for this one — Codex or Claude?

Do not focus windows, type prompts, submit, send screenshots, or set timers until Raul confirms the target AI.

Examples that require confirmation:

- “pass this to the dev AI”
- “run the dev debugging skill”
- “have the AI look at this”
- “send this over and check back”

Examples that do **not** require confirmation:

- “send this to Codex” → use Codex
- “tell Claude this” → use Claude
- “ask Claude to check the mobile bug” → use Claude
- “pass it onto Codex” → use Codex

Explicit user instructions still win: if Raul names the target and says “don’t submit,” “draft only,” “skip screenshot,” or “skip timer,” obey that narrower instruction.

---

## Codex Handoff Path

For Codex handoffs, the default interaction path is:

1. Focus Codex if needed with `desktop_focus_window({ name: "Codex" })`.
2. Press `desktop_press_key({ key: "Ctrl+N" })` to open a fresh chat.
3. Type the exact prepared prompt with `desktop_type({ text })`.
4. Press `desktop_press_key({ key: "Enter" })` to submit.
5. Immediately maximize Codex with `desktop_window_control({ action: "maximize", name: "Codex" })` when possible, or active-window maximize if Codex is already focused.
6. Capture a fresh Codex screenshot/window screenshot.
7. Send screenshot proof to Raul on Telegram/origin with caption like: `Codex handoff submitted and running.`
8. Write a `write_note` entry summarizing the handoff, exact issue/prompt, screenshot proof sent, and timer status.
9. Create the required 2-minute follow-up timer.
10. Report briefly.

Default Codex prompt shape:

- Start with: `Hi Codex, it's Prometheus on behalf of my user.`
- State the issue in plain language with the most relevant concrete clues Prometheus already found.
- Ask Codex to verify the issue, identify the problem, and report back clearly.
- If the fix is small and safe, explicitly tell Codex it may proceed and apply the fix.

Preferred wording:

> Please go and verify the issue and let me know what the problem is. If it's a small/safe fix, please proceed and do so.

Do not inject Prometheus proposal workflow, broad “no edits” constraints, or excessive caution into Codex handoffs unless Raul explicitly asks for read-only investigation.

---

## Claude Handoff Path

Claude is a supported secondary dev-debugging target. Use Claude when Raul explicitly asks to use Claude.

For Claude handoffs, use the current/fresh Claude desktop chat as appropriate to Raul’s instruction and visible UI state:

1. Focus Claude with `desktop_focus_window({ name: "Claude" })` or target the known Claude window with `desktop_list_windows` / `desktop_get_window_state` if needed.
2. Maximize Claude with `desktop_window_control({ action: "maximize", name: "Claude" })` when possible.
3. Use a fresh screenshot/window screenshot to ground the composer location if the UI is ambiguous.
4. If Raul wants a new chat and Claude supports the shortcut/UI path, use it; otherwise use the visible current composer.
5. Type the exact prepared prompt into the Claude chat box with `desktop_window_type` or screenshot-grounded click + `desktop_type`.
6. Submit with `Enter` only when Raul asked to submit / did not say draft-only.
7. Immediately capture a fresh Claude screenshot/window screenshot after submit.
8. Send screenshot proof to Raul on Telegram/origin with caption like: `Claude handoff submitted and running.`
9. Write a `write_note` entry summarizing the handoff, exact issue/prompt, screenshot proof sent, and timer status.
10. Create the required 2-minute Claude follow-up timer.
11. Report briefly.

Default Claude prompt shape:

- Start with: `Hi Claude, it's Prometheus on behalf of my user.`
- State the bug/request plainly.
- Include any concrete symptom Raul gave and any relevant UI/source clues Prometheus already has.
- Ask Claude to verify the issue and explain the problem.
- If the fix is small and safe in its own environment, ask Claude to proceed and report exactly what changed.

---

## Mandatory Screenshot + Follow-up Timer After Successful Submit

After a successful submitted handoff to Codex or Claude, always maximize/capture/send proof, write a note, and schedule a follow-up unless Raul explicitly says to skip proof or timers.

### Initial 2-minute timer

Create a 2-minute one-off timer targeted to the same session/origin with instructions specific to the chosen AI:

For Codex:

> Check the Codex desktop window for the debugging handoff response. Focus Codex if needed, maximize the Codex window, take a fresh screenshot/window screenshot, send the screenshot to Raul on Telegram/origin, read what Codex responded, and report the result. If Codex is still working and this is the first follow-up timer for this handoff, create exactly one more 2-minute follow-up timer. If Codex is still working after the second follow-up timer, do not create another timer; reply that Codex is still working and it’s taking a bit.

For Claude:

> Check the Claude desktop window for the debugging handoff response. Focus Claude if needed, maximize the Claude window, take a fresh screenshot/window screenshot, send the screenshot to Raul on Telegram/origin, read what Claude responded, and report the result. If Claude is still working and this is the first follow-up timer for this handoff, create exactly one more 2-minute follow-up timer. If Claude is still working after the second follow-up timer, do not create another timer; reply that Claude is still working and it’s taking a bit.

### Timer behavior

- The follow-up timer must inspect the real desktop UI with desktop tools.
- If the AI appears finished, send the screenshot and summarize what it said.
- If the AI is still working on the first timer, reset/schedule exactly one more 2-minute timer.
- If the AI is still working on the second timer, send a screenshot and tell Raul it is still working; do not create an infinite timer chain.
- If the AI finishes on the second timer, send the screenshot and summarize the result.

Order after submit is always: screenshot-send → note → timer → brief report.

---

## Explicit User Instructions Still Win

If Raul gives a narrower instruction, obey it exactly:

- “Just type it, don’t send.” → type only; do not press Enter.
- “Press enter.” → press `Enter` only.
- “Don’t submit” / “draft only” → do not press Enter.
- “Don’t send a screenshot” / “skip proof” → do not send screenshot proof for that handoff.
- “Don’t set a timer” / “skip follow-up” → do not set the follow-up timer.
- “Use the existing Claude chat” → use existing Claude chat.
- “Use a new Codex chat” → fresh Codex chat via Ctrl+N.

---

## Recovery / Fallback Rules

Only use fallback actions after the default path fails or the named app is genuinely unavailable.

- If focus fails, inspect visible windows/processes and report the exact blocker.
- If typing fails, try `desktop_type_raw` once.
- For Codex, if Ctrl+N does not open a new chat, use a screenshot-anchored coordinate click on the new-chat control; Raul previously identified it around `(75,75)` when the Codex app coordinate space matches the visible window.
- For Claude, if the composer contains stale text, use the saved desktop automation clear-chatbox technique: focus the composer, select/delete only the current composer text, then type the new prompt.
- Use screenshots to recover from uncertainty/failure and after submit for proof.
- Do not click ambiguous permission/security modals unless a fresh screenshot clearly shows the target and action.

---

## Desktop Rules

- Use desktop automation, not browser automation, for Codex/Claude desktop tasks.
- Prefer app/window-specific tools (`desktop_window_control`, `desktop_get_window_state`, `desktop_window_type`, `desktop_window_press_key`) when targeting Claude or Codex.
- Prefer keyboard shortcuts where confirmed.
- Do not click around just to “make sure.”
- Do not use clipboard inspection unless Raul asks or typing fails.
- Do not modifier-click unless the UI explicitly requires it.
- Ground coordinate clicks in fresh screenshots when state is ambiguous.

---

## Anti-patterns

- Do not choose Codex vs Claude silently when Raul did not name the AI. Ask first.
- Do not open a browser for Codex or Claude desktop handoffs.
- Do not start with app discovery/search if Raul indicates the target app is already open.
- Do not reuse an existing Codex chat unless Raul specifically asks; default Codex path is fresh chat via Ctrl+N.
- Do not send vague prompts like “fix this.” Include concrete symptoms/clues.
- Do not over-explain Prometheus context in the prompt.
- Do not claim a fix from the AI’s text alone; distinguish “AI reported” from verified source/runtime changes.
