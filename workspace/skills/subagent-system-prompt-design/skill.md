---
name: Subagent System Prompt Design
description: How to write high-quality system prompts and HEARTBEAT.md files for Prometheus subagents. Use when creating a new subagent, rewriting a failing agent's prompt, diagnosing an agent that produces inconsistent output, or designing a team pipeline. Pairs with the Prometheus Team Design skill. Triggers on: write system prompt, agent prompt, subagent instructions, heartbeat instructions, agent keeps failing, agent not doing the right thing, rewrite agent prompt, new subagent, agent design.
emoji: "✍️"
version: 1.0.0
triggers: write system prompt, agent prompt, subagent instructions, heartbeat instructions, agent keeps failing, agent not doing right thing, rewrite agent prompt, new subagent, agent design, spawn subagent, create agent
---

# Subagent System Prompt Design Guide

The system prompt is the single most important factor in whether a subagent works reliably. A vague prompt produces inconsistent agents. A tight prompt produces agents that do the same thing every time.

---

## The Six Required Sections

Every subagent system prompt must have all six of these. Missing sections are the most common cause of agent failure.

```
## Role
One sentence. What are you, and what is your one job?

## Input
Where do you find your input? Exact file path or describe what will be passed to you.
What format is it in? What do you do if it's missing or empty?

## Task
Step-by-step instructions. Be explicit. No "figure it out" language.
Use numbered steps. Each step is one action.

## Output
What do you produce? Where exactly do you write it?
What's the exact filename? What format?

## Rules
What you must NOT do. Hard constraints. Edge cases.
What to do when something unexpected happens.

## Done Signal
How do you signal completion? (Write output file? Set a flag? Call write_note?)
What does "done" look like if something went wrong?
```

---

## Role Section — Get This Right

**Good:**
> You are a news scraper. Your job is to fetch the 5 most recent AI headlines from Hacker News and write them to `workspace/teams/intel/working/headlines.json`.

**Bad:**
> You are a helpful research agent that assists with gathering information.

The good version tells the agent: what it is, what it does, what it produces, where it puts it. The bad version tells it almost nothing.

**Rule:** If you can't describe the role in one sentence with a specific output artifact, the job is too vague.

---

## Input Section — Be Exact

Always specify the exact file path the agent should read from. Relative paths from the team workspace are fine but be consistent.

**Good:**
```
## Input
Read: `workspace/teams/intel/working/headlines.json`
Format: JSON array of objects with fields: title, url, source, timestamp
If the file is missing or empty: write_note("No input found — skipping run") and stop.
```

**Bad:**
```
## Input
You'll receive headlines from the previous agent.
```

The bad version assumes the agent will receive something it won't. Agents don't pass data directly — they read and write files.

---

## Task Section — Number Every Step

Each step should be one tool call or one logical unit of work. If a step has "and" in it, split it.

**Good:**
```
## Task
1. Read `workspace/teams/intel/working/headlines.json`
2. For each headline, call web_fetch on the URL to get the full article text
3. Extract: title, 2-sentence summary, relevance to Prometheus (1-5 score), why it matters
4. Write results to `workspace/teams/intel/working/enriched_headlines.json` as a JSON array
5. Call write_note("Enriched N headlines") where N is the count processed
```

**Bad:**
```
## Task
Research the headlines and enrich them with context and relevance scores.
```

The good version is executable. The bad version requires interpretation.

---

## Rules Section — Specify Failure Behavior

This is the most commonly skipped section. It's also the one that prevents infinite loops and silent failures.

Always include:
- What the agent must NOT do
- What to do when a tool call fails
- Rate limit / retry behavior
- What to do if input is malformed

**Example:**
```
## Rules
- Do NOT call browser_open — use web_fetch for reading pages
- Do NOT process more than 10 headlines per run (rate limit protection)
- If web_fetch fails for a URL: skip it, log the URL in errors[], continue
- If the input JSON is malformed: write_note("Bad input format") and stop
- Do NOT modify any file outside workspace/teams/intel/
```

---

## Done Signal Section

The manager and orchestrator use the done signal to know when to proceed to the next phase.

**File-based done signal (preferred):**
```
## Done Signal
Write output to `workspace/teams/intel/working/enriched_headlines.json`.
The manager checks for this file's existence to know this phase is complete.
If no headlines were processable, write an empty array `[]` — do not skip the write.
```

**Note-based done signal:**
```
## Done Signal
Call write_note("enrichment_done: N headlines processed") when complete.
Call write_note("enrichment_failed: <reason>") if the run could not complete.
```

**Why empty-write matters:** If the agent writes nothing on failure, the manager has no way to know whether the agent ran at all vs. whether it ran and found nothing.

---

## HEARTBEAT.md — For Scheduled Agents

Heartbeat files are simpler than system prompts. They're for recurring scheduled behavior, not pipelines.

**Template:**
```markdown
# HEARTBEAT.md — [Agent Name]

## What to do on each tick

1. [First action]
2. [Second action]
3. [Write result or summary]

## Rules
- If nothing to do, reply: HEARTBEAT_OK
- Do not run longer than 5 minutes
- Write all output to files — never just respond with text

## Output Location
[Where outputs go]
```

**Key rule:** If the agent has nothing meaningful to do, it MUST respond with exactly `HEARTBEAT_OK` (case-insensitive). This suppresses unnecessary broadcasts and keeps logs clean.

---

## Sizing a System Prompt

| Prompt length | Signal |
|---|---|
| Under 200 words | Too vague — agent will improvise. Add more specifics. |
| 200–400 words | Ideal range. Specific enough, focused enough. |
| 400–600 words | Acceptable if the task is genuinely complex. |
| Over 600 words | The job is too big. Split into two agents. |

---

## Testing a Prompt Before Deploying

Before creating the agent, read your prompt and ask:

1. **Could a smart intern follow this exactly without asking questions?** If no → add specifics.
2. **Does the agent know what to do if the input is missing?** If no → add failure behavior.
3. **Does the agent know when it's done?** If no → add done signal.
4. **Does the agent know what NOT to do?** If no → add rules.
5. **Is there an "and" in the Task section?** If yes → split that step.

---

## Connecting to the Prometheus Team Design Skill

This skill covers how to write individual agent prompts. The **Prometheus Team Design** skill covers how to structure the team, design the pipeline, and decide which agents need to exist. Use both together when building a new team.

Workflow:
1. Team Design skill → design the pipeline and roles
2. This skill → write each agent's system prompt
3. `spawn_subagent(create_if_missing: {..., system_instructions: "..."})` → register the agent
4. Test one agent at a time before connecting the pipeline
