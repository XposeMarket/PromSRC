---
name: "code-review"
description: "Perform an evidence-based review of a code change or pull request for correctness, project conventions, regressions, security, performance, and maintainability. Use for review-only work; do not silently modify code or publish comments."
---

# Code Review

Review the actual change and its context. This is advisory unless the user explicitly authorizes edits or remote comments.

## Eligibility and scope

Resolve the repository and review target before reading deeply: working-tree diff, staged diff, branch comparison, or pull request. If there is no meaningful change, the target is closed/draft when that matters, the change is automated/generated, or the same review was already completed, report that review is not applicable and stop. Identify repository instruction files such as `AGENTS.md`, `CLAUDE.md`, `CONTRIBUTING.md`, and local package guidance in the root and modified directories.

Summarize the change, affected files, user-visible behavior, and test evidence. Inspect the complete changed hunks plus enough surrounding code to understand contracts. Read history or blame only when it answers a concrete ownership or compatibility question.

## Review lenses

Run independent lenses in parallel with `agents_and_teams` when practical, or sequentially otherwise:

1. **Guidelines** — project instructions, API contracts, conventions, compatibility, and required tests.
2. **Correctness** — changed-code bugs, edge cases, state transitions, async behavior, security, performance, and failure handling.
3. **History** — why the code exists, prior regressions, and compatibility assumptions.
4. **Integration** — callers, consumers, schemas, migrations, deployment/config, and adjacent tests.
5. **Changed-file comments** — factual accuracy, stale explanations, missing rationale, and noise.

Every finding must include file/line evidence, impact, why the current code is wrong or risky, and a concrete fix direction. Distinguish confirmed defects from questions and suggestions. Do not report style preferences as bugs.

## Confidence gate

Score each candidate from 0–100 based on evidence, reproducibility, and project context. Report only findings at 80 or higher as actionable. Keep lower-confidence concerns in a short “needs confirmation” section only when they could materially change the decision. Re-check the target after analysis so a stale diff or changed PR does not produce a false report.

## Output

Return a concise summary, then findings ordered by severity:

- **Critical** — data loss, security issue, broken release, or widespread failure.
- **Important** — likely correctness, compatibility, reliability, or performance defect.
- **Suggestion** — worthwhile improvement that does not block acceptance.
- **Positive** — notable evidence of good design or coverage.

For each actionable finding: `path:line`, issue, impact, evidence, confidence, and recommended change. Finish with tests/checks actually run and an explicit verdict: approve, approve with suggestions, needs changes, or blocked. Do not create a commit, alter the worktree, or post PR comments unless separately authorized.
