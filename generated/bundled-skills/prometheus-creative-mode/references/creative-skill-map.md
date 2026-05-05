# Creative Skill Consolidation Map

This bundle is the new home for Prometheus creative/video guidance.

The full legacy skill bodies are preserved under `references/legacy-skills/` so an agent can load only the relevant deep reference when needed.

## Core

- `references/PROMETHEUS_HTML_MOTION_SPEC.md`: canonical engineering spec for valid Prometheus HTML Motion clips.
- `prometheus-html-motion-spec`: canonical HTML Motion structure, timing, lint, QA, and export contract.
- `prometheus-hyperframes-bridge`: Prometheus-first routing for HyperFrames-style video work.
- `html-motion-video`: normal clip creation/editing/export workflow.
- `creative-director-video`: creative direction and edit decision guidance.

## Motion And Rendering

- `gsap`: GSAP timelines and effects.
- `web-animations`: CSS and WAAPI patterns.
- HTML-in-Canvas experiments now live as first-party adapter/block snippets inside the Prometheus runtime. Use them only as feature-detected progressive enhancement.
- `remotion-best-practices`: Remotion concepts and constraints.
- `remotion-to-hyperframes`: Remotion-to-HTML Motion conversion guidance.
- `hyperframes`: upstream HyperFrames composition reference.
- `hyperframes-cli`: standalone CLI reference only.
- `hyperframes-registry`: block/registry ideas.

## Text And Typography

- `pretext-html-motion`: Pretext-style kinetic typography.
- `pretext-html-motion-video`: finished Pretext video workflows.
- `nous-pretext-upstream`: upstream Pretext reference.

## ASCII

- `nous-ascii-video`: premium Python/FFmpeg ASCII rendering.
- HTML Motion remains the composition pass for captions, overlays, CTAs, frames, and export.

## Media And Website Workflows

- `video-analysis-and-transcription`: source video analysis before edit assembly.
- `website-to-hyperframes`: website-to-video process adapted for Prometheus.

## Presets

- `html-motion-preset-author`: preserve successful clips as reusable presets.
- `holographic-globe-hyperframes-preset`: reusable globe effect.

## Migration Direction

1. New creative requests should trigger `prometheus-creative-mode`.
2. Older skills should become thin compatibility pointers over time.
3. New creative additions should be added as references/templates inside this bundle, not as top-level skills, unless they are truly unrelated to Creative Mode.
4. Once trigger behavior is validated, retire or hide redundant top-level creative skills from the active skill manifest.
