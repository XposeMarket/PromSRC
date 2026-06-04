# Exported MP4 Playback Freeze Guardrail — 2026-05-29

## Trigger
Use this guardrail after any HyperFrames render/export, especially when the user will view the MP4 directly or when the composition includes transitions, GSAP timelines, scroll-like scene changes, videos, or canvas/WebGL animation.

## Evidence
On 2026-05-29 Prometheus created `hyperframes-opus-4-8-prometheus/final.mp4` for an Opus 4.8 showcase. The run reported lint/validate/inspect/render success and sampled QA frames, but Raul immediately reported that actual playback showed the first `OPUS 4.8` frame/transition and then appeared frozen/stuck. Evidence: `audit/chats/transcripts/mobile_mpr4mp2m_qat6y4.md:30-61`; `Brain/skill-episodes/2026-05-29/episodes.jsonl:4-5`; `Brain/thoughts/2026-05-29/06-34-thought.md:18-19,28-31`.

## Rule
Do **not** claim a HyperFrames video is finished from lint/validate/inspect/render alone. A render is not shipped until the actual exported MP4 has been checked for visible frame-to-frame motion across scene boundaries.

## Minimum QA before presenting/claiming success
1. Confirm the output file exists and has plausible duration/resolution/frame count using the safest available project-local command or video QA tool.
2. Sample frames across the whole timeline, including immediately before and after transitions.
3. Compare sampled frames/contact sheets for perceptual change. If several adjacent samples are identical when animation should progress, treat as a blocker.
4. If available, use Prometheus video QA tools such as contact sheet/frame diff/timeline analysis rather than relying only on static HyperFrames inspect output.
5. Report honestly: say "rendered but playback QA failed" if any frozen-frame/stuck-transition issue remains.

## Recovery hints
- Inspect composition duration/timeline metadata and whether root/scene tracks actually advance.
- Check for CSS/JS animation that only runs at load instead of seek time.
- Check transitions that leave a full-screen first scene overlay above later scenes.
- Check z-index/opacity and any pinned/fixed element that can visually mask the timeline.
- Re-render to a new filename after the fix to avoid stale/cached output confusion, then re-run sampled-frame QA.
