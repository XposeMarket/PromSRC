---
name: "svg-diagrams"
description: "Create or edit a precise standalone SVG diagram, architecture visual, process map, annotated schematic, or system illustration. Use only when SVG is explicitly requested or is the existing artifact format; use Mermaid for text-native diagrams and chart tools for quantitative plots."
---

# SVG diagrams

Build a semantic visual system, not a pile of absolute coordinates.

1. Define audience, message, entities, relationships, hierarchy, dimensions, and output context.
2. Choose a layout model and establish viewBox, spacing, typography, color, markers, and reusable symbols. In a themed Prometheus surface inherit `--prom-bg`, `--prom-surface`, `--prom-border`, `--prom-text`, `--prom-muted`, and `--prom-accent` rather than hardcoding an outer canvas. For standalone deliverables use a neutral editorial palette or consult `theme-application`; do not default to dark slate/cyan or purple-blue-cyan gradient "AI SaaS" aesthetics unless brand-required.
3. Group related elements and give meaningful IDs/classes. Draw connectors before boxes so they sit behind nodes; use opaque under-rectangles beneath translucent fills.
4. Route connectors through gaps, avoid crossings, and preserve label readability. Maintain at least 40 px between unrelated boxes where possible; place message buses in gaps and the legend outside all grouped boundaries. Use consistent arrowheads and dashed styles for security groups or regions.
5. Add accessibility title/description when the artifact is user-facing.
6. Validate XML, inspect the rendered SVG at target sizes, and check clipping, contrast, font fallback, and responsive scaling.

Do not embed untrusted scripts or external assets without need. Prefer semantic edits over full regeneration when modifying an existing SVG. For offline viewing, offer a standalone HTML wrapper with inline SVG and no external dependencies, while retaining the standalone SVG as the source artifact.

Read [detailed-guide.md](references/detailed-guide.md) for layout recipes, marker/filter patterns, annotation styles, and code templates.
