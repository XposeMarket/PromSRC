# HyperFrames / HTML Motion export smoke-test findings — 2026-05-09

Evidence: `Brain/skill-episodes/2026-05-09/episodes.jsonl` entries 7-16; `Brain/skill-gardener/2026-05-09/workflow-episodes.jsonl` entries 24, 29, 31-36; `memory/2026-05-09-intraday-notes.md:67-93`.

## When to use this note
Use this when Creative/HyperFrames authoring appears healthy but export, materialization, selected clip state, or catalog compatibility fails. This is not a replacement for the main workflow; it is a decision tree for interpreting common failure signatures from the May 9 HyperFrames integration tests.

## Known pass/fail split
A clip can be genuinely healthy for authoring while still blocked for MP4 export. Treat these as separate checkpoints:

1. **Authoring pass**: HyperFrames catalog browse/insert or raw source insert works; layers/slots extract; lint has 0 errors or known Studio warnings only.
2. **Motion pass**: `hyperframes_qa` or rendered snapshots show sampled frames changing over time with no console/network errors.
3. **Materialization pass**: `hyperframes_materialize` writes a materialized HTML file and activates it as the current HTML Motion clip.
4. **Export pass**: `hyperframes_export` or `creative_export_html_motion_clip` completes and `creative_export_trace` points to a fresh MP4 artifact.

Do not claim “export works” from authoring, lint, QA, or snapshots alone.

## Failure signatures and interpretation

- `creative_quality_report returned no-ship. score: 0` while lint/layout/text-fit/snapshots are clean: likely quality-gate/export-report bug, not proof that the clip is visually broken. Run `creative_quality_report`, `creative_export_trace`, and direct frame samples; report the split honestly.
- `hyperframes_export requires a selected HyperFrames clip` after successful materialization: selected HyperFrames state may be lost after materializing into HTML Motion. Re-select or keep the HyperFrames clip id available before export; if no tool can reselect, report this as selected-clip/materialization bridge state loss.
- `No active HTML motion clip` after materialization: materialization did not activate the HTML Motion clip. Inspect `creative_get_state` and the materialized path before retrying export.
- `HTML motion screenshot frame N timed out`: export reached frame capture but a specific screenshot frame exceeded the timeout. Prefer 30fps, reduce complexity, test sample snapshots around the failing timestamp, and capture the exact frame number in the blocker.
- `creative_render_snapshot: toDataURL ... Tainted canvases may not be exported`: canvas/cross-origin asset tainting blocks snapshot/export of the normal canvas path. Try HTML Motion snapshot or ensure assets are locally served/asset-safe.
- Static frames with console errors such as `Invalid regular expression flags`, `Unexpected token '<'`, or timeline API errors indicate runtime/catalog normalization problems, not just visual polish.

## Recommended smoke-test order

1. `switch_creative_mode({ mode: "video" })` if no video workspace is active.
2. `creative_checkpoint({ action: "save" })` before destructive resets.
3. `creative_purge_scene` or `creative_reset_scene` when prior tests may have contaminated scene state.
4. `hyperframes_browse_catalog` and note item count.
5. Insert one official catalog block and one simple raw source-backed clip; keep their clip ids.
6. Run `hyperframes_lint` and `hyperframes_qa` on the raw clip.
7. Patch one text slot with `hyperframes_set_text`; re-run QA.
8. `hyperframes_materialize`; verify active HTML Motion state with `creative_get_state` or `creative_read_html_motion_clip`.
9. Render sampled frames at start/middle/end with `creative_render_html_motion_snapshot` or the applicable frame tool.
10. Export at 30fps; if blocked, capture the exact export error and `creative_export_trace`.

## Reporting rule
Report the exact checkpoint reached: authoring / motion / materialization / export. Avoid vague “HyperFrames is fixed” wording unless a fresh MP4 exists and `creative_export_trace` confirms the artifact path.