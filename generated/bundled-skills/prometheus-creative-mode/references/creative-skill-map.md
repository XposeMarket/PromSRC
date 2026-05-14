# Creative Skill Consolidation Map

Prometheus Creative Mode is HyperFrames-first. Older HyperFrames, Remotion, Pretext, and animation-adapter skills are retained as references or archived compatibility material, but the broad creative workflow should route through `prometheus-creative-mode`.

## Active Skills

- `prometheus-creative-mode`: default HyperFrames-first route for video canvas work, editable HTML-in-motion, media analysis, catalog adaptation, text flow, QA, and export.
- `hyperframes-catalog-assets`: narrow companion for looking up and adapting HeyGen HyperFrames catalog blocks/components.

## Primary Stack

- HyperFrames composition model: `data-composition-id`, timed clips, tracks, nested compositions, variables, GSAP timelines, runtime seeking.
- Prometheus editability layer: asset placeholders, layer extraction, slot metadata, inspector patching, snapshots, QA, and export.
- `@hyperframes/core`: parse/generate/lint/validate/compile/inject runtime.
- `@hyperframes/player`: playback reference, iframe bridge reference, and mobile audio behavior reference.

## Prometheus-Native Bridge Files

- `src/gateway/creative/hyperframes-bridge.ts`: official core parser/linter/runtime bridge, layer extraction, variables, slots, and patch operations.
- `src/gateway/creative/hyperframes-catalog.ts`: catalog import/adaptation support.
- `src/gateway/creative/hyperframes-export-adapter.ts`: materializes HyperFrames clips for the existing renderer.
- `src/gateway/creative/hyperframes-qa.ts`: sample-frame QA over HyperFrames HTML.
- `src/gateway/creative/html-motion-spec.ts`: compatibility lint for older Prometheus HTML Motion clips.

## Reference Lanes

- HyperFrames: keep `legacy-skills/hyperframes`, `legacy-skills/hyperframes-cli`, and `legacy-skills/hyperframes-registry` as the main authoring and reusable-block references.
- Remotion: keep `legacy-skills/remotion-best-practices` for concepts and `legacy-skills/remotion-to-hyperframes` only for explicit source migration.
- Pretext: keep `legacy-skills/pretext-html-motion`, `legacy-skills/pretext-html-motion-video`, and `legacy-skills/nous-pretext-upstream` for text-fit, text flow, and kinetic typography references.
- ASCII: keep `legacy-skills/nous-ascii-video` as the Python/FFmpeg ASCII lane, composed back through HyperFrames/HTML.
- Website/video analysis: keep `legacy-skills/website-to-hyperframes` and `legacy-skills/video-analysis-and-transcription` as planning/analysis references adapted to HyperFrames-first Prometheus.

## Adapter References

GSAP, CSS/WAAPI, Lottie, Three, Anime.js, and Tailwind guidance should be loaded only when a specific composition needs that adapter. These adapters must remain deterministic, finite, and compatible with HyperFrames runtime seeking.

## Archived Standalone Skills

The old standalone creative folders are under `workspace/skills/.archived-creative-legacy/standalone-adapters-2026-05-09/` so the skill scanner does not load multiple broad creative front doors at once. Their contents remain available as recoverable references.

## Migration Direction

1. New creative requests trigger `prometheus-creative-mode`.
2. Prometheus authors HyperFrames-compatible HTML by default.
3. Prometheus exposes editability through parsed layers, declared variables, and explicit slots.
4. HyperFrames catalog reuse may trigger `hyperframes-catalog-assets`, then implementation returns to `prometheus-creative-mode`.
5. New creative additions should land as references, templates, blocks, variables, or slots inside this HyperFrames-first bundle unless they are genuinely unrelated to video/HTML composition work.
