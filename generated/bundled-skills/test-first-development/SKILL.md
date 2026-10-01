---
name: "test-first-development"
description: "Guide feature and bug work through a practical test-first loop: define observable behavior, write a failing test, make the smallest implementation pass, refactor safely, and verify the surrounding contract. Use when tests should drive implementation, not for visual exploration or a review-only request."
---

# Test-First Development

Use when adding behavior, changing a contract, or fixing a reproducible bug where automated tests can express the expected result. TDD is a tool, not a ritual: for visual exploration, throwaway spikes, or unavailable external systems, state the alternative verification plan instead.

## 1. Define behavior

Write the smallest observable contract in plain language. Identify inputs, outputs, side effects, error cases, boundaries, and invariants. Choose the narrowest stable test layer: unit, integration, API, component, or end-to-end. Test through public interfaces or stable seams, not internals: a good test survives an internal refactor.

## Iron law and vertical slices

Unless the user explicitly opts out, production behavior must follow its failing test. Write one test, implement only enough to pass it, then repeat for the next behavior. Never write all tests up front or implement the whole feature before its tests: horizontal slicing tests imagined behavior instead of observed contracts. If new code was written before its test, delete it and redo that slice from RED; isolate new code first so unrelated work is preserved.

| Rationalization | Response |
| --- | --- |
| "Too simple to test" | Write the smallest observable assertion. |
| "I'll add tests after" | Delete the untested new code and restart from RED unless the user opts out. |
| "I already manually tested" | Manual testing does not prove test-first. Run a failing automated test. |

## 2. RED

Add one focused test that fails for the intended reason. Run only that test first and preserve the failure output. If it passes before the implementation changes, investigate whether the test is exercising the new behavior, the fixture is stale, or the behavior already exists.

## 3. GREEN

Implement the smallest production change that makes the focused test pass. Do not add speculative abstractions or weaken the assertion. Re-run the focused test, then the nearest related tests.

## 4. REFACTOR

Improve names, duplication, structure, or boundaries while keeping the tests green. Keep refactoring separate from behavior changes where possible. Preserve project conventions and public contracts.

## 5. Verify the slice

Run the focused test, related suite, typecheck/lint/build scripts that apply, and at least one regression path. Inspect the diff and confirm the test would fail if the behavior regressed. For an integration that cannot be run locally, use a deterministic mock plus a clearly labeled live-check requirement.

## Output contract

Return the behavior contract, test added or changed, RED evidence, implementation summary, GREEN/REFACTOR evidence, broader verification, and any uncovered risk. Never claim test-first completion from a test file that was not executed.
