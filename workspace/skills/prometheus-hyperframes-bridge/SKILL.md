---
name: "prometheus-hyperframes-bridge"
description: "Integrate official HyperFrames authoring workflows with Prometheus Creative Mode’s canvas, asset library, native timeline, audio pipeline, QA, and export system. Use when building, importing, editing, compositing, validating, or rendering a HyperFrames composition inside a Prometheus creative project rather than operating only through the standalone CLI."
---

# Prometheus HyperFrames Bridge

Use official HyperFrames skills for composition semantics and Prometheus tools for project orchestration, mixed-media editing, asset custody, QA, and delivery.

## Bridge workflow

1. Enter Creative Mode `video`; inspect project and timeline state.
2. Select exactly one official workflow skill for the deliverable, plus `hyperframes-core` or `hyperframes-keyframes` only when its contract is needed.
3. Author or import the composition as source HTML. Keep HTML as the editable source of truth.
4. Bring it into Creative Mode through `creative_hyperframes_ops` (`insert_clip` or catalog/import).
5. Perform structured edits through `creative_hyperframes_ops` (`set_text`, `set_color`, `set_timing`, `set_variable`, `set_asset`, `apply_patch`, `add_animation`); avoid regex editing when a typed operation exists.
6. Run `creative_hyperframes_ops` (`lint`, `materialize`, `qa`) in that order.
7. Choose the output path:
   - Export the HyperFrames composition directly for a standalone deterministic video.
   - Keep it as a timeline clip for native transitions, footage, captions, music, voiceover, or layered compositing.
   - Render it as an overlay and composite it over footage for hybrid edits.
8. Use `creative_quality_ops` frame/timeline/audio checks before final `creative_video_ops` export or HyperFrames composition render.

## Ownership boundary

- HyperFrames owns composition HTML, timing attributes, seek-safe animation, component wiring, and deterministic scene rendering.
- Creative Mode owns projects, imported/generated assets, shot generation, multi-clip timeline edits, audio tracks, captions, overlay compositing, history, QA evidence, and final delivery.
- Do not recreate an existing HyperFrames operation with generic canvas mutations.
- Do not force footage-heavy edits into one HTML document when the native timeline is the clearer source of truth.

Read [references/tool-crosswalk.md](references/tool-crosswalk.md) for exact tool mappings and failure boundaries.
