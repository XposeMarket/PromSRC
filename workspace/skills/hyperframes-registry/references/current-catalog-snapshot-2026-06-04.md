# Current HyperFrames Catalog Snapshot — 2026-06-04

Source: `https://raw.githubusercontent.com/heygen-com/hyperframes/main/registry/registry.json` fetched by Prometheus on 2026-06-04.

Use this as a fast local routing map before hand-authoring from scratch. For live/current details, still run registry discovery or `npx hyperframes catalog` when possible.

## Examples

- `warm-grain`
- `play-mode`
- `swiss-grid`
- `vignelli`
- `decision-tree`
- `kinetic-type`
- `product-promo`
- `nyt-graph`

Use with `npx hyperframes init <dir> --example <name>`.

## Data / maps / diagrams

- `data-chart`
- `us-map`
- `us-map-bubble`
- `us-map-hex`
- `us-map-flow`
- `world-map`
- `spain-map`
- `flowchart`
- `flowchart-vertical`

## Social / product UI blocks

- `instagram-follow`
- `tiktok-follow`
- `yt-lower-third`
- `x-post`
- `reddit-post`
- `spotify-card`
- `macos-notification`
- `app-showcase`

## Commercial/story blocks

- `logo-outro`
- `north-korea-locked-down`
- `apple-money-count`
- `vpn-youtube-spot`
- `blue-sweater-intro-video`
- `nyc-paris-flight`
- `ui-3d-reveal`

## Caption components

Catalog-first for captions. Install with `npx hyperframes add <component>` and wire as overlay/snippet per CLI output.

- `caption-pill-karaoke`
- `caption-neon-accent`
- `caption-weight-shift`
- `caption-emoji-pop`
- `caption-editorial-emphasis`
- `caption-parallax-layers`
- `caption-glitch-rgb`
- `caption-matrix-decode`
- `caption-particle-burst`
- `caption-texture`
- `caption-clip-wipe`
- `caption-kinetic-slam`
- `caption-gradient-fill`
- `caption-neon-glow`
- `caption-highlight`
- `caption-blend-difference`

Routing defaults:

- editorial/doc/storytelling → `caption-editorial-emphasis` or `caption-weight-shift`
- social/high-energy → `caption-highlight`, `caption-pill-karaoke`, or `caption-kinetic-slam`
- tech/glitch → `caption-glitch-rgb` or `caption-matrix-decode`
- cinematic depth → `caption-parallax-layers`
- playful → `caption-emoji-pop`
- dramatic texture → `caption-texture`

## Texture / overlay components

- `grain-overlay`
- `shimmer-sweep`
- `grid-pixelate-wipe`
- `texture-mask-text`
- `vignette`
- `parallax-zoom`
- `parallax-unzoom`

## Transitions / VFX blocks

Standalone specific transitions:

- `domain-warp-dissolve`
- `ridged-burn`
- `whip-pan`
- `sdf-iris`
- `ripple-waves`
- `gravitational-lens`
- `cinematic-zoom`
- `chromatic-radial-split`
- `glitch`
- `swirl-vortex`
- `thermal-distortion`
- `flash-through-white`
- `cross-warp-morph`
- `light-leak`

Transition packs:

- `transitions-3d`
- `transitions-blur`
- `transitions-cover`
- `transitions-destruction`
- `transitions-dissolve`
- `transitions-distortion`
- `transitions-grid`
- `transitions-light`
- `transitions-mechanical`
- `transitions-other`
- `transitions-push`
- `transitions-radial`
- `transitions-scale`

Use transitions only when the frame direction justifies them. Do not add shader/VFX transitions just to look busy.

## VFX / device / liquid glass

- `vfx-text-cursor`
- `vfx-liquid-background`
- `vfx-iphone-device`
- `vfx-magnetic`
- `vfx-portal`
- `vfx-shatter`
- `vfx-liquid-glass`
- `liquid-glass-notification`
- `liquid-glass-context-menu`
- `liquid-glass-media-controls`
- `liquid-glass-widgets`
- `ios26-liquid-glass`
- `macos-tahoe-liquid-glass`

Raul-specific taste note: liquid glass / purple-blue SaaS / glossy rounded-card language can become an AI tell fast. Use only when the requested style actually calls for it.

## Code snippet blocks

Apple Terminal themes:

- `code-snippet-apple-terminal-basic`
- `code-snippet-apple-terminal-clear-dark`
- `code-snippet-apple-terminal-clear-light`
- `code-snippet-apple-terminal-grass`
- `code-snippet-apple-terminal-homebrew`
- `code-snippet-apple-terminal-man-page`
- `code-snippet-apple-terminal-novel`
- `code-snippet-apple-terminal-ocean`
- `code-snippet-apple-terminal-pro`
- `code-snippet-apple-terminal-red-sands`
- `code-snippet-apple-terminal-silver-aerogel`
- `code-snippet-apple-terminal-solid-colors`

VS/editor themes:

- `code-snippet-dark-2026`
- `code-snippet-dark-modern`
- `code-snippet-dark-plus`
- `code-snippet-high-contrast`
- `code-snippet-high-contrast-light`
- `code-snippet-light-2026`
- `code-snippet-light-modern`
- `code-snippet-light-plus`
- `code-snippet-monokai`
- `code-snippet-solarized-light`
- `code-snippet-visual-studio-dark`
- `code-snippet-visual-studio-light`

## Agent rule

Before hand-authoring any of these categories, check whether a catalog item can carry the job:

- captions;
- social posts/lower thirds/follow widgets;
- maps/charts/flowcharts;
- code snippets;
- app/device showcases;
- logo outros;
- transitions/VFX.

If a catalog item is used, install it with `npx hyperframes add <name>`, wire it using the printed snippet and the registry skill, then run lint + inspect + export verification.
