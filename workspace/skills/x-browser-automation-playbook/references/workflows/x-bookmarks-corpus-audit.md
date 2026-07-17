# X bookmarks corpus audit

1. Start at `https://x.com/i/bookmarks` and anchor at the top.
2. Prefer authenticated user Chrome. If attachment fails: close/reopen the exact profile, retry once, then use the authenticated Prometheus profile; use desktop-only extraction only as the last fallback.
3. Collect each visible `article` with canonical `/status/<id>` URL and visible text/author/date/quote context. Dedupe by canonical URL.
4. Use a bounded 60-80 scroll ceiling and a stable-no-new stop boundary. Record first URL, last URL, count, scrolls, and collection profile.
5. Persist raw JSON/JSONL with workspace-native file writes when browser download paths are unavailable.
6. Run a short verification pass. X virtualization is mutable, so small count drift is expected and must be documented rather than silently normalized.
7. For skill audits, pass the corpus to `bookmark-to-skill-distiller`.

## Tool recovery learned 2026-07-17
`scroll_collect_v2` rejected a structured call with a misleading 'Too many arguments' error and `scroll_collect` demanded structured extraction configuration. Direct DOM article/status collection was the successful fallback (499 unique, then 497 on verification). Do not loop on the collector wrappers when their schema behavior conflicts with the documented wrapper contract.