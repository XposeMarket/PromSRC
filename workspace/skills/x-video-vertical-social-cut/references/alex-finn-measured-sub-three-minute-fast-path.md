# Alex Finn measured sub-three-minute fast path

Source benchmark: X status `2080024545856249998`.

## Measured prior run

- Direct X download: 47 seconds.
- Broad full-video analysis/transcription: 3 minutes 42 seconds.
- Bounded local word transcription: 29 seconds.
- Render plus full decode: 19 seconds.
- Lightweight QA: 9 seconds.

The broad full-video `analyze_video` call was the dominant avoidable bottleneck and must not appear in the fast path. Its output was unnecessary because the lightweight local transcript artifacts were sufficient to select/build the 20-second cut.

## Corrected execution order

1. Start direct download immediately in a short Windows path.
2. Probe once.
3. Reuse exact-media transcript artifacts when available. If none exist, use bounded audio-only/local transcription; never broad `analyze_video`.
4. Choose one coherent source range.
5. Extract only that range to WAV.
6. Run cached lightweight Whisper with word timestamps on only the range.
7. Build 2-5-word ASS cards.
8. Render once with direct FFmpeg.
9. Perform probe + full decode + one contact-sheet visual review.
10. Stat and deliver.

## Expected budget

With comparable network behavior, the measured components imply roughly 1m45s before small orchestration overhead. The operational target is under 3 minutes. At 4 minutes, stop any unproven fallback and surface the precise blocker instead of continuing silently.

## Prohibitions from this benchmark

- Do not call `analyze_video` on the full downloaded source.
- Do not download a Whisper model.
- Do not perform multiple AI visual QA calls.
- Do not update the skill before delivering unless Raul explicitly asks for that ordering.
- Do not describe render-only time as workflow speed; report request-to-delivery total and phase timing.