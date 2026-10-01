---
name: "social-intel"
description: "Analyze a named social account's public or connected analytics and suggest evidence-backed growth actions. Use for profile and content-performance analysis; use x-growth-engine for @Raulinvests team drafting and prometheus-x-growth-operator for the separate Prometheus-owned account workflow."
---

# Social Media Intelligence

If an analysis includes draft X posts or replies, remove all em dashes from generated X copy.

Ground account analysis in observed public or connected metrics, not generic posting advice.

---

## Tool

Load `social_intelligence` with `request_tool_category`, then call `social_intel` if available. Confirm the current schema before passing options; unsupported platforms or private metrics require an authenticated integration. `social_intel(platform, handle, mode?, competitor?)`

- **platform**: `instagram` | `tiktok` | `x` | `twitter` | `linkedin` | `facebook`
- **handle**: with or without `@`
- **mode**: `full` (default — tries API first, falls back to scraping) | `quick` (scrape only)
- **competitor**: `true` to analyze a competitor without saving to entity files

---

## Workflow

### Own Account Analysis
```
1. social_intel({ platform: "instagram", handle: "@yourbrand" })
2. Report is returned to chat + saved to entities/social/instagram.md
3. Suggest 3 specific next actions based on the data
```

### Competitor Analysis
```
1. social_intel({ platform: "instagram", handle: "@competitor", competitor: true })
2. Compare against own account data from entities/social/instagram.md
3. Identify gaps and opportunities
```

### Full Social Audit (multiple platforms)
```
Run social_intel for each platform the user is on.
Synthesize into a cross-platform report covering:
- Which platform has best engagement rate
- Which content type performs best per platform
- Posting frequency comparison
- Growth trajectory per platform
```

---

## Connecting Official APIs (for full analytics)

Without a connected API, only publicly visible information may be available; report actual tool coverage and missing metrics rather than assume scraping succeeds.
With an authorized connected API, private per-post metrics may become available subject to granted scopes and platform permissions. Never promise reach, impressions, saves, or watch time without observing them.

### Instagram
1. Go to developers.facebook.com → Create App → Instagram Graph API
2. Get a long-lived access token
3. In Prometheus: `vault set social_instagram_token <token>`

### X (Twitter)
1. developer.twitter.com → Create project → Get Bearer Token
2. `vault set social_x_token <bearer_token>`

### TikTok
1. developers.tiktok.com → Create app → Get access token
2. `vault set social_tiktok_token <token>`

### LinkedIn
1. linkedin.com/developers → Create app → Marketing Developer Platform
2. `vault set social_linkedin_token <token>`

---

## Analysis Framework

When delivering a social coaching report, always cover:

**1. Audience Health**
- Follower count + growth rate (if historical data available)
- Following ratio (high following/follower ratio = vanity follows)
- Engagement rate = (likes + comments) / followers × 100

**2. Content Performance**
- Top 3 posts and what made them work (timing, format, caption, topic)
- Bottom 3 posts — what to avoid
- Average engagement rate vs platform benchmarks:
  - Instagram: 1-3% = average, 3-6% = good, 6%+ = excellent
  - TikTok: 4-9% = average, 9%+ = good
  - X: 0.5-1% = average, 1%+ = good

**3. Content Patterns**
- Best performing content type (Reels vs Posts vs Stories / video vs image)
- Caption length correlation with performance
- Hashtag usage effectiveness
- Best posting times (if timestamp data available)

**4. Growth Trajectory**
- Is engagement rate stable, growing, or declining?
- Follower growth signals

**5. Actionable Recommendations (always 5 specific actions)**
- Numbered, prioritized by impact
- Each one must be specific and executable: not "post more" but "post 3x/week at 7pm EST based on your top 5 posts all being published in that window"

---

## Entity File Format

Results are saved to `workspace/entities/social/[platform].md`.
Read this file before responding to follow-up questions about the same platform.
Update the "Last Updated" and "Followers" fields after each analysis run.

---

## Output Format

Always structure the report as:
1. **Profile snapshot** (followers, following, posts, bio)
2. **Performance summary** (avg engagement, top posts, content breakdown)
3. **What's working** (2-3 specific observations)
4. **What's not working** (2-3 specific observations)
5. **5 priority actions** (numbered, specific, executable)
6. **Data source** (API / scraped / partial)

Keep it direct. No padding. Numbers over adjectives.
