---
name: "session-retro"
description: "Run a retrospective on a finished Prometheus session, task, or schedule run and propose concrete environment fixes: skill corrections, missing automated checks, memory or runbook entries, tool-economy changes, and information-access gaps. Use when the user asks for a retro, post-mortem, lessons learned, or what should change so the next run goes better. Do not use for weekly tool-log audits (tool-failure-audit), live runtime repair (self-repair-protocol), or reviewing a code diff."
---

# Session Retro

A retro improves the agent's environment, not the transcript. The output is a ranked list of small, specific changes that make the next run faster or safer: a sharper skill, a check that catches the mistake automatically, a memory entry that removes a lookup, a cheaper tool path.

## 1. Pick the session and read the primary sources

- Default to the current chat. If the user names another session, task, or schedule run, find it: `memory(action:"search", query, mode:"timeline")` for chronology, the session transcript under `audit/chats/transcripts/`, `task_control` or `agent_run_ops(action:"get")` for task and agent runs, `schedule_job_history` and `schedule_job_outputs` for scheduled runs, and today's intraday notes.
- Read the actual tool calls and results, not only the final summary. Note every place the run stalled, retried, guessed, asked, or was corrected by the user.

Done when you can list the session's timeline as: goal, key steps, each failure or correction with its evidence, and the end state.

## 2. Look for candidates in each lens

Check every lens; skip one only with a stated reason.

- **Navigation:** how long did it take to find the right file, tool, or skill? Would a pointer (a line in a skill, a MEMORY.md runbook entry, a `references/` link) have saved the search?
- **Skills:** did a skill fire that should not have, fail to fire, or give a wrong step? Was a needed procedure missing entirely? Quote the exact line that misled.
- **Automated checks:** could a deterministic check have caught the mistake (a lint rule, a test, a validate step, a schedule verify run)? Look for an existing check that is present but not wired before proposing a new one. A mechanical rule belongs in a check; prose is for judgment calls.
- **Tool economy:** were there expensive or repetitive calls (many single-file reads that one grep would replace, full-file reads, repeated failed retries, serial work that could fan out)?
- **Memory and context:** was a fact looked up that should have been remembered, or was stale memory trusted? Was a user preference stated that is not yet in USER.md?
- **Information access:** was a crucial signal unavailable (logs, a dashboard, read-only access to a service)?
- **No-ops:** are there instructions in SOUL.md, skills, or prompts that did not change behavior and only cost context?

## 3. Turn findings into proposals

For each candidate write: the observed evidence (quote or tool result), the proposed change, its exact home, and the expected effect. Homes:

| Change | Home | Route |
|---|---|---|
| Skill fix or new skill | `skills/<id>/` | `skill_candidate_submit`, or direct edit only if the user asks |
| Durable fact or preference | USER.md / MEMORY.md | `memory(action:"write"|"update")` after the user confirms |
| Runbook or operational correction | MEMORY.md | `memory(action:"write")` with category |
| Unfinished bug or follow-up | intraday notes | `write_note(status:"open")` |
| Prometheus source defect | src proposal | name it; follow `src-edit-proposal-rigor` |
| Automated check | repo or schedule | describe the exact check and where it runs |

Rank by severity: things that produced wrong results first, then wasted time, then polish. Cap at the top 7; list the rest in one line.

## 4. Present and apply

Show the ranked list. Let the user choose what to apply with `ask_prometheus_questions` (multi_select, one option per proposal). Apply only the chosen items, through the routes above. Inferred lessons the user did not approve still go to `skill_candidate_submit`, never straight into skill files. Close with a `write_note` that records the retro, what was applied, and which items stay open.

## Guardrails

- User messages are the only evidence of a user preference. Assistant self-praise is not.
- One retro, one session. Do not generalize from a single run into a sweeping rule; say "observed once" when that is the truth.
- Prefer deleting or sharpening an instruction over adding a new one.

## Exit criteria

Every lens was checked; every proposal cites evidence and names a home; the user chose what to apply; applied changes were verified (reread the skill, memory record, or note); a closing note exists.

Lineage: inspired by mattpocock/skills retro, rewritten for Prometheus.
