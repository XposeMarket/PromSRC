---
name: smallclaw-team-design (Deprecated Redirect)
description: DEPRECATED compatibility shim. This legacy skill ID now redirects to `prometheus-team-design`. Use it during the transition window if older prompts reference smallclaw naming. Triggers on: build a team, create agents, design workflow, subagent, orchestrator, team structure, multi-agent, dispatch, assign roles, agent responsibilities, who does what, team playbook.
emoji: "🧩"
version: 1.1.0
triggers: build a team, create agents, design workflow, subagent, orchestrator, multi-agent, dispatch, assign roles, team structure, agent responsibilities, who does what, team design, new team, agent system prompt, shared workspace
---

# ⚠️ Deprecated Skill ID: `smallclaw-team-design`

This skill is maintained as a **temporary compatibility shim** for one release cycle.

## Canonical replacement
Use **`prometheus-team-design`** as the current, supported team-design playbook.

- New canonical path: `skills/prometheus-team-design/SKILL.md`
- New canonical focus: Prometheus managed-team runtime (manager/coordinator flows, dispatch patterns, goal management, and review cadence)

## Migration note
If any automation, prompt, or team recipe still references `smallclaw-team-design`, keep it working temporarily but migrate those references to `prometheus-team-design` at the next touch.

## Compatibility behavior
During transition, this legacy skill ID should be treated as a redirect to the canonical playbook. Practical team-design guidance is preserved in the new skill without loss of coverage.

## Trigger compatibility
Legacy triggers are intentionally kept here to preserve backwards compatibility while users and automations migrate.
