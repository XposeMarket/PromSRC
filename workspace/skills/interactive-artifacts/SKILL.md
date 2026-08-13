---
name: "interactive-artifacts"
description: "Create polished interactive HTML artifacts, dashboards, cards, comparison tools, and lightweight visual explainers with real user interaction. Use when the deliverable itself should be an interactive browser artifact; do not use for ordinary website implementation, static charts, or slide/document output."
---

# Interactive artifacts

Choose this skill when interaction materially improves understanding or exploration.

This is Prometheus's freeform generative-UI lane. It is not limited to a small card
or a fixed widget catalog: a self-contained HTML block may be a fractal explorer,
simulation, dashboard, lesson, configurable tracker, planner, or mini-game when
that experience materially serves the request.

## Workflow

1. Define the question the artifact helps a user answer.
2. Choose the smallest useful interaction model: filters, toggles, tabs, sliders, drill-down, or step-through.
3. Build semantic HTML with scoped CSS and minimal JavaScript.
4. Use realistic content and an intentional visual hierarchy.
5. Provide keyboard access, visible focus, readable contrast, touch-friendly controls, and responsive behavior.
6. Test state changes, empty/error states, layout at representative widths, and console behavior.

## Prometheus visual contract

- Keep the outer document transparent. Do not add a hardcoded light/dark canvas or
  an outer card solely to make the iframe visible; the host provides the surface.
- Use the injected design tokens (`--prom-bg`, `--prom-surface`,
  `--prom-surface-secondary`, `--prom-border`, `--prom-text`, `--prom-muted`,
  `--prom-accent`, `--prom-success`, `--prom-warning`, and `--prom-danger`).
  Internal cards, controls, and game boards may have intentional surfaces, but
  those surfaces must use the tokens rather than a fixed theme palette.
- Let content determine height. Avoid fixed outer heights, `position: fixed`, and
  page-level scroll containers. The host grows the inline frame from measured
  content, so a larger self-contained experience can still remain in the chat.
- Keep the experience responsive at 320px and above, keyboard accessible, and
  usable with touch. Complexity is allowed; unnecessary chrome and overflow are not.
- Keep local interaction local. The sandbox must not use credentials, Electron or
  Node APIs, the filesystem, cookies, browser permissions, arbitrary iframes,
  unrestricted networking, or external-account access. External actions belong to
  registered Prometheus tools and policy checks, never to generated JavaScript.
- Use `window.openai?.widgetState` / `setWidgetState` or the equivalent
  `window.prometheusVisual` bridge for compact, JSON-serializable state. Do not
  persist large datasets in widget state.

## Surface choice

Use an inline visual when it supports the surrounding answer and can sit between
prose. Treat the visual as an artifact surface only when it is the main deliverable
and genuinely needs long-lived editing, multiple views, or independent persistence.
Do not generate UI merely for decoration.

## Persistent state in Prometheus chat

When the artifact is returned inside a Prometheus `html` visual fence, treat it as a persistent conversation object:

- Initialize controls from `window.openai?.widgetState` when present.
- After meaningful interaction, call `window.openai?.setWidgetState(nextState)` with a compact JSON-serializable object. Prometheus also exposes `window.prometheusVisual.getState()` and `.setState(nextState)`.
- Store user intent such as selected metrics, filters, tabs, slider values, or the current step. Do not store large datasets or values already encoded in the visual source.
- Keep state keys stable across refinements so compatible selections survive a revised visual version.

Keep the initial view understandable without interaction. Avoid decorative controls that do not change the user’s understanding. Prefer a static chart or prose answer when interactivity adds no value.

Read [html-workflows.md](references/html-workflows.md) for component patterns and [visual-workflows.md](references/visual-workflows.md) for visual-selection guidance. Load only the matching reference.
