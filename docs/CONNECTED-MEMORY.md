# Connected memory implementation

## Stage A: retention foundation (PR, not deployed)

This is the first independently reviewable stage of the locked connected-memory plan, not a usable connected library yet. There are **no UI changes** and automatic library capture is compile-time OFF (`AUTOMATIC_REFERENCE_CAPTURE_READY`). Do not enable it before search/open, access rules, exclusion/deletion controls and the desktop/mobile Memory controls ship together. No user material is bulk imported; no extra model or paid analysis calls are introduced.

### Ownership and persistence
`ResourceStore` remains authoritative for resources, immutable versions and snapshot bytes. `resources/references.sqlite` owns saved reference intent/provenance and the only new `version_pins` table; it is not a generated search cache. Existing bundled better-sqlite3 is lazy-loaded. The service is gateway-internal; it is not a public permission boundary. Workspace scope is not a user/team grant or filesystem sandbox. B/C must implement caller/grant enforcement before exposure.

A synchronous save validates evidence, commits pending pins first, fsyncs snapshots, flushes/fsyncs the resource registry, then atomically creates the reference and promotes pins. Startup recovery completes only operations whose registry versions and snapshots are durable. Unknown/missing pending evidence remains pinned, never expired by age. Repeated operation IDs reuse the existing completed capture; conflicting main bindings are rejected.

ResourceStore cleanup reads pins on every flush across instances. Unreadable/corrupt/unavailable reference metadata suppresses pruning, not ordinary attachment writes. A `references.required` marker prevents silently treating a lost database as an empty library. Restore database plus its WAL consistently; do not remove the marker to force cleanup.

The metadata writer holds an exclusive `references.lock` with random token, process identity and hostname. Other processes read an existing DB but writes fail visibly. Dead-process recovery requires same host and a provably nonexistent process; a live/reused PID, permission error, invalid identity or orphaned recovery lock is conservative read-only. No age-based lock stealing. Operator recovery requires stopping all consumers and backing up the resources directory before moving an abandoned lock. A recovery-lock crash may require that explicit procedure. This guards the new metadata writer, not all legacy filesystem tools.

### Media evidence
Each `analyze_video` run gets a UUID child folder, including when `output_dir` is supplied (it now names the parent). `extracted.json` preserves produced frames/contact sheets/audio hashes, known frame timestamps, source hash, available transcript and requested focus before the optional report model runs. `complete.json` adds the returned report. Direct observation never fabricates an analysis report. Coverage is explicitly sampled frames, not continuous playback. Analyzer paths must stay within this run. No new dependency assumptions; existing extraction/transcription availability remains unchanged.

Manifests describe existing output, not a hidden default reference archive. Future gated capture snapshots the source and one archived manifest resource per run. Frame/audio blobs are copied to managed `resources/content/analysis/<operation-hash>/` without a resource registry row per frame; they survive temporary workspace output removal. Originals and the run version are pinned. A source video and total derivative bundle each have a 100 MiB cap, and a run has at most 160 files. Oversize capture fails explicitly without deleting outputs or selecting a paid provider. Incomplete archive copies are retained, not advertised as complete or silently deleted; B/C deletion/export/storage accounting must cover them.

### Ingress and limits
Dormant adapters cover common chat attachment registration and Memory-note attachments using existing resource IDs, plus completed video manifests. No endpoint, memory-tool action, team sharing, legacy import or auto-discovery is added in A. No semantic OCR or visual-search claim. Channel-specific transport and project continuity remain future acceptance requirements.

### Verification
`node scripts/test-connected-memory-foundation.mjs` exercises real SQLite, registry snapshots, 26-version retention, missing DB fail-closed behavior, second process writer rejection, workspace read isolation, restart/pending recovery, idempotency, immutable manifests, traversal refusal and archived original/frames. All data is temporary synthetic data.
`node scripts/test-media-analysis-previews.mjs` exercises the real video function with external extractor/provider fixtures and existing preview paths; its custom loader resolves imports relative to each source module. It checks repeated run manifests, honest transcript/analysis absence, direct vs report behavior and desktop/mobile preview renderers. This is not a physical-phone or real remote-model test.

### Remaining approved work
B+C: typed memory search/open, actual provider image delivery, exclusions/correction/permissions, desktop/mobile Memory controls, owner switches, storage/export/delete and backup UX. D: explicitly shared collections and exact-version durable team/verifier handoffs. E: project fresh-chat continuity and supported channel ingress. A alone must never be reported as the finished feature.
