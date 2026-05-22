## 6D-1) Creative Generative Video Pipeline and 2026-05-20 Self-Edit Notes

The current Creative Video stack is not only scene-graph HTML Motion. It also has a Creative Generative Pipeline in `src/gateway/creative/generative-pipeline.ts`.

Use this pipeline when Raul asks for a complete generated video, promo, ad, avatar/voiceover clip, AI footage sequence, generated app/product shot, scene chaining, captions, HUD overlays, music/SFX, or a finished social video.

Primary source files:

- `src/gateway/creative/generative-pipeline.ts`
- `src/gateway/creative/assets.ts`
- `src/gateway/creative/audio.ts`
- `src/gateway/creative/composition.ts`
- `src/gateway/creative/contracts.ts`
- `src/gateway/creative/renderers/composition_renderer.ts`
- `src/gateway/tools/defs/creative-tools.ts`
- `src/gateway/agents-runtime/subagent-executor.ts`
- `src/gateway/routes/canvas.router.ts`

Project/planning tools in this lane:

- `creative_create_project`
- `creative_create_storyboard`
- `creative_write_shot_prompt`
- `creative_generate_sequence`
- `creative_generation_history`
- `creative_register_generation`
- `creative_select_best_take`
- `creative_compare_shots`

Generated image/video tools:

- `creative_generate_image_shot`
- `creative_generate_video_shot`
- `creative_refine_video_shot`
- `creative_retry_shot_until_pass`
- `creative_chain_scene`
- `creative_extract_video_frame`
- `creative_extract_video_frames`
- `creative_pick_continuity_frame`
- `creative_extract_layers_for_generation`
- `creative_analyze_generated_video`

Assembly/composition tools:

- `creative_stitch_clips`
- `creative_auto_assemble_rough_cut`
- `creative_render_generated_sequence`
- `creative_generate_motion_graphics_layer`
- `creative_overlay_hyperframes_on_video`
- `creative_composite_video_layers`
- `creative_validate_composition_layers`
- `creative_preflight_overlay`
- `creative_sample_composite_frames`

Audio/caption tools:

- `creative_import_audio`
- `creative_download_audio`
- `creative_extract_audio_from_video`
- `creative_generate_voiceover`
- `creative_transcribe_audio`
- `creative_sync_captions_to_audio`
- `creative_add_audio_track`
- `creative_mix_audio_tracks`
- `creative_add_music_bed`
- `creative_add_sound_effects`

Provider facts verified on 2026-05-20:

- OpenAI image generation works as a keyframe/source-image path when configured.
- xAI video generation works as the generated footage path through `generate_video` and Creative wrappers.
- xAI voiceover works through the xAI OAuth bridge or `XAI_API_KEY`; the implementation uses `getValidXAIToken(...)` when connected.
- OpenAI voiceover uses auth candidates from direct API keys, OpenAI OAuth `api_key`, and OpenAI OAuth `access_token` through `openAiVoiceAuthCandidates()`.
- OpenAI transcription should use the same auth-candidate bridge; do not route around it with shell commands or one-off API calls.
- Creative TTS must follow the same OAuth-bridge principle as Realtime voice, xAI dictation/search, and mobile/desktop voice flows: if the user connected OpenAI or xAI/Grok through OAuth, Creative voiceover should be able to use that connection without requiring a separate env var.
- A voice provider error like `OpenAI voice is not configured` is a product/auth-bridge bug when the corresponding OAuth connection is active elsewhere. Fix auth candidate resolution before asking Raul for keys.
- A voice error like `Voice 'alloy' not found`, `Voice 'cedar' not found`, or `Voice 'male' not found` means the tool guessed unsupported provider voice names. Creative voice tools need a provider voice discovery/status path or a provider-specific default list; agents should not brute-force voice names in user-facing workflows.
- If OpenAI TTS fails with a scope error such as missing `api.model.audio.request`, try xAI voiceover before declaring audio impossible.

Correct full-video production order:

1. Create or reuse a Creative project with `creative_create_project`.
2. Create a storyboard with `creative_create_storyboard` or derive one from the user brief.
3. Generate keyframes/opening frames when visual continuity matters.
4. Generate video shots.
5. Analyze generated shots before accepting them.
6. Retry/refine weak shots rather than accepting a broken first pass.
7. For continuation, extract multiple candidate frames and use `creative_pick_continuity_frame` instead of blindly using the last frame.
8. Select best takes and record lineage.
9. Assemble the base sequence with `creative_stitch_clips` or `creative_auto_assemble_rough_cut`.
10. Add voiceover, music, SFX, captions, HUD overlays, CTA cards, or lower thirds as separate Creative audio/layer assets.
11. Composite or mux final media through Creative tools.
12. QA with `video_analyze_imported_video`, sampled frames/contact sheets, audio stream metadata, and visible-scene checks before presenting.

Important 2026-05-20 test result:

- A four-scene Prometheus calorie-tracking app promo was successfully generated and presented.
- The reliable final visual file was `creative-projects/mobile_mpea7jgt_0a0nab/prometheus-creative/exports/prometheus-calorie-promo-stitch-clean.mp4`.
- QA verified four visible scenes: narrator/product intro, meal scan, mobile dashboard, CTA/outro.
- OpenAI-generated keyframes and xAI-generated video clips worked.
- xAI-generated voiceover existed, but the earlier overlay/composite path froze the visual base when muxing overlays/audio, so the broken overlay/audio composite was not presented.

PulseFit app test result from this same date/context:

- Creative project root: `creative-projects/9fe81950-4861-45fe-a2d3-6ae1524e8ea3/prometheus-creative/`.
- Source generated scene clips were the four xAI MP4 files in `prometheus-creative/assets/library/` with timestamps around `2026-05-20T01-34`, `01-36`, `01-37`, and `01-39`.
- The direct concat artifact that finally contained all four scenes was `prometheus-creative/exports/prometheus-pulsefit-all-4-clips-concat-copy.mp4`.
- Earlier or partial/bad outputs in the same exports folder included `prometheus-pulsefit-full-24s-composite-fixed.mp4`, `prometheus-pulsefit-full-promo-hyperframes.mp4`, `prometheus-pulsefit-rough-cut.mp4`, `prometheus-pulsefit-all-generated-scenes-combined.mp4`, and `prometheus-pulsefit-all-scenes-full-length.mp4`.
- `prometheus-pulsefit-full-24s-composite-fixed.mp4` sampled as a frozen/still final PulseFit hero image across the duration, so it should be treated as a failed composite even though a file existed.
- `prometheus-pulsefit-all-4-clips-concat-copy.mp4` sampled as a 24.17s, 720x1280, 24fps, roughly 19.4MB file with all four generated scenes and hard cuts. This was the verified visual truth for the PulseFit test.
- The visible Video canvas/editor showed generated media in the Assets panel but the timeline stayed blank. That is a separate editor-placement/state issue from asset generation and final media assembly; future fixes must ensure generated rough cuts or assembled clips are inserted as timeline clips, not merely registered as assets.

Failure pattern and fix from 2026-05-20:

- `creative_stitch_clips` and `creative_auto_assemble_rough_cut` are the reliable base assembly path for generated multi-shot footage.
- The old composite path built a preview HTML page containing `<video>` layers, then rendered that page through Playwright screenshots. This made base footage dependent on browser video seeking and could freeze the visual base on one scene.
- `creative_composite_video_layers` now has a fast path for a single full-frame video layer plus audio layers: it stream-copies the existing MP4 video and muxes audio internally with bundled FFmpeg. This preserves verified visuals and avoids browser re-rendering.
- Composite preview video seeking now waits for `requestVideoFrameCallback` when available before screenshots, so the captured frame is more likely to reflect the requested media time.
- Overlay iframes now receive local layer time (`timeline time - layer start + media start`) instead of raw global timeline time.
- Generated caption HTML now exposes standard seek hooks: `window.__promSeek`, `window.__hf.seek`, and `prometheus-html-motion-seek`.
- `creative_stitch_clips` now treats `transition:"cut"` as a real zero-duration cut in metadata instead of reporting a misleading fallback 500ms transition.

Operational rule for FFmpeg:

- Do not use `run_command` FFmpeg as the normal Creative media path.
- Prefer Creative tools that resolve workspace paths and use bundled FFmpeg internally.
- If a shell FFmpeg command seems necessary, first ask whether a Creative tool should exist or should be fixed.
- The 2026-05-20 failure showed shell FFmpeg/ffprobe returning `Invalid argument` on files that Creative's own analyzer could read, likely due shell/path/runtime context rather than missing files.
- Native tools should own these operations: stitching, audio extraction, audio import, audio mix, stream-copy mux, frame extraction, contact sheets, and final asset registration.

Generated-media QA rule:

- A final video is not done because export returned a file.
- Always sample across the timeline and confirm the intended scenes are actually visible.
- For multi-scene generated videos, explicitly verify that sampled frames are not blank, not static, and not stuck on one generated frame/scene.
- For audio claims, verify the output has an audio stream or extracted audio file. Visual frame QA alone cannot prove voiceover exists.
- Do not present a visually frozen overlay/audio composite just because it has captions or audio; present the best verified artifact and report what was intentionally withheld.

Overlay/caption rule:

- HTML Motion/HyperFrames overlays are polish layers over generated footage, not the source of truth for the generated footage itself.
- If an overlay render freezes the base video, fall back to the verified stitched visual cut and fix the compositor rather than shipping the frozen composite.
- Caption layers must expose deterministic seek hooks. A custom setter alone is not enough if the compositor dispatches standard `prometheus-html-motion-seek` events.

Video canvas/editor distinction:

- Creative Video has at least three related but different timelines:
  - the scene-graph/editor timeline in the Video canvas
  - HTML Motion/HyperFrames deterministic composition timing
  - generated-footage rough-cut/composite timing in the Creative Generative Pipeline
- Do not assume a successful generated sequence automatically appears correctly on the visible canvas timeline. If assets exist but timeline is blank, debug editor placement/state separately from media generation.
- Do not conflate scene-graph `creative_apply_ops` style editing with generated-footage assembly. Video mode intentionally rejects many image/canvas scene-graph edit tools.

Self-edit lessons from this patch:

- When Creative tools expose a gap that forces shell FFmpeg, patch the Creative tool path, not the user workflow.
- Small, safe fixes should be made directly in the source with focused verification:
  - read the actual source path first
  - patch only the failing surface
  - preserve unrelated dirty worktree changes
  - run `npx tsc --noEmit --pretty false`
  - update this file after source verification
- The 2026-05-20 patch touched `src/gateway/creative/generative-pipeline.ts` and `src/gateway/routes/chat.router.ts`.
- `npx tsc --noEmit --pretty false` passed after the patch.
- `npm run build:backend` may exceed a short two-minute shell timeout even when TypeScript is clean; prefer a longer timeout or the narrower TypeScript check when only TS validity is needed.

Model/tool-surface note from 2026-05-20:

- xAI has a 200-tool payload limit.
- `chat.router.ts` must cap tools using the configured active provider as well as explicit provider/model overrides.
- A model-switch or low-tier note-writing turn can otherwise leak the full activated tool surface and fail with an error like `228 tools have been provided but the maximum is 200`.

Reusable HTML Motion preset capture:

- Prometheus now has native reusable-capture tools: `creative_save_html_motion_template`, `creative_save_html_motion_block`, and `creative_promote_scene_to_template`.
- Use native tools when the user wants the current Creative project to gain a reusable template/block.
- Use `html-motion-preset-author` when the user wants a portable bundled skill/preset package with template resources, examples, and QA notes.
- The preset-author workflow reads the active HTML motion clip, lints it, renders QA frames, extracts reusable HTML into `templates/*.html`, writes a bundled skill, and registers/syncs it.
- `holographic-globe-hyperframes-preset` is the first captured visual preset from the 2026-04-29 holographic globe test. It includes `templates/holographic-rotating-globe-light.html` and should be used for future holographic globe / orbital scan / wireframe earth requests.
