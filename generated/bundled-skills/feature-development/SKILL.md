---
name: "feature-development"
description: "Guide a feature from discovery through clarification, architecture, implementation, review, and verification using Prometheus workspace and agent/team capabilities. Use for a new feature or substantial change; do not use for a one-line edit or a review-only request."
---

# Feature Development

Run a feature as a sequence of evidence-backed phases. The outcome is a working, verified change with a clear decision record—not merely a plausible implementation.

## Phase 0 — Scope and safety

Restate the requested behavior, affected surface, constraints, and definition of done. Inspect repository instructions, the current branch and dirty state, package scripts, and nearby implementation before editing. Separate pre-existing changes from the feature. If the request is ambiguous in a way that changes architecture, ask focused questions and wait; if the user says “whatever,” recommend a choice with tradeoffs and obtain confirmation before implementation.

Create a small checklist of discovery, decisions, implementation, review, and verification. Keep the checklist visible in the response as the phase changes.

## Phase 1 — Parallel discovery

When `agents_and_teams` is available, dispatch two or three independent explorers in parallel with different scopes:

- repository structure and likely entry points;
- data flow, state, APIs, and dependencies;
- tests, conventions, failure modes, and adjacent implementations.

Each explorer must return concrete file paths and line references, current behavior, relevant data flow, risks, and tests to run. If agents are unavailable, perform the same passes sequentially. Read the cited files yourself before accepting a conclusion; agent summaries are leads, not evidence.

## Phase 2 — Clarify the contract

Convert discovery into a one-sentence user story and a short acceptance contract. Resolve behavior, UX/API shape, compatibility, error handling, performance, security, and test questions before designing. Do not silently invent requirements.

## Phase 3 — Architecture options

For changes with real design choices, ask two or three architecture reviewers to propose distinct approaches. Require each to describe touched files, control/data flow, migration or compatibility impact, failure behavior, test strategy, and tradeoffs. Present the options concisely, recommend one, and wait for the user's selection when the choice is material. For a small change, document why the smallest existing pattern is sufficient.

## Phase 4 — Implement in slices

Implement the approved approach in coherent slices. Follow existing naming, state ownership, error boundaries, and test conventions. Keep changes scoped; do not opportunistically refactor unrelated code. After each risky slice, run the narrowest relevant test or type check so failures stay attributable. Never claim completion from a clean edit alone.

## Phase 5 — Fresh review

Run three review lenses, in parallel when practical:

1. simplicity and duplication;
2. correctness, edge cases, security, and performance;
3. project conventions and maintainability.

Require evidence and confidence for each finding. Fix high-confidence issues before verification or present them as explicit follow-up choices. Use `independent-fresh-context-review` when the change is consequential and a fresh context is available.

## Phase 6 — Verify the story

Use `verification` for an end-to-end feature path and `local-file-browser-verification` for local browser artifacts. Verify the user-visible trigger, client/server boundary, API or process call, persistence/external dependency, response, and rendered result. Run focused tests plus one adjacent regression path. If a boundary fails, stop at that boundary, report evidence, and repair only when authorized.

## Completion report

Report the user story, changed paths, decisions, tests and real-world checks, evidence, remaining risks, and any follow-up work. If implementation was not authorized or a design decision is awaiting the user, say exactly where the workflow stopped.
