---
name: "dev-debugging"
description: "Hand a Prometheus development or debugging request to the ChatGPT desktop app when the user explicitly asks for that desktop handoff. Use for composing, submitting, proving, and following up on a ChatGPT debugging request; do not invoke for normal debugging that Prometheus can perform directly."
---

# ChatGPT Development Handoff

Use the desktop app as an explicitly requested external development handoff. Do not treat it as Prometheus's normal debugging route or as a substitute for local diagnosis.

## Submit

1. Prepare a compact prompt containing the observed behavior, expected behavior, strongest evidence, relevant paths or subsystem, and the requested outcome.
2. Focus the ChatGPT desktop window. If it is not open, resolve and launch the installed ChatGPT application.
3. Unless the user requests an existing conversation, press `Ctrl+N` for a fresh chat.
4. Type the prepared prompt and press Enter only when submission is authorized.
5. Verify the submitted prompt is visible in the ChatGPT window. A successful keypress is not proof of submission.

## Evidence and follow-up

- Capture a fresh window screenshot after submission.
- For a remote/origin request, send proof with `delivery_send_screenshot(source:"desktop_new", target:"origin")`.
- Record a concise note containing the prompt purpose, submission time, and follow-up state when `write_note` is available.
- Create a two-minute follow-up timer only when the user requested asynchronous monitoring or the active delivery surface supports it. Cap automatic follow-up at two checks.
- On follow-up, inspect the real ChatGPT window. Report whether it is still working, completed, or failed; do not infer completion from elapsed time.

## Boundaries

- Obey draft-only, do-not-submit, no-screenshot, and no-follow-up instructions.
- Do not send repository secrets, credentials, unrelated transcripts, or private user data.
- Do not claim ChatGPT changed Prometheus until the resulting workspace diff and validation prove it.
- If ChatGPT proposes source changes, those changes remain subject to the normal development source-edit workflow.
- Prefer stable window IDs and keyboard input; use coordinate clicks only as screenshot-grounded recovery.

Completion means the requested prompt was visibly submitted and, when requested, the resulting response was collected and reported.

Read [references/handoff-recovery.md](references/handoff-recovery.md) only after a window, conversation, prompt-transport, modal, helper, or follow-up failure. Use [templates/stuck-approved-proposal-handoff.md](templates/stuck-approved-proposal-handoff.md) only for executor diagnosis inside the governed proposal lane; the [mobile bug example](examples/mobile-new-chat-bug-handoff.md) shows the compact prompt shape.
