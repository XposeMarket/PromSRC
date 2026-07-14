# Wedged Chrome CDP and Origin Screenshot Delivery

## Trigger

The user asked variants of:

- "Run the AI smoke test for Raul."
- "AI, run the smoke test for me, please."

## What Worked

- Desktop window discovery found ChatGPT and Claude.
- Focusing ChatGPT and Claude worked when using the desktop window tools.
- Fresh desktop screenshots could be captured and delivered to the mobile origin when the flow explicitly captured a screenshot file and then called the delivery tool.
- Web-search fallback produced useful Reddit/X-style AI chatter when browser automation could not attach.

## Failure Pattern

Browser automation repeatedly failed even though Chrome was present:

- Prometheus Chrome debug port `9222` responded, but Playwright attach timed out (`browserType.connectOverCDP: Timeout ... exceeded`).
- User Chrome debug port `9223` failed because normal Chrome was already open with that profile.
- Desktop Chrome fallback was unreliable when Chrome menus/session prompts stole focus or left address-bar navigation stuck.

Screenshot delivery also had a small trap:

- A tool screenshot id is not necessarily a deliverable attachment path.
- If `delivery_send_screenshot` reports `Attachment not found`, capture a fresh `desktop_screenshot` or `desktop_window_screenshot` and send that returned screenshot/file id explicitly.
- Do not tell Raul a screenshot was sent until the delivery tool succeeds.

## Recommended Recovery Order

1. Load this skill plus only the matching desktop, browser, or X playbook.
2. Focus ChatGPT and Claude with exact window tokens when possible.
3. Capture and deliver fresh origin screenshots only when the user requested monitored proof or ambiguity requires it; do not send one after every focus by default.
4. Run `browser_doctor` before repeated `browser_open` retries if port `9222`/`9223` errors appear.
5. If `9222` is wedged and `9223` is blocked by normal Chrome, report the exact Chrome target blocker and continue with `web_search` / `web_fetch` fallback rather than looping on browser_open.
6. In the final, separate: desktop focus result, screenshot delivery result, browser target health, and fallback research result.

## Output Shape

```markdown
Done — smoke test ran.
- Desktop focus: ChatGPT <worked/blocked>, Claude <worked/blocked>.
- Screenshot delivery: <worked/blocked with exact error>.
- Browser automation: <worked/blocked; include 9222/9223 details when relevant>.
- Fallback research: <worked/skipped; summarize Reddit/X/search themes>.

Tool check: desktop <pass/fail>; screenshot delivery <pass/fail>; browser target <pass/fail>; fallback <pass/fail>.
```
