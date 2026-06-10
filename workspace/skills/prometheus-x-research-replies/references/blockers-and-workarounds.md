# Known Blockers & Workarounds — X Research & Replies Workflow

**Last Updated:** 2026-06-08

## External Blockers (Not Skill Issues)

These blockers are infrastructure or credential limitations, not skill gaps. All workarounds require manual setup or approval.

### 1. xAI Grok x_search Out of Credits
**Symptom:** `x_search` calls fail with "spending limit exceeded" or credit exhaustion.
**Root Cause:** Free xAI Grok credits exhausted; resets monthly or require paid subscription.
**Workaround:**
- Upgrade to paid Grok subscription at grok.com
- Switch to `web_search` + keyword filtering for research fallback
- Delegate x_search to a separate scheduled job with independent credits
**Status:** Active blocker as of 2026-06-08. Fallback to web_search confirmed working.

### 2. X Browser Auth Missing (@raulinvests Profile)
**Symptom:** `browser_open` to x.com/home lands on login page; no raulinvests avatar or credentials available.
**Root Cause:** No stored browser session/credentials for raulinvests in scheduled job context; scheduled agents run with a fresh/clean browser profile.
**Workaround:**
- Store raulinvests password in Prometheus vault/auth system for automated login
- Use X OAuth flow instead of browser password login
- Manually log in once and persist the session cookie to the scheduled context
- Use X API create_post directly (see blocker 3)
**Status:** Active blocker as of 2026-06-08. Affects all browser-based posting attempts.

### 3. X API Token Invalid / Expired (@raulinvests)
**Symptom:** X API calls return 401 Unauthorized or "invalid token refresh" (400 error).
**Root Cause:** OAuth token for @raulinvests account is expired or revoked; typical for accounts unused > 1 week.
**Workaround:**
- Refresh/re-authorize @raulinvests account on X OAuth app settings
- Regenerate personal API key/bearer token at developer.twitter.com
- Verify token is stored in Prometheus vault under the correct path (check SOUL.md/BUSINESS.md for expected location)
- Test with a test X API call before attempting research workflow
**Status:** Active blocker as of 2026-06-08. X API posting unavailable until token is refreshed.

## Prepared Content (Ready When Auth Fixed)

Three research angles prepared on 2026-06-08 but not posted due to blockers above. Ready to post immediately once auth is restored:

1. **Agent Reasoning Patterns:** "Agent reasoning patterns are shifting fast in 2026. The ones that learn from task feedback, refine their approach incrementally, and build domain-specific reasoning improve dramatically over time. That's different from throwing more parameters at the problem. This is where local learning and persistent memory shine."

2. **Agent Specialization:** "Specialization wins in 2026. Generalist LLM chatbots lost. Agents with domain reasoning, local learning, and task-specific memory are outperforming. That's a shift."

3. **Human-AI Collaboration:** "In 2026, agent memory is the last real battleground. Stateless chatbots → stateful learning agents. The teams with durable, queryable memory across sessions will outcompete those rebuilding context every turn."

## Recommended Next Steps

1. Verify and refresh X API token before next workflow run
2. Add xAI Grok credits or migrate to web_search fallback
3. Store safe browser credentials for @raulinvests or switch to X API posting
4. Test credentials before the next scheduled run (consider a manual test run after fixes)

---

*This reference is maintained by Dream/Skill Curator and updated whenever blockers change or new failure patterns emerge.*
