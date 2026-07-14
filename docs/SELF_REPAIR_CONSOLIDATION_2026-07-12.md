# Self Repair Consolidation

Date: 2026-07-12

## Result

Self Repair is now a public operational diagnosis and governed recovery workflow. It no longer owns an independent source patch executor.

## Public diagnostic system

- `system_diagnostics` provides a bounded read-only snapshot of gateway heartbeat, automation anomalies, live/durable runtimes, recurring errors, cached provider health, build state, restart state, and audit freshness.
- `diagnostic_packet` creates sanitized structured incident artifacts under `workspace/diagnostics/incidents`.
- Public Self Repair uses live tools as current truth and the audit mirror only as timestamped historical evidence.

## Audit safety

- Audit materialization now redacts sensitive structural keys, authorization values, bearer tokens, labeled secrets, environment secrets, and sensitive URL query values.
- JSON, JSONL, and text are materialized through redaction rather than raw file copy.
- The manifest no longer stores absolute canonical paths.
- Global and per-entry freshness/provenance metadata identify the mirror as a delayed, non-canonical redacted snapshot.
- Orphaned mirror files are removed when their canonical source disappears.
- Diagnostic packets are mirrored into `audit/diagnostics/incidents` through the same redaction path.

## Development escalation

Development `skill_read("self-repair-protocol")` auto-loads `references/dev-escalation.md`. A proven application defect is captured as a diagnostic packet, inspected against current source, and submitted through the standard `write_proposal` code-change lane governed by `src-edit-proposal-rigor`.

The public bundle removes the development reference and its manifest entry. It does not expose source-edit terminology or tools.

## Legacy retirement

- Removed `src/tools/self-repair.ts`.
- Removed repair-specific Telegram buttons, callbacks, listing/detail commands, and independent apply/rebuild behavior.
- Preserved normal proposal and command-approval `/approve` and `/reject` flows.
- Startup archives any old `pending-repairs` directory under the config directory as inert retained records.
- A zero-caller scan confirms no legacy executor imports remain.

## Verification

- Backend TypeScript build passed.
- Disposable audit-redaction, system-diagnostics, and diagnostic-packet tests passed.
- Public/dev skill-read boundary tests passed.
- Public bundle regeneration passed.
- Full skill catalog and routing regressions passed.
- Scoped diff validation passed.
