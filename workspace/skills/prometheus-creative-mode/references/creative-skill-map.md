# Creative Skill Consolidation Map

Prometheus Creative Mode is HyperFrames-first for deterministic composition and Creative Generative Pipeline-first for AI media production. Older HyperFrames, Remotion, Pretext, and animation-adapter skills are retained as references or archived compatibility material, but the broad creative workflow should route through `prometheus-creative-mode`.

## Active Skills

- `prometheus-creative-mode`: default route for AI media generation, video canvas work, editable HTML-in-motion, media analysis, catalog adaptation, text flow, audio/captions, QA, and export.
- `hyperframes-catalog-assets`: narrow companion for looking up and adapting HeyGen HyperFrames catalog blocks/components.

## Primary Stack

- HyperFrames composition model: `data-composition-id`, timed clips, tracks, nested compositions, variables, GSAP timelines, runtime seeking.
- Prometheus generative production layer: projects, storyboards, image/video shot wrappers, frame extraction, continuity picking, scene chaining, layer extraction, retries, generation lineage, selected takes, rough cuts, audio/caption tools, and final compositing.
- Prometheus editability layer: asset placeholders, layer extraction, slot metadata, inspector patching, snapshots, QA, audio muxing, and export.
- `@hyperframes/core`: parse/generate/lint/validate/compile/inject runtime.
- `@hyperframes/player`: playback reference, iframe bridge reference, and mobile audio behavior reference.

## Prometheus-Native Bridge Files

- `src/gateway/creative/hyperframes-bridge.ts`: official core parser/linter/runtime bridge, layer extraction, variables, slots, and patch operations.
- `src/gateway/creative/hyperframes-catalog.ts`: catalog import/adaptation support.
- `src/gateway/creative/hyperframes-export-adapter.ts`: materializes HyperFrames clips for the existing renderer.
- `src/gateway/creative/hyperframes-qa.ts`: sample-frame QA over HyperFrames HTML.
- `src/gateway/creative/html-motion-spec.ts`: compatibility lint for older Prometheus HTML Motion clips.
- `src/gateway/creative/generative-pipeline.ts`: Creative projects, storyboards, generation lineage, image/video shot wrappers, frame extraction, scene chaining, layer extraction for generation, rough cuts, overlays, compositing, audio import/download/extract/generate/transcribe/mix, captions, music, and SFX.
- `src/gateway/creative/audio.ts`: audio source analysis, waveform data, duration probing, and enriched Creative audio tracks.
- `src/gateway/creative/renderers/composition_renderer.ts`: composition rendering and FFmpeg audio muxing/mixing.

## Reference Lanes

- HyperFrames: keep `legacy-skills/hyperframes`, `legacy-skills/hyperframes-cli`, and `legacy-skills/hyperframes-registry` as the main authoring and reusable-block references.
- Remotion: keep `legacy-skills/remotion-best-practices` for concepts and `legacy-skills/remotion-to-hyperframes` only for explicit source migration.
- Pretext: keep `legacy-skills/pretext-html-motion`, `legacy-skills/pretext-html-motion-video`, and `legacy-skills/nous-pretext-upstream` for text-fit, text flow, and kinetic typography references.
- ASCII: keep `legacy-skills/nous-ascii-video` as the Python/FFmpeg ASCII lane, composed back through HyperFrames/HTML.
- Website/video analysis: keep `legacy-skills/website-to-hyperframes` and `legacy-skills/video-analysis-and-transcription` as planning/analysis references adapted to HyperFrames-first Prometheus.

## Generative Production Lane

Load `CREATIVE_GENERATIVE_PIPELINE.md` whenever a task includes generated images/videos, frame continuity, extracted layers, rough cuts, captions, voiceover, music, sound effects, provider media generation, or full video production.

The key production tools are:

- Project/lineage: `creative_create_project`, `creative_register_generation`, `creative_generation_history`, `creative_select_best_take`.
- Story/shot flow: `creative_create_storyboard`, `creative_write_shot_prompt`, `creative_generate_sequence`.
- Generated media: `creative_generate_image_shot`, `creative_generate_video_shot`, `creative_refine_video_shot`, `creative_retry_shot_until_pass`.
- Continuity/assets: `creative_extract_video_frame`, `creative_extract_video_frames`, `creative_pick_continuity_frame`, `creative_chain_scene`, `creative_extract_layers_for_generation`.
- Assembly/polish: `creative_stitch_clips`, `creative_auto_assemble_rough_cut`, `creative_generate_motion_graphics_layer`, `creative_overlay_hyperframes_on_video`, `creative_composite_video_layers`.
- Audio/captions: `creative_import_audio`, `creative_download_audio`, `creative_extract_audio_from_video`, `creative_generate_voiceover`, `creative_transcribe_audio`, `creative_sync_captions_to_audio`, `creative_add_audio_track`, `creative_mix_audio_tracks`, `creative_add_music_bed`, `creative_add_sound_effects`.

## Adapter References

GSAP, CSS/WAAPI, Lottie, Three, Anime.js, and Tailwind guidance should be loaded only when a specific composition needs that adapter. These adapters must remain deterministic, finite, and compatible with HyperFrames runtime seeking.

## Archived Standalone Skills

The old standalone creative folders are under `workspace/skills/.archived-creative-legacy/standalone-adapters-2026-05-09/` so the skill scanner does not load multiple broad creative front doors at once. Their contents remain available as recoverable references.

## Migration Direction

1. New creative requests trigger `prometheus-creative-mode`.
2. Prometheus authors HyperFrames-compatible HTML by default.
3. Prometheus exposes editability through parsed layers, declared variables, and explicit slots.
4. HyperFrames catalog reuse may trigger `hyperframes-catalog-assets`, then implementation returns to `prometheus-creative-mode`.
5. Generative video/image work should use Creative-aware wrappers so outputs are registered as assets/generations rather than loose files.
6. New creative additions should land as references, templates, blocks, variables, slots, or pipeline tools inside this bundle unless they are genuinely unrelated to video/HTML composition work.
