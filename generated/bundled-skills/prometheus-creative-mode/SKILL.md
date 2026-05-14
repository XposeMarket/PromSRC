---
name: prometheus-creative-mode
description: HyperFrames-first Prometheus Creative Mode front door for editable video canvas work, HTML-in-motion editing, HyperFrames compositions, catalog blocks, media analysis, Pretext text flow, deterministic animation adapters, QA, and export.
metadata:
  short-description: HyperFrames-first Creative Mode with Prometheus editability, QA, assets, and export
---

# Prometheus Creative Mode

This is the single active entry point for Creative Mode video work in Prometheus.

The goal is HyperFrames-first authoring with Prometheus-grade editability. HyperFrames is the main composition model: HTML is the source of truth, `data-*` attributes define timeline structure, media is declarative, GSAP/runtime adapters provide deterministic motion, and nested compositions make blocks reusable. Prometheus wraps that model with editable layers, asset placeholders, patch operations, timeline UI, snapshots, QA, and export.

HTML Motion is not a rival runtime. Treat it as Prometheus' editable compatibility layer around HyperFrames: the same HTML remains inspectable, patchable, selectable, asset-safe, and exportable inside Prometheus.

## Default Route

For video work, author real HyperFrames-compatible compositions and keep them editable in Prometheus.

1. Switch into editable Video Creative Mode with `switch_creative_mode({ mode: "video", reason, initialIntent })`.
2. Use HyperFrames structure as the default: root `data-composition-id`, `data-width`, `data-height`, timed clips, `data-track-index`, and deterministic runtime seeking.
3. Import or analyze user media when supplied, then reference it through Prometheus asset placeholders or local project assets that Prometheus can serve.
4. Prefer reusable HyperFrames catalog blocks/components when they fit, then adapt them into Prometheus-editable slots/layers.
5. Preserve source HTML as the edit source of truth.
6. Extract editable layers, variables, and slots for the Prometheus inspector.
7. Patch through HyperFrames-aware operations whenever possible; raw string edits are fallback only.
8. Lint with HyperFrames core plus Prometheus asset/text/QA checks.
9. Sample early, middle, and near-end frames.
10. Export through the best available Prometheus/HyperFrames-compatible path.

## HyperFrames Contract

New clips should follow the real HyperFrames rules:

- Every composition has a root/stage element, preferably `id="stage"`, with `data-composition-id`, `data-width`, and `data-height`.
- Use seconds for native HyperFrames timing: `data-start="0"`, `data-duration="5"`, `data-media-start="2"`.
- Use `data-track-index` for timeline order and z-order; same-track clips should not overlap.
- Add `class="clip"` to timed visible non-media elements so the runtime can manage visibility.
- Do not add `class="clip"` to `<video>` elements; HyperFrames manages video visibility/playback directly.
- Do not manually call `video.play()`, `video.pause()`, set media `currentTime`, or mount/unmount clips from script.
- Register GSAP timelines on `window.__timelines["composition-id"]`, matching the composition id.
- Use `data-composition-src` and `<template>` files for reusable nested compositions.
- Use `data-composition-variables` and `data-variable-values` for typed editable parameters.

Prometheus can accept older HTML Motion timing (`ms`, `prometheus-html-motion-seek`, stage metadata) as compatibility input, but new work should stay as close as possible to native HyperFrames and then expose Prometheus edit handles around it.

## Editability Model

Prometheus should not flatten sophisticated HyperFrames blocks into brittle DOM guesses. Use three editability tiers:

- Direct layers: simple text, image, video, audio, and composition elements parsed by `@hyperframes/core`.
- Slots: advanced blocks expose `data-prom-slot-text`, `data-prom-slot-asset`, `data-prom-slot-color`, `data-prom-slot-number`, `data-prom-slot-timing`, or `data-prom-slot-variable`.
- Opaque advanced blocks: GSAP-heavy, canvas, WebGL, Lottie, shader, and deeply nested blocks remain source-preserving, with edits routed only through declared variables/slots.

If a reusable block needs future editing, add explicit variables or slots instead of relying on visual selection alone.

## Core Runtime Stack

Use local HyperFrames packages already installed in Prometheus:

- `@hyperframes/core`: parse HTML, extract metadata, generate HTML, lint, validate, compile timing, inject runtime, work with variables.
- `@hyperframes/player`: useful reference for iframe playback, controls, ready events, and mobile audio proxy behavior.
- `@hyperframes/producer`: preferred export path for real HyperFrames renders, including frame capture, media probing, audio muxing, nested composition resolution, shader/canvas/Lottie handling, and final encoding.
- `@hyperframes/engine`: underlying seekable page-to-video capture contract: pages must expose `window.__hf = { duration, seek }`, normally via the official runtime/player bridge.
- `@hyperframes/studio`: reference/editor integration surface for variables, catalog blocks, and composition editing behavior.
- Prometheus bridge files: `src/gateway/creative/hyperframes-bridge.ts`, `hyperframes-catalog.ts`, `hyperframes-producer.ts`, `hyperframes-export-adapter.ts`, and `hyperframes-qa.ts`.

Prefer official HyperFrames core APIs over regex parsing for edits that map to the schema.

## Routing Rules

For HyperFrames-specific details, prefer the official installed skills in `.agents/skills`:

- `hyperframes`: primary HTML composition authoring, timing, variables, nested comps, captions, audio-reactive visuals, transitions, and motion quality.
- `hyperframes-cli`: `npx hyperframes` init/lint/inspect/preview/render/doctor/info flows.
- `hyperframes-media`: TTS, transcription, background removal, and media preprocessing.
- `hyperframes-registry`: `hyperframes add`, block/component files, nested composition wiring, registry discovery.
- `website-to-hyperframes`: website capture and website-to-video pipeline.
- `remotion-to-hyperframes`: Remotion migration only.
- `gsap`, `animejs`, `css-animations`, `lottie`, `three`, `waapi`, `tailwind`: deterministic adapter-specific authoring.

Use `references/legacy-skills/` only as Prometheus historical context or when an official installed skill is unavailable:

- `prometheus-hyperframes-bridge`: Prometheus-specific editability and runtime boundaries.
- `prometheus-html-motion-spec`: compatibility rules for older HTML Motion clips.
- `html-motion-video`: Prometheus wrapper/edit/export workflow for HTML compositions.
- `creative-director-video`: pacing, framing, edit decisions, and creative direction.
- `video-analysis-and-transcription`: analyze longer videos before clipping or assembly.
- `pretext-html-motion`: Pretext-style kinetic typography and text-as-geometry.
- `pretext-html-motion-video`: finished video workflows using Pretext typography.
- `nous-pretext-upstream`: upstream Pretext reference details only.
- `nous-ascii-video`: Python/FFmpeg ASCII render lane composed back into HyperFrames/HTML.
- `remotion-best-practices`: Remotion concepts and constraints as reference material.
- `html-motion-preset-author`: save successful clips as reusable HyperFrames/Prometheus presets.
- `holographic-globe-hyperframes-preset`: reusable globe preset.

For HyperFrames catalog reuse, use the separate `hyperframes-catalog-assets` skill as a narrow catalog lookup/adaptation companion, then return here for Prometheus-native editing and QA.

## Adapter Policy

Animation adapter material is reference-only until a clip needs it:

- GSAP: default for choreographed HyperFrames timelines; keep timelines paused and registered.
- CSS/WAAPI: use for finite native animation that can be seeked deterministically.
- Lottie/dotLottie: use local assets and seekable players.
- Three/WebGL: render from HyperFrames/Prometheus seek time, not wall-clock animation loops.
- Anime.js: require `autoplay: false` and a seekable instance.
- Tailwind: acceptable for static style/layout only when bundled or compiled safely.

## Pretext And Spatial Text

When an object should influence text flow, author it as a real selectable DOM element and mark it with Prometheus flow metadata:

```html
<div class="orb" data-role="orb" data-flow-exclusion data-flow-shape="circle"></div>
<p class="article-copy" data-flow-text>Long copy that should wrap around the orb.</p>
```

Use this as an editor enhancement over the HyperFrames DOM. Do not fuse editable objects into pseudo-elements, canvas drawings, backgrounds, or flattened groups.

## QA Gate

Before export, verify:

- HyperFrames lint passes or every remaining finding is intentional.
- No broken assets, raw local paths, or remote dependencies that Prometheus cannot serve deterministically.
- No text overflow, bad wrapping, clipped titles, or off-canvas primary content.
- Representative frames are visually different when motion is expected.
- Media and GSAP timelines respond correctly to seek.
- Nested compositions and variable overrides resolve.
- Important media segments are visible and audio preservation/muxing is handled.
- Advanced blocks expose slots/variables when they are supposed to be editable.

If QA fails, patch and sample again before export.
