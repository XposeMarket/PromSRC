---
name: "code-simplifier"
description: "Simplify recently changed code while preserving exact behavior, project conventions, error semantics, and public contracts. Use after implementation or review when the user asks to simplify or clean up code; do not use for broad rewrites."
---

# Code Simplifier

Improve clarity without changing behavior. Scope the work to recently modified files or the exact paths named by the user. Read local instructions, tests, and surrounding patterns before editing.

## Review before editing

Identify duplication, needless indirection, deep nesting, unclear names, avoidable state, unreachable branches, noisy comments, and inconsistent local patterns. Separate safe simplifications from changes that alter behavior, timing, errors, types, performance, or public API. Preserve intentional complexity when it encodes a real invariant or compatibility constraint.

## Simplify deliberately

- reduce duplication and unnecessary branching;
- flatten control flow with early returns when that improves comprehension;
- use precise names and small focused helpers;
- keep error handling explicit and actionable;
- avoid nested ternaries, clever one-liners, speculative abstractions, and unrelated formatting churn;
- preserve side-effect order, async behavior, fallback semantics, type guarantees, and user-visible output;
- follow the repository's style instead of imposing a personal style.

Make the smallest coherent patch. If a proposed cleanup would require a behavior decision, stop and ask rather than smuggling the decision into a refactor.

## Verify

Review the final diff for behavior-preserving intent. Run the narrowest relevant tests, type checks, lint, or build. Exercise a representative runtime path when the code is UI, async, or integration-sensitive. If a check cannot run, say why. Report what became simpler, what was intentionally left alone, tests run, and any semantic risk.
