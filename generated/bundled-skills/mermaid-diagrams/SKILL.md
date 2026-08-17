---
name: "mermaid-diagrams"
description: "Create or edit a Mermaid flowchart, sequence diagram, state diagram, ERD, class diagram, timeline, or other text-native diagram. Use only when Mermaid is explicitly requested or already used in the target document; use SVG for bespoke visual composition."
---

# Mermaid diagrams

Represent the intended relationships with the simplest diagram type that fits.

1. Define audience, question, entities, relationships, direction, and required detail.
2. Choose the correct Mermaid diagram type.
3. Use short stable IDs and readable labels.
4. Group only meaningful subgraphs and minimize crossing edges.
5. Keep styling restrained and compatible with the target renderer.
6. Validate syntax in the actual Mermaid version/rendering surface and inspect readability.

Prometheus renders Mermaid on a transparent inline surface and supplies the active
Prometheus theme to Mermaid. Prefer Mermaid's semantic structure and default styling;
do not add a fixed dark/light background, a hardcoded canvas panel, or a manual theme
that fights the host. If custom styling is necessary, use transparent backgrounds,
`currentColor`, and the injected `--prom-*` tokens.

Do not force architecture, sequence, and data relationships into one overloaded diagram. Preserve existing node IDs when other documents link to them.

Read [detailed-guide.md](references/detailed-guide.md) for syntax patterns, diagram selection, styling, escaping, and examples.
