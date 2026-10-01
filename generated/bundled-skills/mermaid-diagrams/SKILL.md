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

Do not force architecture, sequence, and data relationships into one overloaded diagram. Preserve existing node IDs when other documents link to them.

Read [detailed-guide.md](references/detailed-guide.md) for syntax patterns, diagram selection, styling, escaping, and examples.
