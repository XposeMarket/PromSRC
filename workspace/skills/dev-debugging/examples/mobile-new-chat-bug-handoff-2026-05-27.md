# Example: Mobile new-chat bug Codex handoff (2026-05-27)

Use this as a compact pattern when Raul asks to run the dev-debugging skill for a Prometheus mobile/web-ui bug and provides concrete reproduction clues.

## User request pattern

> Please run the dev debug skill on this issue — none of the new chat buttons are actually creating new chats on the mobile app, or at least they aren't showing/updating. I hit the `+` icon in the header or the New Chat button in the left panel; it clears the chat and the voice page points toward a new mobile chat, but opening the hamburger menu reveals no new mobile chats.

## Handoff prompt shape

```text
Hi Codex, it's Prometheus on behalf of my user.

Please verify this Prometheus mobile app bug and let me know the problem. If it's a small/safe fix, please proceed and do so.

Symptom: On the mobile app, neither the header `+` icon nor the left-panel New Chat button appears to create a visible new mobile chat. Tapping either clears the chat and the voice page looks pointed at a new mobile chat, but reopening the hamburger/session drawer shows no new mobile chat entry. Please check whether the chat is saved at all, whether it appears on desktop but not mobile, or whether the mobile drawer/list refresh is failing.

Please inspect the mobile new-chat flow, session creation/save path, and mobile drawer/session-list refresh path. Report the root cause clearly and apply a small safe fix if you find one.
```

## Tool choreography that worked

1. `skill_list`
2. `skill_read({ id: "dev-debugging" })`
3. `desktop_focus_window({ name: "Codex" })`
4. `desktop_press_key({ key: "Ctrl+N" })`
5. `desktop_type({ text: <prepared prompt> })`
6. `desktop_press_key({ key: "Enter" })`
7. `desktop_window_control({ action: "maximize", name: "Codex" })`
8. `desktop_window_screenshot({ name: "Codex" })`
9. `desktop_send_to_telegram({ caption: "Codex handoff submitted and running." })`
10. `write_note(...)`
11. `timer({ action: "create", delay_seconds: 120, ... })`, unless Raul explicitly asks to skip/cancel follow-up.

## Notes

- Preserve Raul's reproduction clues in the Codex prompt; do not flatten them into “mobile is broken.”
- Ask Codex to check both persistence and mobile list refresh, because symptoms can be ambiguous between save failure and drawer/list update failure.
- If Raul immediately cancels the timer after the successful handoff, cancel it; the screenshot proof and handoff still count as complete.