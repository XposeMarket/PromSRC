# frame.md Current Research — 2026-06-04

## What changed

Current public HyperFrames docs now position `frame.md` as the video-native companion to `design.md`:

- `design.md` describes the brand: colors, type, components, imagery, do/don't rules.
- `frame.md` directs the composition: pacing, scale, dwell time, motion language, scene rhythm, camera/frame behavior.
- For video/HyperFrames work, prefer `frame.md` when present. It is the missing translation layer from web/static design specs into frame-native video direction.

## File precedence for HyperFrames video projects

When creating or editing a HyperFrames project, inspect specs in this order:

1. `frame.md`
2. `FRAME.md`
3. `design.md`
4. `DESIGN.md`

If both `frame.md` and `design.md` exist:

- Treat `design.md` as brand facts.
- Treat `frame.md` as motion/composition direction.
- If they conflict on video behavior, `frame.md` wins.
- If they conflict on exact brand tokens, flag the conflict instead of silently inventing.

## Why it matters for Prometheus

This prevents the common failure mode where an agent turns a web design system into a moving website or slide deck. A good HyperFrames agent should first translate brand into video decisions:

- how long text should dwell on screen
- how large type must be for video
- which scenes are holds versus quick cuts
- which transitions are meaningful versus gratuitous
- what motion verbs fit each beat
- what texture/foreground/midground/background layers make the frame feel produced

## Captions update

Official/current caption guidance includes a registry-first path. Before building custom captions from scratch, check catalog components with:

```bash
npx hyperframes catalog --tag caption-style
```

Useful caption components include:

- `caption-highlight` — TikTok-style highlight
- `caption-pill-karaoke` — karaoke pill / lyric style
- `caption-editorial-emphasis` — documentary/editorial captions
- `caption-glitch-rgb` — cyber/glitch
- `caption-kinetic-slam` — full-screen hype captions
- `caption-neon-glow`, `caption-neon-accent`
- `caption-clip-wipe`, `caption-gradient-fill`
- `caption-matrix-decode`
- `caption-emoji-pop`
- `caption-parallax-layers`
- `caption-particle-burst`
- `caption-texture`
- `caption-weight-shift`

Caption hard rules remain:

- Use transcript timestamps.
- One group visible at a time.
- Add a deterministic hard kill at group end with `tl.set(... visibility: "hidden")`.
- Use `window.__hyperframes.fitTextFontSize()` for width safety.
- Never use `.en` Whisper models unless the user explicitly says the audio is English.

## CLI / inspector / validation reminders

Current docs confirm the CLI is the primary agent loop:

```bash
npx hyperframes lint
npx hyperframes inspect --samples 8
npx hyperframes snapshot
npx hyperframes render --output output.mp4 --fps 30 --quality standard
```

Use `inspect` as a visual-layout gate, not just `lint`. It catches clipped text, container overflow, text contrast issues, and frame/layout problems that structural lint cannot see.

For Prometheus specifically, never claim a strict HyperFrames video is done until the final exported MP4 is frame-verified, not merely linted or rendered.

## Audio / producer notes

HyperFrames audio is handled as timeline clips:

- video elements should be visual; audio should usually be separate `<audio>` elements
- use `data-volume` for mix levels
- use `data-media-start` for trims
- producer extracts audio from video/audio clips, applies offsets/volume, and mixes into the final MP4

For audio-reactive visuals, pre-extract deterministic audio data and sample per frame on the GSAP timeline. Do not use runtime Web Audio analysis, `Math.random()`, or wall-clock timing.

## Studio / inspector notes

`npx hyperframes preview` starts Studio with:

- iframe preview using the same runtime path as render
- visual timeline bars from parsed `data-start` / `data-duration` / `data-track-index`
- scrubber, frame-step, hot reload
- source editor / property inspector surfaces in `@hyperframes/studio`

For Prometheus, the useful direction is to mirror this mental model: source-backed clips + timeline inspection + property-level edits + actual frame snapshots.