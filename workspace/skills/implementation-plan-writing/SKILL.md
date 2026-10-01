---
name: implementation-plan-writing
description: Turn an approved spec or requirements into a saved, task-by-task implementation plan with exact files, interfaces, failing tests, verification commands, and a verified-API discovery phase, written for an executor with no context. Use before touching code on a multi-step build; not for requirements gathering, spec writing, or one-file fixes.
---

# Implementation Plan Writing

Write the plan for an implementer (you after a context reset, or a spawned agent) who has never seen this codebase or conversation. They write idiomatic code once they know the exact interface and the exact test. What they cannot know is what you decided: which files, which names and signatures, which values the spec pins, which tests prove each task. Write those down. Nothing else.

## 0. Preconditions

- An approved spec or decisions file exists (`spec-writing` / `requirements-grilling`). If not, stop and route there.
- Scope check: if the spec covers several independent subsystems, propose one plan per subsystem. Each plan must yield working, testable software on its own.
- Use `declare_plan` for the phases of THIS skill (discovery, structure, tasks, self-review, handoff) and `complete_plan_step` as each finishes.

## 1. Phase 0: discovery of real APIs (always first)

Before planning, confirm what actually exists. Never plan against an API you assume.

- Locate with one multi-pattern `workspace_read(action:"grep")`; read big windows in one batch (`fast-coding-loop`).
- For external libraries, read real docs via `web_fetch` or the installed package source.
- For wide surveys, spawn fact-gathering workers with `background_ops(action:"spawn", provider:"openai_codex", model:"gpt-6-sol")` (route `openai_codex/gpt-6-luna` for cheap lookups). Never spawn Anthropic agents from an Anthropic main chat. Each worker must return: sources read, exact signatures and file:line locations, copyable example locations, and a confidence note with known gaps. Reject reports without sources. Keep synthesis and plan wording with yourself.
- Produce an **Allowed APIs** list (with sources) and an **Anti-patterns** list (methods that do not exist, deprecated parameters).

## 2. File structure

Map every file to be created or modified and its single responsibility. Files that change together live together. In existing code, follow established patterns; do not restructure on your own initiative.

## 3. Tasks

A task is the smallest unit with its own test cycle that a reviewer could reject independently. Fold setup, config, and docs into the task whose deliverable needs them. Steps are single actions with a checkable result.

Plan file header:

```
# <Feature> Implementation Plan
Goal: one sentence.  Architecture: 2-3 sentences.  Stack: key tech.
Spec: <path>.  Executor: follow implementation-plan-execution.
## Global constraints  (version floors, naming, platform rules copied verbatim from the spec)
## Allowed APIs / Anti-patterns  (from Phase 0, with sources)
## Review focus  (up to five inputs or failure modes the spec implies but no test covers yet, most likely first; add a test for each to the owning task)
```

Each task:

```
### Task N: <component>
Files: create/modify/test with exact paths (and line ranges for modifications)
Interfaces: Consumes <exact signatures from earlier tasks>; Produces <exact names and types later tasks use>
- [ ] Write failing test <name> asserting <spec values>
- [ ] Run <command>. Expected: FAIL with <message>
- [ ] Implement <signature> in <file> (one line on approach only if the signature and test leave a real choice)
- [ ] Run <command>. Expected: PASS
- [ ] Commit <paths> "<message>"
```

What a step must contain: a test step has the test name and assertions with the spec's exact values; a code step has the exact signature, file, and pinned values (bodies only for algorithms the test does not determine); a verification step has the command and the output that means pass. Refer to other tasks through their Interfaces block, never by repeating code. Frame tasks as "copy the pattern at <file:lines>" when an example exists.

## 4. Self-review (yourself, then fix inline)

1. Spec coverage: every requirement maps to a task.
2. Step scan: no line that decides nothing ("TBD", "handle edge cases", "add validation"), and no full bodies the test already determines.
3. Type consistency: names and signatures match across tasks.
4. Review focus filled, or explicitly checked and empty.
5. Proportion: a plan much longer than the spec has become a code transcript; cut bodies back to signatures and assertions.

## 5. Save and hand off

- Save to the repo's plan folder if it has one, else `plans/<YYYY-MM-DD>-<slug>-plan.md`. Report the absolute path. Never keep the plan only in chat.
- Send a card via `ask_prometheus_questions`: `Recommended: execute inline now (implementation-plan-execution)` / `Execute with parallel workers` / `Just save it`.
- Record a `write_note` with the plan path.

## Guardrails

- No production code during planning.
- No invented APIs or parameters; everything in a step is either in Allowed APIs or created by an earlier task.
- Prometheus source changes still go through `promsrc-pr-worktree` at execution time.

## Exit criteria

Plan file saved, self-review done, Phase 0 sources cited, user chose an execution path.

Lineage: Inspired by obra/superpowers writing-plans (MIT) and thedotmack make-plan, rewritten for Prometheus.
