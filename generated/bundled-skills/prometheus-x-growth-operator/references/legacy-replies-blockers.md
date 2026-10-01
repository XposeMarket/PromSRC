# Known Blockers & Workarounds — X Research & Replies Workflow

**Last Updated:** 2026-06-09

## External Blockers (Not Skill Issues)

These blockers are infrastructure or credential limitations, not skill gaps. All workarounds require manual setup or approval.

### 1. xAI Grok x_search Out of Credits
**Symptom:** `x_search` calls fail with "spending limit exceeded" or credit exhaustion.
**Root Cause:** Free xAI Grok credits exhausted; resets monthly or require paid subscription.
**Workaround:**
- Upgrade to paid Grok subscription at grok.com
- Switch to `web_search` + keyword filtering for research fallback (confirmed working 2026-06-09)
- **Best path:** Use browser-first research (open x.com/home, scroll timeline) — zero API dependency
**Status:** Active blocker as of 2026-06-09. Browser-first research is the primary confirmed fallback.

### 2. X Browser Auth Missing (@raulinvests Profile)
**Symptom:** `browser_open` to x.com/home lands on login page; no raulinvests avatar or credentials available.
**Root Cause:** No stored browser session/credentials for raulinvests in scheduled job context; scheduled agents run with a fresh/clean browser profile.
**Workaround:**
- If @raulinvests is already logged in on the desktop browser (interactive runs), browser-first posting works without credentials
- Store raulinvests password in Prometheus vault/auth system for automated login
- Manually log in once to persist the session cookie
**Status:** Partially resolved — interactive desktop runs succeed when logged in. Scheduled cron context still needs persistent credentials.

### 3. X API Token Invalid / Expired (@raulinvests)
**Symptom:** X API calls return 401 Unauthorized or "invalid token refresh" (400 error, `x_api_me` fails).
**Root Cause:** OAuth token for @raulinvests account is expired or revoked.
**Workaround:**
- Refresh/re-authorize @raulinvests account on X OAuth app settings
- Regenerate personal API key/bearer token at developer.twitter.com
- **Preferred short-term path:** Avoid API calls entirely; use browser-first research + posting
**Status:** Active blocker as of 2026-06-09. Browser path does not need the API token.

## Successful Workflow Pattern (2026-06-09)

Browser-first research + posting confirmed fully working in the late evening run:
1. `browser_open("https://x.com/home")` → already logged in as @raulinvests
2. `browser_snapshot / scroll / get_page_text` → captured trending topics from live timeline
3. Keyboard shortcuts `n` / `r` + `Control+Enter` for composing and submitting
4. `browser_close()` immediately after all posting

See full recipe: `references/workflows/prometheus-x-research-replies.md`

## Recommended Next Steps

1. Keep browser-first research as primary path (stable, zero API dependency)
2. Verify/refresh X API token when convenient — not blocking the browser-first path
3. Consider a scheduled credential-keepalive job for the X browser session in the cron context
4. Add xAI Grok credits when available — x_search gives better signal than web_search for reply targeting

---

*changeType: update_blocker_status — evidence: Brain/skill-episodes/2026-06-09/episodes.jsonl, appliedBy: brain_dream, reason: Document 2026-06-09 successful browser-first pattern and update blocker statuses*
