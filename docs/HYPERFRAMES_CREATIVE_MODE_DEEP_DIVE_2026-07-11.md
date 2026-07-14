# HyperFrames and Prometheus Creative Mode deep dive — 2026-07-11

## Installed upstream set

Pinned official source: `heygen-com/hyperframes` commit `35c231e35f81c3f0dda820d83f1ddf69095f37d5`.

All 20 official skills were installed for Codex. Eighteen non-colliding skills were also installed in the Prometheus catalog. Prometheus retained its existing `hyperframes-cli` and `hyperframes-registry` directories because overwriting them would discard local Creative Mode behavior; the official versions are available in Codex and staged in the pinned audit checkout for a controlled merge.

Official specialist skills are explicit-only. `prometheus-creative-director` is the single broad production router, and `prometheus-hyperframes-bridge` defines the integration boundary.

## Existing Prometheus capability

Creative Mode already depends on HyperFrames `0.6.20`: core, engine, producer, studio, and CLI. It exposes 154 creative/video tool operations: 132 `creative_*`, 13 `hyperframes_*`, and 9 `video_*` operations.

Prometheus adds capabilities beyond the standalone HyperFrames authoring loop:

- persistent creative projects, storyboards, history, undo/redo, and checkpoints;
- asset import, generation, analysis, layer extraction, masks, and brand kits;
- generated video shots, selection/retry, continuity, stitching, rough cuts, and multi-track composition;
- voiceover, transcription, captions, music, SFX, mixing, and audio-sync checks;
- HyperFrames catalog import, typed patches, materialization, overlays, and hybrid compositing;
- frame, contact-sheet, keyframe, caption, audio, timeline, layout, and export QA.

## Ownership model

- HyperFrames owns deterministic HTML composition, timing attributes, seek-safe animation, components, linting, and scene rendering.
- Creative Mode owns project orchestration, assets, footage, generated shots, timeline editing, audio, QA evidence, and final delivery.
- Hybrid productions should render designed HyperFrames scenes or overlays inside the native Creative Mode timeline.

## Validation evidence

Passed:

- official skill installation;
- HyperFrames native parse/serialize round trip;
- Prometheus-normalized parse/serialize round trip;
- catalog block/component parsing;
- multiple catalog preview snapshots;
- local Creative Mode/HyperFrames package discovery.

Blocked or partial:

1. The catalog smoke test's producer call failed with `No frame files found in directory`. Diagnosis proved this is a test-harness configuration defect, not a Creative Mode renderer failure:
   - The direct test passes numeric `fps: 24`, but HyperFrames 0.6.20 requires the exact rational shape `{ num: 24, den: 1 }`. Numeric FPS becomes `undefined/undefined` in FFmpeg arguments, leaves `totalFrames` non-finite/null, and produces no frames.
   - The direct test does not expose Prometheus's bundled FFmpeg on `PATH`, so a one-worker streaming run fails earlier with `spawn ffmpeg ENOENT`.
   - With rational FPS and the bundled binary exposed, the direct producer captured 24/24 frames and generated a 60,553-byte MP4.
   - The real `renderHyperframesWithProducer` wrapper already supplies rational FPS and exposes bundled FFmpeg. It independently captured 24/24 frames at the authored 320×180 resolution and generated a 27,658-byte MP4.
   Required correction: update only `scripts/test-hyperframes-catalog-pipeline.mjs` to use the production wrapper, or mirror its rational-FPS and dependency-exposure setup. No production renderer repair is required for this failure.
2. The official Python `quick_validate.py` could not run because `PyYAML` is absent. Install `PyYAML` only if that validator is adopted as a required Prometheus dependency; the Prometheus loader/build remains the primary validation path meanwhile.
3. Merge current official `hyperframes-cli` and `hyperframes-registry` references into the Prometheus copies without deleting local bridge behavior.
4. Several official workflow entrypoints are very large. Keep them explicit-only and load only the selected workflow; do not make the upstream umbrella skill an automatic router.

## Recommended next implementation batch

1. Correct the catalog smoke-test harness to exercise `renderHyperframesWithProducer` rather than bypassing production dependency setup.
2. Add a disposable end-to-end fixture: author → insert → typed patch → lint → materialize → QA → render → contact sheet.
3. Merge the two colliding official skills reference-by-reference.
4. Add routing tests proving one Creative Director match, zero implicit upstream specialists, and explicit specialist selection.
5. Forward-test product launch, talking-head recut, music video, and faceless explainer workflows after encoding passes.
