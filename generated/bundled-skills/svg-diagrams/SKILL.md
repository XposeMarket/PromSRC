---
name: "svg-diagrams"
description: "Create or edit a precise standalone SVG diagram, architecture visual, process map, annotated schematic, or system illustration. Use only when SVG is explicitly requested or is the existing artifact format; use Mermaid for text-native diagrams and chart tools for quantitative plots."
---

# SVG diagrams

Build a semantic visual system, not a pile of absolute coordinates.

1. Define audience, message, entities, relationships, hierarchy, dimensions, and output context.
2. Choose a layout model and establish viewBox, spacing, typography, color, markers, and reusable symbols.
3. Group related elements and give meaningful IDs/classes.
4. Route connectors clearly, avoid crossings, and preserve label readability.
5. Add accessibility title/description when the artifact is user-facing.
6. Validate XML, inspect the rendered SVG at target sizes, and check clipping, contrast, font fallback, and responsive scaling.

Do not embed untrusted scripts or external assets without need. Prefer semantic edits over full regeneration when modifying an existing SVG.

Read [detailed-guide.md](references/detailed-guide.md) for layout recipes, marker/filter patterns, annotation styles, and code templates.
