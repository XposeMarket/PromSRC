---
name: interactive-visuals
description: This skill routes visual requests to the correct specialized skill. Read this first, then switch to the right skill.
emoji: "🧩"
version: 1.0.0
---

# Interactive Visuals — Router

This skill routes visual requests to the correct specialized skill. Read this first, then switch to the right skill.

## Routing Table

| What the user wants | Skill to use |
|---|---|
| Data chart — bar, line, pie, scatter, radar | **`chart-visualizer`** |
| Architecture diagram, system map, box-and-arrow, component diagram | **`svg-diagrams`** |
| Interactive widget, dashboard, calculator, step-through, slider, form | **`html-interactive`** |
| Flowchart, sequence diagram, ERD, Gantt, state machine, class diagram | **`mermaid-diagrams`** |

## Quick Rules

- **Numbers / data to visualize** → `chart-visualizer`
- **"How does this system work" / services + databases** → `svg-diagrams`
- **"I want to interact with / adjust / filter"** → `html-interactive`
- **"Show the flow / sequence / steps"** → `mermaid-diagrams`
- **Report with charts + KPIs combined** → `html-interactive` (it can embed Chart.js)

## When It's Ambiguous

- Architecture flowchart with ~10 named services → `svg-diagrams` (need positioning control)
- Simple 5-step process flow → `mermaid-diagrams` (faster, cleaner)
- Dashboard with multiple charts + KPI numbers → `html-interactive`
- Single chart with data → `chart-visualizer`

Once you've identified the right skill, **stop using this router and read that skill's SKILL.md instead.**