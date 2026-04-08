# Prometheus Agent & Team Architecture Redesign

## The Problem
Current system creates agents from scratch every time — full prompts, roles, tools all hand-crafted per team. This causes:
- Bloated main chat context
- Random inconsistent agent roles (x_post_analyzer, etc.)
- Expensive team creation process
- Not scalable for multi-team / company-wide vision

---

## The Fix: Role Registry + Coordinator Pattern

### Core Concept
Separate three things that are currently tangled:

- **What agents ARE** → permanent role definitions (the registry)
- **What teams ARE** → temporary compositions for a specific mission
- **What the coordinator DOES** → matches mission to roles, spins up team

---

## New Flow

```
Main Chat → "I need a feature implementation team"
         ↓
Team Coordinator (reads registry)
         ↓
Instantiates correct roles → Creates team + manager
         ↓
Team runs autonomously (existing manager/subagent system)
         ↓
Result returns to Main Chat
```

Main chat never needs to know how teams work internally. Clean context, clean separation.

---

## Role Registry

Static folder of pre-built agent definitions:

```
.prometheus/
  agents/
    planner.json
    orchestrator.json
    researcher.json
    analyst.json
    builder.json
    operator.json
    verifier.json
```

Each file contains the complete agent definition — prompt, tools, permissions, model assignment. Coordinator reads the right files and instantiates from them. Done.

---

## The 7 Core Roles (trimmed from GPT's list)

| Role | Purpose |
|------|---------|
| **Planner** | Decomposes goal into executable plan with subtasks, owners, acceptance criteria |
| **Orchestrator** | Keeps team running — launches agents, manages handoffs, retries, resolves deadlocks |
| **Researcher** | Finds and synthesizes information, returns evidence bundles |
| **Analyst** | Turns raw info into decisions, evaluates tradeoffs, produces recommendations |
| **Builder** | Code generation, patching, refactoring, scripts, technical artifacts |
| **Operator** | Browser automation, file edits, external system actions (needs strict permissions + logging) |
| **Verifier** | QA gate — validates output against requirements before anything ships |

**Dropped/merged:** Intake Router (main chat handles this), Writer (Builder covers it), Data/ETL (Operator covers it), Compliance (approval gate covers it)

---

## Agent Instantiation Model

Agents are **role definitions**, not singletons. Like a job description vs an employee — you can instantiate multiple copies of the same role simultaneously across different teams.

```
Role Registry (static definitions)
├── Researcher v1.2
├── Builder v1.4
└── Verifier v1.1

Running Teams (live instantiations)
├── Team A: Bug Scanner
│   ├── Researcher [instance_a1]
│   └── Analyst [instance_a2]
│
├── Team B: Feature Build
│   ├── Builder [instance_b1]
│   └── Verifier [instance_b2]
│
└── Team C: Social Listening
    └── Researcher [instance_c1]
```

Same Researcher definition → three separate API calls → zero interference.

---

## Model Assignment Per Role

| Layer | Model |
|-------|-------|
| Main Chat | Codex 5.3 |
| Coordinator | Sonnet 4.6 |
| Team Managers | Sonnet 4.6 |
| Subagents (all roles) | Haiku / Codex mini |
| Background agents | Haiku / Codex mini |

---

## What the Coordinator Needs

Just one thing: **a registry + instance tracker.**

- Registry: all available role definitions
- Instance tracker: what's currently running, which team it's assigned to, status

Coordinator reads mission brief → reads registry → composes team → hands off to manager → done.

---

## What Stays the Same

- Manager per team tracking subagent activity ✅
- Team running autonomously once spun up ✅
- Approval gates on sensitive actions ✅
- Background/scheduled agent support ✅

---

## Summary

Team creation goes from:
> create subagent A (full prompt) → create subagent B (full prompt) → create team → attach A → attach B → configure → run

To:
> "I need X done" → coordinator composes from registry → team runs
