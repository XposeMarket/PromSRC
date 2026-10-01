---
name: "root-cause-debugging"
description: "Investigate software failures by reproducing the symptom, narrowing hypotheses with evidence, tracing the actual cause, applying the smallest safe repair, and verifying the original and adjacent paths. Use for bugs and regressions, not for ordinary feature design or a generic code review."
---

# Root Cause Debugging

Use this workflow when behavior is wrong, a test or build fails, a regression appears, or a runtime problem needs explanation. Do not patch from the first plausible guess.

## 1. State the failure

Capture the exact symptom, expected behavior, observed behavior, environment, inputs, first known bad version, and impact. Preserve the original error text and a minimal reproduction when possible.

## 2. Reproduce before changing code

Before theorizing, build a fast, deterministic, agent-runnable pass/fail check that fails on the user's exact symptom. Prefer: failing test, curl script, CLI fixture diff, headless browser script, replayed trace, throwaway harness, fuzz loop, bisect, or differential run. Minimize the repro until every remaining element is load-bearing. Confirm whether the failure is deterministic, input-specific, environment-specific, timing-sensitive, or already gone. Record commands, versions, logs, and artifacts. If reproduction is impossible, label the investigation hypothesis-only and do not claim the cause is proven.

## 3. Build and test hypotheses

Separate symptoms from causes. List 3 to 5 ranked falsifiable hypotheses in the form "if X, changing Y should alter the failing check"; show them to the user before testing without blocking if the user is away. Inspect recent changes, call paths, state transitions, boundaries, logs, configuration, dependencies, and generated artifacts. Change one variable at a time where practical. Use targeted probes; tag temporary debug logs with a unique marker such as `[DBG-<slug>]`, then search for and remove that marker's logs before finishing. For performance failures, measure a baseline and bisect; logs alone do not establish the cause.

For each hypothesis, record supporting evidence, contradicting evidence, the next discriminating check, and the result. Correlation, a clean build, or an absent log entry is not proof.

## 4. Repair narrowly

Choose the smallest change that addresses the demonstrated cause without unrelated cleanup. Preserve compatibility and existing conventions. Add or update a regression test at a seam that reproduces the real call pattern; if no such seam exists, record an architecture finding and hand off to `architecture-deepening`. Do not mask errors with broad catches, retries, sleeps, feature flags, or weaker tests unless evidence requires it.

After three failed fix attempts, stop patching and question the architecture with the user through `ask_prometheus_questions`. Do not try a fourth speculative patch.

## 5. Verify and close

Re-run the original reproduction, focused tests, relevant typecheck/build/lint commands, and one adjacent regression path. Compare before/after behavior. Inspect the diff for accidental scope. Report verified facts, remaining hypotheses, skipped checks, and follow-up work.

## Output contract

Return: failure statement, reproduction evidence, hypotheses and checks, root-cause confidence, changed files, verification commands/results, residual risk, and next action. Never report a fix as complete when only the source edit was made.
