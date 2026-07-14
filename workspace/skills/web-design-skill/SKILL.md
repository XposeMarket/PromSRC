---
name: "web-design-skill"
description: "Design or substantially improve the visual system of a website or web application, including layout, typography, color, responsive behavior, components, media, and interaction polish. Use for visual web-design work; do not use for unrelated coding, minor copy edits, or framework-specific animation unless explicitly requested."
---

# Web design system

Build a coherent interface from a brief and the project’s existing design language. Do not paste a generic aesthetic over a product without understanding its users and content.

## Design loop

1. **Inspect.** Read the current app structure, styles, reusable components, assets, brand constraints, and target breakpoints.
2. **Define the brief.** Identify audience, primary action, information hierarchy, tone, content density, accessibility needs, and visual constraints.
3. **Set tokens.** Establish a small color system, typography scale, spacing rhythm, radii, shadows, and motion rules. Reuse project tokens when they already exist.
4. **Compose.** Design page hierarchy and responsive layout before polishing individual components.
5. **Implement.** Use semantic HTML, maintainable project-native CSS/components, real content, and intentional media.
6. **Verify visually.** Inspect representative desktop and mobile widths, overflow, contrast, focus states, touch targets, loading/empty/error states, and key interactions.

## Quality rules

- Give every section a clear job and hierarchy.
- Prefer a restrained palette with deliberate contrast over many competing accents.
- Use typography and spacing to create rhythm; do not rely on card borders for every grouping.
- Avoid generic gradient-heavy “AI dashboard” styling unless it fits the brief.
- Keep controls recognizable and keyboard/focus behavior accessible.
- Use real or representative content so layout decisions reflect actual density.
- Preserve existing product conventions unless the user requests a redesign.
- Treat mobile as a designed state, not a shrunken desktop page.

## Scope routing

Use `landing-page-blueprint` when conversion structure and copy hierarchy are the primary task. Use `codex-frontend-engineer` when repository implementation and component architecture dominate. Use a named animation/provider skill only when the user chooses that technology or the project already depends on it.

## Read details only when needed

- Read [detailed-guide.md](references/detailed-guide.md) for CSS patterns, component recipes, typography pairings, palettes, responsive techniques, and the full template.
- Read [color-palettes.md](references/color-palettes.md) only when selecting or extending a palette.
- Use [html-template.html](references/html-template.html) only when the task calls for a standalone HTML starting point.

Deliver a coherent system and verify it in the rendered interface, not only by reading the source.
