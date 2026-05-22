# Chrome debug-port retry blocker

Observed 2026-05-15 during a simple voice/browser test to open `https://x.com/home`:

- First `browser_open({ url: "https://x.com/home", observe: "screenshot" })` failed with `browserContext.newPage: Target page, context or browser has been closed`.
- `browser_doctor` was run.
- A second `browser_open` failed with `Chrome launched but did not respond on port 9222 after 15s. Close the Chrome window using profile C:\\Users\\rafel\\.prometheus\\chrome-debug-profile and try again.`
- When the user said to try once more, a later single `browser_open` succeeded and returned "Browser opened" before the turn was interrupted.

## Practical guidance

For simple X-open requests, if the first open fails because the browser context closed, one recovery attempt with `browser_doctor` plus a second `browser_open` is reasonable. If the second attempt reports the Chrome debug profile/port 9222 blocker, stop and report that exact blocker instead of looping. If the user explicitly asks to retry after that blocker, try one clean `browser_open` again before declaring the session unrecoverable, because the debug-profile process may have finished settling or been released between turns.

Keep the final response short for voice-test flows: state whether X opened, or give the exact Chrome debug-profile blocker and the closest next step.