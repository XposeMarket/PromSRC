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

Keep the initial view understandable without interaction. Avoid decorative controls that do not change the user’s understanding. Prefer a static chart or prose answer when interactivity adds no value.

Read [html-workflows.md](references/html-workflows.md) for component patterns and [visual-workflows.md](references/visual-workflows.md) for visual-selection guidance. Load only the matching reference.
