# Raul-approved Kimi benchmark: exact fast path

This is the authoritative visual/process baseline for the X-video clipping skill because Raul explicitly praised these exports. Do not substitute later generic 20-second telemetry runs or HyperFrames attempts.

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
- Exact render implementation: `tools/render_social_clips.py`
- Exact approved artifacts: `exports/kimi-k3-social-clips/`

Later evidence confirms what not to copy:
- HyperFrames attempt rejected at `audit/chats/transcripts/mobile_mrv13wv3_nh17ac.md:410-416`: `The first version you did was WAY fucking better`.
- Later generic 20-second Ashen telemetry attempt rejected in `audit/chats/transcripts/mobile_mrwcwam2_zdkiix.md`.

## Approved visual contract

The approved first-run exports were **720x1280, 30fps, H.264/AAC**, not 1080x1920. Preserve the landscape source as a centered 720x405 foreground at `y=290`. Fill the 9:16 canvas with a source-derived dark blur. Add:

- a dark top strip from y=0 through 106;
- a persistent uppercase hook in gold/yellow at the top;
- a small source/Prometheus tag under the hook;
- burned spoken captions in bold white with dark outline around `MarginV=210`;
- a dark bottom strip from y=1165 through 1280.

The exact approved FFmpeg filter and ASS construction are in `tools/render_social_clips.py:32-69`. When reproducing this style, copy that implementation first rather than reinventing the layout.

## Fast execution path for one linked X video

Latency target: **8-10 minutes maximum**, with **3-6 minutes preferred** when the source/transcript is cached.

1. Activate only `media_assets` and `workspace_write`. Read this resource and the main skill. Do not read broad Creative/HyperFrames skills.
2. Call `download_media(url, output_dir)` immediately for an X status. Do not call `web_fetch`, browser tools, or Creative ingest first. Use the exact returned MP4 path.
3. Resolve the known FFmpeg/FFprobe binaries once. Do not search the drive. Probe duration/dimensions/codecs.
4. Reuse an existing transcript or transcript cache keyed to the exact media. If absent, transcribe once. Do not call full-source `analyze_video` before hook selection.
5. Choose one coherent source window from timestamped transcript text. Default 30-45 seconds unless Raul asks otherwise. For 2-3 clips, choose independent coherent ranges in one pass.
6. Generate ASS directly from transcript segments intersecting each selected range. Use the approved Title/Tag/Caption styles from `tools/render_social_clips.py`. If Raul explicitly requests no header, remove only Title/Tag events and top strip; do not change the rest of the approved composition.
7. Render directly with FFmpeg. For one clip, run one render. For several independent clips, launch renders in parallel when safe rather than serially. Use `libx264 -preset faster -crf 20`, AAC 160k, 30fps, `+faststart`. NVENC is unavailable on the verified machine (`Cannot load nvcuda.dll`), so do not spend time probing it again unless hardware changes.
8. QA the actual MP4: FFprobe, full decode, then one contact sheet or 8-12 sampled frames. One visual pass is enough unless it finds a defect. Do not separately analyze each clip multiple times.
9. Deliver the exact stat-verified artifact path and record compact telemetry.

## Avoided overhead

The original praised run took 17m39s because it included avoidable work: failed `web_fetch`, full-source `analyze_video` (4m28s), failed cloud STT (1m26s), broad FFmpeg search (1m01s), shell quoting retries, local Whisper (4m14s), serial CPU rendering (5m21s), and three separate QA analyses.

The optimized lane removes the failed fetch, full-source analyzer, cloud-STT retry, binary search, shell experimentation, and redundant QA. The remaining critical path is download + cached/targeted transcript + direct render + one QA pass.

## Reproduction evidence, 2026-07-22

The exact original `tools/render_social_clips.py` was rerun against the retained 1.01GB Kimi source and transcript. It recreated all three artifacts successfully in 411.69 seconds (6m51.69s), inside Raul's 8-10 minute target even though the legacy script renders all three serially. Full-decode QA passed for all three MP4s. Fresh 12-frame visual QA passed the approved layout on clips 01 and 03. NVENC was tested and is unavailable, so CPU `libx264` remains the verified path.
