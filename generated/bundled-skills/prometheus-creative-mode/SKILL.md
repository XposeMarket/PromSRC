---
name: prometheus-creative-mode
description: Unified Prometheus Creative Mode bundle for video canvas work, HTML Motion, HyperFrames-style composition, Remotion guidance, Pretext text-fit and typography, ASCII video, GSAP/CSS/WAAPI animation, website-to-video, media analysis, templates, presets, lint/inspect, QA, and MP4 export. Use this as the main creative/video skill before any older standalone creative skill.
metadata:
  short-description: Unified Creative Mode video, motion, ASCII, Pretext, Remotion, and HyperFrames workflow
---

# Prometheus Creative Mode

This is the front door for Creative Mode video work in Prometheus.

Use this bundle first for:

- HTML Motion clips
- HyperFrames-style composition
- Remotion-to-HTML conversion
- Pretext text fitting and kinetic typography
- ASCII video and terminal cinema
- GSAP/CSS/WAAPI/Lottie/Three animation guidance
- experimental WICG HTML-in-Canvas DOM-to-canvas adapters
- website-to-video
- video analysis and clipping
- presets, reusable blocks, templates, lint, inspect, QA, and export

Prometheus owns the editor, asset library, timeline UI, HTML Motion renderer, patch/revision system, export pipeline, QA flow, template library, style system, and ASCII pipeline. HyperFrames is reference material and an optional compatibility target, not the native runtime.

## Normal Path

For polished video work:

1. Enter Creative Video mode.
2. Import/analyze user media when provided.
3. Choose an existing HTML Motion template/block when one fits.
4. Author or patch a self-contained HTML Motion clip.
5. Run text-fit/lint checks.
6. Snapshot early, middle, and near-end frames.
7. Patch until QA passes.
8. Export through Prometheus.

Do not use the external HyperFrames CLI or raw shell rendering for normal Prometheus creative clips.

## Core Spec

Prometheus HTML Motion clips must follow the bundled spec:

- complete self-contained HTML document
- inline CSS and optional inline JS only
- no external network assets
- media through `{{asset.id}}` placeholders
- root metadata: `data-composition-id`, `data-width`, `data-height`, `data-duration`, `data-frame-rate`, `data-start`, `data-role`, `data-track-index`
- explicit timing units in new clips: prefer `ms`; allow `s`; treat legacy bare numbers as milliseconds
- deterministic seek-driven animation
- Pretext/text-fit gate before export
- early/mid/near-end visual QA

## Spatial / PreText Flow Authoring

When a visual object should influence text flow, do not fuse that object into the text node as a background, pseudo-element, canvas drawing, or single flattened group. Author it as its own selectable DOM element and mark it with flow metadata, for example:

```html
<div class="orb" data-role="orb" data-flow-exclusion data-flow-shape="circle"></div>
<p class="article-copy" data-flow-text>Long copy that should wrap around the orb.</p>
```

Use `data-flow-exclusion` on independently movable objects that text should wrap around. Use `data-flow-shape="circle"` for circular objects and `data-flow-shape="rect"` for panel-like objects. Use `data-flow-text` on the text container that should respond. The editor can then keep the object draggable while applying PreText-style exclusion flow and panel negotiation. If an object must be editable later, it must be a real element, not a CSS pseudo-element or painted background.

For draggable flow objects, do not rely on CSS `float`/`shape-outside` as the primary layout mechanism. `shape-outside` follows the float's original layout box, not a transform/translate-driven dragged visual position. Put the flow object in its own absolutely positioned DOM element and let Prometheus flow metadata drive the live exclusion. Legacy inline floats may be accepted as compatibility input, but new clips should author the object separately from the prose.

Prefer the `flow-orb-copy` HTML Motion block when the brief asks for PreText-like text/object interaction, an orb embedded in copy, text wrapping around an object, or editable flow typography. When revising older fused designs, use the editor's Separate Flow action or patch the HTML so the object is a sibling/child real element with `data-flow-exclusion`, while the copy has `data-flow-text`. In final notes, report separations and spatial QA changes explicitly, for example: "Orb separated into draggable flow object; copy marked as flow text; spatial QA passed."

Read the full spec when authoring or reviewing structural rules:

- `references/PROMETHEUS_HTML_MOTION_SPEC.md`
- `references/legacy-skills/prometheus-html-motion-spec/SKILL.md`

## Routing

Use the smallest relevant reference from `references/legacy-skills/`:

- `html-motion-video`: normal HTML Motion creation, templates, edits, media placement, QA, export.
- `prometheus-hyperframes-bridge`: Prometheus-native HyperFrames-style routing and compatibility boundaries.
- `prometheus-html-motion-spec`: canonical structure/timing/lint/export contract.
- `creative-director-video`: creative direction, pacing, framing, clip selection.
- `video-analysis-and-transcription`: analyze longer videos before editing or clipping.
- `pretext-html-motion`: Pretext-style kinetic typography and text-as-geometry.
- `pretext-html-motion-video`: finished video workflows using Pretext typography.
- `nous-pretext-upstream`: upstream Pretext API/reference details.
- `nous-ascii-video`: premium Python/FFmpeg ASCII render lane.
- `gsap`: GSAP timeline technique inside deterministic HTML Motion.
- `web-animations`: CSS/WAAPI animation patterns.
- `remotion-best-practices`: Remotion concepts and constraints.
- `remotion-to-hyperframes`: converting Remotion ideas to seek-safe HTML Motion.
- `hyperframes`: upstream HyperFrames composition rules as reference.
- `hyperframes-cli`: standalone HyperFrames CLI only when explicitly requested.
- `hyperframes-registry`: reusable HyperFrames-style blocks and registry ideas.
- `website-to-hyperframes`: website-to-video planning adapted to Prometheus.
- `html-motion-preset-author`: saving successful clips as reusable presets.
- `holographic-globe-hyperframes-preset`: reusable globe preset.

Use `references/creative-skill-map.md` for the current consolidation map.

## Decisions

Default renderer:

- Use Prometheus HTML Motion for polished short videos, social clips, ads, launch videos, animated cards, captions, overlays, and product/demo motion.

ASCII:

- Use the Python/FFmpeg ASCII lane for dense source-backed terminal cinema.
- Use HTML/canvas ASCII smart layers for lightweight editable browser-native effects.
- Use HTML Motion as the composition pass around either lane.

Remotion:

- Keep Remotion as a useful reference and preview/conversion lane.
- Convert Remotion concepts to Prometheus HTML Motion unless the user explicitly asks for a standalone Remotion render.

HyperFrames:

- Use HyperFrames for patterns: track metadata, lint ideas, deterministic timelines, blocks, and optional compatibility export.
- Do not assume HyperFrames packages, CLI, Studio, or runtime are installed.

Audio:

- HTML Motion export is strongest as a visual frame-sequence path.
- If source speech/music matters, use the dedicated audio/video path or muxing flow. Never silently discard important audio.

HTML-in-Canvas:

- Treat WICG HTML-in-Canvas as experimental progressive enhancement.
- Use it through adapter/block snippets only when feature detection passes.
- Keep normal DOM fallback visible when unsupported.
- Do not make browser flags or `drawElementImage` support mandatory for normal Prometheus exports.

## QA Gate

Before export, verify:

- no broken assets or raw local paths
- no remote dependencies
- no text overflow or bad wrapping
- no clipped/off-canvas primary content
- frame samples are visually different when the brief expects motion
- scene timing is deterministic
- important media segments are actually visible
- audio preservation/muxing is handled when required

If QA fails, patch and sample again before export.
