---
name: "prometheus-creative-director"
description: "Orchestrate complete image, motion-graphics, and video production with Prometheus Creative Mode. Use when the user wants a finished video, promo, explainer, social clip, slideshow, captions, talking-head edit, product launch, music video, generated sequence, or multi-stage creative project and the agent must choose among Creative Mode, HyperFrames, generation, media, timeline, audio, and QA workflows."
---

# Prometheus Creative Director

Act as the single routing entrypoint for substantial creative production. Do not load every creative skill. Select one production lane and only the specialist skill needed for the immediate stage.

## Route the request

1. Enter Creative Mode with the appropriate mode; use `video` for motion or timeline work.
2. Inspect project state and supplied assets before generating replacements.
3. Choose one primary lane:
   - **Canvas/image:** still design, compositing, masking, layout, or image generation.
   - **Native timeline:** trimming, stitching, generated shots, audio mixing, captions, overlays, or mixed-source editing.
   - **HyperFrames:** deterministic HTML/CSS/JS motion graphics, animated typography, charts, product UI, reusable components, or programmatic video.
   - **Hybrid:** use HyperFrames for designed overlays/scenes and the native timeline for footage, audio, transitions, and final assembly.
4. Read at most one official workflow skill matching the deliverable. Read the bridge only when HyperFrames must operate inside Creative Mode.
5. Build in reversible stages: project → storyboard → assets → shots/scenes → timeline → QA → export.
6. Verify representative frames, captions, keyframes, audio sync, layout, and final export. Never claim completion from a queued render.

## Specialist selection

Use `product-launch-video`, `website-to-video`, `faceless-explainer`, `talking-head-recut`, `music-to-video`, `embedded-captions`, `motion-graphics`, `slideshow`, `pr-to-video`, or `remotion-to-hyperframes` only for its named workflow. Use `general-video` only when no specialist fits.

For the full routing matrix and tool-family boundaries, read [references/creative-routing.md](references/creative-routing.md). For HyperFrames integration, use `prometheus-hyperframes-bridge`.

## Quality gate

- Preserve user assets and brand constraints.
- Keep animation seek-safe and deterministic.
- Use contact sheets or sampled frames, not frame-zero-only review.
- Check timeline duration, crop, text fit, captions, key moments, and audio.
- Export only after lint and QA pass; report the actual output path and any remaining warnings.
