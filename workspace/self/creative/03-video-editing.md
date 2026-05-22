## 6C) Creative Video and Editing Capabilities

Video creative mode is first-class.
It supports:

- editable scene graph video timelines
- multi-clip composition timelines with video/audio/caption tracks
- Remotion motion templates
- HTML Motion clips
- source-backed HyperFrames clips
- HTML Motion deterministic frame sequence MP4 export
- browser MediaRecorder-style export path for scene graph output
- audio track config and analysis
- frame snapshots and contact sheets
- QA reports

Video/audio structures exist in:

- `src/gateway/creative/audio.ts`
- `src/gateway/creative/composition.ts`
- `src/gateway/creative/renderers/composition_renderer.ts`
- `web-ui/src/components/creative/audioEngine.js`
- `web-ui/src/components/creative/exportEngine.js`

Audio track config supports:

- `source`
- `label`
- `startMs`
- `durationMs`
- `trimStartMs`
- `trimEndMs`
- `volume`
- `muted`
- `fadeInMs`
- `fadeOutMs`
- analysis/waveform metadata

Clip trimming and speed metadata are exposed through `creative_trim_clip`, which maps to `apply_ops` with `set-clip` and supports:

- `startMs`
- `endMs`
- `durationMs`
- `trimStartMs`
- `trimEndMs`
- `speed`
- `loop`

The multi-clip composition model is separate from the scene-graph element timeline.
Source-backed composition clips currently use lanes:

- `html-motion`
- `remotion`

Composition track kinds currently include:

- `video`
- `audio`
- `caption`

Composition tools currently include:

- `creative_composition_get`
- `creative_composition_add_track`
- `creative_composition_add_clip`
- `creative_composition_move_clip`
- `creative_composition_trim_clip`
- `creative_composition_split_at`
- `creative_composition_delete_clip`
- `creative_composition_set_transition`
- `creative_composition_select_clip`
- `creative_composition_lint`
- `creative_composition_render`
- `creative_composition_save`

Composition routes in `canvas.router.ts` currently include:

- `GET /api/canvas/composition`
- `POST /api/canvas/composition`
- `POST /api/canvas/composition/render`
- `POST /api/canvas/composition/lint`

For CapCut-like workflows, current Prometheus pieces are:

- `analyze_video` for source analysis/transcript/frame sampling
- `video_extract_clip_frames` and `video_render_contact_sheet` for visual review
- `creative_import_asset` / `creative_analyze_asset` for asset registration
- `creative_add_asset` for scene graph placement
- `creative_trim_clip` for source range/speed/loop metadata
- HTML Motion `video` elements with `data-start`, `data-duration`, `data-trim-start`, and `data-offset`
- frame QA before export

Current limitation:

- HTML Motion MP4 export is strongest for visual composition and deterministic frame output.
- If preserving, mixing, or ducking source audio matters, verify audio sync and use the broader audio/video path or add an explicit muxing step.
- Scene-graph video render jobs are now tracked under `prometheus-creative/render-jobs`, but the agent still needs to inspect rendered frames directly before declaring video work finished.
