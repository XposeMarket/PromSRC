# Creative Generative Pipeline

This is the current Prometheus Creative Mode production spine. Use it when the user wants Prometheus to produce, extend, polish, or remix video rather than only author a standalone HTML/HyperFrames composition.

## Mental Model

Prometheus now has three cooperating layers:

- Generative production: image shots, video shots, frame extraction, continuity selection, layer extraction, retries, shot history, projects, rough cuts, and generated media lineage.
- Editable composition: HTML Motion and HyperFrames-style overlays, captions, lower thirds, HUDs, callouts, title cards, CTA layers, and general layer compositing.
- Audio finishing: imported/uploaded audio, downloaded media audio, extracted video audio, generated voiceover, transcription, captions, music beds, sound effects, timed tracks, and mixed audio masters.

Do not treat these as competing systems. Generated video is footage. HTML Motion/HyperFrames is the editorial and graphics layer. Creative projects and generation history are the durable production memory.

## First-Class Tools

Project and planning:

- `creative_create_project`: create the persistent project manifest that owns brief, target format, storyboard, assets, generations, selected takes, rough cuts, exports, QA reports, audio tracks, and captions.
- `creative_create_storyboard`: create a shot plan.
- `creative_write_shot_prompt`: convert a rough idea into a generation-ready shot prompt.
- `creative_generate_sequence`: generate all storyboard shots, optionally chaining continuity and retrying weak shots.

Image/video generation:

- `creative_generate_image_shot`: generate a Creative-aware still/keyframe/background/asset image and register it.
- `creative_generate_video_shot`: generate a Creative-aware video shot and register it.
- `creative_refine_video_shot`: targeted repair/extension wrapper for weak motion, bad hands/faces, wrong character, style mismatch, ending issues, loopability, and continuation.
- `creative_retry_shot_until_pass`: retry, QA, and compare attempts until a shot reaches threshold or attempts are exhausted.

Continuity and extraction:

- `creative_extract_video_frame`: extract first, middle, last, timestamp, percent, or continuity frames.
- `creative_extract_video_frames`: extract multiple candidate frames and contact sheets.
- `creative_pick_continuity_frame`: choose the best continuation frame with heuristics and optional vision critique.
- `creative_chain_scene`: extract a continuity frame from the prior shot, generate the next shot, register lineage, and optionally build timeline context.
- `creative_extract_layers_for_generation`: extract layers/assets from images or videos and register them for future generation references.

Lineage and selection:

- `creative_register_generation`: register any generated/imported media with prompt, provider, model, parent, asset, shot, attempt, and metadata.
- `creative_generation_history`: inspect all attempts.
- `creative_compare_shots`: compare two attempts.
- `creative_select_best_take`: select the best take for a shot from generation history.

Assembly and compositing:

- `creative_stitch_clips`: concatenate clips with normalization and basic transition handling.
- `creative_render_generated_sequence`: wrap generated clips through HTML Motion for rough sequence export.
- `creative_auto_assemble_rough_cut`: assemble selected takes or ordered videos into a rough cut and save timeline JSON.
- `creative_generate_motion_graphics_layer`: generate editable HTML Motion overlays for captions, lower thirds, callouts, HUDs, data cards, title cards, logo intros, CTA outros, subtitles, and app annotations.
- `creative_overlay_hyperframes_on_video`: place an HTML Motion/HyperFrames overlay over a base generated video and render.
- `creative_composite_video_layers`: stack videos, images, HTML/HyperFrames layers, captions, and audio tracks into a final MP4/WebM.

Audio and captions:

- `creative_import_audio`: import uploaded/local audio and analyze waveform/duration.
- `creative_download_audio`: download supported media-page audio with yt-dlp audio-only mode, import, analyze, and register.
- `creative_extract_audio_from_video`: extract MP3/WAV/M4A from local video and register it.
- `creative_generate_voiceover`: generate provider voiceover with configured OpenAI/OpenAI Realtime-compatible TTS or xAI TTS, save, import, analyze, and register.
- `creative_transcribe_audio`: transcribe local audio with OpenAI or xAI STT.
- `creative_sync_captions_to_audio`: create editable timed caption HTML Motion layers from transcript text or segments.
- `creative_add_audio_track`: prepare timed audio with start, trim, duration, volume, mute, fade in/out.
- `creative_mix_audio_tracks`: mix multiple tracks into a mastered audio asset.
- `creative_add_music_bed`: import/download music, lower volume, fade it, and attach it.
- `creative_add_sound_effects`: add timed SFX tracks and optionally mix them.

Guardrails:

- `creative_normalize_layer_specs`: normalize layer specs before render.
- `creative_validate_composition_layers`: detect bad paths, timing, bounds, unsupported layers, and overlap risk.
- `creative_preflight_overlay`: build preview HTML and validate the composite before render.
- `creative_sample_composite_frames`: render sample frames/contact sheets before final export.

## Recommended Full Flow

Use this order for “make a complete video” requests:

1. Create a project with `creative_create_project`.
2. Create or load a storyboard.
3. Generate image shots when the opening/keyframe quality matters.
4. Generate video shots.
5. Analyze shots and retry/refine weak ones.
6. Pick continuity frames for chained scenes.
7. Select best takes and record them.
8. Assemble a rough cut.
9. Generate/edit overlay layers for captions, lower thirds, HUDs, title/CTA cards, or product callouts.
10. Add voiceover, uploaded/downloaded audio, extracted audio, music bed, and SFX.
11. Mix or attach audio tracks.
12. Composite video, overlays, captions, and audio.
13. Sample frames and verify the final MP4/WebM.

## Routing Rules

Use the generative pipeline when the user asks for image generation, video generation, scene continuation, avatar generation, game promos, AI footage, asset/layer extraction, rough cut assembly, captions, voiceover, music, or full video production.

Use HyperFrames/HTML Motion authoring when the user asks for deterministic motion graphics, overlays, captions, typography, UI callouts, product labels, HUDs, charts, transitions, or polished edit layers.

Use OpenCut or another editor only as a source of design/editor ideas or future canvas integration reference. Do not assume OpenCut is the runtime for Prometheus Creative Mode unless the codebase explicitly integrates it.

## Failure Modes To Watch

- Continuing from the final video frame when it is blurry or distorted. Use candidate extraction and `creative_pick_continuity_frame`.
- Generating many loose files without registering lineage. Always register or use Creative-aware wrappers.
- Treating generated videos as final products. They usually need rough cut assembly, overlays, captions, and audio finishing.
- Adding overlays without preflight/sampling. Run validation and sample frames before final export.
- Silently dropping source audio. Import/extract/mix audio explicitly and report audio identity.
- Using provider TTS/STT without configured keys. The tool should return a clean config error; do not pretend provider audio was generated.
- Downloading copyrighted or platform media without user intent. The tools can download supported media, but agents should respect user direction and applicable rights.

## Current Limits

- Visual QA has improved, but true semantic critique still depends on available vision/model support and is not perfect.
- Provider voiceover requires configured OpenAI/OpenAI Realtime-compatible or xAI credentials/OAuth.
- Transcription currently exposes OpenAI/xAI first-class paths; local HyperFrames/Whisper CLI remains a fallback/reference path.
- Transitions and editor-grade NLE features are improving, but simple rough cuts and HTML/HyperFrames compositing are the reliable lane today.
