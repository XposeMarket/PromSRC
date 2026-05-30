# Domain Patterns

## Operational SaaS, CRM, Admin, Internal Tools

Default structure:

- left nav or top command bar
- compact KPI strip when useful
- primary table/list/board
- filters/search/sort visible near the data
- detail drawer/panel for selected item
- status chips and timestamps
- bulk actions when list selection exists

Style:

- restrained palette
- 4-8px radii
- thin borders over heavy shadows
- compact type
- clear hover/focus/selected states

## Analytics and Dashboards

Expected pieces:

- date range or segment filters
- KPI row with units and deltas
- primary chart with labels/legend
- table or breakdown underneath
- empty/loading/error states
- source or freshness timestamp when relevant

Avoid pure chart decoration. Make the metrics inspectable.

## Editors and Creative Tools

Expected pieces:

- toolbar with icon buttons
- canvas or working area
- inspector/sidebar for properties
- swatches or sliders for visual controls
- layers/history/undo where natural
- stable canvas dimensions

Prioritize interaction density over explanatory prose.

## Games

Expected pieces:

- playable board/scene first
- score/state/timer
- reset/pause/new game
- clear rules in controls or concise modal only if needed
- keyboard/touch support when natural
- deterministic state updates

Use proven rules or physics libraries for established domains. Do not hand-roll chess, poker, physics collisions, parsing, or pathfinding unless the user explicitly asks.

## 3D and Canvas

Expected pieces:

- full-bleed or intrinsically framed scene, not a decorative preview card
- camera/object framing that works at desktop and mobile sizes
- nonblank initial frame
- real animation or interaction
- resize handling
- canvas pixel check or screenshot verification

Use Three.js for 3D unless the repo already has another 3D stack.

## Commerce and Product Surfaces

Expected pieces:

- real product imagery
- price/rating/availability when relevant
- comparison or variant controls
- primary action
- trust/return/shipping details when useful
- card lists only for repeated products

The product must be visible in the first viewport.

## Landing Pages and Heroes

Use only when the request is actually marketing/brand/presence.

Hero rules:

- H1 is the brand/product/place/person name or literal offer/category.
- Supporting copy carries the value proposition.
- Use a relevant image, generated bitmap, product shot, place photo, or immersive real scene.
- Do not put hero text inside a card.
- Do not use split text/media card compositions by default.
- Leave a hint of the next section visible on common mobile and desktop viewports.

## Portfolios and Editorial

Expected pieces:

- subject/person/work visible in the first viewport
- project/work grid or article surface
- strong typography with readable body text
- navigation that supports exploration
- media with stable aspect ratios

Expression is welcome, but the work still needs to be inspectable.
