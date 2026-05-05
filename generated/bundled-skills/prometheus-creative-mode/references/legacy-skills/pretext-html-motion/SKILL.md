---
name: Pretext HTML Motion
description: >
  Build deterministic Pretext-powered kinetic typography, text-flow, glyph-particle, ASCII/text-geometry clips inside Prometheus Creative Video mode using HTML Motion rather than standalone browser demos. Triggers on: pretext demo, text flowing around a shape, kinetic typography, glyph particles, shatter text, text as geometry, ASCII typography, creative text layout, HTML motion typography, and canvas text animation. Use this when the user wants Pretext-style browser/canvas typography adapted into Prometheus Creative Video, social clips, product promos, or reusable HTML Motion presets.
emoji: 🌀
version: 1.0.0
triggers: pretext, pretext demo, text flow, text flowing around shape, kinetic typography, glyph particles, text particles, shatter text, typographic motion, ascii typography, text as geometry, creative text layout, HTML motion typography, canvas text animation
---

# Pretext HTML Motion

Use `@chenglou/pretext` as a deterministic text-layout primitive inside **Prometheus Creative Video mode**. The output is not a standalone `/tmp` browser demo by default; it is an HTML Motion clip that can be previewed, QA’d, patched, exported, and reused inside Prometheus.

---

## Core Principle

Pretext returns geometry: line breaks, line widths, grapheme positions, and measured text flow. Prometheus supplies the production lane: Creative Video mode, HTML Motion, asset placeholders, snapshots, lint/text-fit checks, and MP4 export.

**Treat Pretext as a motion-design primitive, not a page-layout library.** Use it when knowing the text geometry before drawing unlocks a visual effect.

---

## When To Use This

Use this skill when the request involves:

- text flowing around a moving orb, logo, product, cursor, person, or object
- kinetic typography with per-letter/per-glyph motion
- text particles, shatter/reassemble effects, swarm/flock letters, or magnetic words
- ASCII-like typography using real prose instead of rasterized monospace only
- editorial/magazine layouts where paragraphs wrap around animated callouts or shapes
- text-as-geometry games, obstacles, bricks, fields, maps, or constellations
- deterministic multiline text fitting before rendering
- adapting Hermes/Pretext demos into Prometheus Creative Video mode

Do **not** use this for ordinary static text cards, simple CSS wrapping, normal captions/subtitles, or image-to-ASCII conversion. For normal caption reels, use the caption/Remotion path. For pure ASCII conversion from video/image, use the ASCII video skill.

---

## Prometheus-Native Workflow

1. **Load the Creative Video authority layer first.** Read `creative-director-video`, `html-motion-video`, and `prometheus-hyperframes-bridge` when making an actual video clip.
2. **Switch to Creative Video mode.** Use Prometheus Creative Video/HTML Motion tools, not raw files + local web server.
3. **Choose a Pretext pattern** from the pattern table below.
4. **Author an HTML Motion clip** with complete inline HTML/CSS/JS. Prefer `creative_create_html_motion_clip` when no built-in template fits.
5. **Use Pretext inside the clip** for layout and glyph positions. If remote ESM imports are unavailable, use the fallback layout shim from `references/pretext-fallback-layout.md` until Pretext is bundled locally.
6. **Use real copy.** No lorem ipsum. Use product manifesto, founder copy, code, transcript excerpts, user-provided text, or short editorial prose that fits the brief.
7. **Run deterministic text fit.** Use `creative_measure_text`, HTML motion lint, or text-fit reports for major copy slots before relying on snapshots.
8. **Preview frames visually.** Render early, middle, and near-end frames. For text-particle effects, also inspect the most chaotic transition moment.
9. **Patch and rerender** until no clipped text, overlap, blank frame, unreadable contrast, or weak motion progression remains.
10. **Export only after QA passes.** Mention the exported path and what QA was sampled.

---

## Pattern Library

| Pattern | Use For | Pretext Geometry | Visual Direction |
|---|---|---|---|
| `pretext-orb-reflow` | prose flowing around a moving orb/logo/product | streaming line ranges + per-row width/left edge | premium editorial, AI bends information around the work |
| `pretext-particle-shatter` | letters explode, magnetize, or reassemble | grapheme positions from laid-out lines | hook moments, chaos-to-clarity, title reveals |
| `pretext-ascii-mask` | real prose forms a logo/symbol/field | line/glyph grid sampled against a mask | terminal aesthetic, product bumper, code-art |
| `pretext-editorial-crawl` | magazine spread, article wrap, pull quote | variable columns and obstacle spans | Claude-style product film, founder manifesto |
| `pretext-word-game` | words as bricks/obstacles/colliders | word/line bounding boxes | playful demos, social experiments, puzzle metaphors |
| `pretext-magnetic-headline` | headline glyphs pulled by cursor or product | per-grapheme anchor positions | interactive-feeling UI videos, “agent at work” motion |

Pick one pattern before writing code. If the user only says “make a cool Pretext thing,” default to `pretext-orb-reflow` or `pretext-particle-shatter` because they show the value fastest.

---

## HTML Motion Implementation Rules

- Output must be a **complete HTML document** with inline CSS and inline JS.
- Set fixed stage dimensions: usually `1080x1920` for vertical social or `1920x1080` for product films.
- No `/tmp` demo workflow, no Python server, no standalone browser preview unless the user explicitly asks for a separate artifact.
- Avoid external network dependencies except the pinned Pretext ESM import if runtime policy allows it:

```js
import {
  prepare,
  layout,
  prepareWithSegments,
  layoutWithLines,
  layoutNextLineRange,
  materializeLineRange,
  measureLineStats,
  walkLineRanges
} from "https://esm.sh/@chenglou/pretext@0.0.6";
```

- If remote imports are not allowed, use the fallback shim resource and write the clip so `window.PretextLike` can be swapped with real Pretext later.
- Use system fonts unless a font asset is imported. Good defaults: `Georgia`, `Iowan Old Style`, `Inter`, `system-ui`, `Helvetica Neue`, `JetBrains Mono`, `ui-monospace`.
- Use `{{asset.id}}` placeholders for images/video/logo assets. Never put absolute Windows paths in HTML.
- Add region markers for future patches:

```html
<!-- @prometheus-region pretext-canvas -->
<canvas id="pretextCanvas" width="1080" height="1920"></canvas>
<!-- /@prometheus-region pretext-canvas -->
```

---

## Pretext Coding Patterns

### Fixed-width multiline canvas rendering

```js
const font = "500 42px Georgia";
const lineHeight = 56;
const prepared = prepareWithSegments(copy, font);
const { lines } = layoutWithLines(prepared, 840, lineHeight);

ctx.font = font;
ctx.textBaseline = "top";
for (let i = 0; i < lines.length; i++) {
  ctx.fillText(lines[i].text, 120, 220 + i * lineHeight);
}
```

### Streaming variable-width text around a moving object

```js
let cursor = { segmentIndex: 0, graphemeIndex: 0 };
let y = 180;
while (true) {
  const span = corridorAtY(y, orb); // { left, width }
  const range = layoutNextLineRange(prepared, cursor, span.width);
  if (!range) break;
  const line = materializeLineRange(prepared, range);
  ctx.fillText(line.text, span.left, y);
  cursor = range.end;
  y += lineHeight;
}
```

### Glyph particles from laid-out text

```js
const anchors = [];
for (const line of lines) {
  for (const glyph of line.graphemes ?? []) {
    anchors.push({ char: glyph.text, x: line.x + glyph.x, y: line.y, tx: line.x + glyph.x, ty: line.y });
  }
}
```

If the exact Pretext structure differs, adapt by using `Intl.Segmenter` and `ctx.measureText` to recover grapheme x positions from each materialized line. The important part is deterministic anchors before animation.

---

## Visual Direction Defaults

Do not make a bland terminal demo. Pick a look:

| Style | Palette | Best For |
|---|---|---|
| Editorial Ink | cream `#f4ede1`, ink `#161411`, tomato `#c44a2c` | thoughtful launch, product story, founder copy |
| Mono Noir + Lime | black `#070707`, white `#f7f7f2`, lime `#bef264` | dev tools, data, agent workflows |
| Amber CRT | black `#050402`, amber `#ffb000`, ember `#ff5a1f` | terminal nostalgia, code, cyberpunk |
| Clay + Sand | clay `#1f1611`, sand `#f4e7d0`, terracotta `#d97757` | premium analog, local business, craft |
| Graphite + Mint | graphite `#111827`, white `#f8fafc`, mint `#5eead4` | polished software/product demos |

Add at least two production details: grain, glow, scanline, card frame, cursor path, progress rail, animated mask, subtle camera drift, or CTA/outro. Do not use random rectangles as decoration.

---

## QA Checklist

Before saying it is done:

- [ ] Text source is meaningful and not placeholder/lorem.
- [ ] Early frame is not blank and already looks intentional.
- [ ] Mid frame shows the actual Pretext effect, not a static card.
- [ ] Near-end frame has a resolved composition or CTA/outro.
- [ ] No clipped text, broken wrapping, single-letter columns, or illegible contrast.
- [ ] Main text stays inside platform safe areas.
- [ ] Motion has at least three meaningful beats.
- [ ] Assets use `{{asset.id}}`, not absolute paths.
- [ ] If Pretext ESM import was used, note that the clip currently depends on pinned `@chenglou/pretext@0.0.6`; if offline export/runtime blocks it, swap to the fallback shim or vendor the library.

---

## Anti-Patterns

- Do not port Hermes’ `/tmp` + Python server workflow as the default.
- Do not deliver a “hello world” canvas with one moving circle and plain text.
- Do not rely on DOM layout reads for the central effect. That defeats the point.
- Do not use lorem ipsum.
- Do not default to AI-cliché purple/blue gradients.
- Do not claim production quality without rendered frame QA.
- Do not patch a corrupted/stale timeline forever. If duplicated layers or ghost content appear, checkpoint/purge/rebuild.

---

## Reusable Output Shape

When finalizing a Pretext HTML Motion build, report briefly:

```md
Done — created `[clip name]`.
- Pattern: `pretext-orb-reflow`
- Format: vertical 1080x1920, 8s
- QA: checked frames at 500ms / 4000ms / 7500ms
- Export: `workspace/.../clip.mp4`
- Note: uses pinned `@chenglou/pretext@0.0.6` or fallback shim
```

Keep the explanation short unless Raul asks to inspect the implementation.
