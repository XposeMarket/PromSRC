---
name: "interactive-visuals"
description: "Route /visual requests and general requests for a visual explanation to the smallest best-fit Prometheus visual: native rich widget, Chart.js chart, Mermaid diagram, precise SVG, or interactive HTML artifact. Use when the user asks to visualize, diagram, chart, map, compare, simulate, explore, or explicitly invokes /visual."
---

# Interactive visuals router

Treat `/visual` as an output intent, not as content to reproduce. Identify the question the visual must help the user answer, choose one primary representation, and load only the matching specialized skill when one is needed.

## Route in this order

1. Use an existing native rich-output tool when structured data already fits a map, weather card, market card, sources card, product carousel, or comparison table.
2. Use `chart-visualizer` for one quantitative chart: trends, comparisons, distributions, correlations, or part-to-whole data.
3. Use `mermaid-diagrams` for text-native flows, sequences, states, ERDs, timelines, Gantt charts, or class relationships.
4. Use `svg-diagrams` for bespoke architecture, annotated schematics, spatial layouts, or diagrams needing precise composition.
5. Use `interactive-artifacts` for adjustable simulations, calculators, dashboards, filters, sliders, drill-downs, or step-through explainers.

Prefer the smallest representation that materially improves understanding. Do not generate interactive HTML when a native widget, chart, Mermaid diagram, or SVG answers the question cleanly. Do not invent data. If the user supplied enough context, choose without asking them to select a format.

## Output contract

- Make the visual the primary result and keep surrounding prose short.
- Use one primary visual unless the request genuinely requires multiple coordinated views.
- Preserve real units, labels, sources, and missing values.
- Design for desktop and mobile widths down to 320px.
- Keep local filters and selections inside the visual. Use a conversational follow-up only when the user asks Prometheus to investigate or explain a selected state.
- For interactive HTML, initialize from `window.openai?.widgetState` and save meaningful state with `window.openai?.setWidgetState(nextState)`; Prometheus also exposes the equivalent `window.prometheusVisual` API.
- When refining an existing visual, preserve its stable artifact identity and compatible interaction state instead of rebuilding unrelated parts.

Read [references/soul-visual-defaults.md](references/soul-visual-defaults.md) only when native rich-output selection is ambiguous.
