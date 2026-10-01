---
name: "media-assets-pipeline"
description: "Acquire, validate, persist, organize, and deliver image, video, audio, and transcript assets with provenance and bounded recovery. Use for asset lifecycle beyond one-shot interpretation; use image-analyst to understand a single image and imagegen for one-shot raster creation. Not for interpretation of a single image (image-analyst) or one-shot raster generation (imagegen)."
---

# Media Assets Pipeline

Use this for media acquisition and handling across image, video, audio, captions, and transcripts. Use image-analyst for visual interpretation and imagegen for one-shot raster generation; this playbook owns the asset lifecycle.

## Acquire with provenance

Prefer the narrowest supported source route: direct URL download for direct assets, supported media download for social/video pages, native generation for new assets, or Creative import for project assets. Record source URL/path, acquisition method, timestamp, provider/model when applicable, and user-supplied invariants. Do not bypass authentication, DRM, CAPTCHAs, or access controls.

## Inspect before transforming

Verify the artifact exists and is non-empty. Inspect image dimensions/alpha/format, video duration/dimensions/codecs, audio duration/sample rate/channels, and transcript language/timestamps when relevant. Use content inspection, not a file extension, as proof.

## Analyze and derive

Choose only the needed operation: image vision/OCR, video contact sheet/detail frames, audio extraction/transcription, caption sync, trim/reframe, or format conversion. Preserve the original and write derived outputs to a clear project/output location. Register derived assets with their parent/provenance when the Creative or media ledger is in use.

## Validate and deliver

For images, check composition, text, alpha, and reference fidelity. For video, check decode, duration, dimensions, sampled frames, captions, crop, and audio. For audio/transcripts, check decode, duration, intelligibility, timestamps, and sync. Hash or otherwise identify important final artifacts when the workflow requires reproducibility. Deliver the actual verified path and distinguish source, derived, and final files.

## Recovery

- download timeout or partial file: inspect size/decode, remove or quarantine the partial output, retry once with a bounded timeout or alternate supported source;
- unsupported page or missing media: use the supported media path, then direct asset extraction, then report the limitation;
- corrupt decode: preserve evidence, try a safe remux/decoder path, never claim success from metadata alone;
- missing provider/model: use the nearest supported generation or local deterministic transform;
- analysis/transcription failure: preserve the media, retry the bounded transcription window, or report missing analysis;
- delivery failure: keep the verified workspace artifact and report the destination failure separately.

Never replace the original destructively unless explicitly requested.
