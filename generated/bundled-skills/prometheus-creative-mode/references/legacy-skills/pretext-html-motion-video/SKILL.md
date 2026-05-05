---
name: Pretext HTML Motion Video
description: >
  Adapt @chenglou/pretext typographic layout demos into Prometheus Creative Video / HTML Motion clips. Use this when the user asks for Pretext inside Creative Video mode, text flowing around a moving shape, kinetic typography, glyph particles, ASCII/text-as-geometry motion, editorial text-flow clips, or a Prometheus-native version of the Hermes pretext skill. This skill routes away from standalone browser demos and toward Creative Video canvas preview, frame QA, and MP4 export.
emoji: ✒️
version: 1.0.0
triggers: pretext video, pretext creative, text flowing around shape, text around orb, kinetic typography pretext, text as geometry, glyph particles, ascii text motion, typographic flow video, create pretext clip, pretext html motion, text layout animation
---

# Pretext HTML Motion Video

Use this skill to turn `@chenglou/pretext` into a **Prometheus Creative Video primitive**: deterministic text layout + Canvas drawing + HTML Motion export. The upstream Hermes skill produces standalone browser demos; this Prometheus version produces clips inside Creative Video mode with snapshots, linting, safe areas, and export QA.

---

## Core Idea

`@chenglou/pretext` measures multiline text without DOM layout reads. It can return line breaks, per-line widths, cursors, and grapheme positions before rendering. In Creative Video mode that becomes a motion primitive for:

- text flowing around a moving orb, logo, product, cursor, face, or screenshot
- kinetic typography with line/glyph-level motion
- glyph shatter / scatter / reassemble effects
- ASCII/text-mask motion where prose wraps around real obstacle geometry
- editorial magazine-style columns with animated pull quotes
- deterministic caption/stat/quote fitting before snapshot QA

The output is **not** a `/tmp` demo and not a Python-served HTML file. The output is a Prometheus HTML Motion clip that can be previewed on the canvas and exported.

---

## Default Tool Flow

1. Read this skill, then read `prometheus-hyperframes-bridge` and `html-motion-video` if not already loaded.
2. Switch to video mode: `switch_creative_mode({ mode: "video", reason: "Pretext HTML Motion clip", initialIntent })`.
3. Use `creative_create_html_motion_clip` for custom Pretext scenes unless a built-in HTML template already fits.
4. Author a complete self-contained HTML document with fixed stage dimensions.
5. Run text-fit/lint tools when available: `creative_lint_html_motion_clip`, `creative_text_fit_report`, or `creative_quality_report`.
6. Render at least three frames: early, midpoint, near-end. For animation-heavy scenes, render a contact sheet.
7. Patch until frames pass visual QA.
8. Export only after QA passes.

If the relevant Creative HTML Motion tools are not active in the current session, activate the creative/video tool category first. Do **not** use `run_command`, standalone servers, or external browser tabs as the default path.

---

## Prometheus Compatibility Rules

- HTML must be complete and self-contained: `<!doctype html>`, inline CSS, inline JS.
- Use pinned ESM imports only when necessary, e.g. `https://esm.sh/@chenglou/pretext@0.0.6`.
- Avoid remote images/videos/fonts. Prefer system fonts or imported Creative assets with `{{asset.id}}` placeholders.
- Do not reference absolute Windows paths in HTML.
- Fixed canvas dimensions are required. Default vertical: `1080x1920`; landscape: `1920x1080`; square: `1080x1080`.
- Keep primary text inside safe area. Vertical safe area: roughly `x:64–1016`, `y:120–1760`.
- No blank first frame. At 0–500ms the scene should already look intentional.
- The start/mid/end frames must be visibly different.
- Minimum readable mobile text sizes: body/prose 24px+, CTA 48px+, hero/title 64px+ unless the text field is deliberately decorative texture.
- For prose-as-texture, low readability is acceptable only if the hero/caption/CTA remains readable.

---

## Pattern Selector

| User intent | Pattern | Pretext API | Best output |
|---|---|---|---|
| “text flows around an orb/logo/product” | `orb-reflow` | `layoutNextLineRange` + `materializeLineRange` | editorial/prose motion clip |
| “glyphs explode / letters scatter” | `glyph-particles` | `layoutWithLines` / line materialization + grapheme split | kinetic hook/reveal |
| “ASCII logo made from words” | `ascii-mask-reflow` | variable row spans + `layoutNextLineRange` | cyber/dev/AI bumper |
| “magazine spread / pull quote” | `editorial-columns` | shared cursor across columns | premium launch/editorial clip |
| “animated quote/title” | `kinetic-lines` | `layoutWithLines` | title card, quote card, social clip |
| “auto-sized quote/stat card” | `shrinkwrap-card` | `measureLineStats` | deterministic card fit |

Pick one pattern. Do not mash all of them together unless the clip is intentionally multi-act.

---

## Pattern Recipes

### 1. Orb Reflow

Use for prose that opens around a moving object. This is the signature Pretext effect.

Key structure:

```js
const prepared = prepareWithSegments(TEXT, FONT);
let cursor = { segmentIndex: 0, graphemeIndex: 0 };
let y = TOP;
while (y < BOTTOM) {
  const dy = y - orb.y;
  let x = COL_X;
  let w = COL_W;
  if (Math.abs(dy) < orb.r) {
    const half = Math.sqrt(orb.r ** 2 - dy ** 2);
    const leftW = Math.max(0, orb.x - half - COL_X);
    const rightW = Math.max(0, COL_X + COL_W - (orb.x + half));
    if (leftW >= rightW) { x = COL_X; w = leftW - 18; }
    else { x = orb.x + half + 18; w = rightW - 18; }
    if (w < 80) { y += LINE_H; continue; }
  }
  const range = layoutNextLineRange(prepared, cursor, w);
  if (!range) break;
  const line = materializeLineRange(prepared, range);
  ctx.fillText(line.text, x, y);
  cursor = range.end;
  y += LINE_H;
}
```

Prometheus video upgrade: animate the obstacle automatically with time. Do not rely on mouse interaction for the exported clip.

### 2. Glyph Particles

Use Pretext to get stable home positions, then animate letters away and back.

Rules:
- Use `Intl.Segmenter` for graphemes.
- Cache glyph home positions; do not rebuild them every frame unless the text/font/width changes.
- In exported video, trigger shatter/reassemble by timeline time, not user click.
- Keep the main message readable before and after the effect.

### 3. ASCII Mask Reflow

Use a grid or shape buffer to create row spans. Feed the same spans to Pretext that you use to draw the visual obstacle.

Rules:
- Measured spans beat giant bounding boxes.
- Morphing visual shapes need morphing collision spans.
- Use separate visual and collision layers when fading/glowing objects.
- If the user provides a logo/image, import/analyze it first and derive safe silhouette/placement.

### 4. Editorial Columns

Use shared cursors across columns so copy naturally continues.

Rules:
- Treat pull quotes, product cards, screenshots, and logos as row obstacles.
- Use warm editorial palettes for launch/founder/story clips.
- This pattern pairs well with slow camera movement and a strong CTA card in the final act.

---

## Copy / Corpus Rules

- Use real copy that matches the brief. Never ship lorem ipsum.
- If the user does not provide prose, write a short meaningful corpus from the project context.
- For Prometheus demos, good corpus themes are: unified operating layer, one-click desktop agent super app, modernizing daily work beyond terminals, connecting tools/memory/workflows, creative video as an agent-native canvas.
- Repeat the corpus enough to fill the texture layer, but keep hero copy short and intentional.
- Decorative prose can repeat; hero text and CTA must not.

---

## Aesthetic Defaults

Avoid generic purple/blue AI gradients. Strong starting palettes:

| Vibe | Background | Text | Accent |
|---|---|---|---|
| Mono Noir + Lime | `#070707` | `#f7f7f2` | `#bef264` |
| Editorial Cream + Ink | `#f4ede1` | `#171717` | `#c44a2c` |
| Deep Teal + Amber | `#041c1c` | `#ffe6cb` | `#f59e0b` |
| Terminal Amber | `#080704` | `#f6c56f` | `#ff7a1a` |
| Mint Graphite | `#101820` | `#f8fafc` | `#5eead4` |

Use texture intentionally: grain, scanlines, glow, vignettes, soft shadows, one accent line/progress rail. Do not fill the scene with random rectangles.

---

## HTML Motion Template Skeleton

Use this as the base shape for a hand-authored clip. Customize the stage size, palette, corpus, and pattern.

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<style>
  html, body { margin:0; width:100%; height:100%; overflow:hidden; background:#070707; }
  body { font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
  #stage { position:relative; width:1080px; height:1920px; overflow:hidden; background:#070707; color:#f7f7f2; }
  canvas { position:absolute; inset:0; width:100%; height:100%; }
  .hero { position:absolute; left:72px; right:72px; top:118px; z-index:5; font:800 92px/0.95 Inter, system-ui, sans-serif; letter-spacing:-0.06em; }
  .hero .accent { color:#bef264; }
  .cta { position:absolute; left:72px; right:72px; bottom:120px; z-index:6; font:700 50px/1.05 Inter, system-ui, sans-serif; color:#070707; background:#bef264; border-radius:28px; padding:28px 34px; transform-origin:left center; animation:cta 900ms ease-in-out infinite alternate; }
  @keyframes cta { from { transform:scale(1); } to { transform:scale(1.025); } }
</style>
</head>
<body>
<div id="stage">
  <canvas id="textCanvas"></canvas>
  <div class="hero">Text can <span class="accent">move around meaning.</span></div>
  <div class="cta">Built in Prometheus Creative Video</div>
</div>
<script type="module">
import { prepareWithSegments, layoutNextLineRange, materializeLineRange } from "https://esm.sh/@chenglou/pretext@0.0.6";
const W = 1080, H = 1920, DURATION = 9000;
const canvas = document.getElementById("textCanvas");
const ctx = canvas.getContext("2d");
const DPR = Math.min(devicePixelRatio || 1, 2);
canvas.width = W * DPR; canvas.height = H * DPR; ctx.setTransform(DPR,0,0,DPR,0,0);
const FONT = "500 30px Inter, ui-sans-serif, system-ui, sans-serif";
const LINE_H = 42;
const TEXT = `Prometheus turns tools, context, memory, files, browsers, teams, and creative work into one operating layer. The canvas is not a toy. It is where an agent can plan, render, inspect, repair, and ship real motion. `.repeat(20);
const prepared = prepareWithSegments(TEXT, FONT);
function draw(now) {
  const t = ((now || 0) % DURATION) / DURATION;
  ctx.clearRect(0,0,W,H);
  ctx.fillStyle = "rgba(190,242,100,0.08)";
  const orb = { x: 540 + Math.sin(t * Math.PI * 2) * 210, y: 980 + Math.cos(t * Math.PI * 2) * 260, r: 190 + Math.sin(t * Math.PI * 4) * 20 };
  const g = ctx.createRadialGradient(orb.x, orb.y, 0, orb.x, orb.y, orb.r * 1.8);
  g.addColorStop(0, "rgba(190,242,100,0.38)"); g.addColorStop(1, "rgba(190,242,100,0)");
  ctx.fillStyle = g; ctx.fillRect(0,0,W,H);
  ctx.font = FONT; ctx.textBaseline = "alphabetic"; ctx.fillStyle = "rgba(247,247,242,0.62)";
  let cursor = { segmentIndex:0, graphemeIndex:0 };
  for (let y = 360; y < 1580; y += LINE_H) {
    let x = 72, w = W - 144;
    const dy = y - orb.y;
    if (Math.abs(dy) < orb.r) {
      const half = Math.sqrt(orb.r * orb.r - dy * dy);
      const leftW = Math.max(0, orb.x - half - 72);
      const rightW = Math.max(0, W - 72 - (orb.x + half));
      if (leftW >= rightW) { x = 72; w = leftW - 20; } else { x = orb.x + half + 20; w = rightW - 20; }
      if (w < 96) continue;
    }
    const range = layoutNextLineRange(prepared, cursor, w); if (!range) break;
    const line = materializeLineRange(prepared, range);
    ctx.fillText(line.text, x, y); cursor = range.end;
  }
  requestAnimationFrame(draw);
}
requestAnimationFrame(draw);
</script>
</body>
</html>
```

---

## QA Checklist

Before presenting or exporting:

- [ ] The clip runs inside Prometheus Creative Video mode, not a standalone browser demo.
- [ ] Pretext import is pinned.
- [ ] Text corpus is real and relevant.
- [ ] Animation is timeline-driven; it does not depend on mouse/touch interaction to look good.
- [ ] First frame is not blank.
- [ ] Early, middle, and near-end frames are visually distinct.
- [ ] Hero/CTA text is readable and inside safe area.
- [ ] Decorative text does not collide with hero/CTA.
- [ ] No absolute Windows paths or unimported media assets.
- [ ] Lint/text-fit/quality report has no ship-blocking findings.
- [ ] Export trace or final frame QA confirms the rendered clip is current, not stale.

---

## Anti-Patterns

- Do not copy the Hermes workflow of writing `/tmp/demo.html`, serving with Python, and sending a file path unless Raul explicitly asks for a standalone external demo.
- Do not rely on interactive dragging for an exported video. Use deterministic timeline motion.
- Do not use lorem ipsum.
- Do not place remote image/video/font URLs in the clip. ESM library imports are acceptable when the library is needed and pinned.
- Do not call Pretext `prepare*` inside the frame loop.
- Do not use a giant obstacle bounding box when row-measured spans are possible.
- Do not export before looking at real rendered frames.

---

## Relationship to Upstream Hermes Skill

The upstream skill is valuable as reference material for Pretext APIs and demo patterns. In Prometheus, treat it as inspiration only. The controlling workflow is:

**Pretext measurement → HTML Motion canvas composition → Creative frame QA → patch → export.**

If the upstream bundle is installed as `nous-pretext-upstream`, selectively read its resources for deeper examples:

- `references/patterns.md`
- `templates/hello-orb-flow.html`
- `templates/donut-orbit.html`
