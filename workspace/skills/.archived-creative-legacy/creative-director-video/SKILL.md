---
name: creative-director-video
description: Use when Prometheus is creating, editing, critiquing, or exporting Creative Mode videos, Remotion motion templates, caption reels, audiograms, product promos, social clips, Shorts, Reels, TikToks, Stories, or any video that needs production-quality layout, typography, motion, pacing, safe-area checks, and export QA.
emoji: "🎬"
version: 1.0.0
triggers: video, creative, creative mode, remotion, caption, captions, reel, reels, tiktok, short, shorts, story, audiogram, product promo, promo video, motion template, motion templates, export, mp4, animation, animations
---

# Creative Director Video

## Mission

Act like a video creative director before acting like a canvas operator. Build clips that read as intentionally art-directed: clear hierarchy, strong framing, readable typography, purposeful motion, and export-ready QA.

## Default Workflow

1. Identify the format first: Reel/TikTok/Short/Story/Square/Feed/YouTube.
2. Pick a high-level system before low-level layers:
   - Caption/subtitle reel: use Remotion `caption-reel-v2` first.
   - Product or feature announcement: use Product Promo once available; otherwise use a structured scene with media, callouts, and CTA.
   - Audio clip, podcast, waveform, or music visual: use Audio Visualizer once available; otherwise build a waveform/progress layout.
3. Choose a style preset before placing elements: TikTok Bold, Startup Launch, Editorial, Tech Product, Luxury, Meme/News, or Calm Professional.
4. Search libraries deliberately:
   - Use icon search for meaningful symbols, marks, platform icons, tech icons, arrows, badges, or metaphors.
   - Use animation search for entrances, exits, text beats, pulses, wipes, parallax, blur, or emphasis.
5. Build in passes:
   - Pass 1: canvas, template, rough structure, timing.
   - Pass 2: typography, spacing, safe areas, layers.
   - Pass 3: motion rhythm, accents, CTA/outro.
   - Pass 4: visual QA, fixes, export.

## Media Intake Direction

If the user provides images, videos, screenshots, product recordings, social clips, or long footage, inspect the media before designing around it.

- Images: identify subject, visible text, safe crop zones, busy regions, brand colors, and whether text needs a scrim/panel.
- Videos: identify duration, orientation, key visual moments, dead air, on-screen text, transcript/audio quality, and candidate in/out points.
- Do not use media as a generic background unless it reads clearly and supports the message.
- Choose a clear media role: hero proof, app/product demo, b-roll, testimonial, before/after, gallery tile, texture, or CTA support.
- If the media is the main proof, give it enough size and screen time to be understood.

For long-video clipping, require an edit decision list before final assembly: source timestamp range, reason for selection, visual/audio content, crop/framing, speed treatment, captions, and target act in the final clip.

## Template Handling

- When starting a new caption reel, apply `caption-reel-v2` once from a fresh or replaced scene.
- If the user asks for a stronger version after export, prefer a fresh rebuild with the same brief over repeatedly reapplying templates onto an edited/corrupted scene.
- Do not stack multiple caption-reel instances in one scene unless the user explicitly asks for multiple template layers.
- If two caption layers overlap, disable/delete the older generated layer or rebuild fresh before continuing.
- For Bold TikTok V2, use strong social primitives by default: large display type, high-contrast accents, caption chips, visible progress, CTA card, and at least two distinct caption beats.

## Composition Rules

- Respect social safe areas. Keep primary text away from top UI zones and lower app chrome zones.
- Use a clear focal stack: hook/title, main caption or product visual, support detail, CTA/progress.
- Avoid giant empty centers unless the emptiness is used for motion, media, or deliberate reveal.
- Avoid random decorative shapes. Every line, dot, card, or icon must support hierarchy, rhythm, or meaning.
- Use z-index intentionally: background, texture, media, containers, copy, highlights, overlays.
- Do not use editor-looking graphics such as anchor nodes, bounding boxes, or guide-like lines unless they are clearly stylized and polished.

## Typography Rules

- Never allow broken word wrapping, single-letter fragments, or words split like `Rem / otion`.
- Use 2-4 strong lines for hooks and 1-3 readable caption lines per beat.
- Prefer high-contrast font pairings:
  - Bold social: Bebas Neue/Anton/Impact-style heading + Manrope/Inter body.
  - Startup launch: Sora/Inter/Manrope with strong weight contrast.
  - Editorial: Playfair/Georgia heading + Inter/Manrope body.
  - Tech product: Space Grotesk/Sora/Inter.
- Set line height tightly for big display text, usually 0.9-1.08.
- Keep letter spacing at 0 unless a template intentionally sets a label treatment.

## Motion Rules

- Add motion beats, not only fade-ins. Use at least 3 meaningful changes across a short clip:
  - hook reveal
  - caption/word emphasis
  - graphic or media move
  - CTA/progress/outro
- Match motion to content:
  - hype/social: punch scale, word highlights, quick wipes, pulse accents.
  - product: smooth parallax, feature callout reveals, screenshot pans.
  - professional: restrained slide/fade, clean progress motion.
- Avoid static frames across the middle and end of the clip unless the user asked for a still graphic.

## Editing And Timing Rules

- Use `creative_trim_clip` for editable video layers when selecting source ranges, setting visible duration, changing speed, or looping footage.
- Use `video_extract_clip_frames`, `video_render_contact_sheet`, or equivalent snapshot tools to verify the chosen visual moments.
- In HTML motion clips, use asset placeholders plus `data-start`, `data-duration`, and `data-trim-start` to place source video moments in the composition.
- Speed changes must have a reason: compress waiting, emphasize action, match music, or create a deliberate ramp. Do not speed up speech unless captions/audio remain intelligible.
- For clips with important source audio, verify audio sync and note whether the chosen export path preserves or requires muxing audio.

## Pre-Export QA Gate

Before exporting, render at least three frames: start, midpoint, near-end. Do not export if any of these are true:

- visible selection boxes, resize handles, guides, or editor controls
- clipped text, broken words, bad wrapping, unreadable contrast
- important text outside safe areas
- overlapping elements that look accidental
- blank or awkward frames
- weak hierarchy, cheap template feel, or no meaningful motion progression

If QA fails, revise with creative tools and run the snapshot review again. Use `force:true` only when the user explicitly asks to export despite known problems.

## Output Standard

For final delivery, include the saved file path, mention whether video playback QA ran, and briefly note any remaining caveat such as missing audio/transcript. Do not claim production quality unless the frame QA and export/video QA both pass.
