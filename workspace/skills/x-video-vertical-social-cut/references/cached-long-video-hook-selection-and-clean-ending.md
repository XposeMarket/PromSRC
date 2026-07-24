# Cached long-video hook selection and clean-ending fast path

Evidence: Kevin Naughton Jr. 15-minute source, X status `2079921911350673579`, completed 2026-07-22.

## Cache-first identity contract

Before downloading, inspect only bounded known artifact roots for likely source MP4s. Do not recursively scan the full workspace or drives. Candidate cache roots should include the active run artifact directory and the current session's prior social-cut source directory.

A filename is not sufficient identity. Verify:

1. expected creator/status context when preserved;
2. source duration against the linked media class (this source was 900.992s);
3. dimensions/codecs with one probe;
4. path, byte size, duration, source URL, selected start, and selected duration in `source-identity.json`.

If no bounded, verified cache exists, call `download_media` once. Do not browse or web-fetch first.

## Long-video candidate selection

For a 15-minute source, do not default to the opening channel introduction. Prefer a specific, standalone claim with immediate audience value. The successful Kevin candidate opened with:

> This is basically the best Linux laptop that you can buy.

The same section developed a useful second point: the physical device matters, but the real work happens in a VPS/cloud machine.

Candidate gates before final rendering:

- First spoken sentence must be intelligible without prior context. Reject leading conjunctions/fragments such as `...that you can buy` or `and this is...` when they feel clipped.
- Last spoken sentence must complete naturally. Reject `let's jump over...`, `So now...`, or any transition into the next section.
- When an otherwise strong candidate fails only at its edges, move the source start/end by small sub-second increments instead of abandoning the section.
- A user-requested 30-second clip may validly be 20-30 seconds. Prefer a clean 26-second ending over padding to exactly 30 seconds.

## Caption cards

Use exact word timestamps and 2-4 words per card for dense speech. Current proven settings:

- start: first word minus ~20ms;
- end: final word plus ~70ms;
- cap the end at the next word minus ~10ms;
- break at punctuation or a >=300ms pause;
- no header/title/tag/source-credit styles or events;
- correct obvious tokenization before rendering (`pre -production` -> `pre-production`).

Editorial edge cleanup must also update captions. If trimming audio before `So now`, ensure the final caption is exactly `here.` rather than `here. So`. Check the last caption-card text directly before rendering.

## Efficient Windows paths

Workspace shell commands may already start inside the workspace root. Resolve `.` first and construct paths from that verified location. Do not blindly prepend another `workspace/` directory.

Known binaries in the Prometheus repo are one directory above the workspace:

- `node_modules/@ffmpeg-installer/win32-x64/ffmpeg.exe`
- `node_modules/@ffprobe-installer/win32-x64/ffprobe.exe`

Use project-local binaries. Never recurse drives looking for FFmpeg.

## Performance recovery

Local Whisper `small.en` CPU word-timestamp transcription can vary dramatically (roughly 2-7 minutes for 27-30 seconds on the verified machine). Therefore:

- cache the exact candidate JSON beside the exact candidate MP4;
- before transcription, test for the expected exact JSON path and skip Whisper if it exists;
- do not rerun Whisper after caption-only, duration-only, filter-only, or ending-text corrections;
- render/QA separately from transcription so a wrapper timeout cannot discard a completed transcript;
- do not combine slow transcription and render under one tight foreground timeout.

## Delivery gate

Mandatory actual-export gates:

1. probe H.264/AAC, 1080x1920 or current requested dimensions, 30fps;
2. full decode to null exits 0;
3. sampled visual QA confirms no added header and no corrupt frames;
4. transcript/playback confirms complete hook and complete ending;
5. inspect the first and last caption cards directly;
6. caption transition QA confirms no stale 1-2 second linger;
7. stat and deliver the exact final MP4.

Successful Kevin export evidence:

- output duration: 26.033s;
- 1080x1920, 30fps, H.264/AAC;
- no added header/title/tag/source credit;
- final caption: `here.`;
- complete opening and ending;
- full decode passed;
- actual-export visual/transcript QA passed.
