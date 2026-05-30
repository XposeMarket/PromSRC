# Prometheus Runtime Reality — 2026-05-24

Observed from Raul's xAI OAuth / Grok promo video run.

## Strict HyperFrames routing

When Raul explicitly says **"HyperFrames only"**, treat that as a hard routing constraint:

1. Prefer a real HyperFrames CLI project inside the workspace (`hyperframes-[slug]/`) over Creative/HTML Motion wrappers until Prometheus native HyperFrames export is proven stable.
2. Allowed path: project scaffold/source edit, asset copy, `hyperframes lint`, `validate`, `inspect`, `render`, exported MP4 verification, then `present_file`.
3. Do **not** silently fall back to `creative_create_html_motion_clip`, `creative_export`, or HTML Motion when the user asked for HyperFrames specifically. If first-class Prometheus `hyperframes_*` QA/render fails, state the exact blocker and continue fixing through the CLI/project path.

## Export verification hard gate

Never claim a video is done from lint, source snapshots, or output-file existence alone. After export, verify the **actual MP4**:

- sample frames from the exported file;
- confirm duration/frame count is plausible;
- confirm frames are not black/blank;
- confirm requested visible text/logos/assets appear;
- if frame extraction fails, or sampled frames are black/empty/missing required assets, treat export as failed.

This gate exists because a Creative/HTML Motion fallback exported a tiny black-screen MP4 even though source snapshots/lint looked acceptable.

## Creative fallback disclosure

HTML Motion / Creative tools are acceptable fallback routes only when the user asked for a video generally and did not require strict HyperFrames. If the user asked for HyperFrames specifically, any Creative fallback must be explicitly disclosed and should not be presented as HyperFrames-only output.

## Runtime caveats from the observed Windows run

- First-class `hyperframes_insert_clip` could insert a clip, but `hyperframes_qa` / `creative_render_snapshot` hit `ReferenceError: __name is not defined` in the current Prometheus runtime.
- HyperFrames CLI render reported FFmpeg missing from PATH; using `ffmpeg-static` / discoverable `ffmpeg.exe` let render complete.
- Node v20.20.2 emitted warnings against HyperFrames' preferred Node >=22, but render still completed.
- PowerShell in this runtime may reject `&&`; use separate commands or PowerShell-native `$LASTEXITCODE` chaining.
- `duplicate_media_discovery_risk` can be non-fatal when it comes from intentional repeated static logo/image use and render/inspect passes. If it comes from accidentally stacked duplicate media nodes, fix it.

## Preferred artifact pattern

For real HyperFrames projects, prefer:

```text
hyperframes-[slug]/
  index.html
  hyperframes.json
  package.json
  assets...
  final.mp4
```

Final response should include project path, source file, exported MP4 path, checks run, and whether the export was frame-verified.