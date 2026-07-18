# Coding Context Packet V3

Prometheus preserves bounded, authoritative code evidence between coding turns so a follow-up edit can continue from verified post-edit context instead of automatically rereading every touched file.

## Data flow

1. Native read and mutation tools return their normal human-readable result.
2. `attachCodeEvidenceToToolResult(...)` enriches successful file results with `extra.codeEvidence`.
3. Mutation evidence is derived from the existing pre-mutation workspace snapshot and the authoritative resulting file on disk.
4. `observeCodingContext(...)` stores only structured facts and bounded post-edit windows.
5. `selectCodingContextPacket(...)` checks continuation relevance, age, task scope, project root, and the current on-disk hash.
6. A V3 facts block is injected into the system prompt only when selection succeeds and shadow mode is disabled.

Raw tool output, full files, assistant reasoning, and unrestricted diffs are not copied into the packet.

## Evidence contract

Each file record can contain:

- operation: `read`, `create`, `update`, `delete`, `move`, or `copy`;
- workspace/project-relative path and previous path for moves/copies;
- authoritative SHA-256 of the resulting file bytes;
- resulting existence, byte size, line count, and binary status;
- before/after changed line ranges;
- bounded, line-numbered post-edit windows;
- completeness and a required-reread reason when evidence cannot be safely reused;
- timestamp and provenance.

Potential credential values in evidence windows are redacted. Binary and oversized files do not include content windows.

## V3 reuse rule

Prometheus may use a post-edit window without rereading only when:

- `state_matches_evidence` is `true`;
- `required_action` is absent; and
- the needed code is present in the bounded window.

The packet builder recalculates the current file hash immediately before injection. An external modification removes stored windows from the injected packet and adds a reread requirement.

## Configuration

The implementation honors:

```json
{
  "work_context": {
    "enabled": true,
    "shadow_mode": false,
    "packet_version": 3,
    "max_packet_bytes": 12000,
    "max_age_hours": 0.5,
    "fast_paths": {
      "coding": true
    }
  }
}
```

- `packet_version: 2` keeps a bounded legacy renderer as a rollback path.
- `shadow_mode: true` performs selection and records diagnostics without injecting a block.
- Explicit `max_age_hours` applies to both interactive and agent contexts. Without it, interactive packets default to 30 minutes and persistent-agent packets to 14 days.
- Packet bytes are hard-capped at 96,000 even if configuration requests more.

## Persistence and diagnostics

Packets are stored atomically in `work-context/coding-context-packets.json`. Writes are deferred briefly so a file tool does not synchronously rewrite the packet store on its critical path.

Decisions and first follow-up file actions are recorded in `work-context/coding-context-decisions.jsonl`. The log rotates at 5 MiB and records:

- injected, shadowed, omitted, or stale decisions;
- selection reason, packet size, age, and evidence-quality counts;
- the first subsequent file tool, whether it was a read or mutation, elapsed time, and error state.

Desktop and mobile process views display the per-turn packet decision without exposing code windows.

## Verification

Run:

```bash
npm run test:coding-context
npm run benchmark:coding-context
npx tsc --noEmit
npm run check:web-ui
```

The benchmark compares V2 and V3 rendering for the same authoritative continuation evidence and reports packet sizes, actionable-window availability, and V3 selection p95 latency.
