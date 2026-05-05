# Holographic Globe HyperFrames Preset Example

Use this when Raul asks for a holographic rotating globe, world model, orbital scan, cyber map, wireframe earth, or similar HTML motion / HyperFrames visual.

## Recommended output

- Format: landscape 1920x1080
- Duration: 9s by default
- Frame rate: 30fps unless Raul explicitly asks for 60fps
- Export path: `creative_export_html_motion_clip` with `format: "mp4"`
- QA: render at 500ms, 4500ms, and 8500ms before export

## Style tokens

- Background: near-black green `#020706`
- Primary accent: holographic teal `#5eead4`
- Highlight: pale mint `#dffff8`
- Effects: scanlines, orbit rings, dotted stars, soft vignette, radial glow

## Text defaults

- HUD: `Orbital scan online`
- Eyebrow: `Holographic Earth Model`
- Headline: `Slow rotating\nneon globe`
- Subcopy: `A luminous wireframe sphere with scanlines, orbit rings, particles, and subtle camera drift.`
- CTA: `HyperFrames hologram render`

## Export note

Prefer the CSS-only lightweight version for MP4 export. The canvas/rAF version looked richer but timed out around frame 56 during a 60fps export test. If rebuilding a richer version, keep particle counts low and avoid expensive per-frame shadow blur loops.