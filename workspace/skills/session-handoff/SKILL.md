---
name: "session-handoff"
description: "Write a HANDOFF briefing that lets a fresh Prometheus session, background agent, or peer thread continue current work without the degraded context: goal, current state, files in play, failed attempts and why, best theory, ordered next steps, constraints, memory pointers, and suggested skills. Use when the user says handoff, start fresh, I'll pick this up later, or the session is looping on the same failed fix. Do not use for reusable project briefing packs (context-pack-builder) or ordinary end-of-task summaries."
---

# Session Handoff

The handoff is a briefing for an agent that has never seen this chat. Prometheus memory and intraday notes already give a fresh session the broad timeline; the handoff adds what that timeline cannot: the real goal, what was tried and why it failed, the current theory, and the exact first move.

## 1. Gather before writing

- Reread the whole arc of the session, not just the last few turns.
- Run `memory(action:"search", query:"<task key terms>")` and note the two to four records that matter most (a decision, a root cause, a failed approach) with their ids or paths.
- List artifacts that already hold detail (plans, specs, proposals, notes, commits, PRs). The handoff links to them; it does not copy them.
- If the next session's purpose was given ("next we deploy it"), tailor every section to that.

## 2. Write the document

Default path: `handoffs/<yyyy-mm-dd>-<slug>.md` in the workspace (scratch, not committed). Use this structure:

```markdown
# Handoff: <short title>
> Generated: <timestamp> | Session: <session id if known> | Next focus: <one line>

## Goal
<the end state the user wants, one paragraph>

## Current state
Working: <confirmed working items>
Broken: <exact symptom, verbatim error text>

## Files and artifacts in play
| Path | Why it matters |

## What was tried and why it failed
### Attempt 1: <name>
- What: <action>
- Why it failed: <root cause, not "didn't work">

## Current best theory
<what you believe the right path is, and the evidence>

## Next steps
1. <specific action with path, tool, or command>

## Constraints
<user preferences from this session, things ruled out, approvals still needed, environment facts>

## Memory pointers
- <record id or path>: <why it matters>
- Re-run: memory(action:"search", query:"<query>")

## Suggested skills
- <skill id>: <when to read it>
```

Writing rules: address the incoming agent, not the user. Be ruthlessly specific; "fix the auth" is useless, "in src/x.ts line 47 the expiry check uses the wrong clock" is useful. Paste exact error text. Every sentence must carry information the next agent needs.

## 3. Redact

Remove API keys, tokens, passwords, cookies, and personal data the next agent does not need. Reference secrets by their store name, never the value.

## 4. Persist and route

- `write_note(status:"open", content:"Handoff written: <path>; next step: <step 1>")` so the work stays visible across days.
- If the work continues in a background agent, pass the handoff path inside a fully self-contained `background_ops(action:"spawn")` prompt (default `openai_codex/gpt-6-sol`). If it continues in a peer session, use `thread-and-session-operations`.
- Tell the user, briefly: where the file is, and that a new session can start with "Read <path> and continue."

## Exit criteria

A cold reader can start step 1 without asking anything; every failed attempt has a cause; secrets are absent; an open note points at the file.

Lineage: inspired by mattpocock/skills handoff and thedotmack/claude-mem handoff, rewritten for Prometheus.
