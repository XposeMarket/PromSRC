# Holographic Globe HyperFrames Preset

## Purpose

Use this skill when Raul asks for a holographic rotating globe, neon wireframe globe, orbital scan, cyber earth, world-map hologram, or a reusable HyperFrames-style globe visual in Prometheus Creative Video mode.

This preset was captured from the 2026-04-29 globe test that Raul reacted strongly to. The goal is to preserve the look while making future exports faster and more reliable.

## Default creative direction

- Landscape 1920x1080.
- 9 seconds unless the user specifies otherwise.
- Holographic teal / mint-on-near-black palette.
- Slow globe rotation with scanlines, orbit rings, star particles, HUD readout, and subtle vignette.
- Trailer / launch-video energy, not a plain science-class globe.

## Tool workflow inside Prometheus

1. Read `prometheus-hyperframes-bridge`, `html-motion-video`, and `creative-director-video` if doing broader video work.
2. Switch into video creative mode with `switch_creative_mode({ mode: "video" })`.
3. Create an HTML motion clip using `templates/holographic-rotating-globe-light.html` as the base HTML.
4. Set composition metadata to:
   - width: `1920`
   - height: `1080`
   - durationMs: `9000`
   - frameRate: `30`
5. Render QA snapshots at `500`, `4500`, and `8500` ms.
6. Export MP4 at 30fps only after frame QA passes.

## Important export rule

Default to 30fps for HTML motion / HyperFrames exports. 60fps is overkill for this class of generated HTML clip and can make rendering/export much slower without meaningful visual improvement. Only use 60fps if Raul explicitly requests it.

## Performance lessons from the first version

The original rich canvas/rAF version looked excellent but timed out during MP4 export around frame 56 in a 60fps render. The safer reusable base is the CSS-only lightweight HTML template bundled in `templates/holographic-rotating-globe-light.html`.

If you make a richer future version:

- Keep particle counts low.
- Avoid many per-frame canvas shadowBlur calls.
- Avoid random initialization that causes nondeterministic frame output unless seeded.
- Prefer CSS transforms/repeating gradients for grid motion.
- Test snapshots before export.
- Use 30fps.

## Customization knobs

Patch these first instead of rewriting the whole clip:

- Accent color: CSS variable `--teal`.
- Highlight color: CSS variable `--pale`.
- HUD copy: `.hud span` text.
- Headline: `h1` content.
- Subcopy: `.sub` content.
- CTA: `.cta` content.
- Rotation speed: `rotateGrid`, `landShift`, and `ring` animation durations.
- Density: background-size on `.stars`, ring dimensions, and latitude/longitude spacing in CSS gradients.

## QA gate

Before claiming the clip is done, inspect early/mid/late snapshots. Do not export or present as complete if:

- text is unreadable or overlapping,
- the globe is too dim,
- the scene looks static across samples,
- the CTA does not appear near the end,
- the design regresses into a generic purple/blue AI gradient,
- export settings accidentally return to 60fps.
