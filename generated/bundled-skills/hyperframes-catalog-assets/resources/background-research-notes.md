# Background Research Notes — HyperFrames Catalog

Collected by Prometheus background agents on 2026-05-05 while inspecting `https://hyperframes.heygen.com/catalog`, official docs, and GitHub registry.

## Social / Data / Effects / Blocks details

### Social Overlays

| Name | Slug | Category | Type | Dimensions | Duration | Files | Install / Usage | Prometheus Creative mapping |
|---|---:|---|---|---:|---:|---|---|---|
| Instagram Follow | `instagram-follow` | Social Overlays | `hyperframes:block` | 1080×1920 | 4.5s | `instagram-follow.html` → `compositions/instagram-follow.html`; `assets/avatar.jpg` | `npx hyperframes add instagram-follow`; host as composition with `data-composition-id="instagram-follow"` | Reusable vertical social-follow overlay/template; map to Creative Video social profile follow card preset with editable avatar, handle, profile stats, CTA button. |
| macOS Notification | `macos-notification` | Social Overlays | `hyperframes:block` | 1920×1080 | 5s | `macos-notification.html` → `compositions/macos-notification.html` | `npx hyperframes add macos-notification`; composition embed | Reusable desktop notification overlay; map to Creative Video system notification / alert banner asset for demos, product videos, automations. |
| Reddit Post Card | `reddit-post` | Social Overlays | `hyperframes:block` | 1920×1080 | 5s | `reddit-post.html` → `compositions/reddit-post.html` | `npx hyperframes add reddit-post`; composition embed | Reusable Reddit/social-proof card; map to forum post/comment card template with editable title, body, upvotes, comments. |
| Spotify Now Playing | `spotify-card` | Social Overlays | `hyperframes:block` | 1080×1920 | 5s | `spotify-card.html` → `compositions/spotify-card.html` | `npx hyperframes add spotify-card`; composition embed | Reusable vertical music/audio card; map to now playing / podcast / audio card visual component with album art, progress bar. |
| TikTok Follow | `tiktok-follow` | Social Overlays | `hyperframes:block` | 1080×1920 | 4.5s | `tiktok-follow.html` → `compositions/tiktok-follow.html`; `assets/avatar.jpg` | `npx hyperframes add tiktok-follow`; composition embed | Reusable vertical TikTok creator CTA; map to shorts/reels follow card preset with editable creator avatar, handle, follow CTA. |
| X Post Card | `x-post` | Social Overlays | `hyperframes:block` | 1920×1080 | 5s | `x-post.html` → `compositions/x-post.html` | `npx hyperframes add x-post`; composition embed | Reusable tweet/X post overlay; map to Creative X post card template with editable author, body, metrics, verified/icon slots. |
| YouTube Lower Third | `yt-lower-third` | Social Overlays | `hyperframes:block` | 1920×1080 | 4.5s | `yt-lower-third.html` → `compositions/yt-lower-third.html`; `assets/avatar.jpg` | `npx hyperframes add yt-lower-third`; composition embed | Reusable YouTube subscribe lower-third; map to creator/channel lower-third overlay with avatar, channel, subscribe CTA. |

### Data

| Name | Slug | Type | Dimensions | Duration | Files | Mapping |
|---|---|---|---:|---:|---|---|
| Data Chart | `data-chart` | `hyperframes:block` | 1920×1080 | 15s | `data-chart.html` → `compositions/data-chart.html` | Animated chart scene/template with editable series, labels, value callouts, NYT-style typography. |

### Effects

| Name | Slug | Type | Files | Mapping |
|---|---|---|---|---|
| Grain Overlay | `grain-overlay` | `hyperframes:component` | `grain-overlay.html` → `compositions/components/grain-overlay.html` | Film grain/noise texture overlay with opacity/blend controls. |
| Grid Pixelate Wipe | `grid-pixelate-wipe` | `hyperframes:component` | `grid-pixelate-wipe.html` → `compositions/components/grid-pixelate-wipe.html` | Grid/tile pixel wipe transition primitive. |
| Shimmer Sweep | `shimmer-sweep` | `hyperframes:component` | `shimmer-sweep.html` → `compositions/components/shimmer-sweep.html` | Premium shimmer sweep for headings, cards, CTAs, AI accents. |

### Blocks

| Name | Slug | Type | Dimensions | Duration | Files | Mapping |
|---|---|---|---:|---:|---|---|
| Flowchart | `flowchart` | `hyperframes:block` | 1920×1080 | 12s | `flowchart.html` → `compositions/flowchart.html` | Animated flowchart/process/decision-tree template with nodes, connectors, cursor/typing interaction. |
| Logo Outro | `logo-outro` | `hyperframes:block` | 1920×1080 | 6s | `logo-outro.html` → `compositions/logo-outro.html` | Logo reveal/outro template with editable logo asset, tagline, glow, URL pill. |

## Transition catalog details

### Shader transitions

All confirmed shader transition catalog blocks share Type `Block`, Dimensions `1920×1080`, Duration `4s`, file target `compositions/<slug>.html`, install command `npx hyperframes add <slug>`.

| Name | Slug | Style notes | Prometheus mapping |
|---|---|---|---|
| Chromatic Radial Split | `chromatic-radial-split` | Chromatic aberration radial split / RGB separation from center. | RGB/radial WebGL/canvas transition. |
| Cinematic Zoom | `cinematic-zoom` | Dramatic radial zoom blur with chromatic fringing. | Hero reveal zoom-blur transition. |
| Cross Warp Morph | `cross-warp-morph` | Cross-warped morphing / noise blend between scenes. | Premium morph transition. |
| Domain Warp Dissolve | `domain-warp-dissolve` | Fractal noise domain warping, organic glowing edge. | Organic/noise dissolve transition. |
| Flash Through White | `flash-through-white` | White flash crossfade / overexposed handoff. | Camera-flash/launch beat transition. |
| Glitch | `glitch` | Digital glitch artifacts, displacement, scanlines. | Cyber/terminal glitch transition. |
| Gravitational Lens | `gravitational-lens` | Gravity-well lensing with chromatic aberration. | Lens-warp scene transition. |
| Light Leak | `light-leak` | Warm cinematic light leak overlay. | Cinematic analog transition/overlay. |
| Ridged Burn | `ridged-burn` | Ridged turbulence burn with sparks/heat glow. | Destructive hero burn transition. |
| Ripple Waves | `ripple-waves` | Concentric ripple wave distortion. | Water/ripple distortion transition. |
| SDF Iris | `sdf-iris` | SDF circular iris reveal with glowing ring. | Iris reveal transition. |
| Swirl Vortex | `swirl-vortex` | Spiral rotation and noise warping. | Vortex transition. |
| Thermal Distortion | `thermal-distortion` | Heat haze / thermal warping. | Heat shimmer transition/effect. |
| Whip Pan | `whip-pan` | Fast camera pan with directional motion blur. | Editorial whip-pan transition. |

Important guardrail from upstream: do not mix CSS and shader transitions in the same HyperFrames composition without a deliberate adapter, because shader transitions capture DOM scenes to WebGL textures.

### CSS transition showcase blocks

| Name | Slug | Duration | Notes |
|---|---|---:|---|
| 3D Transitions | `transitions-3d` | 11s | Perspective flip/rotate transition pack. |
| Blur Transitions | `transitions-blur` | 20s | Blur-through, directional blur, focus pull ideas. |
| Cover Transitions | `transitions-cover` | 21s | Cover/uncover panels and blinds. |
| Destruction Transitions | `transitions-destruction` | 14s | Break-apart/page burn style. |
| Dissolve Transitions | `transitions-dissolve` | 24s | Crossfade, blur crossfade, focus pull, color dip. |
| Distortion Transitions | `transitions-distortion` | 21s | Glitch, chromatic, ripple, VHS-like patterns. |
| Grid Transitions | `transitions-grid` | 11s | Grid/tile dissolves. |
| Light Transitions | `transitions-light` | 21s | Glow, flash, light leak, film burn. |
| Mechanical Transitions | `transitions-mechanical` | 15s | Shutter and iris motions. |
| Other Transitions | `transitions-other` | 20s | Gravity drop, morph circle, miscellaneous. |
| Push Transitions | `transitions-push` | 24s | Push/slide/squeeze/elastic push. |
| Radial Transitions | `transitions-radial` | 20s | Circle iris, diamond iris, diagonal split. |
| Scale Transitions | `transitions-scale` | 15s | Zoom-through and zoom-out. |

### CSS transition recipes to extract into Prometheus presets

- Push Slide, Vertical Push, Elastic Push, Squeeze
- Circle Iris, Diamond Iris, Diagonal Split
- 3D Card Flip
- Zoom Through, Zoom Out
- Crossfade, Blur Crossfade, Focus Pull, Color Dip
- Staggered Color Blocks, Horizontal Blinds, Vertical Blinds
- Light Leak, Overexposure Burn, Film Burn
- Glitch, Chromatic Aberration, Ripple, VHS Tape
- Shutter, Clock Wipe
- Grid Dissolve
- Gravity Drop, Morph Circle
- Blur Through, Directional Blur
- Page Burn

## GitHub registry/source structure

Registry root:

```text
https://raw.githubusercontent.com/heygen-com/hyperframes/main/registry
```

Top manifest:

```text
https://raw.githubusercontent.com/heygen-com/hyperframes/main/registry/registry.json
```

Structure:

```text
registry/
├── registry.json
├── blocks/<slug>/registry-item.json + <slug>.html
├── components/<slug>/registry-item.json + <slug>.html + demo.html
└── examples/<slug>/registry-item.json + starter files
```

Examples listed in top manifest, installed by `hyperframes init --example <slug>`:

- `warm-grain`
- `play-mode`
- `swiss-grid`
- `vignelli`
- `decision-tree`
- `kinetic-type`
- `product-promo`
- `nyt-graph`

Repo directory observed but not in fetched top-level registry manifest: `registry/blocks/flowchart-vertical/`. Treat as repo-available but possibly not catalog-indexed/installable unless the top-level registry later includes it.

Preview image pattern:

```text
https://static.heygen.ai/hyperframes-oss/docs/images/catalog/<blocks|components>/<slug>.png
```

## Immediate high-value Prometheus imports

Most useful for Prometheus launch/demo work:

- `app-showcase`
- `ui-3d-reveal`
- `logo-outro`
- `data-chart`
- `flowchart`
- `x-post`
- `macos-notification`
- `yt-lower-third`
- `grain-overlay`
- `shimmer-sweep`
- `cinematic-zoom`
- `glitch`
- `chromatic-radial-split`
- `cross-warp-morph`
- `light-leak`
- `transitions-blur`
- `transitions-push`
- `transitions-scale`
