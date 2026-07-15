---
name: "interactive-artifacts"
description: "Create polished interactive HTML artifacts, dashboards, cards, comparison tools, and lightweight visual explainers with real user interaction. Use when the deliverable itself should be an interactive browser artifact; do not use for ordinary website implementation, static charts, or slide/document output."
---

# Interactive artifacts

Choose this skill when interaction materially improves understanding or exploration.

## Workflow

1. Define the question the artifact helps a user answer.
2. Choose the smallest useful interaction model: filters, toggles, tabs, sliders, drill-down, or step-through.
3. Build semantic HTML with scoped CSS and minimal JavaScript.
4. Use realistic content and an intentional visual hierarchy.
5. Provide keyboard access, visible focus, readable contrast, touch-friendly controls, and responsive behavior.
6. Test state changes, empty/error states, layout at representative widths, and console behavior.

## Persistent state in Prometheus chat

When the artifact is returned inside a Prometheus `html` visual fence, treat it as a persistent conversation object:

- Initialize controls from `window.openai?.widgetState` when present.
- After meaningful interaction, call `window.openai?.setWidgetState(nextState)` with a compact JSON-serializable object. Prometheus also exposes `window.prometheusVisual.getState()` and `.setState(nextState)`.
- Store user intent such as selected metrics, filters, tabs, slider values, or the current step. Do not store large datasets or values already encoded in the visual source.
- Keep state keys stable across refinements so compatible selections survive a revised visual version.

Keep the initial view understandable without interaction. Avoid decorative controls that do not change the user’s understanding. Prefer a static chart or prose answer when interactivity adds no value.

Read [html-workflows.md](references/html-workflows.md) for component patterns and [visual-workflows.md](references/visual-workflows.md) for visual-selection guidance. Load only the matching reference.
