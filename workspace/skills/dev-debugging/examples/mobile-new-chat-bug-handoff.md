# Mobile new-chat bug handoff example

Use this compact example when the user explicitly asks to hand a concrete Prometheus mobile/web defect to ChatGPT Desktop.

## Prompt

```text
Please diagnose this Prometheus mobile defect.

Observed: tapping either New Chat control clears the current view and points the voice surface toward a new mobile chat, but reopening the session drawer shows no new entry.

Expected: a new session is persisted and immediately appears in the mobile session list.

Please inspect session creation/persistence and the mobile drawer refresh path. Report the root cause. Any source change must stay in the normal governed source proposal workflow; do not bypass approval.
```

## Verified choreography

1. Resolve and focus the installed ChatGPT app with an exact window token.
2. Open a new chat only if the user did not request an existing conversation.
3. Wait for the composer, type the compact prompt, and press Enter.
4. Verify the submitted prompt is visible.
5. Capture full-window proof and deliver it to the request origin only when requested or required by the remote workflow.
6. Write a concise handoff note. Create a bounded follow-up only when the user requested monitoring.

Preserve the distinction between session-save failure and list-refresh failure; do not flatten the symptom into “mobile is broken.”
