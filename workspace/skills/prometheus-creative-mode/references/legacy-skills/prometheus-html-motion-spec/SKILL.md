---
name: prometheus-html-motion-spec
description: Canonical Prometheus HTML Motion composition spec for Creative Video mode. Use when creating, reviewing, linting, exporting, or converting Prometheus HTML Motion clips, especially HyperFrames-style clips, Remotion-to-HTML conversions, Pretext text-fit work, ASCII smart layers, timeline metadata, deterministic animation adapters, asset placeholders, or standalone export compatibility.
metadata:
  short-description: Canonical spec for Prometheus HTML Motion clips
---

# Prometheus HTML Motion Spec

This is the source of truth for HTML Motion clips inside Prometheus Creative Video mode.

Prometheus owns the editor, assets, timeline, renderer, revision system, QA, and export pipeline. HyperFrames is a reference for good composition discipline, timeline metadata, lint ideas, and optional compatibility export, not the controlling runtime.

## Build Target

An HTML Motion clip is a complete, self-contained HTML document rendered by Prometheus:

- inline CSS only
- optional inline JS only
- no external network scripts, fonts, images, or videos
- media must use Prometheus asset placeholders such as `{{asset.logo}}`
- no absolute Windows paths in HTML
- fixed stage dimensions on `html`, `body`, and the root stage
- deterministic frame output when Prometheus seeks the clip to a timestamp

## Required Root Stage

Every clip should have one root stage element with Prometheus/HyperFrames-style metadata:

```html
<main
  id="stage"
  data-composition-id="promo-main"
  data-width="1080"
  data-height="1920"
  data-duration="8000ms"
  data-frame-rate="30"
  data-start="0ms"
  data-role="stage"
  data-track-index="0"
>
  ...
</main>
```

Required root attributes:

- `data-composition-id`: stable unique composition id
- `data-width`: pixel width
- `data-height`: pixel height
- `data-duration`: total clip duration
- `data-frame-rate`: intended export frame rate, usually `30`
- `data-start`: root start, normally `0ms`
- `data-role`: semantic role, normally `stage`
- `data-track-index`: root track, normally `0`

Use `data-frame-rate` in new Prometheus clips. If importing or exporting HyperFrames-compatible projects, `data-fps` may be accepted as an alias, but Prometheus-authored HTML should prefer `data-frame-rate`.

## Timing Units

New Prometheus HTML must use explicit timing units:

- `ms` for milliseconds, preferred for Prometheus: `data-start="1200ms"`
- `s` for seconds when matching imported HyperFrames/GSAP concepts: `data-duration="2.5s"`

Legacy bare numbers are allowed only for backward compatibility and should be interpreted as milliseconds inside Prometheus. New clips should avoid bare numeric timing because upstream HyperFrames treats bare timing as seconds.

Timing attributes:

- `data-start`: when the element appears on the Prometheus timeline
- `data-duration`: how long the element is active
- `data-end`: legacy helper, avoid in new clips unless patching an existing one
- `data-trim-start`: source media trim offset for video/audio assets
- `data-offset`: local animation offset, when needed
- `data-track-index`: logical timeline track. Same-track clips should not unintentionally overlap.

For HyperFrames-compatible export, Prometheus may convert explicit millisecond timings to seconds and map `data-trim-start` to HyperFrames-style media start metadata when needed.

## Timeline Semantics

The Prometheus renderer owns time. HTML Motion code must be seek-safe:

- animations derive from the current Prometheus timestamp
- no `Date.now()`, wall-clock drift, open-ended `setInterval`, or unbounded animation loops for exported motion
- CSS animations must pause or be controlled during snapshot/export seeking
- JS adapters must expose deterministic seek behavior where practical
- media elements should be seeked from `data-start`, `data-duration`, and `data-trim-start`
- finite repeats only

Prometheus dispatches seek/update signals for HTML Motion runtime code. Smart layers should listen for Prometheus seek events and render the exact requested frame instead of playing freely.

## Animation Adapters

Allowed animation approaches:

- CSS transitions/keyframes, if paused/seekable for export
- WAAPI, if driven by explicit `currentTime`
- GSAP timelines, if created paused and seeked by Prometheus time
- Lottie, if loaded from local/imported assets and controlled by frame/time
- Three.js/canvas, if render state is derived from Prometheus time

Adapter requirements:

- initialize synchronously or gate rendering until ready
- expose a deterministic `seek(timeMs)` style behavior when possible
- avoid async timeline construction after export begins
- avoid infinite autoplay as the only source of motion
- keep all animated text measurable and inside safe areas at sampled frames

## Roles And Blocks

Use `data-role` to make structure inspectable and patchable:

- `stage`
- `scene`
- `background`
- `hero-media`
- `headline`
- `caption`
- `lower-third`
- `cta`
- `logo`
- `chart`
- `overlay`
- `transition`
- `ascii-layer`
- `pretext-fit`
- `audio`

Reusable blocks should carry stable IDs/classes and optional region markers:

```html
<!-- region: headline -->
<section id="headline-scene" data-role="scene" data-start="0ms" data-duration="2200ms" data-track-index="1">
  <h1 data-role="headline" data-fit="pretext">Launch faster.</h1>
</section>
<!-- endregion: headline -->
```

## Assets

Use asset placeholders for every imported file:

```html
<img src="{{asset.logo}}" alt="" data-role="logo">
<video src="{{asset.demo}}" muted playsinline data-start="1200ms" data-duration="4500ms" data-trim-start="9000ms"></video>
```

Rules:

- import or locate assets before referencing them
- analyze important media before placing it
- never reference local absolute paths directly
- keep source audio decisions explicit
- use overlays/scrims when text sits on busy media

## Text Fit And Pretext

Text inside fixed boxes must be measured before export:

- use Pretext or Prometheus text-fit tools for hero titles, captions, lower thirds, CTA text, and stat blocks
- treat width/height overflow as ship-blocking
- avoid forced `<br>` except for deliberate display typography
- do not use negative letter spacing
- keep primary text inside social safe areas

Snapshot QA is for visual motion/composition confirmation. It should not be the first time a text overflow is discovered.

## ASCII

Prometheus supports two ASCII lanes:

- heavy Python/FFmpeg ASCII render for premium source-backed terminal cinema
- lightweight HTML/canvas ASCII smart layers for editable browser-native treatments

Use HTML Motion as the composition pass around either lane: captions, overlays, CTAs, product framing, transitions, and final export.

## Lint And Inspect Contract

Prometheus lint/inspect should check:

- missing root metadata
- invalid dimensions, duration, or frame rate
- ambiguous bare timing values
- overlapping same-track clips
- elements active outside composition duration
- media missing asset placeholders
- raw local paths or remote dependencies
- text overflow by Pretext/text-fit pass
- off-canvas primary content
- fixed containers clipping children
- non-deterministic animation patterns
- unsupported async timeline setup
- important audio present but not preserved/muxed

Frame QA should sample at least:

- early frame around `500ms`
- midpoint
- near-end frame around `duration - 500ms`

For dense edits, also sample every scene boundary and every important media segment.

## Export Contract

Prometheus export is the normal path:

1. author or apply template
2. lint
3. text-fit check
4. snapshot/inspect sampled frames
5. patch if needed
6. export through Prometheus tools

Do not call the external HyperFrames CLI for normal Prometheus exports. Use external HyperFrames only for standalone HyperFrames projects, direct compatibility testing, or explicit user requests.

## Compatibility Notes

Prometheus can optionally export a standalone HyperFrames-compatible folder, but that is a compatibility target, not the native source of truth.

When converting:

- Prometheus explicit `ms` timings may become seconds
- `data-frame-rate` may become `data-fps` if needed
- `{{asset.id}}` placeholders must become relative files in the exported folder
- Prometheus-specific QA metadata may be omitted or preserved as harmless `data-*`
- behavior must remain deterministic after conversion
