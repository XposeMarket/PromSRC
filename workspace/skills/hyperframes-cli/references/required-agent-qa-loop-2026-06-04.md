# Required Agent QA Loop — HyperFrames CLI (Prometheus)

This is the default no-ship gate for Prometheus-authored HyperFrames projects.

## Why

`npx hyperframes lint` is structural. It does not prove frames are readable or the exported MP4 is good. `inspect` catches clipped text, overflow, and visual-layout problems at timeline samples. Final MP4 frame verification catches black/frozen/bad exports.

## Required sequence

Run from the real HyperFrames project folder:

```bash
npx hyperframes lint
npx hyperframes validate
npx hyperframes inspect --samples 8
npx hyperframes inspect --at <comma-separated hero timestamps>
npx hyperframes render --output final.mp4 --fps 30 --quality standard
```

If `validate` is unavailable or returns a command-not-found style CLI error, record that exact fact and continue with lint + inspect + render. Do not silently pretend validate passed.

## Inspect handling

Treat `inspect` findings as follows:

- `clipped_text` = fix before render unless explicitly intentional and visually safe.
- `text_box_overflow` = fix before render unless it is a deliberate kinetic/overscale moment and has safe-area headroom.
- `container_overflow` = fix unless decorative/intentional; if intentional, mark the element or ancestor with `data-layout-allow-overflow`.
- `canvas_overflow` during ticker/marquee/entrance/exit = acceptable only if intentional and marked with `data-layout-allow-overflow`.
- Decorative grains, textures, offscreen accents, and mask elements may use `data-layout-ignore` when inspection noise would hide real issues.

After marking intentional overflow, rerun inspect and make sure only accepted warnings remain.

## Hero-frame inspection

In addition to a timeline sweep, inspect explicit hero frames from `frame.md` / storyboard:

```bash
npx hyperframes inspect --at 0.5,1.5,3.0,5.5,7.5
```

Hero timestamps should cover:

- opening readable state;
- densest text/card state;
- major transition midpoint;
- final CTA/logo state;
- any caption-heavy moment.

## Render settings

- Draft iterations: `--quality draft`
- Review/final default: `--quality standard --fps 30`
- Only use `--fps 60` / `--quality high` when Raul asks for final polish or motion demands it; expect slower render.

## Export verification no-ship gate

After render, verify the actual `final.mp4`:

- Duration and frame count are plausible for the project duration/FPS.
- Sampled frames are not black, blank, or frozen.
- Main visual direction from `frame.md` appears.
- Required text/logo/assets appear in the relevant sampled frames.
- Captions, if present, are readable and not simultaneously overlapping.

Use Prometheus media/video analysis tools when available, or safe local media diagnostics and frame sampling. Do not claim done from file existence alone.

## Final report contract

For Raul, final HyperFrames delivery should state:

- project path;
- source `index.html`;
- `frame.md` / `design.md` status;
- exported MP4 path;
- checks run and results;
- final MP4 frame-verification status;
- accepted non-fatal warnings, if any.
