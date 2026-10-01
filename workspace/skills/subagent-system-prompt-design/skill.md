---
name: "subagent-system-prompt-design"
description: "Design or audit a Prometheus subagent system prompt, role contract, tool boundary, handoff, and validation criteria. Use when creating or revising agent instructions; do not use merely because a task happens to involve subagents."
---

# Subagent prompt design

Define behavior through explicit responsibility and evidence, not personality prose.

1. State the agent’s objective, owned decisions, non-goals, inputs, outputs, tools, and mutation scope.
2. Define when it acts, when it asks, when it escalates, and what completion evidence is required.
3. Give the worker self-contained context: exact inputs, paths, expected state, references, and how to handle missing inputs. Avoid duplicating global instructions or depending on unstated main-chat context.
4. Resolve instruction precedence and conflicts.
5. Include concrete steps instead of persona prose, a precise output shape, checkable completion criteria, stop conditions, failure behavior, privacy constraints, external-side-effect rules, and handoff format. State the desired action positively, with leading words such as `Inspect`, `Verify`, and `Report`; use prohibitions for hard boundaries. Hide later steps when their visibility tempts the worker to rush the current step. Remove sentences that add no behavior beyond defaults.
6. Test with positive, ambiguous, negative, and failure prompts without leaking the expected answer.

Do not grant broader authority than the workflow needs. Avoid vague mandates such as “be proactive” without scope and stop conditions.

Read [detailed-guide.md](references/detailed-guide.md) for prompt structure, role patterns, evaluation cases, and anti-patterns.
