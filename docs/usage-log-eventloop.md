# Usage ledger event-loop safety

The gateway's per-turn usage readers are asynchronous. Session queries share an
incremental byte-offset index: complete lines are indexed once, compact contiguous
ranges are stored per session, and only that session's rows are materialized. Cold
indexing and historical reads yield between bounded chunks. File identity, shrinking
size and same-size replacement invalidate the index; unterminated rows are deferred.
Calibration retains only its bounded sample window and reads at most a 256 KiB tail.

Provider usage-awareness reads backwards for its recent billing windows (up to 35
days), rather than parsing all history. These ledger files are timestamp-ordered
append-only telemetry; direct external writes during archive rotation are unsupported.

At startup, and at most hourly after appends exceed 32 MiB, background rotation moves
rows older than 35 days to `model-usage.YYYY-MM.jsonl`. Retention is not deletion:
Hub history and session readers include archives. A newer-than-35-day workload may
still exceed 32 MiB; recent billing history is deliberately preserved. Malformed rows
stay in the active ledger. Same-process appends queue while rotation/read locks are
held, and readers wait for queued appends. Staged files plus a recovery journal make
interrupted archive promotion retryable without duplicating rows. Other processes
must not write this ledger concurrently with rotation.

`npm run test:usage-eventloop` covers session/tail/truncation, archive preservation,
and the X-scrape orphan sweep's awaited asynchronous recursive delete. Run
`npx tsx scripts/benchmark-usage-eventloop.ts [path-to-log]` to benchmark on a temporary
copy; it never changes the supplied ledger. `scripts/analyze-stall-profile.mjs`
prints sampled parent stacks for diagnosis.

Shared gateway changes apply to desktop, web/mobile, channels and agents; there is
no UI state or settings migration. Filesystem APIs are Node-standard; Windows tests
exercise rename/removal behavior. There are no new dependencies or user-specific
paths in runtime code. Rotation is automatic and visible through archive files and
warning logs, with no manual enable/disable setting.
