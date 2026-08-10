# P0-4 Process Hygiene Observer and Dry-Run Boundary

Status: first slice implemented 2026-08-09. This is an observation and candidate-classification surface only. It does not stop, close, delete, rewrite, claim, or repair any resource.

## Data flow and ownership boundary

The six-hour Thoughts path must treat process hygiene as a separate bounded package. The intended flow is:

`Thought trigger -> authenticated GET /api/process-hygiene/thought-summary -> read-only observer -> hashed candidate summary -> Thought context`

The full operator surface is `GET /api/process-hygiene/report`. `GET /api/process-hygiene/dry-run` has the same read-only behavior and makes the zero-action contract explicit. There is intentionally no cleanup POST, broad command, kill endpoint, browser-close endpoint, VM-stop endpoint, or file-delete endpoint.

The implementation is in:

- `src/gateway/process-hygiene.ts`: bounded sources, ownership-aware classification, report construction, redaction, and read-only Windows inventory.
- `src/gateway/routes/process-hygiene.router.ts`: authenticated report, dry-run, and bounded Thought-summary routes.
- `src/gateway/server-v2.ts`: mounts the routes behind gateway authentication and account access.
- `src/gateway/process-hygiene.regression.ts`: synthetic and current-environment read-only checks.

The observer reads only known Prometheus configuration/state surfaces. It does not read workspace files, chat history, memory, task data, or audit logs. It may inspect metadata and bounded JSON fields from gateway/runtime/lease/browser/desktop state, but raw commands, working directories, URLs, titles, profile paths, log contents, payloads, and secrets never enter the report.

Ownership is established by the strongest available bounded relationship:

- gateway: Prometheus runtime status, gateway progress lease, fresh heartbeat, PID, and PID creation identity;
- workers/subagents/runtimes: the active runtime ledger, owner/session/task/schedule identity, gateway relationship, and bounded PID evidence;
- managed processes: Prometheus process records, state, run/session identity, PID, and recorded start time;
- local servers: only listeners whose PID is already attributed to the gateway or an active managed process; an arbitrary port or process name is never enough;
- desktop/Sandbox target: the target runtime's ownership marker and lease count;
- exact Hyper-V target: only the exact `Prometheus-Desktop` (or explicitly configured equivalent) VM and Prometheus owner marker; no VM control is performed;
- browser: in-memory Prometheus/in-house session metadata supplied by the browser subsystem. User profile/target sessions are always protected. Registry-only sessions without proven ownership remain unknown/protected;
- timers, subscriptions, queues, locks, logs, and runtime surfaces: metadata-only candidates with no inferred owner/lease, therefore protected or unknown.

The always-on gateway is never stale merely because it is idle. An expired progress lease while the gateway PID/heartbeat is still live is represented as a protected active gateway relationship, so the observer cannot turn the lease-observability gap into a termination recommendation.

## Classification contract

Every candidate is classified as one of:

- `active`: live relationship, matching PID creation identity, lease, or strong gateway evidence;
- `leased`: an active lease is the controlling evidence, especially when a lease is preferred;
- `recent`: terminal/missing process with a last observation inside the six-hour UTC epoch window;
- `stale`: terminal or missing process with an expired/no lease and no live relationship outside that window;
- `orphaned`: a Prometheus-owned matching process exists without a corresponding active relation or lease;
- `unknown`: ownership, PID identity, relationship, or source data is ambiguous, partial, or inconsistent;
- `protected`: user/external ownership or an explicit safety boundary is proven.

Classification never uses age, name, CPU, or port alone. A PID mismatch is `pid_reused` and fails closed to `unknown`. A future-dated timestamp beyond a small clock-skew tolerance is also `unknown`. Prometheus-owned protected resources can retain a useful lifecycle classification (for example `active`) while carrying `protection: protected`.

The six-hour boundary is epoch milliseconds and inclusive for the `recent` cutoff (`now - 6h` is recent). There is no local-time or DST behavior. Report IDs are deterministic for the same observation time and input, making repeated and concurrent report generation idempotent without a lock or state write.

## Report, audit, and Thought handoff

The report contains bounded source statuses, counts, hashed candidate/owner/session references, evidence codes, safety flags, listener attribution counts, and an in-band privacy-safe audit envelope:

`process_hygiene_report_generated`, stable event ID, `reportOnly: true`, `mutationsAttempted: 0`, and `hashed_refs_no_commands_urls_paths_or_secrets`.

This envelope is telemetry in the returned report, not an audit-log write. Existing audit logs remain untouched. The dry-run block always reports zero destructive actions, zero process termination, zero browser close, zero VM stop, zero file deletion, and an empty executable-action list.

Thoughts should receive only `thoughtSummary`, never the full raw observer inputs. The summary is capped to 20 attention candidates and 40 source statuses, carries counts and safe evidence codes only, and explicitly states that raw commands, URLs, paths, and secrets are absent. It is separate from the six-hour Thought activity package and must not be merged into that package's event ledger.

## Trigger, retry, concurrency, and failure behavior

The first slice is on-demand and has no new scheduler or timer. The six-hour Thought runner may call the summary route at its existing trigger boundary. A caller can retry a generic observer failure with bounded backoff; each OS probe has a finite timeout and no retry loop. Concurrent GETs are safe because the observer writes no state. Partial/unavailable sources are surfaced as source status and do not create cleanup authority. A missing owner, lease, process identity, browser profile, or VM marker results in omission, `unknown`, or `protected`—never an action.

The route is mounted behind the existing gateway and account authorization. Errors are returned as the privacy-safe `process_hygiene_observer_unavailable`; raw exception text is not exposed. The report is intentionally suitable for a UI/manual review flow, not direct model-generated process instructions.

## No-regret decisions

- Report-only and dry-run-only first slice; no destructive executor exists.
- Never claim or close personal Chrome, user tabs, user sessions, or unrelated processes.
- Never act on an arbitrary port, process name, age, CPU value, stale-looking filename, or idle gateway.
- PID creation identity and ownership/lease/session relationships are required wherever available; mismatch fails closed.
- Exact Prometheus desktop/VM boundaries remain protected and the recent session-scoped/on-demand VM lifecycle fix is unchanged.
- No chat, memory, workspace, task, resource, or audit-log deletion/read path is added.
- Full report and Thought summary remain separate contracts, with raw secrets and unsafe instructions excluded from model context.

## Product choices still open

- Whether to add a review UI for candidate acknowledgement and retention; this must remain non-destructive until separately approved.
- Whether the future cleanup executor should exist at all, and its exact authorization/rollback protocol.
- Which durable telemetry sink, if any, should receive the privacy-safe audit envelope; the first slice does not write one.
- Whether internal runtime workers should publish stronger child-process creation/parent-chain identities; the observer currently fails closed when the ledger does not prove them.
- How long candidate reports should be retained; no new retention or cleanup policy is implied by this observer.

## Verification and limits

`npm run test:process-hygiene` exercises active/leased/recent/stale/orphaned/unknown/protected classification, duplicate identity, stale lease, PID reuse, gateway protection, browser/user separation, VM ownership, unrelated-listener protection, partial input, concurrency, idempotence, redaction, and a live read-only OS inventory probe. `npx tsc --noEmit --pretty false` is also required.

The observer deliberately does not claim that a candidate is safe to remove. It reports bounded evidence for an authorized human or a future separately designed policy layer. Runtime ledgers, process records, browser registries, queue/subscription metadata, and desktop state can still be incomplete; those conditions are visible and fail closed.

