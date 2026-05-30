# Strict HyperFrames Project Flow — Prometheus Windows Runtime (2026-05-24)

Use this when Raul explicitly asks for **HyperFrames only** or when first-class Prometheus Creative/HyperFrames tools hit runtime QA/export failures.

## Route

1. Create or use a real workspace project folder, e.g. `hyperframes-[slug]/`.
2. Author/edit `index.html` as the source of truth.
3. Copy real assets into the project folder with stable relative filenames.
4. Run HyperFrames CLI checks from the project folder: lint, validate, inspect, and explicit timestamp inspect for hero frames.
5. Render with HyperFrames CLI only, e.g. `npx hyperframes render --output final.mp4`.
6. Verify the exported MP4 by sampling frames from the actual final file before presenting.
7. Use `present_file` for generated media unless Raul explicitly asks for delivery elsewhere.

## Why this route exists

During Raul's xAI OAuth/Grok promo run, first-class Prometheus HyperFrames insertion worked, but native QA/render hit `ReferenceError: __name is not defined`. Creative HTML Motion fallback produced useful visual snapshots but exported a bad black MP4. The reliable route was the real HyperFrames CLI project path: initialize/write source, copy assets, lint/inspect, render, and verify final MP4 frames.

## Current Windows caveats

- HyperFrames render may fail with `FFmpeg not found`. Use bundled/installed FFmpeg or `ffmpeg-static`; ensure `ffmpeg.exe` is discoverable from the project or PATH before rerendering.
- Node v20.20.2 can render but may emit warnings because HyperFrames prefers Node >=22.
- Do not assume `&&` works in Prometheus PowerShell runs. Use separate `run_command` calls or PowerShell-native `$LASTEXITCODE` checks.
- Keep all paths within the workspace allowlist. Do not use absolute `C:\Users\...\PromSRC` cwd values when the command tool is restricted to workspace paths.
- `duplicate_media_discovery_risk` is not automatically fatal if the repeated media is an intentional static logo/image and render plus inspect pass; fix it when it indicates stacked accidental duplicates.

## No-ship gate

Do not call the result done if any of these are true:

- output MP4 is implausibly tiny for the duration/resolution;
- final-file frame extraction fails;
- sampled frames are black/blank;
- required logos/text are missing from sampled frames;
- duration/frame count does not match the requested video;
- the output came from HTML Motion/Creative after a "HyperFrames only" instruction.

## Expected project artifact pattern

```text
hyperframes-[slug]/
  index.html
  hyperframes.json
  package.json
  assets...
  final.mp4
```

## Final response checklist

- Project path
- Source `index.html`
- Exported MP4 path
- Checks run (`lint`, `validate`, `inspect`, render)
- Export verification status from the final MP4
- Any non-fatal warnings accepted and why
