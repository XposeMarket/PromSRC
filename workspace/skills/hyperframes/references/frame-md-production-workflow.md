# frame.md Production Workflow for Prometheus HyperFrames

Use this for any serious HyperFrames video, promo, launch clip, captioned video, or multi-scene composition.

## Core distinction

- `design.md` / `DESIGN.md` = brand facts: colors, typography, logo, imagery constraints, component style, do/don't rules.
- `frame.md` / `FRAME.md` = video direction: pacing, scene rhythm, dwell time, scale, camera/framing, transition rules, motion vocabulary, readability, and what the viewer should feel per beat.

When both exist, `frame.md` wins for video behavior. `design.md` wins only for exact brand tokens unless `frame.md` explicitly declares a video-safe adaptation. If they conflict on exact colors/fonts/logo use, flag it instead of inventing.

## Required read order

Before authoring/editing HyperFrames HTML, inspect in this order:

1. `frame.md`
2. `FRAME.md`
3. `design.md`
4. `DESIGN.md`
5. `SCRIPT.md` / `script.md` when narration/captions exist
6. `STORYBOARD.md` / `storyboard.md` when scenes are preplanned
7. Any reference images/videos/assets

If no `frame.md` exists and the task is non-trivial, create a short one before coding. For quick one-scene tests, hold the same fields mentally, but still write them into `frame.md` if the project will be reused or rendered.

## Minimum frame.md template

```md
# frame.md — [Project Name]

## Intent
One sentence: what the viewer should understand/feel.

## Format
- Aspect ratio / dimensions:
- Duration:
- FPS:
- Platform/context:

## Visual translation from design.md / references
- Palette:
- Typography scale:
- Texture/material language:
- Avoid:

## Pacing and readability
- Scene rhythm:
- Minimum dwell for important text:
- Max words on screen:
- Text safe area:

## Motion vocabulary
- Entrances:
- Continuous motion:
- Transitions:
- Exits:
- Forbidden motion tells:

## Beat list
| Time | Beat | Viewer focus | Motion | Text |
|---:|---|---|---|---|
| 0.0-1.5 | | | | |

## QA gates
- Lint:
- Inspect samples:
- Hero-frame inspect timestamps:
- Export frame verification timestamps:
```

## Prometheus defaults when Raul gives only a vibe/reference image

Convert the vibe into a frame spec instead of jumping into HTML:

- Palette: extract 4-7 dominant colors and name their roles (paper, ink, accent, shadow, highlight).
- Materials: name tactile surfaces (newsprint, enamel, wood, CRT, glass, oxidized metal, etc.).
- Motion: choose 3-5 verbs (stamp, slide, reveal, parallax, flicker, scan, hinge, smear, shutter).
- Pacing: slow enough to read; no rapid scene cuts unless explicitly requested.
- Anti-AI-tells: avoid purple/blue SaaS gradients, meaningless glows, generic rounded cards, random HUD ornaments, and tiny web UI text.

## Beat planning rule

Every beat should define:

1. the stable hero frame first;
2. what moves into it;
3. what keeps moving after entrance;
4. how the eye exits to the next beat;
5. why the transition belongs.

If a beat only says "fade in text," it is under-directed. Add composition, material, depth, or motion intent.

## QA relationship

The `frame.md` QA section should drive the CLI/dev loop:

```bash
npx hyperframes lint
npx hyperframes validate
npx hyperframes inspect --samples 8
npx hyperframes inspect --at <hero timestamps>
npx hyperframes render --output final.mp4 --fps 30 --quality standard
```

Then verify the actual exported MP4 frames, not just the source HTML or CLI success.
