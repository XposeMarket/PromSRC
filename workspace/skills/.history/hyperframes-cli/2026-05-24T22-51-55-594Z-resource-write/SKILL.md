---
name: hyperframes-cli
description: HyperFrames CLI dev loop — `npx hyperframes` for scaffolding (init), validation (lint, inspect), preview, render, and environment troubleshooting (doctor, browser, info, upgrade). Use when running any of these commands or troubleshooting the HyperFrames build/render environment. For asset preprocessing commands (`tts`, `transcribe`, `remove-background`), invoke the `hyperframes-media` skill instead.
---

# HyperFrames CLI

Everything runs through `npx hyperframes`. Upstream prefers Node.js >= 22 and FFmpeg. In Raul's current Windows runtime, Node v20.20.2 may emit warnings but can still render; missing FFmpeg is the more common hard render blocker.

## Workflow

1. **Scaffold** — `npx hyperframes init my-video`
2. **Write** — author HTML composition (see the `hyperframes` skill)
3. **Copy assets** — place real images/video/audio under the project with stable relative paths
4. **Lint** — `npx hyperframes lint`
5. **Validate** — `npx hyperframes validate` when available / required by the project
6. **Visual inspect** — `npx hyperframes inspect`, plus `--at` hero timestamps for important frames
7. **Preview** — `npx hyperframes preview` when interactive review is useful
8. **Render** — `npx hyperframes render --output final.mp4`
9. **Verify exported MP4** — sample frames from the actual final file before presenting

Lint, validate, and inspect before preview/render. `lint` catches missing `data-composition-id`, overlapping tracks, and unregistered timelines. `inspect` opens the rendered composition in headless Chrome, seeks through the timeline, and reports text spilling out of bubbles/containers or off the canvas. Export verification is a no-ship gate: output-file existence is not proof that the rendered MP4 is good.

## Scaffolding

```bash
npx hyperframes init my-video                        # interactive wizard
npx hyperframes init my-video --example warm-grain   # pick an example
npx hyperframes init my-video --video clip.mp4        # with video file
npx hyperframes init my-video --audio track.mp3       # with audio file
npx hyperframes init my-video --example blank --tailwind # with Tailwind v4 browser runtime
npx hyperframes init my-video --non-interactive       # skip prompts (CI/agents)
```

Templates: `blank`, `warm-grain`, `play-mode`, `swiss-grid`, `vignelli`, `decision-tree`, `kinetic-type`, `product-promo`, `nyt-graph`.

`init` creates the right file structure, copies media, transcribes audio with Whisper, and installs AI coding skills. Use it instead of creating files by hand.

When using `--tailwind`, invoke the `tailwind` skill before editing classes or theme tokens. The scaffold uses Tailwind v4.2 via the browser runtime, not Studio's Tailwind v3 setup.

## Linting

```bash
npx hyperframes lint                  # current directory
npx hyperframes lint ./my-project     # specific project
npx hyperframes lint --verbose        # info-level findings
npx hyperframes lint --json           # machine-readable
```

Lints `index.html` and all files in `compositions/`. Reports errors (must fix), warnings (should fix), and info (with `--verbose`).

## Visual Inspect

```bash
npx hyperframes inspect                 # inspect rendered layout over the timeline
npx hyperframes inspect ./my-project    # specific project
npx hyperframes inspect --json          # agent-readable findings
npx hyperframes inspect --samples 15    # denser timeline sweep
npx hyperframes inspect --at 1.5,4,7.25 # explicit hero-frame timestamps
```

Use this after `lint` and `validate`, especially for compositions with speech bubbles, cards, captions, or tight typography. It reports:

- Text extending outside the nearest visual container or bubble
- Text clipped by its own fixed-width/fixed-height box
- Text extending outside the composition canvas
- Children escaping clipping containers

Errors should be fixed before rendering. Warnings are surfaced for agent review; add `--strict` to fail on warnings too. Repeated static issues are collapsed by default so JSON output stays compact for LLM context windows. If overflow is intentional for an entrance/exit animation, mark the element or ancestor with `data-layout-allow-overflow`. If a decorative element should never be audited, mark it with `data-layout-ignore`.

`npx hyperframes layout` remains available as a compatibility alias for the same visual inspection pass.

## Previewing

```bash
npx hyperframes preview                   # serve current directory
npx hyperframes preview --port 4567       # custom port (default 3002)
```

Hot-reloads on file changes. Opens the studio in your browser automatically.

When handing a project back to the user, use the Studio project URL, not the
source `index.html` path:

```text
http://localhost:<port>/#project/<project-name>
```

Use the actual port from the preview output and the project directory name. For
example, after `npx hyperframes preview --port 3017` in `codex-openai-video`,
report `http://localhost:3017/#project/codex-openai-video`.

Treat `index.html` as source-code context only. It is fine to link it as an
implementation file, but do not label it as the project or preview surface.

## Rendering

```bash
npx hyperframes render                                # standard MP4
npx hyperframes render --output final.mp4             # named output
npx hyperframes render --quality draft                # fast iteration
npx hyperframes render --fps 60 --quality high        # final delivery
npx hyperframes render --format webm                  # transparent WebM
npx hyperframes render --docker                       # byte-identical
```

| Flag                 | Options               | Default                    | Notes                                                              |
| -------------------- | --------------------- | -------------------------- | ------------------------------------------------------------------ |
| `--output`           | path                  | renders/name_timestamp.mp4 | Output path                                                        |
| `--fps`              | 24, 30, 60            | 30                         | 60fps doubles render time                                          |
| `--quality`          | draft, standard, high | standard                   | draft for iterating                                                |
| `--format`           | mp4, webm             | mp4                        | WebM supports transparency                                         |
| `--workers`          | 1-8 or auto           | auto                       | Each spawns Chrome                                                 |
| `--docker`           | flag                  | off                        | Reproducible output                                                |
| `--gpu`              | flag                  | off                        | GPU-accelerated encoding                                           |
| `--strict`           | flag                  | off                        | Fail on lint errors                                                |
| `--strict-all`       | flag                  | off                        | Fail on errors AND warnings                                        |
| `--variables`        | JSON object           | —                          | Override variable values declared in `data-composition-variables`  |
| `--variables-file`   | path                  | —                          | JSON file with variable values (alternative to `--variables`)      |
| `--strict-variables` | flag                  | off                        | Fail render on undeclared keys or type mismatches in `--variables` |


## Export Verification — No-Ship Gate

Never call a render finished just because `npx hyperframes render` exited or `final.mp4` exists. Verify the actual exported MP4 before final response:

## Troubleshooting

```bash
npx hyperframes doctor       # check environment (Chrome, FFmpeg, Node, memory)
npx hyperframes browser      # manage bundled Chrome
npx hyperframes info         # version and environment details
npx hyperframes upgrade      # check for updates
```

Run `doctor` first if rendering fails. Common issues: missing FFmpeg, missing Chrome, low memory.

### Prometheus Windows runtime notes (2026-05-24)

- **FFmpeg not found:** If render says FFmpeg is missing, use bundled/installed FFmpeg or `ffmpeg-static`; ensure `ffmpeg.exe` is discoverable from the project or PATH before rerendering.
- **Node version:** HyperFrames prefers Node >= 22. Raul's machine was observed on Node v20.20.2; warnings are expected, but render may still complete. Do not ignore actual render failures.
- **PowerShell syntax:** Do not assume `&&` works in Prometheus Windows PowerShell runs. Use separate `run_command` calls or PowerShell-native `$LASTEXITCODE` chaining.
- **Install checks:** Do not treat missing `node_modules/@hyperframes` alone as proof HyperFrames cannot run; determine whether the workflow uses `npx hyperframes`, a local package, or Prometheus-bundled Creative/HyperFrames tooling.
- **Duplicate media warning:** `duplicate_media_discovery_risk` is not automatically fatal when it comes from intentional repeated static logo/image use and render plus inspect pass. Fix it when it indicates accidentally stacked or duplicated media/video nodes.
- **Native Prometheus tool errors:** If first-class Creative/HyperFrames QA/export errors with `ReferenceError: __name is not defined` or exports a black/empty MP4, preserve the authored source and continue via the real CLI project path rather than claiming success.

**Parametrized renders:** the composition declares its variables on the `<html>` root with **`data-composition-variables`** — a JSON **array of declarations** (`{id, type, label, default}` per entry) that defines the schema. Scripts inside read the resolved values via `window.__hyperframes.getVariables()`. The CLI **`--variables '{"title":"Q4 Report"}'`** is a JSON **object keyed by id** that overrides those declared defaults for one render; missing keys fall through, so the same composition runs unchanged in dev preview and in production. (Sub-comp hosts can also override per-instance with **`data-variable-values`** — same object shape, scoped to one mount of the sub-composition. See the `hyperframes` skill for the full pattern.)

## Asset Preprocessing

`npx hyperframes tts`, `transcribe`, and `remove-background` produce assets (narration audio, word-level transcripts, transparent video) that get dropped into a composition. Each downloads its own model on first run. For voice selection, whisper model rules (the `.en`-translates-non-English gotcha), output format choice (VP9 alpha WebM vs ProRes), and the TTS → transcribe → captions chain, invoke the `hyperframes-media` skill.

## Troubleshooting

```bash
npx hyperframes doctor       # check environment (Chrome, FFmpeg, Node, memory)
npx hyperframes browser      # manage bundled Chrome
npx hyperframes info         # version and environment details
npx hyperframes upgrade      # check for updates
```

Run `doctor` first if rendering fails. Common issues: missing FFmpeg, missing Chrome, low memory.

## Other

```bash
npx hyperframes compositions   # list compositions in project
npx hyperframes docs           # open documentation
npx hyperframes benchmark .    # benchmark render performance
```
