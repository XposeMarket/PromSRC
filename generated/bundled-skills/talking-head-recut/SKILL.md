---
name: "talking-head-recut"
description: "Add timed designed graphic overlays to an existing interview, podcast, or talking-head clip while keeping the footage intact. Use for titles, lower thirds, data callouts, side panels, quotes, or PiP; use embedded-captions for plain spoken-word subtitles, and a creation workflow for a new video."
---

# Talking-head recut

This is an official HyperFrames workflow, selected explicitly by the Creative Director. Preserve the source clip in full and layer transcript-timed, designed graphic cards over it. No NLE retiming, reordering, recoloring, or soundtrack replacement. Consult `references/implementation-full.md` for the complete official recipe, exact command flags, design tables, JSON and HTML contracts, GSAP template, and render/QA steps. Open only the relevant part when needed; this entry is the execution map.

## Route and prerequisites

- Existing interview/talking-head video + *graphics* => this skill; subtitles alone => `embedded-captions`; short unnarrated graphic => `motion-graphics`; video from a URL, brief, or PR => the matching creation workflow.
- Run `npx hyperframes skills update talking-head-recut` only when permitted to refresh the installed skill. An update can overwrite local cleanup: inspect changes before continuing. Resolve CLI with `npx hyperframes --help`; preflight with the committed wrapper's `doctor` (a Docker check may fail, while FFmpeg/FFprobe/Chrome pass; use the specific render dependencies as the gate).
- Confirm FFmpeg/FFprobe and bundled fonts/GSAP assets. On this Windows host use PowerShell and `workspace_run`, not the reference's POSIX shell examples verbatim. Do not assume `python3` or system `ffmpeg` is in PATH; resolve the installed CLI or bundled runtime first.

## Execute

1. Put the input and intermediate files under `videos/<project>/`: `metadata.json`, extracted `audio.mp3`, a flat word-array `transcript.json`, `storyboard.json`, `public/cards/card-XX.html`, `public/index.html`, and the final `output.mp4`.
2. Probe the source video and audio; transcribe locally with HyperFrames Whisper; correct obvious recognition errors *without changing word timestamps*. Clamp all card endpoints to source duration so the render has no accidental black tail.
3. Draft a lightweight card storyboard from the content and transcript. Graphic cards serve ideas and evidence, not a word-for-word subtitle track. Capture card ids, intents, start/end times, content hints, accents, zone and transitions. Consult the original detailed Step 6 for the storyboard schema and zone table.
4. Choose ratio and visual direction before design. Use the supplied destination, or match the source ratio; a general promo defaults to landscape 16:9, not 9:16. Collect any decision that materially affects output through `ask_prometheus_questions` rather than a prose option list. The original Step 7 contains ratio/layout/style/density guidance and visual-design references. Avoid purple-blue-cyan gradient SaaS aesthetics unless the brand requires it.
5. Author each card as a separate HTML fragment with scoped CSS and seek-safe `data-anim` motion (detailed Step 8). Stage bundled fonts, GSAP, and the video; assemble the composition using the detailed Step 9 template. Preserve aspect and safe zones, ensure dense video keyframes for reliable seeking, and avoid transparent overlays that make text unreadable.
6. Validate the composition with HyperFrames, inspect representative and boundary frames (including beginning/end), then render MP4 with the official CLI. Check output decode, dimensions, duration, overlay timing, readability, visibility of source video, and audio continuity. Fix and rerender if visual or timing gates fail.
7. Report source, storyboard, composition, rendered path, verified duration and format, and any limitations. Do not claim success based only on an exit code or file existence.

Detailed recipe: [implementation-full.md](references/implementation-full.md). Design catalogue: [DESIGN_INDEX.md](references/DESIGN_INDEX.md). This skill owns graphics; if subtitles are requested, coordinate with `embedded-captions` without replacing this workflow.
