---
name: "frontend-quality-guard"
description: "Enforce polished, human-designed frontend quality whenever Prometheus creates, edits, reviews, or repairs any user-facing web interface—even a tiny page, component, prototype, dashboard, tool, game, or one-off HTML file. Use to prevent generic AI-generated visual patterns, preserve the repository’s design language, and require responsive browser verification."
---

# Frontend Quality Guard

Apply this guard to every frontend change, regardless of size. Inspect the existing application, implement the real user experience, and verify it in a browser.

## Non-negotiable quality rules

- Do not wrap every section in a bordered card or floating panel. Use spacing, typography, alignment, background shifts, dividers, and hierarchy before containers.
- Do not use purple/blue gradients or purple as the default main colorway unless the user or existing brand explicitly calls for it.
- Avoid generic AI palettes: slate dashboards, beige washes, neon gradient glows, and orange/brown defaults without a domain reason.
- Use clean typography with a deliberate scale, readable line lengths, consistent weights, and no gratuitous negative tracking.
- Use rounded corners only where the component benefits from them. Keep radii consistent and restrained.
- Avoid card soup, nested cards, oversized hero copy, fake testimonials, decorative metric tiles, and vague copy such as “Unlock your potential.”
- Prefer the product itself in the first viewport: the editor, form, table, canvas, game, content, or primary workflow—not a marketing shell.
- Use familiar controls, semantic HTML, real icons from the existing library, and meaningful interaction states.
- Preserve the repository’s framework, tokens, component patterns, navigation, state model, and asset style.

## Workflow

1. Inspect nearby components, global styles, design tokens, routes, scripts, and installed UI/icon libraries.
2. Identify the surface’s actual job and the information/action hierarchy.
3. Build the smallest complete experience. Include expected empty, loading, error, selected, disabled, hover, focus, and responsive states when relevant.
4. Run the project’s existing lint, typecheck, test, and build scripts that apply.
5. Run `scripts/frontend_static_audit.py <path>` as a quick anti-pattern scan.
6. Open the real surface in a browser. Verify desktop and mobile widths, the primary interaction, overflow, clipping, contrast, broken assets, and console errors.
7. Iterate until the surface looks intentional rather than generated from a generic template.

Read `references/frontend-principles.md` for detailed design standards, `references/domain-patterns.md` for domain-specific defaults, and `references/verification-playbook.md` for browser QA. Use bundled templates only when no project scaffold exists.
