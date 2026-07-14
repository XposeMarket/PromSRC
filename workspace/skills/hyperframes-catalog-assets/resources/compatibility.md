# HyperFrames catalog compatibility

Catalog discovery proves that an item exists; it does not prove that the item is usable in the current composition. Treat the generated manifest as the inventory source and never hardcode an item count in instructions.

## Per-item proof

Before claiming a catalog block or component is reusable or export-ready, verify:

1. the slug and official source path from the current catalog manifest;
2. successful registry installation/import with the expected clip or element ID;
3. lint/check output with errors and warnings reported honestly;
4. sampled frames that visibly change when motion is expected;
5. a visual snapshot showing the item is on-canvas, nonblank, and correctly layered;
6. a materialized/exported artifact, or the exact export blocker.

## Known failure shapes

Historical tests showed why the proof is required:

- `app-showcase` once installed structurally but rendered blank frames;
- `data-chart` once installed and exposed its structure while sampled output stayed static and lint still failed;
- remote canvas assets have caused tainting or runtime failures even when raw custom clips worked.

These are regression cases, not current claims about every version of those items. Retest the current source before relying on them.

## Recovery

If an item is blank, static, offscreen, or lint-invalid:

- try another official slug that fits;
- inspect and normalize the official registry source and its asset/runtime dependencies;
- use a clearly labeled custom HyperFrames composition instead of pretending it is the official item; or
- report the exact slug and failure evidence.

Never silently substitute a lookalike and call it catalog-backed. Use “export-ready” only after a fresh artifact and visual QA exist.
