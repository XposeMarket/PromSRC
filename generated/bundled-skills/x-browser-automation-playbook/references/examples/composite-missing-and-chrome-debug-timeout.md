# X posting recovery: missing composite + Chrome debug timeout (2026-06-01)

Observed failure: a text-only X posting request first looked for a saved `x_post` composite, but the composite was not installed in the active runtime. The fallback then tried `browser_open("https://x.com/home", target:"user_chrome", profile_directory:"Default")`, but Chrome did not respond on debug port 9223 within 15s because the normal Chrome profile was already open.

Recovery guidance:

1. Composite-first is still correct, but treat `Composite "x_post" not found` as a normal fallback condition, not as a hard failure.
2. When falling back to manual browser posting and `browser_open` times out on port 9222/9223 for the user's default Chrome profile, do not claim posting succeeded from a partial fill/tool attempt.
3. Re-ground with the currently available browser/desktop surface: if a normal Chrome window is already open, either use the existing controllable browser session/tool target if available, or ask/route through the documented Chrome-debug recovery path (close/relaunch debugger-enabled Chrome) before attempting to publish.
4. Only final-report `Posted` after a successful submit/post confirmation or a post-specific tool result.

Evidence: `Brain/skill-episodes/2026-06-01/episodes.jsonl` entry at `2026-06-01T05:55:31.864Z` recorded missing `x_post`, a Chrome 9223 timeout, and a final response that still said posted.
