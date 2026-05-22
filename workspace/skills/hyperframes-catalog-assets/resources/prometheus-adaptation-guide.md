# Prometheus Adaptation Guide for HyperFrames Catalog Items

## Core conversion

HyperFrames and Prometheus both favor HTML/CSS/JS motion, but Prometheus Creative Mode owns the runtime. Convert, do not blindly embed.

### Blocks → Prometheus templates

A HyperFrames block is usually a self-contained sub-composition. In Prometheus, turn it into one of:

- HTML Motion block/template
- scene preset
- reusable intro/outro/showcase template
- transition preset if it exists only to demonstrate a transition

Preserve:
- dimensions
- duration
- visual style
- editable text/media layers
- timing beats

Change:
- external asset paths → `{{asset.id}}`
- HyperFrames-specific data attributes → Prometheus HTML Motion-compatible metadata where needed
- hardcoded brand/user data → configurable placeholders

### Components → Prometheus effect snippets

A component is an effect snippet. Convert it into:

- overlay effect snippet
- CSS/JS utility layer
- transition helper
- reusable element preset

Examples:
- `grain-overlay` → global film grain layer
- `shimmer-sweep` → text/card highlight animation
- `grid-pixelate-wipe` → scene transition effect

### Transition packs

The CSS transition pages are showcases, not single transitions. Treat each as a pack to mine for motion patterns:

- `transitions-3d`: flip, rotate, perspective
- `transitions-blur`: blur/focus shifts
- `transitions-cover`: cover/uncover panels
- `transitions-destruction`: break/shatter/debris
- `transitions-dissolve`: opacity/noise dissolves
- `transitions-distortion`: warped transforms
- `transitions-grid`: tiled reveals
- `transitions-light`: glow/flash/light leaks
- `transitions-mechanical`: shutter/iris/mechanical gates
- `transitions-push`: push/slide scenes
- `transitions-radial`: radial wipes
- `transitions-scale`: zoom/scale reveals

### Shader transitions

Shader transition blocks are strongest as design references. For Prometheus:

- Prefer native Creative Mode animation/search/template systems first.
- If implementing as HTML Motion, ensure deterministic seek behavior.
- Keep a CSS/SVG fallback if WebGL/shader support is unreliable.
- Visually QA first/mid/end transition frames.

## Exact source fetch examples

Fetch metadata:

```text
https://raw.githubusercontent.com/heygen-com/hyperframes/main/registry/blocks/data-chart/registry-item.json
```

Fetch block HTML:

```text
https://raw.githubusercontent.com/heygen-com/hyperframes/main/registry/blocks/data-chart/data-chart.html
```

Fetch component HTML:

```text
https://raw.githubusercontent.com/heygen-com/hyperframes/main/registry/components/shimmer-sweep/shimmer-sweep.html
```

## Naming convention inside Prometheus

Suggested Prometheus asset/template IDs:

```text
hf-block-{slug}
hf-component-{slug}
hf-transition-{slug}
hf-showcase-{slug}
```

Examples:

- `hf-block-x-post`
- `hf-component-shimmer-sweep`
- `hf-transition-whip-pan`
- `hf-showcase-ui-3d-reveal`

## QA checklist before saving a converted item

- [ ] No absolute Windows paths.
- [ ] No external network assets unless explicitly approved.
- [ ] Text layers remain editable.
- [ ] Logos/images use Prometheus imported assets / placeholders.
- [ ] Timing is deterministic and seek-safe.
- [ ] First/mid/end frames render correctly.
- [ ] Component does not hide or contaminate unrelated layers.
- [ ] The output documents which upstream slug inspired it.
