# Memory/context evidence and review

## What is recorded
Local receipts capture assembled provider-bound attempts at `captureRuntimePromptManifest`, linked by manifest ID and `contextReceipt`. Normal chat supplies the untouched original request and gateway turn ID; receipts separate redacted `userInput` from transformed `providerBoundUserInput`. Other callers label missing original/turn information unavailable.

Actual atomic lexical/hybrid, automatic SQLite/JSON and recall producers emit request-local ranked candidates, scores/thresholds, matched terms, selection and suppression reasons. Context-worker snapshots propagate traces into the same normal chat attempt; unavailable/skipped/error/budget/semantic states are explicit. Hybrid decisions describe final injected selection, not just earlier lexical rank. Every assembled system/developer message and named/unlabelled section has inventory hashes; tracked memory/context sections retain bounded text with duplicate references.

Terminal normal chat joins completed/cancelled/failed outcomes by session+gateway turn, with bounded redacted response and response hash. Completion is **not efficacy**. Separate reviewer judgments are useful/redundant/irrelevant/unknown with provenance and reason; measured efficacy remains unknown absent measurement. Assistant reasoning, media and tool payloads are not retained.

## Bounds and privacy
Workspace-local `audit/context-receipts`; default enabled, seven-day retention, up to256 receipts and192,000 bytes each (49,152,000-byte worst-case cap). Text budget48,000 characters shared across original/transformed input and tracked sections; capture reserves12KB outcome/review headroom. Trace limits:8 traces,96 candidates and6000 stored chars per trace. Privacy scrub precedes truncation; unsafe source IDs hash. All truncation/unavailable flags are visible. Scrubbing is best effort, not a guarantee against natural-language secrets.
Maintenance amortized once/minute except capacity; reads are bounded; outcome joining enumerates once with direct per-ID reads. Capture fails open so observability cannot break a chat. Hashes identify content, not semantic truth. Provider-specific transformations/internal retries after the manifest boundary are outside these receipts.

## Shared authenticated backend and native tools
- `GET /api/context-receipts?days=7&limit=20&sessionId=...&detail=true` (days1–30, limit1–100).
- `GET /api/context-receipts/:id` returns `{success,receipt}`; malformed/traversal IDs rejected.
- `POST /api/context-receipts/:id/review` body `{relevance:'useful'|'redundant'|'irrelevant'|'unknown',reason:string}`.
- `GET /api/context-receipts/settings`; `POST /api/context-receipts/settings` accepts enabled, retentionDays, reset. Disable/re-enable preserves records; reset deletes only receipts and does not implicitly disable.
- `prometheus_audit_ops` actions `context_receipts`, `context_receipt_review`, `context_receipt_settings` expose the same workspace backend. API never accepts arbitrary filesystem root.

Desktop/Electron Audit/Memory/Hub and mobile Audit/Memory/Hub offer **Review context evidence**. Desktop deep links `#context-review` and `#context-review/skills`. See [dashboard](context-review-dashboard.md) and [skill routing](context-routing-skill-observability.md).

## Verification and coverage
`npm run test:context-routing-foundation` runs receipts, real provenance producers/worker serialization, outcome/review joins, recall and skill evidence/native workflows. `node scripts/test-context-review-dashboard.mjs` checks desktop/mobile UI with mocked authenticated-shaped API responses. Neither is physical phone/audio nor provider acceptance proof. Live deployment verification must separately establish actual request-linked receipt/trace/outcome and live UI behavior.
