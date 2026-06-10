# Create Schedule Job with Fallback Chains - Example

Example of creating a robust scheduled job with full fallback behavior based on the X research/posting workflow pattern.

## Problem

Creating scheduled jobs that gracefully handle:
- API token failures
- External service outages  
- Browser auth issues
- Confirm gate blockers

## Solution Pattern

### 1. Research Job with Fallbacks

```javascript
{
  "action": "create",
  "name": "prometheus-x-research-replies", 
  "confirm": true,
  "schedule": {
    "kind": "recurring",
    "cron": "0 1,4,7,10,13,16,19,22 * * *"
  },
  "instruction_prompt": `Run the X research & replies workflow every time this job fires:

1. Read the skill "prometheus-x-research-replies" first using skill_read("prometheus-x-research-replies").
2. Read workspace/prometheus-x-posts-memory.md first using read_file to avoid duplicates and understand prior posts.

3. RESEARCH PHASE - Try in order, use first one that succeeds:
   a) Try x_search (external_apps X connector) to find fresh AI/tech topics and reply opportunities.
   b) If x_search fails or unavailable: browser_open("https://x.com/home") and manually search the feed for AI agent memory topics, reply threads, and fresh angles. Use browser_snapshot, browser_get_page_text, and browser_scroll to gather live opportunities.
   c) If browser fails: web_search with site:x.com "AI agents memory" or similar queries, then web_fetch relevant threads.

4. SELECTION PHASE - Pick 1-2 high-engagement threads where Prometheus/agent memory perspective adds genuine value.

5. REPLY PHASE - Try in order:
   a) Use browser automation: browser_open X thread, browser_click reply button, browser_fill with thoughtful reply, browser_click submit.
   b) If browser fails: log the thread URL and draft reply to workspace/prometheus-x-reply-drafts.md for manual posting.

6. CRITICAL: Do NOT use em dashes (—) in any replies. Use periods, commas, colons, or hyphens instead.

7. Update workspace/prometheus-x-posts-memory.md with what was posted/drafted.

8. ALWAYS browser_close() when finished to prevent CDP conflicts.

SUCCESS: Real replies posted or high-quality drafts saved with thread URLs.`,
  "delivery": {
    "channel": "web"
  }
}
```

### 2. Posting Job with Fallbacks

```javascript
{
  "action": "create",
  "name": "prometheus-x-posts",
  "confirm": true, 
  "schedule": {
    "kind": "recurring",
    "cron": "0 */3 * * *"
  },
  "instruction_prompt": `Run the X posting workflow every time this job fires:

1. Read skill "prometheus-x-posts-workflow" using skill_read("prometheus-x-posts-workflow").
2. Read workspace/prometheus-x-posts-memory.md using read_file to check prior posts and avoid duplicates.
3. Generate one original, human-tone post grounded in Prometheus product updates, AI agent memory themes, or dev insights.
4. CRITICAL: Do NOT use em dashes (—). Use periods, commas, colons, or hyphens instead.
5. Post from @raulinvests via browser automation:
   a) Try browser_open("https://x.com/home") and use inline composer (tweetTextarea_0 element)
   b) Fill composer, click submit button, wait for confirmation
   c) If browser fails: fall back to workspace/prometheus-x-draft-posts.md and log the draft
6. Update workspace/prometheus-x-posts-memory.md with what was posted/drafted.
7. ALWAYS browser_close() when finished.

SUCCESS: Real tweet posted or draft saved for manual posting.`,
  "delivery": {
    "channel": "web"
  }
}
```

## Key Patterns

### Fallback Chains
- Primary: API/connector tools (fastest)
- Secondary: Browser automation (most reliable)
- Tertiary: File logging/draft mode (always works)

### Error Resilience 
- Each phase has explicit failure handling
- No silent failures or hanging operations
- Clear success criteria at each level

### Resource Cleanup
- `browser_close()` prevents CDP port conflicts
- Memory file updates preserve state across runs
- Draft files capture work when automation fails

### Confirm Gate Handling
- Always include `confirm: true`
- If API still blocks, recreate via UI
- Different models (Sonnet vs others) may behave differently

## Common Issues

### Subagent Assignment Problem
```javascript
// WRONG - Creates isolated subagent 
{
  "action": "create",
  "subagent_id": "some_agent"  // Don't do this
}

// RIGHT - Assigns to main Prometheus
{
  "action": "create"  // No subagent_id field = main assignment
}
```

### Missing Fallbacks
```javascript
// BAD - Single point of failure
"Try x_search to post to X"

// GOOD - Graceful degradation  
"Try x_search → browser automation → draft file fallback"
```

### Resource Leaks
```javascript
// BAD - Leaves browser sessions open
"Post to X and finish"

// GOOD - Cleanup
"Post to X, then browser_close() to prevent CDP conflicts"
```