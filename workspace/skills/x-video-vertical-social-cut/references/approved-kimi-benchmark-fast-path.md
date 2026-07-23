# Raul-approved Kimi benchmark: exact fast path

This is the authoritative composition/process baseline for the X-video clipping skill because Raul explicitly praised these exports. Do not substitute later generic telemetry runs or HyperFrames attempts.

## Current override, 2026-07-22

Raul approved the overall preserved-landscape, source-blur, captioned result but explicitly corrected two parts of the workflow after reviewing the latest live export:

1. **No header by default.** Do not add a title, hook, tag, source credit, Prometheus label, or persistent top text unless Raul asks for one in the current request.
2. **Captions must track speech tightly.** Coarse transcript-segment boundaries that leave a caption behind for 1-2 seconds after speech advances are unacceptable. Build cards from word timing and run actual-export transition QA.

These rules supersede the historical Title/Tag behavior below. The benchmark remains authoritative for direct FFmpeg, preserved landscape footage, source-derived dark blur, caption treatment, artifact QA, and speed.

## Approval evidence

- Session: `mobile_mrv13wv3_nh17ac`
- Transcript: `audit/chats/transcripts/mobile_mrv13wv3_nh17ac.md`
- Request and source URL: lines 1-14
- Delivery summary: lines 15-34
- Raul's exact acknowledgement, lines 35-49:
  - `Yo that was cool as FUCK hell fucking yea`
  - `Holy shot`
  - `For a first run benchmark test that was amazing`
- Durable tool telemetry: `exports/kimi-k3-social-clips/TELEMETRY-AND-RUN-LOG.md`
- Exact historical render implementation: `tools/render_social_clips.py`
- Exact historical artifacts: `exports/kimi-k3-social-clips/`

Later evidence confirms what not to copy:
- HyperFrames attempt rejected at `audit/chats/transcripts/mobile_mrv13wv3_nh17ac.md:410-416`: `The first version you did was WAY fucking better`.
- Later generic 20-second Ashen telemetry attempt rejected in `audit/chats/transcripts/mobile_mrwcwam2_zdkiix.md`.
- Latest Ashen review in session `mobile_mrwh5rf1_jjg0nw`: retain the overall look, remove all header/title material, and tighten caption changes to active speech.

## Approved visual contract, corrected

The approved first-run exports were **720x1280, 30fps, H.264/AAC**. Preserve the full landscape source as a centered foreground, normally 720x405 at `y=290` for 16:9 footage. Fill the 9:16 canvas with a source-derived dark blur. Add:

- **no persistent header/title/tag/source-credit by default;**
- bold readable burned spoken captions in white with a dark outline in the lower mobile-safe area;
- original trimmed audio and mobile `+faststart`.

`tools/render_social_clips.py:32-69` remains useful for the historical scale/blur/overlay and encoding construction, but its Title/Tag events and top strip must be omitted. Use the current `SKILL.md` caption timing rules rather than copying coarse historical segment boundaries.

## Fast execution path for one linked X video

Latency target: **8-10 minutes maximum**, with **3-6 minutes preferred** when the source and word-timed transcript are cached.

1. Activate only `media_assets` and `workspace_write`. Read this resource and the main skill. Do not read broad Creative/HyperFrames skills.
2. Call `download_media(url, output_dir)` immediately for an X status. Do not call `web_fetch`, browser tools, or Creative ingest first. Use the exact returned MP4 path.
3. Resolve known FFmpeg/FFprobe binaries once. Do not search the drive. Probe duration, dimensions, and codecs.
4. Reuse an existing transcript only when it belongs to the exact media and contains word-level timing. If only coarse segment timing exists, run a bounded word-timing/alignment pass for the selected range instead of shipping loose captions.
5. Choose one coherent source window from timestamped transcript text. Default to the duration Raul requests; otherwise use 20-30 seconds for one clip. For several clips, choose independent coherent ranges in one pass.
6. Generate ASS caption cards from word timing. Use only the Caption style. Omit Title/Tag/Hook/source-credit styles and events. Keep cards short, clear a completed phrase promptly, and replace it near the next phrase onset.
7. Render directly with FFmpeg. Use `libx264 -preset faster` or `veryfast`, CRF 20, AAC 160-192k, 30fps, and `+faststart`. NVENC is unavailable on the verified machine (`Cannot load nvcuda.dll`), so do not probe it again unless hardware changes.
8. QA the actual MP4: FFprobe, full decode, one contact sheet or 8-12 sampled frames, and caption-transition checks near the early, middle, and late portions against actual audio. Reject any unexpected header or stale caption that carries into a different spoken phrase.
9. Deliver the exact stat-verified artifact path and record compact telemetry.

## Caption timing acceptance

- Prefer 2-6 words per card with phrase/punctuation-aware breaks.
- Let a cue begin at the first word, with no more than about 80ms early lead.
- End it near the final word, normally with only 60-120ms of tail.
- During continuous speech, replace the card within 120ms of the next spoken word onset.
- Reject visible caption lag above roughly 250ms and reject any card that remains while a different phrase is already being spoken.
- Do not solve nonlinear drift with a blind global subtitle offset.

## Avoided overhead

The original praised run took 17m39s because it included avoidable work: failed `web_fetch`, full-source `analyze_video` (4m28s), failed cloud STT (1m26s), broad FFmpeg search (1m01s), shell quoting retries, local Whisper (4m14s), serial CPU rendering (5m21s), and three separate QA analyses.

The optimized lane removes failed fetches, full-source analysis, duplicate STT attempts, binary search, shell experimentation, and redundant QA. The remaining critical path is download, exact-media word timing, direct render, and one actual-export QA pass.

## Reproduction evidence, 2026-07-22

The historical `tools/render_social_clips.py` was rerun against the retained 1.01GB Kimi source and transcript. It recreated all three artifacts successfully in 411.69 seconds (6m51.69s), inside Raul's 8-10 minute target. Full-decode QA passed for all three MP4s. Fresh visual QA passed the preserved-landscape/source-blur composition on clips 01 and 03. This reproduction proves the render lane and speed, not the now-retired header default or coarse caption timing. NVENC was tested and is unavailable, so CPU `libx264` remains the verified path.
