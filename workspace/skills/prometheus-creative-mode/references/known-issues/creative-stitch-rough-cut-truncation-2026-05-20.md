# Creative stitch / rough-cut truncation (2026-05-20)

## Observed symptom

During a Prometheus × PulseFit promo build, combining four generated MP4 scene clips through the normal stitch / rough-cut path produced an output that reported only about `6.93s`, even though the four input clips totaled roughly `24s`.

The user noticed the exported combined video was not longer than ~6 seconds and asked for a full-length retry.

## Evidence

- `audit/chats/transcripts/9fe81950-4861-45fe-a2d3-6ae1524e8ea3.md:31-44` — first combine attempt used stitch/rough-cut; note says stitch produced a too-short output.
- `audit/chats/transcripts/9fe81950-4861-45fe-a2d3-6ae1524e8ea3.md:51-63` — user reported the stitch issue; recovery used an explicit composite timeline and verified `24.16s` output.
- `memory/2026-05-20-intraday-notes.md:8-12` — notes record the 6.93s stitch result and later full-length `24.166s` composite fix.

## Current recovery pattern

When `creative_stitch_clips`, `creative_render_generated_sequence`, or `creative_auto_assemble_rough_cut` produces a duration shorter than the expected sum of source clips:

1. Treat the result as suspect; do not claim the combined cut is final.
2. Compute/check expected duration from inputs when tool metadata is available.
3. Rebuild the sequence with `creative_composite_video_layers` using explicit sequential video layers (`start` offsets, durations, and full-frame bounds).
4. Verify the rendered output duration and dimensions before presenting.
5. Report audio identity explicitly; the observed composite recovery path produced a visual-only output unless audio was separately extracted/mixed/attached.

## Follow-up candidate

A source-level fix should make stitch/rough-cut helpers validate expected duration against the sum of inputs and either preserve all clip durations or fail loudly when truncation occurs.