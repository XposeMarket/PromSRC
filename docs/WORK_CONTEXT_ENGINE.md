# Work Context Engine

The Work Context Engine preserves a small, versioned working set for each chat session so warm follow-ups can continue from verified local state instead of rediscovering the task.

## Packet model

Packets are stored under the Prometheus config directory in `work-context/<session>.json`. Every packet carries an exact revision, freshness state, objective, completed steps, artifacts, effectiveness metrics, and one active domain adapter.

- Coding: project root, branch/head, original and current dirty files, file/symbol targets, line hints, anchors, SHA-256 hashes, build/test commands, last check, and artifacts.
- Browser: browser session/profile, URL/title/page type, content hash, named targets, and pending commit boundary.
- Desktop: active process/window/handle/monitor, screenshot/content hash, semantic targets, and pending commit boundary.
- Creative: mode/project, scene/version/hash, composition, dimensions/duration, assets/layers, QA, and render settings.
- Generic: relevant paths, decisions, and the last tool, shared by workflows that do not yet have a specialized adapter.

Hashes and anchor checks invalidate stale coding targets. Browser, desktop, and Creative adapters use their native content hash, window handle, and scene version/hash guards.

## Runtime fast path

`work_context_execute` accepts up to eight model-chosen steps. It is not an autonomous editor and does not decide what to change. The runtime deterministically:

1. Checks the packet revision and active domain.
2. Checks domain freshness guards.
3. Preflights the complete bounded step list.
4. Executes the already-decided steps without another model generation between them.
5. Stops at the first failed step and records the result back into the packet.

Coding patch steps must use guarded, transactional patchsets. Browser and desktop submit/send/publish/purchase/delete-style actions are rejected from the fast path and remain on the normal approval lane. Creative mutations require a scene version or hash when scene state is available.

## Transactional patches

Both `apply_workspace_patchset` and `apply_dev_source_patchset` use the same transaction engine. It stages every edit in memory, validates every path/guard/edit/syntax result, writes a persisted journal and backups, then replaces all target files. A commit failure rolls back the complete set; an interrupted transaction is recovered before the next patchset.

## Configuration

```json
{
  "work_context": {
    "enabled": true,
    "shadow_mode": true,
    "max_packet_bytes": 96000,
    "max_age_hours": 336,
    "fast_paths": {
      "coding": false,
      "browser": false,
      "desktop": false,
      "creative": false,
      "generic": false
    }
  }
}
```

Shadow mode persists and injects packets but never narrows the tool surface or enables `work_context_execute`. Enable domain flags and disable shadow mode after reviewing packet quality in the target environment.

## Diagnostics and benchmark

- `GET /api/work-context/:sessionId` returns the current packet, resolved configuration, and storage path.
- `POST /api/work-context/:sessionId/clear` invalidates a session packet.
- `GET /api/work-context-benchmarks` reports p50/p95 request-to-verified-edit time, observed tool time, and estimated model/orchestration time.

The runtime metric is elapsed time from each user request to a successful verification after a mutation. Individual tool duration remains a supporting diagnostic, not the success metric. For controlled effectiveness comparisons, each fixture must also supply an independent acceptance command or artifact assertion that the agent does not choose; only runs passing that fixed oracle count as a correct verified edit.
