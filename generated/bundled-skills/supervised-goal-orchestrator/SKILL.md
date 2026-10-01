---
name: "supervised-goal-orchestrator"
description: "Turn a broad objective into bounded parallel lanes with a supervisor and evidence ledger. Use for complex delegate-and-supervise goals; use parallel-agent-fanout for a narrow one-off fanout, not this workflow."
---

# Supervised Goal Orchestrator

Convert ambiguous objectives into supervised execution that ends in evidence, not activity.

1. Normalize objective, acceptance criteria, constraints, non-goals, artifacts, verification, and unknowns.
2. Map uncertain premises before committing.
3. Choose the smallest effective topology: background agents for ephemeral independent work; Prometheus threads for visible durable work; teams for recurring roles.
4. Make every lane self-contained with scope, inputs, output, evidence, non-overlap, success, and stop conditions.
5. Keep one supervisor responsible for synthesis and acceptance.
6. Inspect artifacts, steer concrete gaps, and recover no-progress lanes.
7. Reconcile conflicts explicitly.
8. Use `independent-fresh-context-review` for consequential final review.
9. Produce an evidence ledger mapping criteria to artifacts, verifier, result, and risk.

Success requires verified criteria, resolved conflicts, accessible artifacts, and named residual risks. Delegation never expands authority or bypasses approvals.

For any spawned background agent, set a fully qualified route of `openai_codex/gpt-6-sol` or `openai_codex/gpt-6-luna` only. Review Luna output. Delegation does not bypass model policy.
