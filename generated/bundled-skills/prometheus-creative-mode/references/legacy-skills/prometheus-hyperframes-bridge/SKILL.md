---
name: prometheus-hyperframes-bridge
description: Primary Prometheus routing skill for polished Creative Video, HTML motion, HyperFrames-style composition, GSAP-guided animation, website-to-video, Remotion-to-HTML conversion, promo videos, ads, product demos, and MP4 export inside Prometheus. Use this before upstream HyperFrames or CLI skills unless the user explicitly asks for a standalone HyperFrames project.
---

# Prometheus HyperFrames Bridge

Use this skill when the user asks for HyperFrames-style HTML video, GSAP motion, animated captions, website-to-video, Remotion-to-HTML conversion, or polished HTML/CSS video inside Prometheus.

This is the authority layer for Prometheus. It decides how to apply HyperFrames guidance inside the Prometheus Creative runtime.

For structural rules, timing units, root metadata, asset placeholders, deterministic animation adapters, text-fit expectations, ASCII routing, lint/inspect gates, and compatibility export rules, use `prometheus-html-motion-spec` as the canonical spec.

## Core Rule

Inside Prometheus, prefer the Prometheus Creative HTML Motion tools first:

1. `enter_creative_mode({ "mode": "video" })`
2. `creative_list_html_motion_templates` or `creative_create_html_motion_clip`
3. `creative_render_html_motion_snapshot`
4. `creative_patch_html_motion_clip` for revisions
5. `creative_export_html_motion_clip` or `creative_export` when QA passes

Use imported HyperFrames resources for design, motion, timing, transitions, GSAP technique, and conversion guidance. Do not assume the external HyperFrames CLI is installed unless the user explicitly asks to create or operate a standalone HyperFrames project.

If a user gives enough brief context to proceed, do not stop for the upstream HyperFrames "ask 3 questions" identity gate. Instead, infer a minimal visual identity from the user's product, brand, platform, and requested style, then verify it through frame snapshots. Ask questions only when the brief is too ambiguous to choose a responsible direction.

## Premium ASCII / Terminal Cinema Routing

For high-end ASCII cinema, prefer a hybrid pipeline by default:

1. Call `creative_render_ascii_asset` for the default Prometheus-native path. It runs the bundled Python/ffmpeg ASCII render lane, imports the MP4 into the Creative asset library, and can place it as a selectable video layer.
2. Use the Python `nous-ascii-video` pipeline for dense source-backed ASCII rendering, audio-reactive glyph fields, multi-grid composition, shader chains, tonemapping, and premium raster output.
3. Use HTML Motion / HyperFrames for the composition pass: crisp typography, captions, CTA panels, layout, masks, transitions, safe-area framing, and final Prometheus export. The `python-ascii-render-showcase` template is the built-in wrapper for rendered ASCII MP4s.
4. Use native HTML ASCII blocks/templates only for lightweight previews, browser-native smart-layer effects, quick editable treatments, or when the user explicitly asks for fully HTML Motion ASCII.

Do not force premium ASCII reference work into the browser renderer just because HTML Motion is available. If the user is chasing dense reference-level quality, Python owns the heavy glyph render; Prometheus owns the editable video composition around it.

## Media-Aware Routing

When a request includes user-provided images, videos, screenshots, screen recordings, X/social clips, product demos, or long footage, add an analysis pass before composition.

Preferred tool chain:

1. Acquire/import media: `download_media`, `download_url`, or `creative_import_asset`.
2. Inspect media: `creative_analyze_asset` for dimensions/duration/type, `analyze_video` for transcript/visual beats, and image/video frame QA tools for visible content.
3. Decide the role of each asset: hero, proof, b-roll, background plate, gallery tile, comparison, testimonial, app/device demo, export handoff, or CTA support.
4. Compose through HTML motion using `{{asset.id}}` placeholders and timing attributes, not absolute paths.
5. Verify sampled frames after the media is placed.

Do not place media just because it exists. The agent must know what the media shows, which moment of a video is being used, and why it supports the edit.

## Resource Loading Pattern

For new HTML motion clips:

1. Read this bridge skill first.
2. Read `prometheus-html-motion-spec` for the authoritative Prometheus clip contract.
3. Read `hyperframes` only as a reference, not as the controlling workflow.
4. Read `prometheus-hyperframes-bridge/references/hyperframes-resource-map.md`.
5. Load only the relevant HyperFrames resources with `skill_resource_read`.
6. Build through Prometheus creative tools.

For animation help:

1. Read `gsap`.
2. Load `gsap/references/effects.md` if timelines, easing, stagger, or effect composition matter.
3. Apply the guidance inside the HTML passed to Prometheus creative tools.

For website-to-video:

1. Use browser tools to inspect the website when needed.
2. Read `website-to-hyperframes`.
3. Load its capture, design, storyboard, build, and validate references selectively.
4. Produce the clip with Prometheus Creative HTML Motion tools.

For Remotion conversion:

1. Read `remotion-to-hyperframes`.
2. Load the API map, limitations, sequencing, transitions, and escape-hatch references.
3. Convert concepts into Prometheus-compatible HTML/CSS/JS, then run snapshot QA.

## Text Fit Discipline (Pretext)

Prometheus integrates `@chenglou/pretext` for deterministic text measurement. The browser uses pretext directly for pixel-accurate fits inside the Creative editor; the gateway runs a tuned heuristic mirror of the same model so you can pre-flight text without rendering.

**Hard rule:** every hero title, caption, lower-third, CTA, or stat-bomb that lives inside a sized container MUST be checked for fit before the first snapshot. Snapshot QA is for motion and composition — not for catching overflow you could have caught deterministically.

Apply in this order:

1. **Author the slot.** Decide width, height, font-size, font-family, font-weight, line-height for the text element.
2. **Call `creative_measure_text`** with `{ text, width, maxHeight, fontSize, fontFamily, fontWeight, fontStyle, lineHeight }`. Inspect `overflowsHeight`, `overflowsWidth`, `lineCount`, `suggestedFontSize`.
3. **If `overflowsHeight`:** prefer `suggestedFontSize` (auto-fit), or grow the box, or shorten the copy. Re-measure until it fits.
4. **If `overflowsWidth`:** the longest single word is wider than the box — shorten the word, drop letter-spacing, or grow the width.
5. **After authoring the full clip,** run `creative_lint_html_motion_clip`. Lint's pretext pass (`text-overflow-height` / `text-overflow-width`) catches anything you missed. For per-element drilldown call `creative_text_fit_report`.
6. **Then** snapshot with `creative_render_html_motion_snapshot` and export.

`creative_quality_report` (video mode) automatically attaches a `textFit` block to its result. If `textFit.ok === false`, treat it as ship-blocking the same as caption-timing or audio-sync findings.

`creative_apply_html_motion_template` also runs the fit pass on the rendered HTML and returns `textFit` in its data — if the user's copy overflows the template's slot, fix it before snapshot.

This is where most "the export looks broken" cases come from. Don't skip it.

## Prometheus Compatibility Notes

- Prometheus HTML motion clips must be complete self-contained HTML documents.
- Use inline CSS and optional inline JS only.
- No external network assets unless the user explicitly provided them and Prometheus has imported them as assets.
- Prefer `{{asset.id}}` placeholders for media assets rather than absolute paths.
- For videos, use HTML timing attributes such as `data-start`, `data-duration`, and `data-trim-start` to select source moments. New Prometheus clips should use explicit `ms` or `s` units; legacy bare numeric values are milliseconds.
- Preserve stable IDs/classes and region markers for future patching.
- Always snapshot early, middle, and near-end frames before export.
- Do not call `run_command` to render a Prometheus creative clip; use creative export tools.

## Clipping-Machine Direction

For long-video clipping workflows, use Prometheus as a staged editor:

- Analysis: watch/transcribe/summarize the full source with `analyze_video`; collect candidate hooks, scene changes, captions, visible text, and audio quality.
- Edit decision list: write selected source ranges with timestamps, rationale, crop/framing, speed, caption, and placement notes.
- Assembly: import selected footage as Creative assets; use `creative_trim_clip` for editable canvas/video layers when needed, or HTML motion video elements with `data-trim-start` and `data-duration` for HTML compositions.
- Review: render contact sheets or representative frames for every selected segment, then run final early/mid/end QA.

If the request requires preserving or remixing source audio, call that out and use the dedicated audio/video path. HTML motion export is strongest for visual composition and can be extended with audio muxing, but should not silently discard important speech or music.

## When To Use External HyperFrames CLI

Only use external HyperFrames CLI guidance when the user explicitly asks for a standalone HyperFrames project, direct HyperFrames CLI commands, or export outside Prometheus.

Even then, treat commands as suggestions requiring normal command policy and user approval. A bundled skill never auto-executes scripts or shell commands.
