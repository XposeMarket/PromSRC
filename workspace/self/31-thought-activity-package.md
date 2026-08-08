# Brain Thought Six-Hour Activity Package

Last source verification: 2026-08-08.

## Contract

`src/gateway/brain/activity-package.ts` builds `prometheus.thoughts.activity-package.v1` immediately before a Thought model call. The package is authoritative for the six-hour operational window and is injected directly into `_buildThoughtPromptV2`.

- Window: UTC, half-open `[start,end)`. `start` is included; an event exactly at `end` belongs to the next package.
- Identity: every event has a stable `evt_<sha256-prefix>` ID. Duplicate records merge their provenance instead of becoming duplicate model facts.
- Provenance: every event carries a source/store/ref, optional record ID, line, and timestamp field. Refs are workspace-relative where possible.
- Runtime linkage: successful `BrainThoughtEntry` records and Thought completion/failure broadcasts carry the package ID and persisted package path alongside the Thought run ID.
- Ordering: timestamp ascending, then stable event ID.
- Authority: canonical runtime stores, not `workspace/audit`. The audit directory is a bounded/redacted materialized recovery mirror and can lag or omit team/subagent/browser/runtime lanes.
- Privacy: secret-looking keys, bearer tokens, query credentials, cookies, raw tool payloads, binary/screenshot payloads, and private reasoning are redacted or omitted. Raw payload refs are not handed to Thought.
- Oversize behavior: the package contains an inline ledger plus a complete direct-read-only continuation manifest. Continuation JSONL parts contain the omitted event records and their hashes. If writing or scanning fails, the omission appears in `completeness.omissions` or `sourceCoverage`; it is not represented as an empty source.
- Unresolved work: open tasks/runtimes/approvals/questions/proposals and active-work entries are included separately from the event window. The unresolved manifest is capped at 200 items and explicitly reports that cap.

## Data flow

```text
Thought trigger (checker, manual run, startup catch-up)
  -> compute window in brain-runner.ts
  -> buildThoughtActivityPackage()
       -> canonical .prometheus stores
       -> workspace history / teams / Brain / events / proposals
       -> live browser-session snapshot
       -> UTC filter, dedupe, redaction, stable ordering
       -> inline ledger + direct continuation files + metrics
  -> inject JSON package into _buildThoughtPromptV2
  -> handleChat(..., executionMode='cron')
  -> record post-run search-call counts and Thought artifacts
```

Thought trigger paths are all in `BrainRunner`: the 15-minute eligibility ticker started by `start()`, the manual `runNow('thought')` route exposed by the Brain settings/schedule API, and catch-up eligibility after a gateway restart. The scheduler/heartbeat/cron/team workers do not invoke Thought directly; their persisted activity is consumed as package source material. `_runThought(...)` is the single model execution path and the package is assembled immediately before its prompt.

The Thought allowlist retains direct file/source reads for current-state verification and light research, but does not expose directory/list/search tools used to reconstruct the covered activity window. Web search remains a separate prior-art/research capability and is counted separately from covered-activity search violations.

## Coverage matrix

| Activity | Canonical package inputs | Package representation | Known boundary |
|---|---|---|---|
| Chats/messages | `.prometheus/sessions`, session message timestamps | message/session events, stable IDs | old history is included only when its message timestamp is in the window |
| Tasks | `.prometheus/tasks` | task snapshots, journal/evidence events, unresolved current tasks | task state without a persisted timestamp is not invented as a window event |
| Runs/threads | cron/schedule/run history, runtime ledger, thread/team stores | run lifecycle and coordination events | persisted snapshots can lag live state; source status says so |
| Tools/errors | `.prometheus/tool-observations`, audit log | redacted tool/status/error events and touched paths | raw result payloads are excluded |
| Browser | browser registry plus browser tool observations | session/url/title/owner metadata and redacted tool events | transient DOM/screenshot payloads are excluded |
| Files/workspace | workspace history, dev-edit records, tool paths, workspace mtimes | file-change/path events | unrecorded deletions cannot be proven by mtime; this is explicit |
| Agents/subagents/teams | agent chats, subagent workspace metadata, managed teams, task/run records | actor/team/dispatch/chat events | raw identity secrets are excluded |
| Schedules/heartbeat | cron/schedules/heartbeat stores and run events | config/run lifecycle events | a config is an event only when its persisted timestamp is in-window |
| Runtime/config | runtime ledgers, status, stall/error/startup records, config timestamps | lifecycle/config/error events | live snapshots may lag persistence cadence |
| Important/unresolved | Brain ledger, events, proposals, diagnostics, approvals/questions | event records plus current unresolved manifest | unresolved manifest cap is reported |

### Before/after coverage

| Activity | Before: Thought prompt path | After: package path |
|---|---|---|
| Chats/messages | Prompt-directed audit scan of mirrored sessions/transcripts; selective and cap-limited | Canonical session snapshots/messages, timestamp-filtered and provenance-bearing |
| Tasks/runs/schedules | Separate audit/task/cron directory searches; partial when mirrors lag or paths are absent | Canonical task journals/evidence, cron/schedule/run stores, plus explicit empty/partial source status |
| Tools/errors | Search/reconstruct audit and recent observations; raw completeness depended on retrieval | Canonical redacted tool observations, audit/error records, stable IDs, merged provenance |
| Browser/files/agents/teams | Not uniformly represented; team/subagent workspace files were excluded from the mirror | Dedicated browser/file/agent/team sources plus mtime/history limitations in the manifest |
| Runtime/config/important/unresolved | Prompt listed likely directories but had no complete source manifest or size telemetry | Canonical runtime/status/event sources, unresolved current-state section, cap/error/continuation disclosure |
| Search/retrieval behavior | `search_files` was exposed for six-hour reconstruction; historical call count unavailable | Covered-activity search tools removed from Thought; assembly records zero search calls by contract and post-run violations |

## Baseline and local measurements

The pre-change baseline had no activity-package builder or package metrics. The Thought V2 prompt explicitly instructed the model to scan `workspace/audit` and the Thought allowlist exposed `search_files`; actual historical search-call and model-latency counts were not persisted, so those values are **unavailable**, not zero. The audit materializer itself reported that it was a mirror, not a complete source, and excluded some team/subagent workspace data.

The following are local measurements on this device, not production measurements:

| Measurement | Before implementation | After implementation |
|---|---:|---:|
| Direct package | none | 1 deterministic package before the model call |
| Covered-activity search calls at assembly | unavailable | 0 by contract |
| Assembly latency | unavailable | 13,793 ms for the current repository’s six-hour window |
| Files visited / records scanned | unavailable | 72,085 / 153,859 |
| Events discovered / included | unavailable | 205 / 205; 0 duplicate records in this window |
| Inline / continuation events | unavailable | 84 / 121 |
| Package size / estimated tokens | unavailable | 220,001 chars / 55,001 estimated tokens |
| Thought model-call latency/failure | unavailable; no historical telemetry | not measured by this local builder run; no model call was started for the benchmark |

The synthetic regression is a separate local test: 716 events, 1 deduped duplicate, 1 continuation, all ten source categories, UTC timezone/boundary checks, redaction, a malformed source, and concurrent deterministic builds. It does not represent production volume.

## Observability and verification

Metrics are appended to `workspace/Brain/state/activity-package-metrics.jsonl`. Each record includes assembly latency, source/file/record/event counts, duplicate count, inline/full ledger size, estimated tokens, continuation write failures, source partials, and post-run search counts. The package artifact stores the correlation ID, package ID, source manifest, and continuation hashes.

Tests:

- `npm run test:activity-package`
- `npx tsc --noEmit`

The regression covers exact boundaries, timezone normalization, deterministic ordering/IDs, duplicate provenance merge, redaction, malformed/partial sources, oversize continuation, unresolved work, retries via repeated builds, and concurrent builds. A full Thought model end-to-end measurement requires an available configured provider and is intentionally not claimed by the local builder benchmark.

## Remaining limitations

1. Historical browser DOM/screenshot payloads are not included; redacted browser tool observations and session metadata are the safe representation.
2. Filesystem mtimes cannot prove an unrecorded deletion; the package reports that limitation and relies on history/tool events for authoritative deletion evidence.
3. Live runtime/browser state can lag its durable persistence boundary. The package exposes source limitations and unresolved current state; Thought must verify consequential current state before proposing action.
4. A very busy window may require continuation reads. Those reads use exact package paths and are not a search/reconstruction flow. If a continuation cannot be written, the package is partial and says why.
