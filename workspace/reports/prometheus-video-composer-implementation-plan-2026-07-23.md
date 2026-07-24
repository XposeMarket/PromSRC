# Prometheus Video Composer — Implementation Plan

**Date:** 2026-07-23  
**Status:** Source-grounded implementation specification  
**Owner:** Prometheus / Raul

## Product goal

Turn Creative Video into a real AI-directed, editable production system. A user can supply one long recording or 1–10 video clips, optional images, music, voiceover, screen recordings, and a natural-language edit instruction. Prometheus produces a persistent editable Creative timeline, performs deterministic cuts and trims, adds captions and an audio mix, inserts one source-backed HyperFrames/HTML Motion sequence when requested, derives social aspect variants, renders the actual MP4, and blocks completion when technical or visual QA fails.

The existing `video_social_cut` remains a separate, fast repurposing product. It gains a receipt-to-composition handoff rather than being absorbed into the editor.

## Verified current state

Prometheus is not starting from zero.

- `CreativeComposition` in `src/gateway/creative/contracts.ts` already models tracks, clips, source-video, HTML Motion, Remotion, HyperFrames, audio tracks, captions, trims, positions, and transitions.
- `src/gateway/creative/composition.ts` already provides deterministic add/move/trim/split/delete/select/transition mutations and linting.
- `src/gateway/creative/renderers/composition_renderer.ts` already renders real source-video through FFmpeg, supports cover/contain/blurred-background fitting, source audio, hooks, captions, external audio mixing, hardware encoders, and export persistence.
- `src/gateway/routes/canvas.router.ts` already persists compositions and exposes composition render/lint routes.
- Creative Video UI already has composition handlers, timeline controls, asset drop, tracks, and render actions.
- HyperFrames catalog access is live and currently exposes 47 source-backed catalog items, including charts, flowcharts, app showcases, and transitions.
- The assistant Creative surface currently exposes wrapper-first tools plus roughly 120 duplicate low-level raw tools. Compatibility dispatch is useful, but the duplicated assistant-visible schema is unnecessary model/tool noise.

### Verified gaps

1. Composition rendering globally sorts and concatenates visual clips. Multiple visual tracks, overlaps, and stored transitions are not faithfully rendered as a master timeline.
2. Source dialogue and music are not managed through a first-class loudness/ducking policy. Track volume and fades are not loudness normalization.
3. There is no typed project-owned sequence manifest connecting source provenance, canonical composition, caption/audio policy, edit history, variants, exports, and QA.
4. Existing rough-cut, generated-sequence, layer-composite, and composition concepts overlap. `CreativeComposition` must become the canonical editable assembly model.
5. Natural-language edits need an interpret → validate → deterministic operation pipeline. The model must never directly rewrite arbitrary timeline JSON.
6. `video_social_cut` produces a strong receipt and exact artifact identity, but cannot formally import that result into Creative.
7. QA exists in pieces but lacks one consolidated sequence export receipt covering decode, streams, dimensions, duration, clip-order evidence, transition boundaries, captions, safe areas, audio loudness/ducking, and exact SHA-256 artifact identity.
8. Raw Creative primitives remain assistant-visible despite wrapper equivalents.

## Architecture decision

### Canonical timeline

`CreativeComposition` is the canonical editable sequence timeline.

- Source footage is represented as `source-video` clips.
- HyperFrames, HTML Motion, and Remotion are timeline clip sources/inserts.
- Scene graph remains the intra-shot image/motion composition system. It is not a second NLE timeline.
- Existing composition mutation helpers remain the deterministic edit kernel.

### New sequence layer

Add a typed `CreativeSequenceDoc` that owns:

- stable sequence ID/version/title
- analyzed source records and provenance
- the canonical `CreativeComposition`
- caption policy and generated/imported caption track references
- dialogue loudness policy
- music bed and ducking policy
- one bounded source-backed motion insert in the first release
- natural-language edit history with resolved deterministic operations
- derived aspect variants
- render/export records
- consolidated QA receipts

The sequence layer orchestrates existing primitives. It does not invent a parallel renderer or storage model.

### High-level assistant API

Add a public, product-shaped `video_compose` façade with actions such as:

- `create`
- `inspect`
- `add_source`
- `add_social_cut_result`
- `assemble`
- `plan_edit`
- `apply_edit`
- `captions`
- `audio_policy`
- `add_motion_insert`
- `create_variant`
- `lint`
- `render`
- `qa`
- `export`

This façade delegates to sequence orchestration and existing composition operations.

`video_social_cut` continues to own fast source extraction, vertical reframing, burned captions, and its compact QA receipt. `video_compose(add_social_cut_result)` validates `qa.passed`, imports the exact artifact, verifies SHA-256 when supplied, and preserves the receipt path/range as provenance.

### Tool cleanup policy

Do not delete raw executor cases or break persisted callers in the first pass.

- Public ordinary surface: `creative_project`, `creative_scene`, `creative_image_ops`, `creative_video_ops`, `creative_hyperframes_ops`, `creative_quality_ops`, `video_social_cut`, and `video_compose`.
- Raw primitives remain dispatchable compatibility/internal endpoints.
- Hide exact wrapper-equivalent raw registrations from normal assistant injection.
- Keep explicit diagnostics available through wrappers.
- Add compatibility telemetry before hard removal.

## Implementation phases

## Phase 1 — Canonical editable sequence foundation

1. Add sequence contracts, normalizers, policies, variants, edit-operation records, provenance, and QA references.
2. Add a sequence module that creates, persists, reloads, resolves clip references, and applies validated operation batches through `composition.ts`.
3. Add a deterministic sequential assembly constructor for 1–10 source clips.
4. Explicitly lint unsupported overlaps/multiple active video lanes until the upgraded renderer lands.
5. Add `video_compose` tool definition and executor routing.
6. Add `video_social_cut` receipt import with exact-file provenance.
7. Add unit coverage for create/reload, trim, split, reorder, ripple delete, ambiguous references, and social-cut import validation.

## Phase 2 — Real audio and caption pipeline

1. Add clip-local transcript → master timeline caption retiming.
2. Add sequence caption policies: off, auto-dialogue, imported; clean/minimal/kinetic presets; safe-area placement.
3. Add cached two-pass FFmpeg `loudnorm` planning for dialogue.
4. Add music ducking through FFmpeg sidechain compression or deterministic speech envelopes.
5. Emit measured loudness/ducking status; never label simple volume changes as normalization.
6. Test trimmed caption boundaries, multi-clip offsets, music recovery, no-speech fallback, and A/V duration alignment.

## Phase 3 — Timeline-aware renderer

1. Replace concat-only visual semantics with a master FFmpeg timeline plan where supported.
2. Implement the bounded transition set: cut, crossfade, dip-to-black.
3. Respect absolute clip placement and active visual-track order.
4. Mix source dialogue, voiceover, music, and SFX into a master audio bus.
5. Preserve direct source-video FFmpeg paths and avoid PNG-frame rendering for ordinary footage.
6. Fail lint/render explicitly for unsupported overlap/transition combinations rather than silently approximating.

## Phase 4 — HyperFrames/HTML Motion insert and variants

1. Browse/import real catalog sources; never synthesize a lookalike when a catalog item was requested.
2. Support one editable HyperFrames/HTML Motion insert in the initial sequence release.
3. Preserve editable slots, source identity, authored dimensions/FPS, and render metadata.
4. Derive 9:16, 1:1, 4:5, and 16:9 variants without mutating the master.
5. Start with center-crop/contain/manual policies plus crop-risk warnings; add subject-aware reframing after deterministic parity.

## Phase 5 — Creative UI and natural-language editing

1. Make composition state the source of truth for multi-clip Video Mode.
2. Add a purpose-built sequence timeline module rather than overloading scene-graph internals.
3. Expose source range, trim, fit, transition, captions, audio policy, insert, variant, render, and QA status.
4. Implement natural-language planning as:
   - instruction → declarative edit plan
   - stable reference resolution
   - validation/unresolved decisions
   - deterministic operation application
   - pre/post summaries and durable edit history
5. Never mutate raw timeline JSON directly from model prose.

## Phase 6 — Consolidated sequence QA receipt

Every serious export must record:

- exact artifact path and SHA-256
- full decode result
- H.264/AAC or requested codec/stream presence
- dimensions, FPS, and duration tolerance
- expected clip order and representative sampled frames
- start/mid/end plus every transition midpoint
- caption-heavy samples and safe-area checks
- HyperFrames/HTML Motion insert midpoint and source-backed lint/QA
- audio duration alignment
- measured dialogue loudness status
- measured ducking behavior or explicit fallback warning
- nonblank/changing visual evidence
- warnings and blocked acceptance checks

## Initial user contract

Example:

> Make an editable 9:16 reel from these four clips. Open with clip 3, use seconds 2–7 of clip 1, then clip 2. Add captions, normalize the dialogue, put this music underneath and duck it during speech, use short dissolves, insert this HyperFrames flowchart after clip 2, and also make a 1:1 version.

Initial limits:

- 1–10 source videos
- optional images, voiceover, and one music bed
- one HyperFrames/HTML Motion insert
- sequential primary video lane, with bounded overlays
- cut/crossfade/dip-to-black
- 30fps default
- bounded output resolutions
- editable master plus selected aspect variants

Not in the first release: multicam synchronization, NLE-grade color grading, arbitrary nested compositions, unlimited overlays, arbitrary keyframe curves, or false claims of automatic intelligent reframing.

## Acceptance suite

### Foundation

- Create sequences from 1, 3, and 10 clips.
- Persist/reload to an equivalent normalized document.
- Reorder, trim, split, ripple delete, and set transitions without corrupting duration.
- Reject unresolved/ambiguous clip references.
- Import only QA-passed social-cut receipts and preserve exact provenance.

### Audio/captions

- Retimed words/segments remain aligned after source trims and master placement.
- Dialogue meets configured integrated loudness within ±1 LU when measurable.
- Music attenuation is measurably lower during known speech windows and recovers after release.
- Missing analysis yields an explicit warning/fallback, never a false pass.

### Rendering

- Output decodes fully and contains expected video/audio streams.
- Clip order and transition samples visually match the timeline.
- Stored transitions are either faithfully rendered or rejected before export.
- Source audio, external audio, and output duration remain aligned.

### Motion insert

- A real catalog HyperFrames/HTML Motion insert survives save/reload with source and editable slots intact.
- Lint and representative-frame QA pass before composition export.
- A second insert in strict initial mode is rejected clearly.

### Variants/UI

- Deriving 9:16 and 1:1 leaves the master unchanged.
- Each variant owns a separate export and QA result.
- Timeline edits made in UI persist and render identically server-side.
- Natural-language changes produce visible validated operation history.

## Source scope

Primary source files expected to change:

- `src/gateway/creative/contracts.ts`
- `src/gateway/creative/composition.ts`
- `src/gateway/creative/sequence.ts` (new)
- `src/gateway/creative/sequence-qa.ts` (new)
- `src/gateway/creative/audio.ts`
- `src/gateway/creative/generative-pipeline.ts`
- `src/gateway/creative/renderers/composition_renderer.ts`
- `src/gateway/tools/defs/creative-tools.ts`
- `src/gateway/tools/defs/file-web-memory.ts`
- `src/gateway/tool-builder.ts`
- `src/gateway/agents-runtime/subagent-executor.ts`
- `src/gateway/agents-runtime/capabilities/web-media-executor.ts`
- `src/gateway/routes/canvas.router.ts`
- `web-ui/src/components/creative/sequenceTimeline.js` (new)
- `web-ui/src/components/creative/audioEngine.js`
- `web-ui/src/components/creative/exportEngine.js`
- `web-ui/src/components/creative/hyperframesController.js`
- `web-ui/src/pages/ChatPage.js`
- correlated `self/creative/*` and `self/05-tools.md` documentation

## Delivery discipline

- Preserve all existing dirty work and compatibility routes.
- Build in coherent vertical slices, with each slice remaining usable.
- Use shared packaged FFmpeg/FFprobe resolution; never assume PATH or recursively search drives.
- Default video export to 30fps.
- Inspect real rendered frames and exported files before claiming visual success.
- Do not remove raw compatibility endpoints until telemetry proves safe.
- Update correlated `self/` documentation in the same completion pass.
