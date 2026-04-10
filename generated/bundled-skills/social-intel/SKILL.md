---
name: Social Media Intelligence
description: Analyze social media accounts, pull performance data, and deliver growth coaching reports. Use for any request involving social media analytics, post performance, follower counts, engagement rates, competitor analysis, or content strategy. Triggers on: social, instagram, tiktok, twitter, x, linkedin, followers, engagement, posts, analytics, social coach, social analysis, grow account, content performance, hashtag, reach, impressions.
emoji: 📊
version: 1.0.0
triggers: social, instagram, tiktok, twitter, x account, linkedin, followers, engagement, posts, analytics, social coach, social analysis, grow my account, content performance, hashtag, reach, impressions, social media, competitor analysis
---

# Social Media Intelligence

Full playbook for running social analysis and delivering actionable growth coaching.

---

## Tool

`social_intel(platform, handle, mode?, competitor?)`

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

Without an API token, Prom uses public scraping (follower count, bio, post grid only).
With an API token, Prom gets: every post's likes/comments/saves/reach/impressions/watch time.

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
