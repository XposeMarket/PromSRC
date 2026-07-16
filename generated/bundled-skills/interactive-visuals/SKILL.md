---
name: "interactive-visuals"
description: "Route /visual requests and general requests for a visual explanation to the smallest best-fit Prometheus visual skill: Chart.js chart, Mermaid diagram, precise SVG, or interactive HTML artifact. Use when the user asks to visualize, diagram, chart, map, compare, simulate, explore, or explicitly invokes /visual."
---

# Interactive visuals router

Treat `/visual` as an output intent, not as content to reproduce. Identify the question the visual must help the user answer, choose one primary representation, then call `skill_read` for exactly one matching specialized skill before composing the answer.

## Explicit `/visual` routing

1. Use `chart-visualizer` for one quantitative chart: trends, comparisons, distributions, correlations, or part-to-whole data.
2. Use `mermaid-diagrams` for text-native flows, sequences, states, ERDs, timelines, Gantt charts, or class relationships.
3. Use `svg-diagrams` for bespoke architecture, annotated schematics, spatial layouts, or diagrams needing precise composition.
4. Use `interactive-artifacts` for adjustable simulations, calculators, dashboards, filters, sliders, drill-downs, or step-through explainers.

For an explicit `/visual` command, do not call `show_ui_card`, `show_comparison`, or satisfy the request with a Markdown table. Native rich cards remain valid for ordinary non-`/visual` requests, but the slash command specifically asks for one of the four visual skill renderers.

Prefer the smallest representation that materially improves understanding. Do not generate interactive HTML when a chart, Mermaid diagram, or SVG answers the question cleanly. Do not invent data. If the user supplied enough context, choose without asking them to select a format.

## Output contract

- Make the visual the primary result and keep surrounding prose short.
- For `/visual`, return exactly one complete fenced visual block: `chart`, `mermaid`, `svg`, or `html`. Plain prose and Markdown tables do not count as completion.
- Use one primary visual unless the request genuinely requires multiple coordinated views.
- Preserve real units, labels, sources, and missing values.
- Design for desktop and mobile widths down to 320px.
- Keep local filters and selections inside the visual. Use a conversational follow-up only when the user asks Prometheus to investigate or explain a selected state.
- For interactive HTML, initialize from `window.openai?.widgetState` and save meaningful state with `window.openai?.setWidgetState(nextState)`; Prometheus also exposes the equivalent `window.prometheusVisual` API.
- When refining an existing visual, preserve its stable artifact identity and compatible interaction state instead of rebuilding unrelated parts.

Read [references/soul-visual-defaults.md](references/soul-visual-defaults.md) only when native rich-output selection is ambiguous.
