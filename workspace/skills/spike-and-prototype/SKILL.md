---
name: spike-and-prototype
description: Build clearly-labelled throwaway experiments that answer a feasibility, approach-comparison, logic, or UI-shape question before committing to a real build, ending each with a written verdict. Use for "is this even possible", "try X vs Y", "quick prototype", "let me see how this feels". Not for production work, questions answerable from docs or code, or already-validated ideas.
---

# Spike and Prototype

A spike is throwaway code whose output is an ANSWER. The code exists only to make the answer trustworthy. Keeping spike code is a separate request that needs its own classification and approval.

## When not to use

- The answer is knowable by reading docs or code: research it instead (`web-researcher` skill with `web_search` + `web_fetch`, or `workspace_read` for code).
- The work is the production path: use `implementation-plan-writing` or `feature-development`.
- The idea is already validated: implement it.

## 1. Pick the question type

- **Feasibility** ("can X do Y within Z?"): standard spike.
- **Comparison** ("A or B?"): same question, several approaches, shared number with suffixes (`002a`, `002b`).
- **Logic / state model** ("does this state machine feel right?"): a single self-contained HTML file with free-play buttons and guided walkthroughs that push the model through hard cases, showing full state after every action. It can be delivered as an inline `html` visual or a workspace file the user opens.
- **UI shape** ("what should this look like?"): several radically different variants on one throwaway route or page, switchable by a URL parameter or a floating bar, following the project's existing routing convention.

If the type is ambiguous, default from context (backend module means logic, page or component means UI) and state the assumption at the top of the prototype.

## 2. Decompose and align

Break the idea into 2 to 5 independent questions, each with an observable Given/When/Then and a risk level. Order by risk: the spike most likely to kill the idea runs first. Present the table, then one `ask_prometheus_questions` card: `Recommended: run all in this order` / `Drop or reorder some` / `Reframe`. Skip decomposition only if the user already named exactly one question.

## 3. Research just enough

Per spike: a 2 to 3 sentence brief (what, why, key risk). If there is a real choice of library or approach, make a short table (approach, pros, cons, maintenance status) from `web_search` / `web_fetch` or installed package source, then pick one and say why. Skip research for pure logic with no dependencies.

## 4. Build

- One folder per spike: `spikes/NNN-short-name/` with a `README.md` and the minimum code. In a repo, put it next to what it prototypes but name it so nobody mistakes it for production; otherwise use the workspace `spikes/` folder.
- Trivial to run: one command (`node main.js`, `python main.py`, a task-runner script) or a double-clickable HTML file. Run it with `workspace_run`.
- Prefer something the user can feel: a CLI with observable output, a minimal HTML page, a one-endpoint server, then a test with readable assertions, in that order.
- Hardcode everything. No build tooling, Docker, env files, or persistence unless persistence is the question; if it is, use a scratch DB or file named so it is obviously disposable.
- No polish, no error handling beyond what makes it run, no abstractions.
- Depth over speed: never declare success after one happy path. Try edge cases and chase surprises.
- Comparison spikes needing real engineering can run in parallel: spawn one worker per variant with `background_ops(action:"spawn", provider:"openai_codex", model:"gpt-6-sol")` (or `gpt-6-luna`), each returning its own verdict. Never spawn Anthropic workers from an Anthropic main chat. You write the head-to-head.

## 5. Verdict

Each README ends with:

```
## Verdict: VALIDATED | PARTIAL | INVALIDATED
What worked / What did not / Surprises / Recommendation for the real build
```

PARTIAL lists its constraints. INVALIDATED is a successful spike. Comparisons add a head-to-head table (quality, setup cost, performance, edge cases) and a named winner with the condition under which the loser would win.

## 6. Capture and clean up

- Fold validated decisions into the spec or plan (`spec-writing`, `implementation-plan-writing`), including any snippet that encodes a decision precisely (state machine, schema).
- In a git repo, commit the spike to a throwaway branch rather than main and leave a pointer to it in the spec, issue, or `write_note`. Main keeps only the validated decision.
- Frontier mode: when asked "what should I spike next", look across existing spikes for integration risks, unproven data handoffs, assumed capabilities, and alternatives to PARTIAL or INVALIDATED results; propose 2 to 4 candidates in a card.

## Guardrails

- Throwaway from the first line, and labelled as such in folder name and README.
- Never ship spike code to production by drift. If the user wants to keep it, treat that as a new bounded or architectural request.
- No secrets in spike code; use environment variables.

## Exit criteria

Every spike has a README verdict backed by runs you actually executed, the user saw the result, and the decision is captured outside the spike.

Lineage: Inspired by NousResearch hermes spike (MIT, adapted from gsd-build/get-shit-done) and mattpocock/skills prototype, rewritten for Prometheus.
