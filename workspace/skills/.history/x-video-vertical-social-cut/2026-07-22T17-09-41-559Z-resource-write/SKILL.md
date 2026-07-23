---
name: X Video to Vertical Social Cut
description: Turn an X/Twitter video or local source clip into a verified 9:16 social export using the proven direct FFmpeg/run-command media path: preserve widescreen foreground, dark blurred background, burned-in captions, and no persistent header by default.
version: 1.1.0
triggers: make a vertical captioned clip from this x video, turn this twitter video into a tiktok style video, make a no-header vertical clip from this video, create a 9:16 social cut with captions
---

# X Video to Vertical Social Cut

This is a **production runbook**, not a generic video-editing checklist. Use it when Raul supplies an X/Twitter video URL or a local MP4 and asks for a short vertical captioned social cut.

## Non-negotiable execution lane

**The footage stays in the direct FFmpeg/run-command media lane from ingest through export.**

- Resolve/download the real source MP4.
- Inspect the actual source and transcript, choose the moment manually.
- Generate ASS captions from the selected source range.
- Build the 9:16 frame with a direct FFmpeg filter: full landscape foreground over a dark blurred source-derived background.
- Burn captions and mux the trimmed original audio in that same FFmpeg render.
- Decode, probe, and visually inspect the final MP4 before delivery.

**Never use HyperFrames, HTML Motion, Remotion, Creative compositions, or frame-by-frame browser rendering** to crop, caption, carry, or export the source footage. Those are only optional overlay/design tools when Raul specifically asks for designed graphics on top of an already-rendered direct-FFmpeg cut.

## Read before executing

Read [`references/proven-direct-ffmpeg-runbook.md`](references/proven-direct-ffmpeg-runbook.md). It contains:

- Windows FFmpeg/FFprobe resolution commands;
- the exact working `filter_complex_script` for the Odyssey no-header export;
- a real ASS caption style and mobile-safe placement;
- direct PowerShell export/probe/decode/frame-QA commands;
- failure recovery for X media, cloud transcription, paths, and captions.

Do not invent a new rendering lane when this reference has the known-good commands.

## Output contract

Default output is a mobile-ready **1080×1920, 30fps H.264/AAC MP4** with `+faststart`:

- Full widescreen source video stays centered and visible. Never crop away useful UI, cinematic action, or end-card copy merely to fill 9:16.
- Unused vertical area is a softened/darkened blurred copy of the original footage.
- Captions are big, high contrast, phrase-length, and placed in the lower safe area.
- There is **no persistent title, hook, source credit, tag, watermark, or header** unless Raul explicitly requests it.
- Use the requested duration; otherwise choose one coherent 20–45-second moment with a clear opening line.

## Exact production workflow

1. **Resolve source.** For an X URL, use the X/media resolver. If X extraction does not expose media metadata, use the downloader/resolver fallback and continue with the downloaded MP4. Do not abandon the edit and do not change render lanes.
2. **Probe and inspect.** Use the runbook FFprobe command. Generate/reuse a cached transcript, make a contact sheet or frame samples, then choose the exact `START` and `DURATION` manually.
3. **Write captions.** Make an `.ass` file whose timing starts at `00:00` for the selected clip. Use the runbook baseline style: Arial 62, white, black outline, lower-safe `MarginV=175`, no title/tag events.
4. **Render.** Put the runbook’s canonical source-video filter into a text file. It trims video/audio, creates the blurred 1080×1920 background, centers the uncropped foreground, applies ASS captions, and maps trimmed original audio. Run the direct FFmpeg export command.
5. **QA the actual MP4.** Full decode, stream/dimension probe, early-middle-ending frame exports, then visual review. Repair by changing only the source time range, captions, or FFmpeg filter. Never swap to HTML rendering.
6. **Deliver only after passing QA.** State real duration, dimensions, codecs, and visible QA findings. Mention any genuine uncertainty rather than claiming an audio/listening verdict without evidence.

## Verified reference: Heavy Pulp Odyssey, no header

The proven no-header Odyssey export used this exact construction:

```text
[0:v]trim=duration=30,setpts=PTS-STARTPTS,split=2[bgsrc][fgsrc];
[bgsrc]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=25:10,eq=brightness=-0.18:saturation=0.72[bg];
[fgsrc]scale=1080:-2:force_original_aspect_ratio=decrease[fg];
[bg][fg]overlay=(W-w)/2:(H-h)/2,ass='CAPTION_PATH'[v]
```

It produced a 30-second 1080×1920 H.264/AAC MP4 with the full cinematic landscape frame, dark blurred background, bold outlined all-caps captions, **no added header**, no black frames, no crop loss, and no caption clipping after actual-export visual QA.

## Required QA gates

Do not deliver unless all are true:

- FFmpeg full decode exits successfully.
- FFprobe reports 9:16 output, H.264 video, and AAC audio.
- Early, middle, and ending output frames have been checked visually.
- Captions are readable and clear of mobile UI.
- No black/corrupt frame, aggressive foreground crop, or accidental header is present.
- The visual verdict is based on the exported MP4, not only the source, timeline, or a generic metadata scorer.

## Avoid

- Do not reopen the generic Creative/HyperFrames path for normal source footage.
- Do not leave a permanent title strip because an old Kimi template had one.
- Do not let a missing X video hint or cloud STT quota abort the workflow.
- Do not claim a clip is good based only on a technical probe.
