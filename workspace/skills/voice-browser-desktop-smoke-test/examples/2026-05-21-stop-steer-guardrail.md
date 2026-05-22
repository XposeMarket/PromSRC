# Example: Stop/steer during voice browser-desktop smoke test (2026-05-21)

Observed in mobile voice sessions `mobile_mpf0c775_1x6zfu` and `mobile_mpf2ogq9_bu4tke`.

## Request shape

Raul asks for the AI smoke test while testing mobile voice/interruption flow, then may say something like:

- "No, go ahead and stop."
- "Please go ahead and just stop never mind."

## Correct behavior

1. Treat the stop/steer as authoritative immediately.
2. Do not force completion of the original smoke-test script after a stop request.
3. If any browser/desktop action already ran, stop further actions and report what was already done versus skipped.
4. If no tool calls completed yet, answer briefly: `Stopped — no smoke test.`
5. If the runtime later resumes after a gateway restart, preserve that the user stopped the test; do not auto-resume the smoke test unless Raul explicitly asks again.

## Evidence

- `audit/chats/transcripts/mobile_mpf0c775_1x6zfu.md:1-13`: Raul tested interruption and Prometheus reported it stopped and changed course.
- `audit/chats/transcripts/mobile_mpf2ogq9_bu4tke.md:19-30`: Raul asked for the smoke test, then said to stop; Prometheus acknowledged stop but a later completion message still appeared. This is the failure mode to avoid.
