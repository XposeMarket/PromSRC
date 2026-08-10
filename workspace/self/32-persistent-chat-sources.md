# Persistent Chat Sources / Context

Status: first-release implementation landed 2026-08-08. This document records measured current behavior and the product decisions that shaped it. It is not a proposal for a separate, speculative memory system.

## Current implementation map

The durable source layer lives outside session transcript JSON:

- `src/gateway/resources/resource-store.ts` owns the registry, immutable versions, workspace-scoped links, provenance, bounded retrieval, legacy migration, and the file/URL/Browser/artifact/task adapters.
- Registry metadata is stored under the configured resource root as `resources/registry.json`; snapshot bytes are under `resources/content/`. Resource storage is atomic and confined to that root.
- `src/gateway/routes/resources.router.ts` exposes thread resource listing, content reads, attach/detach/pin/delete/refresh, fork copying, Browser current-page capture, and Browser history.
- `src/gateway/routes/chat.router.ts` attaches pasted URLs and upload metadata/bytes, migrates historical attachments/URLs, refreshes scheduled-job resources, injects bounded resource context into the same first/subsequent-turn prompt path, and registers final artifacts.
- `src/gateway/browser-tools.ts` records Browser navigation metadata as workspace-scoped history resources. Navigation does not automatically attach page contents to a chat; “Save current page” captures readable text and pins it to the selected chat.
- `src/gateway/tasks/task-store.ts` synchronizes bounded task journals as versioned task resources. `src/gateway/tasks/task-runner.ts` refreshes scheduled bindings and is the only automatic inheritance path for background `_spawn`; `automation-executor.ts` supplies the parent thread resource IDs.
- `web-ui/index.html` places the desktop Sources section after Agent Context/Progress and before Process Log. `web-ui/src/pages/ChatPage.js` renders and operates it.
- `web-ui/src/mobile/mobile-pages.js` places Sources behind the existing top-right overflow menu. It is a closed-by-default popover, not a persistent bottom sheet. `mobile-api.js` loads metadata online; mobile does not cache full source contents.
- Generated UI remains derived from `web-ui/`; run `npm run sync:web-ui` after source edits.

The ordinary chat transcript remains the source of truth for messages and process narration. Resource records are an attached context layer, not a replacement transcript and not a new “clear chat” operation.

## Entity and ownership model

The registry has four related records:

1. `ResourceRecord` — stable resource identity and current metadata: `id`, kind, title, MIME type, origin, locator, workspace scope, status, timestamps, current version, metadata, sensitivity, and deletion time.
2. `ResourceVersion` — immutable content snapshot: version ID, sequence, SHA-256 hash, size, MIME type, snapshot path/kind, optional live source path, capture time, and metadata.
3. `ThreadResourceLink` — the association: thread ID, resource ID, optional selected version, attach actor/time, pin state, inheritance provenance, and detach actor/time.
4. `ResourceProvenanceEvent` — bounded audit history for creation, attachment, detachment, version creation, refresh, Browser visit, inheritance, deletion, and refresh failure.

Resources are workspace-scoped. A store created for one resolved workspace cannot read or mutate another workspace’s resource records. Every thread route resolves the session workspace before selecting its store. Workspace files must be regular files inside the workspace and must also remain inside the real-path boundary; symlinks and traversal are rejected.

The first release intentionally deduplicates only within a workspace, after the workspace boundary is known. URL locators are canonicalized, file locators use the safe workspace-relative path, and content hashes prevent duplicate versions when the same content is attached again. File/image identity still includes the locator path, so two distinct files with identical bytes remain distinct resources. Cross-workspace deduplication is off.

## Resource kinds and origins

Supported kinds are `file`, `image`, `link`, `web_page`, `browser_page`, `artifact`, `task`, `creative_asset`, and `tool_result`. Origins identify how a record entered the system: upload, user link, web fetch, Browser visit/save, assistant artifact, task journal, tool observation, or legacy migration.

The current integration rules are:

- Pasted URLs are attached automatically, with a metadata link plus a fetched readable-text snapshot when the bounded web fetch succeeds. Explicitly attached UI sources are pinned.
- Uploads keep a live workspace file reference when one exists and also create an immutable snapshot. Base64 is not replayed as ordinary session history. Images are stored as binary snapshots but are not read into the text prompt.
- Browser navigation creates history metadata only. Saving the current page captures readable text selectively and pins it. Screenshot/DOM/HTML capture remains opt-in and is not performed merely because a page was visited.
- Generated files, rich artifacts, generated images/videos, and canvas file descriptors are registered after a completed turn as artifact resources; metadata-only artifacts remain discoverable when bytes have already been cleaned up.
- Task journals are bounded to the recent journal tail and become searchable/versioned task resources. A task can be linked to its run session and originating session without copying the same snapshot bytes.
- MCP/connector/account resources are not part of the first release. The resource adapter boundary is deliberate so future Drive/Notion/Slack/MCP adapters can supply a permissioned locator and refresh/version implementation without changing thread retrieval.

## Lifecycle rules

### Attach and refresh

Attachment is idempotent for an active thread link. A changed hash creates a new immutable version and moves the resource’s current version pointer; unchanged content does not create a new version. Explicit UI sources are pinned by default. Automatically discovered pasted links and Browser history are not pinned unless explicitly saved/attached.

Live workspace files retain both the source locator and the captured version. Refresh reads the still-confined live path and creates a new version only when its hash changes. URL/web-page refresh fetches readable text and creates a version; failures mark the resource stale/unavailable and record a provenance event.

Explicitly saved sources do not expire automatically. There is no new retention UI in this release. A user can detach a source from a thread without deleting its backing resource. Underlying deletion is a separate authenticated operation that marks the record deleted and preserves auditability; it does not silently remove the immutable bytes from the registry directory.

Browser history is retained as workspace-scoped metadata resources so it remains searchable. History is not automatically attached to every thread and does not cause full page contents to be captured. The current page save action is the explicit attachment boundary.

### Forks and inheritance

Forking copies active thread links and selected version pointers; it shares immutable backing records and snapshot bytes. It does not duplicate source files or silently create new versions. Copying records `inheritedFrom` and `inheritedBy: fork`.

Only background `_spawn` can inherit resources automatically, and only the explicitly requested, currently authorized resource IDs are copied. Omitting `resource_ids` passes an empty subset; the old “forward every attached resource” behavior is not allowed. Other tasks, ordinary agents, side chats, and unrelated threads do not inherit resources automatically. Scheduled jobs refresh their own bound resources at run time before their turn.

### Migration and compatibility

The first resource-aware turn may migrate a bounded tail of historical messages idempotently, and the resource API also exposes an explicit write-only migration action. GET/list/read/search never run migration or create registry records. The explicit maintenance boundary also sanitizes legacy registry metadata/provenance; immutable historical snapshot identities are preserved and are redacted when read. Migration extracts URLs and attachment preview metadata, but does not recover or duplicate historical raw base64 that has already been scrubbed. Migration markers are per thread, and transcript JSON is not rewritten. Old sessions therefore continue to work with their existing history while gaining resource metadata lazily.

## Retrieval and prompt policy

Every active attached resource contributes bounded metadata to the `<persistent_chat_resources>` manifest: resource ID, type, title, locator when safe, and pin state. Full contents are not injected merely because a resource exists.

Content selection is automatic and permission-scoped:

- pinned resources are eligible by default;
- explicit resource IDs are always eligible;
- unpinned resources are selected for a meaningful title/locator match, or when every token in a multi-token query matches a bounded text excerpt; a generic one-token query does not load every attached body;
- selected text is loaded as excerpts, not whole files/pages;
- the total resource block is capped at 32,000 characters (the initial approximately 8,000-token budget), with a maximum manifest of 60 resources and per-candidate excerpts bounded before final assembly.

This policy is used in both first and subsequent turns because it is assembled in the same `chat.router.ts` prompt path. The prompt cache key includes the selected resource identity/length state so stale resource context is not reused accidentally. The HTTP resource search/content endpoints support explicit UI retrieval; model-side automatic retrieval is currently prompt-side rather than a new user-visible resource tool.

Resource text is wrapped as external content. A narrow detector looks for actual instruction-like injection patterns in selected excerpts. The system emits a safety signal only when such text is selected and detected; it does not show generic warnings for ordinary resources. Resource contents never gain system/developer authority.

The resource layer has no clear-chat behavior. Clearing or deleting chat history remains whatever the existing chat/session contract defines; resource detach/delete is separate.

## UI contract

Desktop is intentionally lightweight: Sources is a normal right-rail section immediately below Agent Context/Progress and immediately above Process Log. The compact view shows source titles/metadata only; the expanded view provides bounded search/scrolling. Existing source cards and attachment links remain compatibility paths, while opening a file delegates to Canvas when available. Browser capture remains an explicit adapter action rather than a visit side effect.

Mobile uses the existing top-right overflow (`…`) menu alongside Files, Permissions, and Settings. Selecting Resources opens a top-right popover. The popover is hidden on initial chat render, closes via the close button or scrim, and never appears just because a chat was opened. Its controls are online-only and metadata-first: save current Browser page, Browser history, attached resources, search, attach, and detach.

## Security, privacy, and failure behavior

- Gateway resource routes remain behind the existing gateway authentication/account middleware.
- Existing-session and workspace boundaries are checked before reads, writes, refreshes, deletes, or fork copies. Resource IDs and thread IDs are validated before registry access; cross-thread/workspace failures use a safe not-found/unavailable response.
- Credential-like URL userinfo/query values, authorization/password/cookie/token fields, snapshot text, provenance metadata, logs, errors, prompt receipts, and model-facing summaries are redacted at the resource boundary. Raw credentials, secrets, and unsafe tool sidecars are not persisted as resource content.
- External page/file/task text is untrusted content and is never treated as runtime instructions. Injection detection is advisory and bounded.
- Sensitive/binary resources are represented by metadata in prompt context; binary snapshot bytes are not converted into arbitrary prompt text.
- Registry writes are atomic. Missing/corrupt snapshots degrade to metadata and status instead of breaking the chat turn. Resource attachment, artifact registration, and Browser history sync are nonfatal to the primary chat operation.
- Provenance is capped at 250 events per resource. Retrieval is capped by resource count, excerpt size, and total characters so the registry is not another unbounded memory cache.
- Attach, detach, read, cache hit/miss, relevance, version, and deletion events expose only opaque resource/version IDs and bounded counters through the store’s privacy-safe telemetry sink; event payloads contain no URLs, content, credentials, or secrets.

## Verification

- `npm run test:resource-store` covers URL deduplication, immutable versioning, secret redaction, exact Unicode/text caps, same-content distinct file paths, retrieval selection/budget, fork link sharing, idempotent detach/delete, live-file refresh, cross-workspace isolation, adapter registration, migration idempotency/read-only behavior, telemetry, and prompt-injection detection. It also checks the router’s explicit migration/read-only contract.
- `npm run build:backend` passes after the gateway/resource integrations.
- `node --check` passes for desktop/mobile resource clients.
- `npm run sync:web-ui` and `npm run check:web-ui` pass; `generated/public-web-ui` matches `web-ui`.
- Local desktop UI inspection confirms Sources appears after Progress and before Process Log. The mobile route requires an authenticated/paird mobile session for a full interaction smoke test; the source contract is closed-by-default in the generated bundle.

## Follow-up boundaries

No-regret work already in place: durable IDs and hashes, immutable versions, workspace/thread authorization boundary, provenance, secret redaction, explicit detach/delete distinction, bounded retrieval, fork link copying, selective Browser capture, privacy-safe telemetry, and adapter-neutral origins/locators. Persistent read paths are registry-write-free; storage directories are created lazily on write.

Product decisions still intentionally deferred: connector/MCP resource adapters and permission UX, richer page snapshots (DOM/screenshot/HTML), resource-specific retention controls, a model-callable search tool versus prompt-side retrieval only, cross-workspace sharing, and offline/mobile full-content caching.

Known implementation limitation: the local resource registry does not yet carry a durable multi-account owner field. Account authorization therefore relies on the existing authenticated gateway/account middleware plus the explicit workspace/thread/session checks in the resource routes and adapters. A future multi-account deployment must add an account/tenant scope before sharing one registry root across accounts.
