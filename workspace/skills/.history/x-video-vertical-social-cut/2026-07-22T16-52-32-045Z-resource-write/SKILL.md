---
name: X Video to Vertical Social Cut
description: Turn an X/Twitter video or local source clip into a verified 9:16 social export: preserve widescreen foreground footage, use a dark blurred background, burn in phone-readable captions, and omit persistent headers by default.
version: 1.0.0
triggers: make a vertical captioned clip from this x video, turn this twitter video into a tiktok style video, make a no-header vertical clip from this video, create a 9:16 social cut with captions
---

# X Video to Vertical Social Cut

Use this workflow when Raul supplies an X/Twitter video URL or a local video and wants a vertical social cut with captions.

## Non-negotiable execution lane

**Use the proven direct FFmpeg/run-command media workflow for all source footage.** Download/resolve the real MP4, inspect it, select the source time range, generate the blurred background and burned-in subtitles with direct FFmpeg filters, export H.264/AAC, and QA the actual MP4.

- Do **not** use HyperFrames, HTML Motion, Remotion, or frame-by-frame HTML rendering to carry, crop, caption, or render the source video.
- Do **not** open a Creative/HyperFrames composition for this task unless Raul explicitly asks for an additional designed overlay, title card, or motion-graphic layer. Even then, composite that layer over the already-rendered direct-FFmpeg source cut rather than routing the underlying footage through it.
- This workflow’s known-good path is the direct command/media path. Prefer it over generic Creative video tools for speed and fidelity.

## Output contract
- Produce an H.264/AAC 9:16 MP4, normally 1080×1920 at 30fps unless source or delivery constraints require otherwise.
- Preserve the full widescreen source video as the centered foreground. Do not crop away meaningful UI or cinematic action.
- Fill unused vertical space with a darkened, blurred version of the same footage.
- Burn in large, high-contrast captions in the lower safe area. Keep captions clear of mobile UI and never clip them.
- **No persistent header, title strip, or watermark by default.** Add one only when the user explicitly asks.
- Use `faststart` / mobile-ready MP4 settings when export tooling supports it.

## Workflow
1. Resolve/download the video. For X status URLs, use the X/media recovery path; if regular post extraction fails, use the media downloader/resolver fallback rather than abandoning the source.
2. Inspect the source video and transcript. Prefer Creative transcription; cloud STT is primary, and local Whisper is the recovery path when cloud transcription is unavailable.
3. Choose a coherent 20–45 second moment with a clear hook and enough dialogue/context. Use the user’s requested length when specified.
4. Build the vertical composition: blurred/dark background, centered uncropped foreground, captions in lower safe area, no default header.
5. Export H.264/AAC.
6. QA before delivery:
   - technical probe/full decode succeeds;
   - sample early, middle, and ending frames or use a contact sheet;
   - visually confirm no black frames, accidental header, crop loss, or caption clipping;
   - verify aspect ratio, duration, audio track, and caption readability;
   - if the generic scorer is confused by source-video metadata, do not use it as the sole acceptance gate.
7. Deliver the final MP4 and report only verified facts. Mention any genuine uncertainty, especially if audio can be transcribed but not directly auditioned.

## Proven Odyssey reference
The verified no-header Odyssey test used full cinematic widescreen footage centered over a dark blurred vertical background, bold outlined all-caps captions in the lower safe area, 1080×1920 H.264/AAC, 30 seconds. Visual contact-sheet review found no persistent header, black frames, crop loss, or caption clipping. Local Whisper fallback produced the transcript during QA.

## Avoid
- Do not leave a persistent title/header on screen unless explicitly requested.
- Do not crop the foreground aggressively just to fill 9:16.
- Do not claim visual or audio QA without actual evidence.
- Do not give up on an X URL solely because the initial post fetch lacks media metadata.