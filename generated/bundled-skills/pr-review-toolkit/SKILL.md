---
name: "pr-review-toolkit"
description: "Run a focused pull-request review through specialized lenses for code correctness, tests, comments, silent failures, type design, and simplification. Use when the user explicitly requests a deep PR review or selected review aspects."
---

# Pull-Request Review Toolkit

Use this as a review orchestrator when a normal code review needs specialized lenses. It is intentionally explicit-only so it does not compete with the general `code-review` route.

## Establish scope

Resolve the PR or local diff, repository instructions, changed files, language/toolchain, and requested aspects. Supported aspects are `code`, `tests`, `comments`, `errors`, `types`, `simplify`, or `all`. If no aspect is specified, use code plus the aspects clearly implicated by the diff, followed by simplification after correctness passes.

Do not review generated files as if they were source. Do not post comments, edit code, commit, or push unless the user separately authorizes that action.

## Specialized lenses

- **Code reviewer:** bugs, regressions, security, performance, async/state behavior, integration, and conventions. Report only high-confidence findings with exact evidence.
- **PR test analyzer:** identify changed behavior and whether tests cover success, invalid input, errors, permissions, concurrency, retries, empty states, and boundary conditions. Rate coverage 1–10 and name the highest-value missing tests; do not demand tests for behavior that cannot be observed or is intentionally covered elsewhere.
- **Comment analyzer:** check comments and documentation for factual accuracy, completeness, stale claims, missing rationale, and obvious noise. Comments should explain why or contract, not restate code.
- **Silent-failure hunter:** inspect empty catches, swallowed promise rejections, broad fallbacks, optional chaining that hides required state, ignored return values, missing logging, and error messages without actionable context. Distinguish intentional recovery from hidden failure.
- **Type-design analyzer:** inspect invariants, illegal states, encapsulation, expression of domain concepts, and compile-time enforcement. Rate the design where useful and give a smallest-improvement path.
- **Code simplifier:** after correctness, reduce duplication and nesting, improve names and control flow, avoid nested ternaries and clever compression, and preserve exact behavior and project conventions. Limit scope to recently modified code unless asked otherwise.

Run independent lenses in parallel with `agents_and_teams` where safe; keep simplification after correctness unless the user asks for parallel suggestions. Each reviewer returns findings, evidence, confidence, and tests/checks performed. If agent tooling is unavailable, run the same lenses sequentially in the current context.

## Aggregate and decide

Deduplicate findings, retain the strongest evidence, and rank Critical, Important, Suggestions, and Positive observations. Include an action plan with `fix now`, `fix later`, or `accepted risk`. Re-read changed files after any authorized remediation and rerun affected checks.

## Final report

State scope, aspects run, verdict, findings with `path:line`, confidence, coverage rating, simplification notes, tests/checks, and unverified paths. Keep advisory findings separate from blockers. Never claim PR approval based only on static inspection when a required runtime or integration path was not exercised.
