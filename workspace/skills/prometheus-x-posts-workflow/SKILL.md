---
name: Prometheus X Posts Workflow
description: Reusable scheduled workflow for autonomous X/Twitter posting. Reads the exact schedule-memory.md file with read_file (never memory_read), generates fresh non-duplicative tweets, attempts posting on the prometheus profile, saves records with write_note if blocked, closes browser after use, and keeps tweets consistent across runs.
version: 1.0.0
---

# SKILL: prometheus-x-posts-workflow

## Purpose
Autonomous scheduled X posting for Prometheus. Ensures every tweet is fresh, references prior content for consistency, uses the correct file read tool, and records everything even on auth blockers.

## Core Rules (NEVER VIOLATE)
- ALWAYS read the schedule-memory.md file FIRST using `read_file` on the exact path: `.prometheus/subagents/schedule_prometheus-x-posts_yfkm6/memory/schedule-memory.md`
- NEVER use `memory_read` on this file (it only works on USER.md/SOUL.md/MEMORY.md).
- Generate ONE distinct, high-quality tweet that does not repeat anything already recorded in the file.
- Attempt to post using the prometheus profile.
- If posting fails or is blocked, still save the tweet text + reasoning to the file using `write_note`.
- After any browser work, ALWAYS call `browser_close`.
- Reference the actual file content so tweets stay non-duplicative and build on prior ones.

## Step-by-Step Workflow
1. Read the full schedule-memory.md file with `read_file` (exact path above).
2. Review all prior tweets and reasoning in the file.
3. Generate a fresh, high-quality tweet (distinct from everything already recorded).
4. Attempt posting on X with the prometheus profile (use browser tools as needed).
5. If blocked or fails: save tweet + reasoning to the file with `write_note` (tag: x-post, task_id: prometheus-x-posts).
6. Close the browser session with `browser_close`.
7. Confirm completion.

## Expected Output
- Tweet text saved in schedule-memory.md under a new dated section.
- Record of any blocker or success.
- Tweets remain consistent and non-repetitive over time.

## Notes
- This skill replaces any old "use memory_read" instructions in scheduled job prompts.
- Incorporates the [2026-06-08] SOUL rule on schedule-memory.md files.