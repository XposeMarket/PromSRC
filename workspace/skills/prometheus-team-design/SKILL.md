---
name: Prometheus Team Runtime Design
description: Canonical playbook for designing managed-agent teams in Prometheus using coordinator/manager flows, dispatch patterns, goal management, and review cadence. Use for team architecture, role design, orchestration strategy, and durable multi-agent workflows. Triggers on: build a team, create agents, design workflow, subagent, orchestrator, team structure, multi-agent, dispatch, assign roles, agent responsibilities, who does what, team playbook, managed team, coordinator, review cycle.
emoji: "🧩"
version: 1.1.0
triggers: build a team, create agents, design workflow, subagent, orchestrator, multi-agent, dispatch, assign roles, team structure, agent responsibilities, who does what, team design, new team, managed team, team manager, coordinator, review cadence, goal management, team pipeline, agent handoff, review cycle, team playbook
---

# Prometheus Team Runtime Design

Use this as the **canonical** skill for team architecture in Prometheus.

---

## Runtime model (current)

Prometheus supports three practical orchestration modes:

1. **Managed team (default for ongoing systems)**
   - Coordinator/manager + specialized subagents
   - Manager controls sequencing, quality checks, and escalation
   - Best for recurring workflows and multi-phase pipelines

2. **Direct specialist dispatch**
   - Explicitly run one known specialist via `dispatch_team_agent`
   - Best for narrow, one-off tasks with minimal orchestration overhead

3. **Single-agent execution**
   - No team structure when scope is small and self-contained

Rule: if work has repeated phases, handoffs, or review checkpoints, prefer managed team design.

---

## 1) Design flow first, agent list second

Before defining agents, pin down:

1. Outcome (single sentence)
2. Workflow phases (input → transform → decision → output)
3. Dependencies (what must happen first)
4. Parallel segments (what can safely run together)
5. Artifacts (what each phase produces)

Design role boundaries around phase ownership, not vague titles.

✅ Good: `collector -> validator -> analyst -> brief-writer`
❌ Bad: `helper`, `assistant-2`, `misc`

---

## 2) Subagent contract template (required)

Each subagent should have explicit contracts:

### Input contract
- Source (dispatch payload, workspace path, tool output)
- Expected format/schema
- Behavior on missing or invalid input

### Responsibility contract
- One primary responsibility
- No hidden side quests

### Output contract
- Deterministic output target (file path, structured payload, team message)
- Output format/schema
- Done signal (status update, artifact written, manager notification)

### Failure contract
- Retry policy + ceiling
- Escalation path (manager/team chat/main agent)
- Failure artifact (log or structured error report)

If a role repeatedly needs “and also…”, split that responsibility.

---

## 3) Coordinator / manager behavior

Use a coordinator when sequencing, QA gates, and adaptation are needed.

### Coordinator responsibilities
- Translate mission into active milestones
- Dispatch by dependency order
- Validate outputs against acceptance criteria
- Handle blockers and retries
- Keep goal state current

### Recommended review loop
1. Read current mission/focus + latest artifacts
2. Select highest-value next phase
3. Dispatch correct specialist
4. Validate returned output
5. Update goals/milestones
6. Continue or escalate blockers

Use `team_manage(action:"trigger_review")` when relying on managed-team review cycles.

---

## 4) Dispatch pattern selection

### Managed review cadence (default)
Use when:
- Team runs continuously
- Work changes over time
- Coordination quality is critical

### Direct `dispatch_team_agent`
Use when:
- The right specialist is known up front
- Task is narrow and bounded
- Fast execution is preferred over orchestration

### Background fan-out/fan-in
Use when:
- Multiple specialists can run concurrently
- You can aggregate with `get_agent_result(task_id)`
- Non-blocking throughput matters

---

## 5) Goal management discipline

Use layered goals to prevent drift:

- **Mission**: long-lived team purpose
- **Current focus**: active objective right now
- **Milestones**: checkpointed outputs with status

Use `manage_team_goal` to set mission/focus, log completed work, and update milestone state.

### Review cadence guide
- `after_each_run`: quality-sensitive pipelines
- `after_all_runs`: batch parallel workflows
- `daily`: ongoing monitoring/research systems
- `manual`: ad-hoc operator-controlled teams

---

## 6) Workspace + artifact design

Keep team output inspectable and recoverable.

Suggested structure:

```
/workspace/teams/<team-name>/
  input/
  working/
  output/
  logs/
  handoffs/
  state.json
```

Artifact rules:
- One phase = one clearly named output artifact
- Preserve intermediates for debug/audit
- Keep handoff filenames stable and machine-readable
- Log concise failure reasons and key decisions

---

## 7) Split vs merge responsibilities

Split when:
- Prompt/instructions are bloated
- Two responsibilities are independently testable
- Failure modes are different
- Part of the role can run in parallel

Merge when:
- Phases are tiny and always sequential
- Handoff overhead exceeds execution effort
- Excess boundaries reduce quality

---

## 8) Practical archetypes

- Intelligence: `source-scout -> validator -> analyst -> brief-writer`
- Content: `topic-researcher -> drafter -> editor -> scheduler`
- Monitoring: `poller -> classifier -> alert-writer -> notifier`
- Product ops: `triager -> implementer -> verifier -> release-notifier`

---

## 9) Migration note (from `smallclaw-team-design`)

`smallclaw-team-design` is now a deprecated compatibility ID.

During the transition window:
- Keep legacy references functioning through the shim skill
- Migrate prompts/automation to `prometheus-team-design` at next touch
- Treat this file as the canonical source of practical team-design guidance

---

## 10) Launch checklist

Before rollout:
- [ ] Mission + current focus defined
- [ ] Workflow phases + dependencies mapped
- [ ] Each subagent has input/output/failure contracts
- [ ] Coordinator responsibilities documented
- [ ] Review cadence selected intentionally
- [ ] Milestones initialized
- [ ] Workspace paths/artifact names fixed
- [ ] Blocker escalation path documented
- [ ] Acceptance criteria present per major phase
