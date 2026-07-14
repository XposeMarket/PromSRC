---
name: "hyperframes-catalog-assets"
description: "Find, inspect, import, and adapt verified official HyperFrames registry blocks and components into Prometheus Creative Mode. Use for explicit catalog asset, registry source, reusable scene, or HyperFrames component requests; do not invoke for ordinary video creation."
---

# HyperFrames Catalog Assets

Use this skill when the user explicitly asks Prometheus to reuse, adapt, browse, import, or build from official HyperFrames catalog components.

## What this skill contains

This bundle indexes the official HyperFrames catalog at `https://hyperframes.heygen.com/catalog` and the upstream registry at `https://github.com/heygen-com/hyperframes/tree/main/registry`.

Read resources in this order:

1. `resources/catalog-manifest.json` — offline snapshot of all catalog items, slugs, categories, official docs, raw registry paths, type, descriptions, durations/dimensions where known, and Prometheus reuse mapping. Check `source.capturedAt`; when freshness matters, compare it with `hyperframes catalog --json` and refresh with `node scripts/refresh-manifest.mjs`.
2. `resources/prometheus-adaptation-guide.md` — how to adapt HyperFrames blocks/components into Prometheus Creative Mode / HTML Motion.
3. `resources/category-map.md` — quick category index.

## Prometheus-native rule

HyperFrames is the primary video model in Prometheus Creative Mode. Treat the official registry as reusable HyperFrames source, not as a loose inspiration library to be flattened into old HTML Motion.

For Prometheus work:

- Blocks stay HyperFrames-native whenever possible.
- Components become nested HyperFrames components, overlays, effects, or declared editable slots.
- Shader/CSS transition blocks become HyperFrames transition recipes/presets.
- Showcases become higher-level HyperFrames story templates.
- Social overlays become editable HyperFrames cards/lower thirds with variables or `data-prom-slot-*` metadata.

Use Prometheus Creative Mode as the orchestration layer: import catalog source, ingest assets/fonts/audio/video, rewrite paths to Prometheus-safe asset placeholders, preserve nested composition structure, expose layers/slots/variables, lint with HyperFrames core, preview with the official runtime/player contract, and export with `@hyperframes/producer` where possible.

## Official source patterns

Registry item metadata:

```text
https://raw.githubusercontent.com/heygen-com/hyperframes/main/registry/{blocks|components}/{slug}/registry-item.json
```

Raw block HTML:

```text
https://raw.githubusercontent.com/heygen-com/hyperframes/main/registry/blocks/{slug}/{slug}.html
```

Raw component HTML:

```text
https://raw.githubusercontent.com/heygen-com/hyperframes/main/registry/components/{slug}/{slug}.html
```

Docs page:

```text
https://hyperframes.mintlify.app/catalog/{blocks|components}/{slug}.md
```

Catalog page:

```text
https://hyperframes.heygen.com/catalog/{blocks|components}/{slug}
```

## Workflow for reuse

1. Look up the item in `catalog-manifest.json`. If the user asks for the latest registry or the snapshot is stale, refresh it first; never silently assume the bundled count is current.
2. Fetch the official raw HTML/registry metadata if exact source is needed.
3. Import source as native HyperFrames HTML and preserve nested composition boundaries.
4. Replace remote/local file paths with Prometheus assets and `{{asset.id}}` placeholders.
5. Add explicit variables or `data-prom-slot-*` metadata for advanced editable blocks.
6. Run HyperFrames lint, preview snapshots, and producer export QA before claiming it is reusable/export-ready.

## Important adaptation boundary

Do not blindly copy external runtime dependencies into Prometheus. If upstream uses GSAP, shaders, CSS keyframes, Lottie, Three.js, or media assets, keep the HyperFrames contract intact but make dependencies local, deterministic, seek-driven, and asset-safe. Document any dependency or asset substitutions in the output.
