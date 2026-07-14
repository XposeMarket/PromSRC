# Frontend Principles

## Build the Working Surface

Default to the thing the user can use immediately. A request for an app, tool, dashboard, game, editor, calculator, or workflow should open on that working surface, not a marketing explanation of it.

Use marketing structure only when the requested artifact is a homepage, landing page, launch page, portfolio, product page, brand page, or venue/person page.

## Inspect and Conform

Before changing UI, identify:

- framework and routing model
- component library and form/table/dialog primitives
- icon library
- CSS approach: global CSS, modules, Tailwind, CSS-in-JS, design tokens
- existing density, radius, spacing, typography, and color conventions
- natural verification commands

If the repo already has a design system, use it even if a fresh design would be more fun. Coherence beats novelty.

## Controls

Use standard controls for standard concepts:

- Tool/action: icon button with accessible label and tooltip if unclear.
- Binary setting: toggle or checkbox.
- Exclusive mode: segmented control or radio group.
- Numeric continuous value: slider plus readout or numeric input.
- Numeric exact value: stepper or input.
- Color: swatch grid or color input.
- Option set: select, menu, combobox, or tabs depending on scope.
- View switch: tabs.
- Confirmation/destructive action: dialog or clearly staged button.

Avoid inventing decorative control shapes when platform conventions exist.

## Layout

Use cards only for repeated items, modals, contained tools, and genuinely grouped records. Avoid nesting cards inside cards. Page regions can be unframed layouts, split panes, table regions, sidebars, or full-width bands.

Keep app surfaces stable:

- define grid tracks with `minmax()` and explicit gaps
- set icon button sizes
- set board/canvas aspect ratios
- prevent toolbar wrapping from changing canvas dimensions
- constrain long labels with wrapping or ellipsis where appropriate
- test narrow widths with real labels

## Typography

Match type scale to context:

- hero-scale type only for real heroes
- compact headings inside panels, sidebars, tables, cards, and tools
- no negative letter spacing
- no font-size based directly on viewport width
- avoid all-caps paragraphs
- keep line length readable

Prefer system fonts or the repo's existing font stack unless the task is explicitly brand/editorial.

## Color

Choose color for hierarchy and task clarity, not decoration.

Avoid defaulting to:

- purple/blue-purple gradient SaaS
- beige/cream/sand/tan lifestyle wash
- dark blue/slate-only dashboard
- brown/orange/espresso
- single-hue palettes with only light/dark variants

Use semantic colors consistently for success, warning, danger, info, selected, disabled, and focus states.

## Assets

When a page is about a product, place, person, artwork, physical object, or game, show the subject clearly. Do not hide behind blurred stock imagery, abstract gradients, or decorative vector shapes.

For games and interactive tools, use assets that make the state readable. Simple SVG/canvas shapes are acceptable when they are game objects or controls, not placeholder decoration.

## Interaction

Make the primary workflow real:

- buttons should do something visible
- filters should affect visible data
- selection should update detail panes
- forms should validate or update state
- reset/undo should work where expected
- keyboard and focus behavior should not be broken

Static mockups are acceptable only when explicitly requested.

## Copy

Use copy that belongs inside the product. Avoid explanatory filler such as "Use the sidebar to navigate" when labels and affordances can carry the interaction.

For landing pages, make the H1 the product, brand, person, place, or literal offer/category. Put value proposition in supporting copy.

## Accessibility Baseline

- Use real buttons and inputs.
- Provide labels for icon-only controls.
- Keep focus visible.
- Preserve keyboard reachability.
- Use sufficient contrast for text and controls.
- Use table markup for tabular data.
- Respect reduced motion for nonessential animation when practical.

## Common Generated-UI Smells

- dashboard made entirely of oversized cards with no dense work area
- landing page for an app request
- feature cards describing unavailable features
- purple gradient background plus glass panels
- icons drawn manually despite an icon library
- canvas or 3D area that renders blank
- responsive layout only tested at one desktop size
- text clipping inside buttons or stat cards
- "beautiful" redesign that removes core functionality
