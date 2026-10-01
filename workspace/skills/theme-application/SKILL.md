---
name: theme-application
description: Choose, preview, and consistently apply a visual theme (palette, type pairing, accents, chart colors) to an artifact such as a slide deck, document, report, HTML page, dashboard, or chart set, either from the bundled theme library or a custom theme built from a brand or brief. Use when the user asks to theme, restyle, rebrand, or "make this match our colors" across an artifact. Do not use for designing a full website (web-design-skill), creating logos or brand kits (exact-logo-brand-kit-workflow), or brand positioning (brand-strategist).
---

# Theme Application

A theme is a small, named contract: 5 to 7 colors with roles, one or two typefaces with roles, and a few rules for accents and charts. Pick or build it once, show it, get a yes, then apply it everywhere in the artifact without drifting.

## 1. Identify the artifact and its constraints

- Artifact type and format: `.pptx` (pptx-writer), `.docx` (docx), PDF (pdf), HTML or dashboard (interactive-artifacts or the project's CSS), inline charts (chart-visualizer), images.
- Hard constraints: existing brand colors or fonts (`memory` search the company or project, check BUSINESS.md via `business_context_mode` when it is company work), template files, accessibility needs, print vs screen.
- Font reality: Office files render with the viewer's installed fonts. For `.pptx` and `.docx` prefer fonts that ship with Office (Calibri, Cambria, Arial, Georgia, Segoe UI, Consolas, Bookman Old Style, Century Schoolbook) or embed. HTML can load web fonts.

## 2. Offer choices

If the user already named a theme or supplied brand values, skip to step 3.

Otherwise pick the 3 or 4 best-fitting themes from `references/theme-library.md` for this subject and audience, and present them with `ask_prometheus_questions` (single_select, one option per theme as "Name: one-line mood", plus "Custom from my brand"). If visual previews help, render a quick swatch board first (step 3) and embed it above the question.

Default taste: editorial, industrial, real-material palettes. Do not propose purple, blue, and cyan gradient "AI SaaS" schemes unless the brand requires them.

## 3. Build or confirm the theme spec

Write the chosen theme as a spec block in the working folder (`themes/<artifact-slug>.theme.md` or inline in the plan):

```
Theme: <name>
ink (primary text): #......
paper (background): #......
surface (panels, table bands): #......
accent (one emphasis color): #......
support (secondary accent): #......
muted (captions, rules, gridlines): #......
signal: positive #...... / negative #......
Display font: <family>, weight   Body font: <family>, weight
Chart series order: accent, ink, support, muted, ...
Rules: accent covers under 10 percent of any page; no gradients; rules and dividers in muted
```

For a custom theme from a brand: start from the brand's primary color as `accent`, derive ink and paper with enough contrast, add one support color from the brand or a neutral, and name the theme after what it evokes (for example "Foundry Steel"). Check contrast: body text against paper at least 4.5:1, large headings at least 3:1. Adjust lightness rather than swapping hues.

Show the spec as a swatch preview before applying when the artifact is large: a small HTML swatch page opened with `browser_session` and captured with `browser_observe` screenshot, or an SVG swatch. Get confirmation.

## 4. Apply consistently

- Map roles, not raw hex, onto the artifact: titles use display font in ink; body in body font; one accent per slide or page; tables use surface bands and muted rules; charts use the series order.
- Slides: set the master or layout colors and fonts first, then content. Documents: set heading and body styles, not per-paragraph formatting. HTML: define CSS custom properties (`--ink`, `--paper`, `--accent`, ...) and use only those. Charts: pass the series order to the chart tool.
- Replace stray colors and fonts that predate the theme. Keep logos and photography untouched.
- When editing an existing branded artifact, the existing brand wins over the library theme; only fill gaps.

## 5. Verify visually

1. Render the result: slides and docs to PDF or images through the owning skill's render path, HTML via `browser_observe` screenshot.
2. Inspect every page or slide for: off-theme colors, fallback fonts, low-contrast text on accent fills, accent overuse, charts using default palettes, and text overflow caused by the new font metrics.
3. Fix and re-render only what changed. One or two bounded passes, then stop.
4. Embed one or two rendered pages in the reply as proof, plus the theme spec.

## Guardrails

- Never alter a supplied logo's colors to match a theme.
- Do not claim a font is applied in an Office file if it will fall back on the user's machine; say so.
- Keep the theme to the spec. No extra one-off colors for "emphasis".
- Raul's taste rule: avoid purple, blue, and cyan gradient SaaS looks; prefer editorial, industrial, and physical-material palettes unless a brand dictates otherwise.

## Exit criteria

- One written theme spec with roles, hex values, fonts, and chart order.
- Every page or slide rendered and checked; contrast meets the thresholds.
- User confirmed the theme before a large application, or it came from their brand.

Lineage: inspired by anthropics theme-factory (curated theme library, show-then-choose-then-apply flow, custom theme fallback); themes and procedure are original to Prometheus.
