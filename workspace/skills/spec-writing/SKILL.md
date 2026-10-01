---
name: spec-writing
description: Synthesize an already-discussed feature into a written spec file (problem, solution, user stories, implementation and testing decisions, test seams, out of scope) saved in the workspace or repo, optionally published as a GitHub issue. Use after requirements-grilling or a design discussion; not for interviewing the user from scratch or for writing the task-by-task implementation plan.
---

# Spec Writing

A spec records WHAT is being built and WHY, from the user's point of view, plus the decisions already made. It is the authority later plans and reviews argue from. This skill synthesizes; it does not interview. If major decisions are still open, stop and run `requirements-grilling` first.

## 1. Gather what is already known

- Pull decisions from the current conversation and any `plans/<slug>-decisions.md`.
- Explore the code you have not read yet with one multi-pattern `workspace_read(action:"grep")` plus a batched read (`fast-coding-loop`). Use the project's glossary terms and respect ADRs.
- List any gaps. If a gap would change the design, ask it through `ask_prometheus_questions` (1 to 3 questions, recommended answer first). Do not invent requirements.

## 2. Pick the test seams

A seam is the public boundary where behavior is observed without reaching inside. Prefer existing seams, and the highest one that can see the behavior; fewer seams is better, one is ideal. Confirm the seam list with the user in a single card (`Recommended: test at <seam>` first) before writing the testing section.

## 3. Write the spec file

Save to the repo's spec convention if one exists (`docs/specs/`, `specs/`), otherwise `plans/<YYYY-MM-DD>-<slug>-spec.md` in the workspace. Use this outline:

- **Problem**: what the user faces, in their words.
- **Solution**: what changes for the user.
- **User stories**: a long numbered list, `As a <actor>, I want <capability>, so that <benefit>`. Cover the main path, edge cases, errors, permissions, and empty states.
- **Implementation decisions**: modules built or changed, interface changes, schema or contract changes, architectural choices, and clarifications the user made. No file paths or code unless a prototype produced a snippet that states a decision more precisely than prose (state machine, schema, type shape); trim it to the decision and say it came from a prototype.
- **Testing decisions**: the confirmed seams, what a good test looks like here (observable behavior, not internals), which modules get tests, and prior-art tests in the codebase to copy.
- **Out of scope**: what this spec explicitly does not cover.
- **Open questions / further notes**.

## 4. Self-review before showing it

Check, and fix inline:

- No placeholders ("TBD", "handle errors appropriately").
- No contradictions between stories and decisions.
- Every decision from the grilling session appears.
- Scope: if it spans several independent subsystems, propose splitting into one spec per subsystem.

## 5. Review gate and publishing

1. Report the absolute path and a 5-line summary. Send a card: `Recommended: approve spec as written` / `Request changes`.
2. Only on request, publish to GitHub with `connector_github_create_issue` (title, body = spec, labels such as `ready-for-agent`). Prometheus source work goes to `XposeMarket/PromSRC` per `promsrc-pr-worktree`. The gh CLI is not installed; always use connector tools.
3. Record a `write_note` with the spec path.
4. Hand off: `implementation-plan-writing` for a multi-step build, or `issue-triage-and-tickets` to split it into tickets.

## Guardrails

- Do not interview from zero; synthesize. Questions are only for decision-changing gaps.
- The spec describes behavior and decisions, not a code transcript.
- Never publish to a tracker without explicit user approval.

## Exit criteria

- Spec file exists, path reported, self-review passed.
- Test seams confirmed by the user.
- User approved the spec, or requested changes were applied.

Lineage: Inspired by mattpocock/skills to-spec and obra/superpowers brainstorming spec stage (MIT), rewritten for Prometheus.
