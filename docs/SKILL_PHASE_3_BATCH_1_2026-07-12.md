# Skill Phase 3 batch 1 — 2026-07-12

## Anime.js — ready

The skill incorrectly used Anime.js v3 calls with the v4 IIFE. The v4 IIFE exposes an `anime` object, so the documented patterns now use `anime.animate()` and `anime.createTimeline()` with v4 easing options.

Chromium verification passed for:

- IIFE loading;
- animation creation;
- timeline creation;
- `window.__hfAnime` registration;
- `seek`, `pause`, and `play` methods;
- visible deterministic state changes after seeking.

## Lottie — partial

`lottie-web` loaded a disposable animation and successfully sought to frame 15/30. The dotLottie package root failed as a classic script because it expects CommonJS `exports`; the skill now uses the working ES-module import from the pinned CDN endpoint. `DotLottie` and `DotLottieWorker` exports were verified in Chromium.

The skill remains explicit-only and partial until a known-valid local `.lottie` asset is constructed, rendered, and sought end to end.

## Local media utilities — ready

The binaries were not absent. Prometheus already ships `@ffmpeg-installer/ffmpeg` and `@ffprobe-installer/ffprobe`; the old skill incorrectly assumed global PATH discovery.

Disposable tests passed for:

- bundled binary resolution;
- H.264/AAC fixture generation;
- FFprobe JSON with two streams and two-second duration;
- WAV audio extraction;
- PNG frame capture;
- clip trimming;
- 160×90 scaling and H.264/AAC transcoding;
- output existence and nonzero sizes.

## PPTX writer — blocked

`pptxgenjs` is not installed in Prometheus, and the documented `workspace/doc-skills-setup.js` installer does not exist. Per the dependency-failure rule, the skill and dependency tree were not modified. Required correction: choose and install a supported presentation dependency path, then generate and render-inspect a disposable deck before changing health.

## Catalog result

- 102 ready
- 12 partial
- 7 blocked
