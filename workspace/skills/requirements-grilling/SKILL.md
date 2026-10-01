---
name: requirements-grilling
description: Interview the user in rounds of question cards until a vague idea, plan, or design becomes a shared, fully decided understanding. Classify the request first (spike, bounded, architectural). Use before spec-writing or implementation; not for writing the spec itself, for product/market validation, or for already-approved work.
---

# Requirements Grilling

Goal: reach a shared understanding where every decision that matters has been made by the user, nothing is silently assumed, and the next step (spike, short design, or written spec) is obvious. You write no production code during this skill.

## 0. Ground yourself first

- Read the relevant code, docs, and recent commits before the first question. Use one multi-pattern `workspace_read(action:"grep")` and one batched read, per `fast-coding-loop`.
- If the repo has `GLOSSARY.md`, `CONTEXT.md`, or `docs/adr/`, read them. Use their vocabulary and do not re-litigate recorded decisions.
- Facts are your job, decisions are the user's. Never ask the user something you can look up with `workspace_read`, `web_search`, or `memory(action:"search")`.

## 1. Classify the request and say it out loud

State the classification in one sentence so the user can override it:

- **Spike**: a feasibility question ("can we", "is it possible", "quick and dirty is fine"). The output is an answer, not kept code. Confirm with one card, then hand off to `spike-and-prototype`.
- **Bounded**: a well-scoped change to a flow that already exists in this repo (a flag, a small endpoint, a one-file fix). Ask only the questions that matter, present a short design in chat (approach, files touched, how it will be tested), then STOP until the user approves.
- **Architectural**: a new project, a new subsystem, or a change to interfaces other code depends on. Run the full tree below, then hand off to `spec-writing`.

When torn between two classes, take the heavier one. If hidden complexity appears mid-session, upgrade the class and say so. Never downgrade mid-task. Familiarity with "this kind of app" does not make a task bounded; bounded means the flow you are changing already exists to read.

## 2. Build the decision tree

List every open decision and what it depends on (privately, or in `plans/<slug>-grilling.md` for long sessions). The **frontier** is every decision whose prerequisites are already settled.

Typical branches: purpose and success criteria, actors, scope and non-goals, data and state, interfaces and contracts, failure behavior, compatibility and migration, security and permissions, performance limits, testing seams, rollout.

## 3. Ask in rounds with question cards

All questions go through `ask_prometheus_questions`. Never post a prose list of questions in chat.

- Each card holds 1 to 3 questions from the current frontier. Use one question per card when the decision is weighty; group up to 3 only when they are independent of each other.
- For select questions, the FIRST option is your recommended answer, labelled like `Recommended: keep the existing REST shape`. Add 1 to 4 real alternatives and keep `allowOther` on.
- Put the tradeoff in the question label in one line: what the choice affects and what each side costs.
- A question whose answer depends on another still-open question belongs to a later round.
- While a fact lookup runs (for example a `background_ops(action:"spawn")` explorer with `provider:"openai_codex", model:"gpt-6-sol"`), ask the frontier questions that do not depend on it. Only downstream questions wait.
- After each card returns, update the tree, recompute the frontier, and send the next card. Keep exactly one card in flight.

When the user's language is fuzzy or overloaded ("account", "job", "sync"), offer a precise term as the recommended option. When the user states how the system works, check the code; if the code disagrees, surface the contradiction in the next card.

## 4. When the user cannot answer

If a decision depends on knowledge only someone else holds (a stakeholder, vendor, ops), stop grilling the user on the subject. Ask only about the send (who it goes to, what must come back), then write `plans/<slug>-questionnaire.md`: purpose, one orienting paragraph, single-idea questions ordered most important first, each followed by an empty `>` answer line, and a closing "Anything else?" question. Report the absolute path and park the dependent branch.

## 5. Close the session

The session ends when the frontier is empty:

1. Post a compact summary: each decision, the chosen answer, and a one-line reason. List parked branches.
2. Send a final card: `Recommended: yes, this is our shared understanding` / `No, revisit something`.
3. Do not act until the user confirms.
4. Save the summary to `plans/<slug>-decisions.md` (or the repo's docs folder if it has a convention) and record a `write_note`.
5. Hand off by class: spike to `spike-and-prototype`; bounded to implementation via `fast-coding-loop` and `test-first-development`; architectural to `spec-writing`, then `implementation-plan-writing`.

## Guardrails

- No code, no scaffolding, no "I'll start while you read". Approval is the gate, even for a two-sentence bounded design.
- One card in flight, 1 to 3 questions per card. Never flood.
- Never offer an option you would not be willing to implement.
- Each new task gets its own classification and approval; approving a spike does not approve the follow-up build.

## Exit criteria

- Classification announced and accepted.
- Every frontier question answered or explicitly parked.
- Decisions file written and its path reported.
- User confirmed the shared understanding through a card.

Lineage: Inspired by mattpocock/skills grilling and grill-me, obra/superpowers brainstorming (MIT), and NousResearch hermes decision-questionnaire (MIT), rewritten for Prometheus.
