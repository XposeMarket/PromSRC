# HyperFrames catalog compatibility notes — 2026-05-09

Evidence: `Brain/skill-episodes/2026-05-09/episodes.jsonl` entries 13-16; `Brain/skill-gardener/2026-05-09/workflow-episodes.jsonl` entries 30, 32, 34, 36; `memory/2026-05-09-intraday-notes.md:83-93`.

## What improved
Prometheus HyperFrames integration can now browse the official catalog and returned **47 catalog items** during repeated tests. Raw source-backed HyperFrames clips can insert, expose layers/slots, lint, QA with changing frames, materialize, and in a later test export through `@hyperframes/producer` to a real MP4.

## Catalog blocks still need per-item proof
Do not assume every official catalog item is deliverable just because `hyperframes_browse_catalog` lists it or `hyperframes_insert_clip` returns an element. On 2026-05-09:

- `app-showcase` inserted structurally but rendered blank frames in one promo attempt.
- `data-chart` inserted/extracted structurally, but QA was static and lint later showed `1 error / 18 warnings`.
- Earlier catalog/snapshot attempts hit canvas tainting and runtime errors before raw custom clips worked.

## Required proof before relying on a catalog item
For any official catalog-backed deliverable, capture all of these before claiming it is source-backed and usable:

1. Catalog item slug and source path from `catalog-manifest.json` or browse result.
2. Successful `hyperframes_insert_clip` with clip/element id.
3. `hyperframes_lint` result and any warnings/errors copied into the handoff.
4. `hyperframes_qa` or sampled frame evidence showing frames change over time when motion is expected.
5. Visual snapshot/frame check that the catalog block is not blank/static/offscreen.
6. Materialization/export result, or an explicit blocker with exact tool error.

## Recovery guidance
If an official item is blank/static/linty, do not silently replace it with a lookalike and call it catalog-backed. Either:

- try another official catalog slug that fits the user request,
- fetch/inspect the raw registry source for that slug and normalize assets/runtime dependencies,
- use a raw source-backed HyperFrames composition and clearly say it is not the official catalog item, or
- report the catalog compatibility blocker with exact slug and error.

## Good wording
- “Catalog browse and insert worked, but `data-chart` is not export-safe yet: QA is static and lint has errors.”
- “This clip is source-backed HyperFrames, but not the official `app-showcase` block because that block rendered blank in QA.”
- “Export-ready” only after a fresh MP4 exists or the export trace confirms the artifact path.