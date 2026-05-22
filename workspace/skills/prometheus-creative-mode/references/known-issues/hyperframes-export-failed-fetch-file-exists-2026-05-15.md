# HyperFrames/HTML Motion export returns `Failed to fetch` but an MP4 exists

Observed: 2026-05-15 during a Prometheus HyperFrames promo generation session.

## Failure signature

- `hyperframes_export` reports `@hyperframes/producer render timed out after 120s`; materialization may still complete.
- `creative_export_html_motion_clip` and/or `creative_composition_render` returns `Failed to fetch`.
- `creative_export` may be blocked by `creative_quality_report returned no-ship` even after separate snapshots look acceptable.
- A workspace MP4 may still exist under the project `exports/` directory despite the export tool returning an error.

## Recovery checklist

1. Do not claim a clean export solely from the failed tool response.
2. Run `creative_export_trace` after the failed export to identify the scene/export hash and any stale/cached output risk.
3. Render representative snapshots or composition frames at early/mid/late timestamps and confirm meaningful motion, no broken assets, and no text overflow.
4. List/check the project export path and verify the MP4 exists, has non-trivial size, and matches the current scene/export intent.
5. If the MP4 exists but export tools failed, report honestly: include the path, note the exact `Failed to fetch`/timeout error, and state what visual/file existence checks passed.
6. If quality report is `no-ship`, do not force `creative_export`; either fix the QA issue or present the existing file as a provisional artifact with the blocker clearly labeled.

## Evidence

- `audit/chats/transcripts/76176aae-caf4-479d-98fa-5f0449808467.md:10-33`
- `Brain/skill-episodes/2026-05-15/episodes.jsonl:3`
- `Brain/skill-gardener/2026-05-15/live-candidates.jsonl:4-5`
