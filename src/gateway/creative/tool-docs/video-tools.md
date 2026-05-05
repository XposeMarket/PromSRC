# Video Tool Catalog

Video Mode exposes a focused tool catalog for timeline editing: mode control, scene state, canvas settings, starter templates, timeline actions, element creation, element updates, selection, deletion, arrangement, style application, asset fit/source updates, animation, rendered frame snapshots, video/image export, scene save, image/video analysis, memory, business context, and skills.

Do not use subagents, background tasks, or plan tools inside Video Mode unless the user explicitly leaves creative mode and asks for that workflow.

For any non-trivial Video Mode request, load `creative-director-video` with `skill_list`/`skill_read` before final layout or export decisions. This applies across all video work, not only Remotion templates: manual timeline edits, starter templates, product promos, caption reels, image montages, audiograms, and MP4 exports. When changing or reasoning about Remotion-backed template code, also load `remotion-best-practices` and use its rule docs for animations, captions, sequencing, fonts, transitions, assets, measuring text, audio visualization, and render checks.

Use `creative_render_snapshot` as the visual self-review checkpoint. It renders actual screenshot frames of the creative canvas, and the chat runtime injects returned frames as actual vision images into the next model step when the primary model supports vision. This is direct self-observation, not a separate critic pass.

For video work, prefer dense review batches over only checking a few hero frames. Use `sampleTimesMs` for exact moments, `frameStepMs` for ranges, or `sampleEveryFrame:true` with `startMs`, `endMs`, and `maxFrames` to inspect sequential frames at the timeline frame rate. For long videos, review the full timeline in contiguous batches so every frame range is seen directly before final delivery.

After `creative_export` returns a saved video path, do not rely on automatic critic summaries. If exported playback needs inspection, use direct frame extraction/snapshot workflows and continue from the frames the model can actually see.

Library and export access:
- Icons use Iconify. You may set `meta.iconName` to any valid Iconify name, including `solar:*`, `lucide:*`, `mdi:*`, `tabler:*`, `ph:*`, `heroicons:*`, `simple-icons:*`, `logos:*`, and other Iconify collections.
- Use `creative_search_icons` when you need exact Iconify icon names for a concept before adding or swapping an icon.
- For non-trivial icon choices, search Iconify instead of only using starter/preset icon examples.
- Text can use any installed or web-safe `meta.fontFamily`; Manrope is only the default.
- Uploaded images and videos are available by exact workspace path in `[UPLOADED FILES]`. Use `analyze_video` when uploaded video content matters, then place assets with `creative_add_asset`; video layers support placement, resizing, rotation, opacity, layering, fit/radius, trim, sequencing, and animation.
- Use `creative_attach_audio_from_url` when the user gives a YouTube/X/TikTok/Instagram/media URL and asks to use the song, soundtrack, or voiceover as background audio. It downloads audio-only with yt-dlp, imports the file into the Creative asset index, analyzes waveform/metadata, and arms the Video Mode audio lane. Only use media the user has rights or permission to use.
- Use `creative_attach_audio_from_file` when the user uploads/sends a local video or audio file and asks to reuse its sound, song, voiceover, or background music. It extracts embedded audio from video files with FFmpeg, then imports, analyzes, and arms the Video Mode audio lane.
- Use `creative_import_asset`, `creative_analyze_asset`, and `creative_search_assets` to build and search the Creative asset index before composing serious videos. Imported assets receive metadata such as type, dimensions, duration, frame rate, codec, thumbnails when possible, tags, brand id, and license data.
- Use `creative_generate_asset` for placement-ready generated background plates/graphic placeholders that are stored in the Creative asset index. Provider-backed generation can replace the local SVG placeholder without changing this tool contract.
- Use `creative_list_templates` and `creative_create_from_template` for premium editable Video Mode scenes before hand-building from primitives. Current templates include `saas-hero-reveal`, `ai-dashboard-flythrough`, and `podcast-audiogram-premium`; they materialize regular layers with timing, effects, masks, blend modes, brand-kit binding, and quality-report metadata.
- Use `creative_trim_clip` for timeline-v2 clip timing, including start/end/duration, trim windows, speed, and loop.
- Use `creative_add_effect`, `creative_set_blend_mode`, and `creative_add_mask` for richer compositing. These write effect stacks, blend modes, and masks into the editable scene graph.
- Motion presets include more than the short examples. Call `creative_get_state` for available preset ids and use any built-in or enabled custom preset.
- Use `creative_search_animations` when choosing motion for a video, caption sequence, image montage, or promo clip instead of repeating only `fade_slide_up` and `scale_pop`.
- Built-in starter templates include `video_promo`, `app_launch`, `product_ad`, `event_flyer`, `testimonial`, `carousel`, `tiktok_caption_reel`, and `audiogram`; treat them as structured starting points and still refine with icons, style presets, motion, and QA.
- Reusable component presets include CTA card, caption block, feature card, logo lockup, lower third, and product callout. Use these instead of building every promo from loose text plus random rectangles.
- Style directions include startup launch, TikTok bold, luxury, editorial, SaaS product, meme/news, and local business ad. Pick one before adding layers so typography, color, icons, spacing, and motion share a visual system.
- Available graphic primitives include icon presets, background panels, accent slabs, light sweeps, phone/app frames, gradients, texture-like overlays, progress bars, and UI mockup frames.
- Use `creative_list_motion_templates` and `creative_apply_motion_template` for Remotion-backed high-level video systems such as Caption Reel V2, Audio Visualizer, and Product Promo. Prefer these over manually placing every caption word or waveform bar when the user asks for reels, audiograms, social presets, or reusable motion styles.
- Prefer `caption-reel-v2` over legacy `caption-reel` for new caption reels, TikToks, Reels, Shorts, launch captions, or reusable motion-template work.
- For Caption Reel, pass the user's spoken/written caption as `caption` or `captionText` if you do not already have timed `captions.segments`; the Remotion runtime will auto-create caption segments for preview/apply.
- Use `creative_generate_motion_variants` when the user asks for options, directions, styles, or platform variants. Keep the chosen variant attached as a motion template instance so it can be revised through template inputs later.
- Use `creative_list_html_motion_templates`, `creative_apply_html_motion_template`, and `creative_create_html_motion_clip` for fast HTML/CSS/JS motion systems. These are best for polished promo clips, social ads, kinetic type, CSS/SVG/canvas/WebGL visuals, product cards, and quick iterations where primitive scene layers would look flat.
- HyperFrames-style HTML is a good fit for Video Mode's HTML motion lane. `creative_create_html_motion_clip` accepts self-contained HTML that uses `data-start`, `data-duration`, `data-end`, `data-trim-start`, and `data-offset`; frame snapshots seek those attributes deterministically. JS-driven clips can listen for `prometheus-html-motion-seek` or read `window.__PROMETHEUS_HTML_MOTION_TIME_SECONDS__` to update GSAP/canvas/WebGL state for exact frame QA.
- For any meaningful video work, use `skill_list`/`skill_read` to load `creative-director-video` when available before final layout and export decisions.
- For Remotion implementation work, use `skill_list`/`skill_read` to load `remotion-best-practices`; do not scaffold or run a separate Remotion Studio project unless the user specifically wants that preview/project workflow.
- `creative_export` in Video mode does not run a separate critic gate. The agent should inspect rendered frames directly with `creative_render_snapshot`, then decide the next edit/export step from its own visual context.
- Run `creative_validate_layout` before export and after large edits. Error-level issues are export blockers unless the user explicitly forces export: broken word wraps, text overflow, unsafe margins, accidental overlaps, or editor/export-risk artifacts.
- Pre-flight every hero title, caption, lower-third, CTA, and stat with `creative_measure_text` before placing it into a sized box. Use `suggestedFontSize` to auto-fit when `overflowsHeight` is true. After authoring, `creative_lint_html_motion_clip` runs a pretext text-fit pass and emits `text-overflow-height` / `text-overflow-width` warnings; drill into them with `creative_text_fit_report`. `creative_quality_report` and `creative_apply_html_motion_template` also attach a `textFit` block — treat `textFit.ok === false` as ship-blocking.
- Run `creative_quality_report` before final export on non-trivial videos. It combines layout validation, keyframe health, caption timing, audio sync, frame traces, static-frame checks, asset usage, and export readiness into one ship/no-ship report.
- Video scenes and exports should default to 60fps. Use lower frame rates only when the user asks for them or when exporting GIF.
- `creative_export` saves to workspace creative exports by default. Only set `download:true` when the user explicitly wants a browser download.

Video quality floor:
- Do not ship videos that are just a title, one paragraph, and a random rectangle unless the user explicitly asks for a minimal static card.
- Every normal video should have a clear format/preset, deliberate font pairing, safe-area layout, at least one icon/media/graphic system when relevant, purposeful layer order, and visible motion progression across sampled frames.
- Before export, fix any frame with overlapping text, broken wrapping, tiny CTA text, visible editor handles, blank/dead space that looks accidental, weak contrast, or repeated static frames with no payoff.
- If repeated edits make the scene inconsistent or old generated layers keep showing, rebuild from a fresh video scene instead of continuing to patch the corrupted timeline.
