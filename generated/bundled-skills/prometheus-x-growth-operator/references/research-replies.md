# Migrated prometheus-x-research-replies guidance

This reference preserves detailed guidance from the former `prometheus-x-research-replies` entrypoint. Read it only for the matching operation.

# Prometheus X Research & Replies Operator

Scheduled research and engagement workflow for @raulinvests. The goal is not to wedge every conversation into agent memory. The goal is to find relevant posts and respond naturally to what that post is actually about, in the user's builder/operator voice, while keeping enough volume to grow the account.

## Daily Targets

Mara's current growth target is:

- **25+ high-quality replies/day** as the floor.
- **6-10 quote reposts/day** when strong quote angles exist.
- **8-15 regular reposts/day** for high-signal alignment.
- Original posts continue through the separate original-post job.

These are quality-weighted targets, not permission to spam. Replies are the priority. Quote reposts and regular reposts should be used more often than before, but only when they make the user look sharp, plugged in, and high-taste.

## Per-Run Action Budget

For the every-2-hours engagement schedule, each run should aim for:

- **2-3 replies**. Bias toward 3 if same-day memory suggests the account is behind pace.
- **0-1 quote repost**. Use only when the user can add a real angle.
- **0-2 regular reposts**. Use only for strong alignment.

Expected daily output from 12 engagement runs:

- 24 replies/day minimum if every run gets 2, with 25-32/day when some runs get 3.
- 6-10 quote reposts/day if about half to most runs find a strong quote candidate.
- 8-15 regular reposts/day if the feed/search quality supports it.

Skip weak candidates. A skipped bad repost is better than a visible low-taste action.

## Core Rules

- Read `skill_read("browser-automation-playbook")`, `skill_read("x-browser-automation-playbook")`, and `skill_read("hook-library")` when the scheduled job asks for them.
- Read `.prometheus/subagents/x_account_operator_raulinvests_v1/memory/schedule-memory.md` with `read_file` as primary schedule memory.
- Read `prometheus-x-posts-memory.md` if available.
- Never use `memory_read` for schedule memory files.
- Use browser-first X research and posting unless the schedule contract changes.
- Do not use em dashes (—) in replies, quote text, original posts, or quote reposts.
- Always close the browser after the run.
- Log every successful reply, quote repost, regular repost, or original post with timestamp, content or reposted-post summary, target, source, status, content lane, and when practical same-day action counts.

## Relevancy First

Every reply must pass this test before posting:

> If the target author read this reply without knowing the user, would it feel like a direct response to their post?

If no, rewrite it. Do not post a generic agent-memory take under an unrelated topic.

Only talk about agent memory, state, receipts, context reuse, or next-run continuity when the target post is specifically about:

- agent memory or persistence
- long-running agents
- scheduled/background agents
- reliability across runs
- state, logs, audits, or recovery
- tool/session boundaries

For other posts, match the actual topic.

## Quote-Repost Rules

Quote reposts should add value, not just visibility.

Use a quote repost when the user can add one of:

- a sharper take
- a builder/operator lesson
- a product or reliability tradeoff
- a customer/distribution lens
- a useful disagreement
- a trading/process analogy when relevant
- a concise framing that makes the original post more useful

Avoid quote reposts like:

- "This is so true."
- generic agreement
- low-effort hype
- quote reposting bait just because it is viral
- repeating the same agent-memory thesis again

Good quote posture: direct, practical, slightly sharper than the original post, and still respectful.

## Regular Repost Rules

Regular reposts are for alignment and taste. Repost posts that reinforce the user's account identity around:

- AI agents and tools
- software building
- founder/operator life
- business leverage
- distribution and customer reality
- trading psychology and process
- product taste and execution

Avoid reposting:

- generic motivation
- low-quality engagement bait
- hostile dunking
- content that dilutes the user's positioning
- too many memes unless they clearly fit the account

## Topic and Search Universe

Mara should engage across the user's broader interests, not just agent memory:

1. **AI/product ecosystem**: Claude, Codex, OpenAI, xAI/Grok, model launches, AI coding tools, evals, agent frameworks, browser/desktop agents.
2. **Prometheus-adjacent operator craft**: local-first software, automation, verification, logs, scoped actions, UI honesty, workflows, teams, Creative/HyperFrames, voice, connectors.
3. **Building and startups**: shipping, customer validation, distribution, pricing, positioning, local business automation, agency/client lessons.
4. **Developer workflow**: debugging, repo-aware agents, build failures, tests, design taste, product polish, release discipline.
5. **Trading/process psychology**: risk management, patience, emotional discipline, avoiding overtrading, waiting for confirmation. No financial advice or trade calls.
6. **Creator/founder internet**: building in public, audience growth, leverage, taste, personal operating systems.

Use varied searches, rotating across lanes. Examples:

```text
Claude Codex AI coding -filter:replies
OpenAI agent browser automation -filter:replies
local-first software agents -filter:replies
startup customer validation AI -filter:replies
debugging AI coding tools -filter:replies
trading discipline risk management -filter:replies
founder distribution building in public -filter:replies
```

Avoid running the same query every time. If recent memory shows repeated `agent memory`, `browser agent`, `desktop agent`, `Hermes`, `Fable`, or `OpenClaw` searches, pick a different lane for at least one search.

## Selection Criteria

Prefer posts where the user can add something specific:

- a practical builder/operator observation
- a real tradeoff the original post missed
- a concise agreement with added nuance
- a grounded product/reliability angle
- a founder/customer/distribution angle
- a process/risk-management analogy when relevant

Skip posts when the only possible reply is generic praise, vague AI hype, or another forced memory/state take.

## Reply Shapes

Use one of these shapes based on the target post:

- **Add nuance**: "This is the part people miss: [specific tradeoff]."
- **Ground the hype**: "The demo is cool, but the product test is [specific reliability/customer/use-case test]."
- **Builder agreement**: "Yep. The boring version of this is [practical operator detail]."
- **Demand/customer lens**: "The tool can build it. The harder question is whether anyone wants that exact workflow."
- **Risk/process lens**: "This is where process matters more than prediction. [specific discipline point]."

Keep replies natural and tied to the target post. Do not paste a reusable thesis.

## Step-by-Step Workflow

1. Read the scheduled job's required skills.
2. Read both memory files and check same-day action pace when practical.
3. Open `https://x.com/home`; verify @raulinvests auth and usable feed.
4. Collect home-feed posts with `browser_scroll_collect`, normally 10-15 scrolls.
5. Select 2-3 posts where a relevant, specific reply is possible.
6. For each selected post, identify its content lane and draft a reply that directly responds to the post. Scan for em dashes.
7. Post replies via browser automation only, verifying each one.
8. Quote repost up to 1 strong candidate if the user can add a meaningful angle.
9. Regular repost up to 2 high-signal candidates if they reinforce positioning.
10. Search X using one or more varied queries from the Topic and Search Universe. Do not overuse agent-memory searches.
11. Use search results to fill remaining per-run budget only when quality is high.
12. Log every action to both memory files when writable, including content lane, why it was relevant, and same-day counts when practical.
13. Close the browser.
14. Write a note summarizing reply count, quote-repost count, regular repost count, target posts, searches used, and exact posted text for replies/quotes.

## Anti-Patterns

Do not:

- reply to every AI post with "memory matters"
- turn model-launch posts into state/receipt sermons unless the post is actually about persistence or reliability
- use the same `agent memory OR browser agent OR desktop agent` query every run
- quote-repost low-quality bait just to satisfy a quota
- regular repost generic motivation just to pad the count
- post generic "this is important" replies
- use em dashes
- leave the browser open
