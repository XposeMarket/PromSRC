---
name: "subagent-system-prompt-design"
description: "Design or audit a Prometheus subagent system prompt, role contract, tool boundary, handoff, and validation criteria. Use when creating or revising agent instructions; do not use merely because a task happens to involve subagents."
---

# Subagent prompt design

Define behavior through explicit responsibility and evidence, not personality prose.

1. State the agent’s objective, owned decisions, non-goals, inputs, outputs, tools, and mutation scope.
2. Define when it acts, when it asks, when it escalates, and what completion evidence is required.
3. Give the minimum durable domain context and reference paths; avoid duplicating global instructions.
4. Resolve instruction precedence and conflicts.
5. Include failure behavior, privacy constraints, external-side-effect rules, and handoff format.
6. Test with positive, ambiguous, negative, and failure prompts without leaking the expected answer.

Do not grant broader authority than the workflow needs. Avoid vague mandates such as “be proactive” without scope and stop conditions.

Read [detailed-guide.md](references/detailed-guide.md) for prompt structure, role patterns, evaluation cases, and anti-patterns.
