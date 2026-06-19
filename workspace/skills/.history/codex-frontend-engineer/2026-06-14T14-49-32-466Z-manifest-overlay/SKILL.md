---
name: codex-frontend-engineer
description: Codex-like frontend engineering workflow for Prometheus. Use when building, editing, reviewing, or repairing web apps, websites, dashboards, games, interactive tools, React/Vite interfaces, HTML/CSS/JS prototypes, responsive UI, browser-verified frontend changes, design-system alignment, or visual QA. Emphasizes real usable app surfaces, repo-native implementation, domain-appropriate design, anti-generic UI constraints, and desktop/mobile verification.
---

# Codex Frontend Engineer

Use this skill to make Prometheus behave like a hands-on frontend engineer: inspect the existing system, build the real user experience, verify it in a browser, and report only what matters.

## Core Contract

1. Inspect before building. Read package files, app structure, existing components, CSS/theme tokens, routes, and icon/UI libraries before choosing an approach.
2. Build the actual experience first. Do not default to a marketing landing page when the user asks for an app, game, tool, editor, dashboard, or workflow surface.
3. Match the domain. Operational software should be quiet, dense, scannable, and repeat-use friendly. Creative tools, games, portfolios, and editorial pages may be more expressive.
4. Prefer existing patterns. Use the repo's framework, component conventions, routing, state style, design tokens, and icon library. Add abstractions only when they remove real complexity.
5. Verify visually. Run or open the app, inspect desktop and mobile viewports, check for blank canvases, overlap, broken assets, clipped text, and layout jumps.
6. Keep the final response short. Mention the changed files, verification performed, and any residual risk.

## First Pass Checklist

Before editing, gather the smallest useful context:

```powershell
rg --files -g "package.json" -g "vite.config.*" -g "next.config.*" -g "src/**" -g "app/**" -g "pages/**" -g "components/**" -g "tailwind.config.*" -g "*.css"
```

Then inspect:

- package scripts and dependencies
- current routes/pages/components near the task
- global CSS/theme tokens
- UI libraries such as shadcn, Radix, MUI, Chakra, Headless UI, lucide, Heroicons
- examples of existing spacing, radius, table, form, modal, chart, and navigation patterns

If there is no frontend scaffold, choose the lightest viable template:

- Copy `assets/templates/vite-react-app/` for a React/Vite app.
- Copy `assets/templates/plain-html-app/` for a static single-file prototype.

## Design Defaults

### Build The Product Surface

Use the first viewport for the work itself:

- Todo app: task list, creation form, filters, status controls.
- CRM: contacts/accounts table, pipeline controls, activity panel.
- Budget tool: accounts, transactions, category controls, summaries.
- Drawing tool: canvas, tools, swatches, layers or history if expected.
- Game: playable board/scene and controls.
- Dashboard: filters, KPI strip, primary chart/table, drill-down or detail panel.

Only build a landing page when the user asks for a homepage, marketing site, product page, portfolio, venue page, launch page, or hero section.

### Domain Taste

- SaaS/admin/CRM/ops: restrained color, compact typography, clear hierarchy, tables, filters, sidebars, command bars, status chips, and dense information.
- Data/analytics: visible filters, chart legends, table fallback, units, empty/loading/error states.
- Editors/tools: toolbar with icon buttons, persistent canvas/work area, inspector/sidebar, undo/redo when natural.
- Commerce/product: real product imagery, comparison states, price/rating metadata, clear primary action.
- Games: immediate play, stable board/canvas dimensions, score/status, reset/pause, keyboard/touch controls where natural.
- Portfolio/editorial/brand: stronger imagery and typography, but still reveal the subject in the first viewport.

Read `references/domain-patterns.md` when the domain choice is ambiguous or the UI category has specific expectations.

## UI Rules

Use familiar controls:

- icon buttons for tools and repeated actions
- swatches for colors
- segmented controls for modes
- toggles or checkboxes for binary settings
- sliders, steppers, or numeric inputs for numbers
- menus/selects/comboboxes for option sets
- tabs for major views
- text or icon+text buttons for clear commands

Prefer the existing icon library. If none exists and this is React, use `lucide-react` when available or add it only if package policy allows. Add labels or tooltips for icon-only controls whose meaning is not obvious.

Avoid:

- generic "Unlock your potential" hero copy
- card soup, nested cards, and every section floating in a rounded rectangle
- visible in-app text explaining how the UI works when labels and layout can do it
- one-note purple gradients, beige/tan washes, dark slate-only dashboards, and brown/orange default palettes
- negative letter spacing and viewport-width font scaling
- text that clips, overlaps, or relies on one screenshot width
- blank decorative canvases or abstract graphics when the subject itself should be visible

Read `references/frontend-principles.md` for the full anti-generic quality bar and `references/visual-quality-rubric.md` before final QA.

## Implementation Rules

- Keep edits scoped to the requested surface and nearby shared components.
- Use real data structures and state transitions, not inert mock panels, unless the user asked for a static mockup.
- Implement expected states: empty, loading, error, selected, disabled, hover/focus, and responsive layout when relevant.
- Use semantic HTML for forms, buttons, nav, tables, dialogs, and landmarks.
- Keep fixed-format UI stable with `aspect-ratio`, grid tracks, min/max sizes, and predictable toolbar/button dimensions.
- Use assets when the subject is visual. Product/place/person/game pages should show the product/place/person/gameplay.
- For known rules engines, use libraries rather than fragile hand-rolled logic when feasible.
- For 3D, prefer Three.js, keep the primary scene full-bleed or intrinsic to the experience, and verify the canvas is nonblank.

## Verification

Run the repo's natural checks when available:

```powershell
npm run lint
npm run typecheck
npm run test
npm run build
```

Run only scripts that exist. If a dev server is needed, start it and open the local URL in the browser. Verify at least:

- desktop around 1366x768 or 1440x900
- mobile around 390x844
- no overlap, clipping, broken assets, horizontal scroll, or unreadable contrast
- primary interaction works
- console has no relevant runtime errors

Use `scripts/frontend_static_audit.py <path>` for a quick static scan of CSS/HTML/JS anti-patterns. It is not a replacement for browser QA.

Read `references/verification-playbook.md` for browser and screenshot procedure.

## Resource Map

- `references/frontend-principles.md`: detailed frontend behavior and visual standards.
- `references/domain-patterns.md`: domain-specific defaults for apps, tools, dashboards, games, landing pages, and 3D.
- `references/verification-playbook.md`: local server, viewport, interaction, and screenshot checks.
- `references/visual-quality-rubric.md`: final review rubric.
- `examples/build-dashboard.md`: example request-to-execution flow for an operational dashboard.
- `examples/repair-existing-app.md`: example for improving an existing UI without fighting the repo.
- `examples/game-or-3d.md`: example for interactive/canvas/Three.js work.
- `assets/templates/vite-react-app/`: minimal React/Vite app template with a practical dashboard surface.
- `assets/templates/plain-html-app/`: static HTML app template for quick prototypes.
- `scripts/frontend_static_audit.py`: static scan for common generated-UI smells.
