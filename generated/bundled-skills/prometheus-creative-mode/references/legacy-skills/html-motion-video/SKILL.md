---
name: html-motion-video
description: Use when Prometheus is creating, editing, previewing, QAing, or exporting HTML/CSS-based motion clips in Creative Video mode, especially promo videos, ads, social clips, animated typography, launch videos, branded motion cards, or quick MP4 clips where a polished HTML composition is better than primitive canvas layers.
metadata:
  short-description: Build polished HTML/CSS motion clips for Prometheus video mode
---

# HTML Motion Video

## Mission

Use HTML/CSS as the high-quality motion design surface inside Prometheus Video mode. This is the preferred path for short polished clips. Primitive canvas layers are NOT acceptable for promo/ad/social videos unless the user explicitly asks for editable canvas layers.

Use `prometheus-html-motion-spec` as the canonical contract for root metadata, timing units, asset placeholders, deterministic animation behavior, text-fit gates, ASCII routing, lint/inspect rules, and export compatibility.

## Path Selection — Read This First

For any of these requests, use HTML motion (NOT primitive canvas layers):

- "make a quick video clip"
- promo, ad, launch, product video, sale/offer video
- TikTok, Reel, Short, animated social creative
- testimonial / social proof, feature reveal, app demo, event/offer promo

Only use the primitive canvas layer system when the user explicitly says they need every object kept as an independently editable Creative canvas layer.

## ASCII / Terminal-Style Video Routing

HTML Motion can host ASCII as a seekable canvas smart layer, but it is not the default choice for premium ASCII cinema.

For high-end ASCII/video-art requests, use the hybrid route:

1. Generate the heavy ASCII render with `creative_render_ascii_asset` when the brief calls for dense source-to-ASCII, audio-reactive visuals, shader chains, tonemapping, or reference-level terminal cinema.
2. Let that tool import the rendered MP4 into Creative Video; use `placeInScene: true` when the rendered ASCII should appear immediately as a selectable video layer.
3. Use HTML Motion for composition: typography, captions, CTA, product framing, overlays, transitions, and final export. Use `python-ascii-render-showcase` when you want a ready wrapper around the rendered MP4.
4. Use native HTML ASCII templates/blocks for previews, lightweight editable smart layers, simple logo treatments, or explicitly browser-native requests.

If quality and editability conflict, prefer Python for the ASCII raster pass and HTML Motion for the finishing/composition pass.

## Workflow

1. Switch to video creative mode with `switch_creative_mode({ mode: "video" })`.
2. Call `creative_list_html_motion_templates`. Pick the closest template.
3. Apply it with `creative_apply_html_motion_template` (templateId + inputs). Only fall back to authoring raw HTML via `creative_create_html_motion_clip` if no template fits the brief.
4. Preview frames with `creative_render_html_motion_snapshot` (start, mid, end at minimum).
5. If anything fails the QA gate below, revise the inputs (or the HTML if you are hand-authoring) and rerun frame QA.
6. Export only after QA passes, using `creative_export_html_motion_clip` or `creative_export` with `format: "mp4"`.

Do not use `write_file` plus `run_command` for HTML motion videos. Do not use the primitive canvas layer tools to assemble a promo. The Creative HTML motion tools handle workspace storage, canvas preview, frame QA, and MP4 export.

## Editing Existing Clips

When the user asks to revise an existing HTML motion clip, DO NOT recreate the whole clip first. Preserve the working design and patch it surgically.

Default edit workflow:

1. Call `creative_read_html_motion_clip` with `includeHtml: true` unless a compact outline is enough.
2. Identify the smallest safe edit: text replacement, CSS variable change, region replacement, marker insertion, asset swap, or manifest update.
3. Call `creative_patch_html_motion_clip` with focused operations and a short `reason`.
4. Run `creative_render_html_motion_snapshot` at early, midpoint, and near-end frames.
5. If the patch made the design worse, use the revision returned by the patch result with `creative_restore_html_motion_revision`.

Preferred patch operations:

- `replace_text` for copy changes.
- `set_css_var` / `replace_css_var` for palette, radius, spacing, and motion-token changes.
- `replace_between` for stable region edits.
- `insert_before` / `insert_after` for adding small CSS rules or DOM fragments near known markers.
- `replace_asset` for swapping images, videos, audio, or fonts while keeping `{{asset.id}}` references.

When generating new HTML, make future edits easy by adding stable IDs/classes and region markers:

```html
<!-- @prometheus-region headline -->
<h1 id="headline">Launch faster with Prometheus</h1>
<!-- /@prometheus-region headline -->
```

Use predictable regions such as `hook`, `headline`, `proof`, `features`, `media`, `cta`, and `outro`. Avoid anonymous one-off markup that cannot be patched later.

## Media Assets

HTML motion clips can use named image/video/audio/font assets. Pass them in the `assets` array on `creative_create_html_motion_clip`, then reference them in HTML with placeholders:

```json
{
  "assets": [
    { "id": "logo", "type": "image", "source": "workspace/uploads/logo.png" },
    { "id": "demo", "type": "video", "source": "workspace/uploads/demo.mp4" }
  ]
}
```

```html
<img class="logo" src="{{asset.logo}}" alt="">
<video class="demo" src="{{asset.demo}}" autoplay muted loop playsinline></video>
```

Rules:

- Prefer workspace uploads, generated assets, or existing creative project files.
- Never reference absolute Windows paths directly in HTML.
- Use `{{asset.id}}` placeholders so Prometheus can serve assets safely in preview, frame QA, and MP4 export.
- For videos, use `autoplay muted loop playsinline` and style them with `object-fit: cover` inside a product frame, phone mockup, b-roll panel, b-roll strip, or masked card.
- Keep text on busy images/videos readable with overlays, scrims, gradients, or solid panels.
- If the user provides media, use it intentionally as the hero/product/proof layer rather than as a tiny decoration.

## Analyze Media Before Using It

When the user provides an image or video for an HTML motion clip, do not place it blindly.

Default media workflow:

1. Import or locate the media with `creative_import_asset` when needed.
2. Run `creative_analyze_asset` for image/video dimensions, duration, orientation, and metadata.
3. For images, use image analysis/vision when the content matters. Identify subject, crop-safe regions, busy areas, text, brand elements, and whether the image needs a scrim or frame.
4. For videos, use `analyze_video` or `video_extract_clip_frames`/contact-sheet style frame review when the content matters. Identify useful moments, on-screen text, scene changes, audio/speech quality, and dead sections.
5. Only then decide the asset role: hero footage, product proof, b-roll, background texture, testimonial proof, gallery tile, app/device mockup, or CTA support.

Never use a provided clip as a generic looping background unless the analysis confirms it is visually appropriate and text will remain readable.

## Video Footage Timing In HTML Motion

HTML motion can place source videos as timed footage inside the generated clip. Use these patterns:

```html
<video
  class="hero-footage"
  src="{{asset.demo}}"
  data-start="4200"
  data-duration="5200"
  data-trim-start="12300"
  muted
  playsinline
></video>
```

```css
.hero-footage {
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: 28px;
}
```

Timing rules:

- New clips should use explicit timing units: `ms` for Prometheus-native timing or `s` when importing/converting seconds-based references.
- Legacy bare values on `data-start`, `data-duration`, `data-end`, `data-trim-start`, and `data-offset` are treated as milliseconds.
- Use `data-trim-start` to choose which part of the source video appears at the start of the HTML motion shot.
- Use `data-duration` to decide how long the footage is visible in the final composition.
- Use CSS/JS or `playbackRate` only when the creative intent requires speed ramping. Otherwise preserve natural motion.
- Add labels in comments near footage regions so future patches can change the selected moments safely.

If the source video has important audio, note that HTML motion export is primarily a visual frame-sequence path. Use the broader video/audio tools or a later muxing step when final audio must be preserved, mixed, ducked, or synchronized.

## Long-Video To Clip Workflow

For "make clips from this long video" or CapCut-style requests, HTML motion should be the finishing/compositing lane, not the first analysis step.

Use this sequence:

1. Analyze the source video with `analyze_video` using enough samples for the duration. Ask for hooks, scene changes, transcript, visible text, emotional beats, dead air, and likely clip candidates.
2. Extract review frames/contact sheets with `video_extract_clip_frames` or `video_render_contact_sheet` where useful.
3. Build an edit decision list before composing:
   - source file
   - selected in/out timestamps
   - visual reason for each cut
   - transcript/audio reason when relevant
   - target role in final clip
   - speed/ramp/crop/caption notes
4. Import selected media as assets.
5. Use HTML motion for framing, captions, overlays, product UI, CTA, b-roll layout, and pacing.
6. Run lint and 3+ frame QA; for long clips, also sample each selected segment.

Do not pretend a long-video edit is done after one summary. The agent should prove it knows what moments it selected and why.

## Built-in Templates

The starter set covers the most common requests, across vertical, square, and landscape formats and varying durations:

**Vertical 1080x1920**

- `startup-product-promo` (8s) — brand mark, headline, 3 feature chips, CTA
- `bold-tiktok-caption` (7s) — massive caption typography, color flash, payoff card
- `saas-feature-launch` (9s) — feature reveal with proof metrics and ship bar
- `app-demo-card` (8s) — glass phone frame with simulated app UI
- `testimonial-social-proof` (8.5s) — quote card, author chip, headline metric
- `event-or-offer-ad` (7.5s) — time-pressure offer, date strip, double-checkmark proof
- `minimal-editorial-quote` (10s) — cream + ink editorial layout, serif quote, slow reveal
- `before-after-reveal` (8s) — split-screen wipe with metric uplift
- `step-by-step-tutorial` (12s) — numbered 4 steps with progress dots
- `stat-bomb-reel` (8s) — three sequential big-number stats, mono-noir + lime
- `podcast-episode-promo` (10s) — animated waveform audiogram, episode card
- `recipe-card-vertical` (10s) — recipe with ingredient list, time/serves chips
- `coming-soon-teaser` (5s) — short mystery teaser with date reveal, mono noir + red
- `news-headline-flash` (6s) — breaking-news red band, ticker, big serif headline
- `feature-comparison-vs` (9s) — two-column comparison with checks/x marks
- `glitch-cyber-promo` (7s) — chromatic-aberration glitch typography, scan lines
- `ugc-review-card` (8.5s) — creator-style review card, rating strip, benefit chips, CTA
- `ai-workflow-demo` (9s) — command palette, task stack, progress rail, output preview
- `local-business-spotlight` (8s) — warm local ad with offer card, trust badges, location strip
- `course-lesson-promo` (9s) — course/cohort promo with lesson card, modules, learner promise

**Square 1080x1080**

- `square-feed-announcement` (6s) — Instagram/LinkedIn feed post, big shape composition

**Landscape 1920x1080**

- `ai-design-studio-launch` (24s) - Claude-style product demo film with workspace, preview, knobs, gallery, cursor, and export modal

- `youtube-intro-promo` (5s) — 16:9 channel intro/end card with subscribe nudge

Each template advertises its `requiredInputs` and `optionalInputs`. Always populate every required input with concrete copy from the user's brief — never placeholders like "Lorem", "Headline here", "Brand". Match the template format to the platform: vertical for TikTok/Reels/Shorts/Stories, square for IG/LinkedIn feed, landscape for YouTube/web.

## Product-Demo Film Grammar

For requests that reference Claude Design-style launch videos, polished product demos, prototype showcases, AI design workspaces, or export-to-agent flows, prefer `ai-design-studio-launch` before generic promo templates.

A product-demo film should show a believable software workflow:

- Title card: brand/product identity and launch promise.
- Workspace hero: browser/app shell with chat/build panel, preview canvas, and toolbar.
- Artifact proof: generated product, app, dashboard, map, globe, or document preview.
- Knobs/tweaks: visible controls such as glow, density, theme, speed, or typography.
- Cursor choreography: pointer movement, click ripple, slider/toolbar/modal interaction.
- Gallery montage: multiple generated artifact examples.
- Export/handoff: modal or code/agent handoff as the final act.

Do not make Claude-style requests as a single caption card. Use product UI, panels, controls, generated artifacts, camera/cursor movement, and a clear handoff moment.

## Parameters / Knobs

Templates may return `parameters`, a normalized knob contract. Treat these as editable creative controls:

- `range` parameters should become sliders in future UI and can be changed by passing the same id in template inputs.
- `color` parameters should become swatches/color inputs.
- `text`, `select`, `boolean`, and `number` parameters should become typed controls.
- `target.path` points to the HTML/CSS variable or runtime field affected by the knob.

For `ai-design-studio-launch`, useful knobs include `accent`, `glow`, `density`, and `speed`. When a user asks to "make the globe brighter," "show more activity," or "slow it down," patch these knobs first before rewriting the design.

## Reusable Blocks

Use `creative_list_html_motion_blocks` and `creative_render_html_motion_block` when a template needs extra richness or when patching an existing clip. Prefer these blocks over inventing random divs:

- Product/proof: `feature-checklist`, `notification-stack`, `app-frame`, `phone-mockup`, `dashboard-panel`
- Product-demo UI: `browser-workspace-frame`, `chat-build-panel`, `tweak-panel`, `artifact-gallery`, `export-agent-modal`
- Motion energy: `icon-burst`, `gradient-wipe-transition`, `wipe-transition`, `flash-transition`, `blur-push-transition`
- Interaction: `cursor-path`
- CTA/offer: `price-offer-card`, `button-pulse`, `end-card`, `logo-lockup`
- Captions: `timed-caption`, `punch-caption`, `karaoke-caption`, `subtitle-bar`
- Data/process: `timeline-steps`, `count-up-stat`, `bar-race`, `sparkline-reveal`

Render blocks, then insert their HTML/CSS/JS into stable regions in the current clip with `creative_patch_html_motion_clip`. A block should support the current act of the video: hook, proof/value, transition, or CTA.

## Color Scheme Plan — AVOID the AI-cliché Purple/Blue Gradient

Do NOT default to the purple→blue cosmic gradient (`#0a0a1f → #1d0f3d`, etc.) that screams "AI-generated promo." That look is overused and instantly dates the work. Pick a palette intentionally based on the brand and emotional register. When in doubt, prefer warm, earthy, editorial, or mono-noir palettes over cool indigo gradients.

Curated palettes (use these as starting points; the `accent` optional input on most templates lets you swap the highlight color without rewriting the template):

- **Editorial Cream + Ink** — bg `#f4ede1`, text `#1a1a1a`, accent `#c44a2c` (terracotta). For thoughtful, magazine, founder-quote energy.
- **Mono Noir + Lime** — bg `#0a0a0a`, text `#fafafa`, accent `#bef264` (lime). For data, fintech, dev tools, bold confidence.
- **Forest Emerald** — bg `#052e16 → #064e3b`, text `#ecfdf5`, accent `#34d399`. For sustainability, growth, education, calm authority.
- **Sunset Coral** — bg `#fb7185 → #f59e0b`, text `#1f1611`, accent `#fff`. For lifestyle, food, fitness, friendly DTC brands.
- **Earthy Clay / Terracotta** — bg `#1f1611 → #3d2c20`, text `#f4ede0`, accent `#d97757` / `#f4a261`. For craft, artisan, design studios, premium analog feel.
- **Sand + Tomato** — bg `#f5e9d4`, text `#2b1407`, accent `#c8553d`. For food, recipes, warm everyday brands.
- **Cream + Ink + Tomato** — bg `#f4ede1`, text `#1a1a1a`, accent `#c44a2c`. For square feed, blogs, modern editorial.
- **Mint + Graphite** — bg `#1f2933 → #0f1a23`, text `#fff`, accent `#5eead4`. For YouTube, product, fresh tech without going purple.
- **Neon Noir Crimson** — bg `#0a0a0a`, text `#fff`, accent `#b91c1c` / `#dc2626`. For news, urgency, alerts, tease.
- **Cyber Glitch** — bg `#000`, text `#d4ff3a` (lime), accent `#ff2bd6` (magenta) + `#00f0ff` (cyan). For gaming, web3, edgy launches.
- **Sand + Ocean** — bg `#eaddc7`, text `#1c2530`, accent `#0e7c7b` (deep teal). For comparison, B2B, calm proof.

Rules:

- Never combine a default purple gradient with a "futuristic" headline — that's the AI-promo cliché.
- Pick at most one accent color; use it for the CTA, the dominant headline accent stroke, and one other small emphasis (chip dot, progress bar, etc.). Don't rainbow.
- Background and text must hit ≥ 4.5:1 contrast. Add a solid panel/scrim behind text on busy plates.
- Match palette emotion to subject: warm earthy for human/craft/founder stories; mono-noir for data/finance/dev; cream editorial for magazine/quote; clay/sand for food/lifestyle; mint/graphite for YouTube; neon-cyber only when the brand actually wants edge.
- If the user provides brand colors, use those instead — but check the result avoids the purple/blue gradient trap.

## Composition Rules (3-act pacing)

Every HTML motion clip MUST move through three distinct acts so the start, middle, and end frames are visually different:

- **Act 1 — Hook (0–25%)**: brand/eyebrow + headline enter. Frame is meaningful from the first sampled millisecond. No black/empty intro.
- **Act 2 — Proof / Value (25–70%)**: feature chips, metrics, app screen, quote card, etc. animate in with staggered timing.
- **Act 3 — CTA (final 20–30%)**: CTA visible and emphasized in the last 20–30% of the clip. Use scale-in + pulse so it feels actionable.

The first sampled frame, the midpoint frame, and the near-end frame must each look clearly different. If `creative_render_html_motion_snapshot` returns three near-identical frames, the clip fails QA.

## HTML Rules

- Return a complete HTML document with inline CSS and optional inline JS only.
- No external network dependencies (no Google Fonts, no remote images, no external scripts). System/web-safe fonts only unless an asset already exists in the workspace.
- Set fixed pixel dimensions on `html`, `body`, and the main stage. Default vertical canvas is `1080x1920`.
- Keep all primary text inside the social safe area. For vertical clips: roughly `x: 64–1016`, `y: 120–1760`.
- Use deliberate hierarchy: brand mark or eyebrow → headline → visual proof system → CTA → optional outro line.
- Use manual line breaks for long headlines and body copy. Never let typography split into single letters or awkward fragments.
- Minimum body text size 24px; minimum CTA text size ~48px on a 1080-wide canvas. No tiny text.
- Maintain strong contrast between text and its immediate background (use overlays or solid panels behind text on busy plates).
- Avoid static layouts that hold for the full duration. Animate entrances, transitions, emphasis, and outro with CSS keyframes.
- Avoid random rectangles or empty boxes that don't support the hierarchy.

## Required Frame QA Gate

Before export, ALWAYS run `creative_render_html_motion_snapshot` and inspect at least three frames: early (~500ms), midpoint, and near-end (duration − 500ms). Do not export if:

- text overlaps, clips, or wraps badly
- any frame is blank, mostly empty without intent, or visually basic
- the CTA is too small for mobile, or not visible in the final 20–30%
- start/mid/end frames look near-identical (motion is static)
- contrast, spacing, or safe-area placement is weak
- typography breaks into single letters or awkward fragments

If QA fails, revise template inputs (or the HTML, if hand-authored) and rerun frame QA. Only call `creative_export_html_motion_clip` after QA passes.

## Quality Bar

Templates and any hand-authored HTML must feel closer to production creative than basic cards:

- layered backgrounds (gradient + glow blob + grain or grid)
- strong typographic hierarchy with weight contrast
- animated progress/accent bars or shipping rails when relevant
- motion-safe pulsing CTA in the final act
- staggered CSS keyframe entrances (cascade, not all-at-once)
- visual proof cards, feature chips, metrics, or app frames — not random decorative rectangles
- clean mobile safe area and balanced negative space
