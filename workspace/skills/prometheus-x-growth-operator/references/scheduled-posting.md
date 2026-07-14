# Migrated prometheus-x-posts-workflow guidance

This reference preserves detailed guidance from the former `prometheus-x-posts-workflow` entrypoint. Read it only for the matching operation.

# Prometheus X Posts Workflow

Autonomous scheduled X posting for @raulinvests. The job should publish one fresh, human post that fits the user's real interests without getting trapped in the same "agent memory is important" lane.

## Relationship to Engagement Strategy

Original posts continue, but the growth push is now driven mainly by Mara's engagement job:

- 25+ high-quality replies/day.
- 6-10 quote reposts/day when strong candidates exist.
- 8-15 regular reposts/day when high-signal alignment exists.

Original posts should complement that strategy. They should give the account a clear point of view and fresh owned ideas, not duplicate the same angles Mara is already using in replies and quote reposts.

## Core Rules

- Read the primary schedule-owner memory first with `read_file`: `.prometheus/subagents/x_account_operator_raulinvests_v1/memory/schedule-memory.md`.
- Read `prometheus-x-posts-memory.md` as the shared/legacy X memory when available.
- Read `skill_read("prometheus-x-research-replies")` when the schedule asks for it so original posts stay aligned with the current reply/quote/repost targets.
- Never use `memory_read` for either schedule memory file.
- Generate one distinct, high-quality post that does not repeat prior posted angles, formats, metaphors, or conclusions.
- Do not default to agent memory, receipts, state reuse, or "next run" themes. Those are only valid when the chosen topic is specifically about memory/state/context.
- Do not use em dashes (—) in any tweet. Use periods, commas, colons, semicolons, or hyphens instead.
- Post via browser automation only, then verify the post visibly or through fresh browser state.
- After browser work, always call `browser_close()`.
- Log success/blockers to both memory files when writable, then call `write_note` with the exact posted text or blocker.

## Topic Rotation

Pick the strongest current angle from the memory, recent product work, X feed context, or the user's durable interests. Rotate across these lanes instead of camping on one:

1. **Prometheus product and builder lessons**: local desktop agents, browser/desktop automation, scheduled jobs, teams, Creative/HyperFrames, voice, connectors, verification, user trust.
2. **AI tooling and model ecosystem**: Claude, Codex, OpenAI, xAI/Grok, Hermes/OpenClaw/Fable-style agent launches, evals, reliability, tool use, product UX.
3. **Software/operator craft**: debugging, shipping, clean scope, logs, rollback, product taste, UI honesty, developer workflow, automation that actually finishes.
4. **Startup and distribution reality**: customer validation, pricing, positioning, local business automation, agency/client work, practical GTM lessons.
5. **Trading and decision discipline**: risk, patience, emotional control, overtrading, process, waiting for confirmation. Avoid financial advice or trade calls.
6. **Creator/founder observations**: building in public, taste, leverage, speed vs judgment, social media growth, useful contrarian takes.

## Repetition Guard

Before drafting, scan the last 10-20 entries in both memory files and identify the overused themes. If recent posts mention agent memory, receipts, state, local-first recovery, blast radius, scoped files, or "done means verified," choose a different lane unless the feed has a genuinely fresh source that demands that angle.

Also check recent reply/quote/repost logs from the engagement workflow. Do not turn a recent reply into an original post unless it has been substantially expanded or reframed.

Use a lightweight rotation note in the log:

```md
- Content lane: [Prometheus product | AI ecosystem | software craft | startup/distribution | trading discipline | creator/founder]
- Repetition check: [what recent angle was avoided]
```

## Drafting Standard

A good @raulinvests original post should sound like the user noticing something from real building, trading, or operating. Prefer:

- specific observations over slogans
- practical tension over generic AI hype
- short paragraphs with natural rhythm
- one clear idea per post
- grounded opinions that a builder/operator would actually have

Avoid:

- "agent memory is the product" as a default conclusion
- repeated "receipts / next run / state / cleanup" phrasing
- corporate SaaS voice
- motivational fluff
- vague AI futurism
- engagement bait that the user would not actually say

## Step-by-Step Workflow

1. Read `.prometheus/subagents/x_account_operator_raulinvests_v1/memory/schedule-memory.md`.
2. Read `prometheus-x-posts-memory.md` if available.
3. If instructed by the schedule, read `prometheus-x-research-replies` for the current daily engagement targets.
4. Identify the last several content lanes and overused angles across originals, replies, quote reposts, and reposts.
5. Choose a fresh lane from Topic Rotation.
6. Draft one post under 280 characters, or a readable multi-line post if the idea benefits from spacing. Scan for em dashes.
7. Open `https://x.com/home` and verify @raulinvests is logged in.
8. Post with the most reliable X browser path from `x-browser-automation-playbook`.
9. Verify the post was submitted.
10. Update both memory files with timestamp, type, content, lane, target, status, and repetition check.
11. Close the browser.
12. Write a note summarizing the exact post or blocker.

## Expected Output

- One fresh original post on @raulinvests.
- Memory entries with content lane and repetition check.
- No em dashes.
- No repeated agent-memory angle unless directly justified by a fresh source.
- Original post complements, rather than crowds out, the daily reply/quote/repost engagement strategy.
