# X browser open timeout / no active session

Observed 2026-05-31 during a real posting request: Raul asked Prometheus to post "whats going on today everybody" on X. The skill loaded correctly, but `browser_open("https://x.com/home")` timed out twice after 60s even after `browser_doctor`; diagnostics showed Playwright was available, but no active browser session opened. Prometheus correctly did not post, reported the exact blocker, and preserved the tweet text.

## Practical guidance

For X posting requests, prefer the saved X post composite when it is available in the active toolset. If a manual browser path is required and `browser_open("https://x.com/home")` times out before a session opens:

1. Run `browser_doctor` once to gather the browser/Playwright state.
2. Retry `browser_open` once with a lighter observation mode if appropriate.
3. If it still times out before a session opens, stop rather than looping. Report that X/browser automation is unavailable, confirm nothing was posted, and preserve the exact intended tweet text for a retry.
4. If the user asks to try again and escalate if it fails, do one fresh retry from current browser state, then use the dev-debugging handoff path if the same no-session/open-timeout blocker repeats.

This is distinct from the Chrome debug-port blocker: here the visible symptom is a 60s `browser_open` timeout with no active session, not an explicit port-9222 profile lock message.