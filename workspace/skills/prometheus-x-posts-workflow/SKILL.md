---
name: Prometheus X Posts Workflow
description: Use this skill when Mara or a scheduled/delegated @raulinvests X/Twitter posting workflow needs to publish or prepare one original post using browser automation, schedule-owner memory, broad topic rotation, duplicate checks, no-em-dash copy, keyboard/composer fallback, browser_close cleanup, and post-run logging. Use it for prompts like autonomous X posting, scheduled X post, Mara post run, tweet from @raulinvests, broaden the X content topics, stop repeating agent memory, or update the X post schedule.
version: 1.2.0
triggers: autonomous X posting, scheduled X post, Mara post run, tweet from @raulinvests, broaden X topics, stop repeating agent memory, X content rotation, update X post schedule, original tweet workflow, raulinvests posting, scheduled tweet, AI Twitter posting
---

# Prometheus X Posts Workflow

Autonomous scheduled X posting for @raulinvests. The job should publish one fresh, human post that fits Raul's real interests without getting trapped in the same "agent memory is important" lane.

## Core Rules

- Read the primary schedule-owner memory first with `read_file`: `.prometheus/subagents/x_account_operator_raulinvests_v1/memory/schedule-memory.md`.
- Read `prometheus-x-posts-memory.md` as the shared/legacy X memory when available.
- Never use `memory_read` for either schedule memory file.
- Generate one distinct, high-quality post that does not repeat prior posted angles, formats, metaphors, or conclusions.
- Do not default to agent memory, receipts, state reuse, or "next run" themes. Those are only valid when the chosen topic is specifically about memory/state/context.
- Do not use em dashes (—) in any tweet. Use periods, commas, colons, semicolons, or hyphens instead.
- Post via browser automation only, then verify the post visibly or through fresh browser state.
- After browser work, always call `browser_close()`.
- Log success/blockers to both memory files when writable, then call `write_note` with the exact posted text or blocker.

## Topic Rotation

Pick the strongest current angle from the memory, recent product work, X feed context, or Raul's durable interests. Rotate across these lanes instead of camping on one:

1. **Prometheus product and builder lessons**: local desktop agents, browser/desktop automation, scheduled jobs, teams, Creative/HyperFrames, voice, connectors, verification, user trust.
2. **AI tooling and model ecosystem**: Claude, Codex, OpenAI, xAI/Grok, Hermes/OpenClaw/Fable-style agent launches, evals, reliability, tool use, product UX.
3. **Software/operator craft**: debugging, shipping, clean scope, logs, rollback, product taste, UI honesty, developer workflow, automation that actually finishes.
4. **Startup and distribution reality**: customer validation, pricing, positioning, local business automation, agency/client work, practical GTM lessons.
5. **Trading and decision discipline**: risk, patience, emotional control, overtrading, process, waiting for confirmation. Avoid financial advice or trade calls.
6. **Creator/founder observations**: building in public, taste, leverage, speed vs judgment, social media growth, useful contrarian takes.

## Repetition Guard

Before drafting, scan the last 10-20 entries in both memory files and identify the overused themes. If recent posts mention agent memory, receipts, state, local-first recovery, blast radius, scoped files, or "done means verified," choose a different lane unless the feed has a genuinely fresh source that demands that angle.

Use a lightweight rotation note in the log:

```md
- Content lane: [Prometheus product | AI ecosystem | software craft | startup/distribution | trading discipline | creator/founder]
- Repetition check: [what recent angle was avoided]
```

## Drafting Standard

A good @raulinvests original post should sound like Raul noticing something from real building, trading, or operating. Prefer:

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
- engagement bait that Raul would not actually say

## Step-by-Step Workflow

1. Read `.prometheus/subagents/x_account_operator_raulinvests_v1/memory/schedule-memory.md`.
2. Read `prometheus-x-posts-memory.md` if available.
3. Identify the last several content lanes and overused angles.
4. Choose a fresh lane from Topic Rotation.
5. Draft one post under 280 characters, or a readable multi-line post if the idea benefits from spacing. Scan for em dashes.
6. Open `https://x.com/home` and verify @raulinvests is logged in.
7. Post with the most reliable X browser path from `x-browser-automation-playbook`.
8. Verify the post was submitted.
9. Update both memory files with timestamp, type, content, lane, target, status, and repetition check.
10. Close the browser.
11. Write a note summarizing the exact post or blocker.

## Expected Output

- One fresh original post on @raulinvests.
- Memory entries with content lane and repetition check.
- No em dashes.
- No repeated agent-memory angle unless directly justified by a fresh source.
