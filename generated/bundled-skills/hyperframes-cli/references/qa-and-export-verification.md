# HyperFrames QA and export verification

Use this no-ship gate for every rendered HyperFrames deliverable. Structural success does not prove readable frames or a healthy encoded video.

## Required sequence

Run through `scripts/run-hyperframes.js` inside Prometheus and through `npx hyperframes` in a standalone project:

1. `lint` the real project.
2. Run the current visual layout command (`check` in current releases; `inspect` is accepted where the installed CLI still exposes that name) across the timeline.
3. Inspect explicit hero timestamps covering the opening, densest text state, a transition midpoint, and the final mark/CTA.
4. Render a new output filename at the requested format and frame rate.
5. Probe and sample the actual exported file.

Fix clipped text, text-box overflow, off-canvas content, and accidental container overflow before rendering. Mark deliberate entrance/exit or decorative overflow only with the framework's explicit layout-ignore/allow attribute, then rerun the check so accepted noise does not hide real failures.

## Export proof

Before reporting completion, confirm:

- the file exists and its byte size is plausible;
- duration, dimensions, codec, frame rate, and frame count match the request;
- sampled frames span the whole timeline and are not black or blank;
- adjacent samples differ when motion should progress;
- required text, logos, assets, captions, and final identity state are visible;
- captions do not overlap simultaneously;
- the exported file, not only Studio or source HTML, was inspected.

Use frame extraction, hashes/diffs, and a contact sheet when available. A render exit code or static layout snapshot alone is insufficient.

## Frozen or masked output recovery

If playback appears frozen despite a successful render:

- verify the root and scene tracks actually advance;
- check whether animation runs only at page load instead of responding to seek time;
- inspect full-screen transitions or pinned/fixed layers that may cover later scenes;
- inspect z-index and opacity state after transition completion;
- render to a new filename to avoid stale-output confusion, then repeat final-file sampling.

Report `rendered but playback QA failed` whenever motion, visibility, or final-file checks remain unresolved. Never substitute a different renderer after a HyperFrames-only instruction without explicit user approval.

## Final report

State the project/source path, exported artifact path, commands run, layout findings, final-file probe/frame result, and any consciously accepted non-fatal warnings.
