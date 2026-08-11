# P11-37 External conversation and setup imports

Status: implemented vertical slice, verified against the current Prometheus
source tree on 2026-08-11.

This feature has two deliberately separate flows in Settings → General:

1. conversation imports create ordinary Prometheus web sessions that can be
   opened and continued with Prometheus models;
2. MCP integration imports create disabled MCP definitions plus a canonical,
   redacted MCP snapshot. The General settings flow is MCP-only; the legacy
   API can still explicitly request a broader inactive setup snapshot.

Neither flow resumes a provider-owned source session. `sourceResume` is always
`unsupported`; imported tool calls, tool results, reasoning, browser activity,
artifacts, and subagent activity are historical data only.

## Runtime ownership

- `src/gateway/imports/import-types.ts` is the durable contract. The import
  binding on a session contains the adapter/provider, source account and
  conversation/session identity where available, input digest, job id, dedupe
  key, counts, continuation mode, and import timestamp.
- `src/gateway/imports/import-adapters.ts` is the quarantine parser boundary.
  It only reads staged regular files, rejects links/special files, bounds text,
  files, JSONL records, ZIP entries, and decompressed bytes, and never invokes a
  source command or tool.
- `src/gateway/imports/import-service.ts` owns staged job records,
  `imports/jobs`, quarantine data, normalized snapshots, checkpoints, setup
  backups, rollback tombstones, deterministic session IDs, and resource
  attachment. Public job responses omit staging and normalized filesystem
  paths.
- `src/gateway/imports/import-discovery.ts` is a read-only, bounded scanner for
  known local Hermes, Codex, Claude Code, Cursor, OpenClaw/LocalClaw, and
  official ChatGPT export locations. It reports counts and candidate paths but
  never reads transcript contents, stages files, imports state, or executes
  source commands.
- `src/gateway/routes/imports.router.ts` exposes the authenticated,
  account-scoped discovery and job lifecycle at `/api/imports/discover` and
  `/api/imports/jobs`.
- `src/gateway/session.ts` persists and exposes import provenance in full
  sessions and summaries. `src/gateway/resources/resource-store.ts` treats
  imported files/images/pages/artifacts as `external_import` resources.
- `web-ui/index.html`, `web-ui/src/pages/SettingsPage.js`, and
  `web-ui/src/styles/settings.css` provide General settings controls. Opening
  General automatically scans the bounded discovery endpoint and renders
  source-specific “Preview chats”, “Preview projects + chats”, and “Preview
  MCP integrations” actions. Conversation previews show selectable chats
  newest first, with top-level chats separated from expandable project groups;
  nothing is committed until the user checks chats and confirms. Rollback and
  deletion controls live in a separate compact import-history panel. The old
  Migration tab is a compatibility redirect to the General import cards.

## Supported source boundary

| Source | Current supported input | Explicit limitation |
|---|---|---|
| ChatGPT | Official `conversations.json` export, including a ZIP export and bounded non-JSON archive assets | No private ChatGPT web scraping; attachments without a stable relation are retained on the first conversation and called out in the preview |
| Codex | Local JSON/JSONL/Markdown transcript, current Codex CLI/Desktop `rollout-*.jsonl` envelope (`session_meta`/`turn_context`/`response_item`/`event_msg`), or another app/server artifact that exposes readable message records. Local `~/.codex/config.toml` `[mcp_servers]` declarations are also previewable as MCP integrations. | Local artifact parsing only; the Codex app-server `thread/resume` protocol is not invoked by import and source-session resume is not claimed. The large `~/.codex/sessions` corpus is split by date and then into deterministic batches capped at 200 MiB; each batch has its own preview, retry, confirmation, checkpoint, and rollback record. A single rollout still cannot exceed the staged safety limit. Codex `[plugins]` entries are package metadata, not Prometheus MCP servers, and are not installed or executed. |
| Claude / Claude Code | Local JSON/JSONL/Markdown transcript artifacts with readable role/content records; local `.claude.json` or Claude Desktop MCP config when present | Private Claude UI APIs and UI automation are unsupported; private database fields are not guessed. MCP imports are disabled until each integration is authorized in Prometheus. |
| Cursor | A copied local SQLite/VSCDB/SQLite3/DB file with a readable transcript table | The database is opened read-only; unknown/private schemas return an explicit unsupported result |
| Hermes | Native `hermes sessions export <output>.jsonl` envelope JSONL (one session per line), plus generic local JSON/JSONL/Markdown transcript artifacts; setup folders can be reviewed separately | No Hermes gateway connection or source-runtime resume; native export preserves historical reasoning/tool records but does not make them executable |
| OpenClaw / LocalClaw | Local JSON/JSONL/Markdown transcript artifacts; setup folders can be reviewed separately | No Gateway takeover, channel connection, pairing, browser-profile, or source-runtime resume |
| Generic | JSON, JSONL, Markdown role/content records | Ambiguous records are imported only when a safe role/content mapping exists; otherwise the preview reports unsupported/skipped data |
| Grok / Grok Build | Generic JSON/JSONL/Markdown when the user supplies a local export | No private Grok web API or UI automation adapter is claimed |

ChatGPT/ChatGPT web connector/plugin configuration has no supported local
export or documented local MCP manifest in this codebase. Discovery therefore
does not scrape the ChatGPT web UI or private app databases; a user-supplied
supported MCP JSON config can still be previewed through the generic setup
parser.

The adapter selection is data-driven. Automatic detection can identify known
source names from the local label/path, but a known brand does not authorize
private API access.

## Normalized transcript mapping

- User and assistant records become `ChatMessage` entries with source
  message IDs, source timestamps when valid, provider/model metadata, a web
  channel, and `external_import` origin.
- System/developer/tool records become historical events. They are never
  promoted to executable Prometheus tool calls. Process entries carry
  `extra.source=external_import`, `historicalOnly=true`, and `executed=false`.
- Tool calls/results, reasoning summaries, browser events, artifacts, and
  subagent records are bounded historical events attached to the nearest
  message or to a visible “Historical activity” assistant record.
- ZIP files and other safe resources become resource-store records with
  `origin=external_import`, source/job metadata, bounded content, and
  workspace/thread ownership. URLs retain URL locators; archive files retain
  archive-entry provenance.
- Source account IDs, source conversation IDs, session keys, source files,
  adapter, provider, input digest, and import time remain in the session
  binding. Session IDs are deterministic per owner/workspace/provider/account/
  conversation identity, so a retry does not duplicate a thread.

Conversation imports have two explicit modes:

- `sessions` creates ordinary top-level Prometheus web sessions and never
  invents a project boundary;
- `projects` groups conversations when the source exposes a stable project or
  workspace boundary (`cwd`, `workspacePath`, `projectPath`, or an adapter
  folder boundary), creates ordinary Prometheus Projects, and links the
  imported sessions into them.

Each imported project stores `ProjectExternalImportBinding` in the normal
project record. It includes the source provider/adapter, stable source project
identity, source path, job, digest, and a link state. A source directory is
assigned to `Project.workspacePath` only when it is an existing regular
directory inside the configured workspace or file-permission allowlist. An
outside path remains visible as provenance with `permission_required`; it is
never silently granted access. Missing or invalid source paths are marked
`unavailable`. ChatGPT's official export does not define a project boundary,
so project mode previews an explicit warning and imports those chats as
top-level threads. Generic JSON/JSONL can participate when it supplies the
same explicit path metadata. Cursor remains session-only by default because
its supported local database boundary is not safely inferable; an explicit
project path in a supported record can still be grouped.

The General settings UI defaults to automatic `projects` mode and does not
expose format, source-account, or scope controls. The preview has two views:
Projects contains expandable source-project groups with project-level and
chat-level checkboxes; Chats contains only source top-level chats. Selecting a
chat nested under a project creates the Prometheus project but commits only
the selected chat IDs. Selecting a project checks all of its visible chats.

Project creation is idempotent by owner/workspace/provider/account/source
project identity. Retrying a job links to the existing project and does not
duplicate sessions. Rollback deletes only projects created by that job and
only the source-bound imported sessions/resources; it never deletes or moves
the source directory. Source task and workspace membership is not converted
into runnable Prometheus tasks in this slice. Subagent records remain
historical events rather than new runnable subagent jobs.

## Job lifecycle and safety

The lifecycle is stage → parse → preview → select → explicit confirm → commit. Job JSON
is atomically written, progress records a phase/count/checkpoint, and each
conversation/setup server is committed independently so a partial result is
visible. A matching owner/workspace/kind/digest returns the existing job.

Conversation confirmation carries the selected source conversation IDs in the
durable job record. The preview list is sorted by `updatedAt` descending and
is bounded at 10,000 rows per staged job; Codex's large source is split into
bounded jobs, each with its own selection list. “Select all” is an explicit
user action, not the default. The backend rejects an empty or stale selection
and imports only the checked chats. Confirming a new conversation job without
an explicit selection is rejected, so an omitted UI payload cannot silently
mass-import the staged corpus; retries reuse the selection already recorded on
the job.

Conversation commit is idempotent by its external binding. MCP integration
commit backs up `mcp-servers.json`, imports only normalized non-secret metadata
with `enabled=false`, skips conflicts by default, and writes a canonical
redacted `mcp.json` plus manifest into the import snapshot. Credentials are
represented as pending reauthorization notices; the flow does not connect MCP
servers, spawn commands, refresh OAuth, or copy provider credentials. The
legacy `setupScope=all` API path may write broader memory/skill/instruction
files into an inactive snapshot, but the General settings integration path
uses `setupScope=mcp` and does not copy them.

Rollback removes only sessions whose binding points at the job, tombstones
created resources, restores the setup backup when one exists, or deletes only
MCP definitions created by that job. Deletion requires rollback for completed
jobs. Failed/rolled-back job records can be deleted after their staging data is
removed.

Imported content is untrusted. Archive traversal, symlinks, special files,
oversized inputs, ZIP entry/decompression limits, secret-like setup fields,
prompt-injection text, and malformed records are handled at the parser/resource
boundaries. Historical commands are displayed as records and are never run.

## Sidebar source identity

Imported desktop thread rows replace only the normal timestamp with a locally
packaged source mark immediately before the title. The mark is selected from
`externalImport.source.provider`/adapter rather than stored as a per-thread UI
constant. ChatGPT, Claude, Cursor, Hermes (the Nous Research mark), and
OpenClaw use local files in `web-ui/src/assets/import-sources/`; unknown brands
get an escaped accessible fallback. Non-imported rows keep their normal
`timeAgo` timestamp. Imported desktop rows are only modestly taller; mobile
rows retain the compact layout, and the logo has no panel, border, or padding.

Sidebar placement is durable. `SessionSummary.sidebarOrder` is a higher-is-
earlier rank; imported conversation commits reorder their imported session IDs
ahead of existing web sessions. Desktop session cards are draggable and persist
the visible order through `POST /api/sessions/reorder`; omitted rows retain
their relative order so the behavior remains safe with paged/virtualized
lists. Dragging between the pinned and normal zones also updates the existing
pin state consistently.

On mobile, the same source provenance is carried through the session-summary
API. Imported rows keep their existing drawer width and row structure; the
approved local source mark is a 14px title-line image immediately before the
title, with no panel, border, or padding around it. The normal last-message
`timeAgo` value remains on the lower metadata line, aligned to the right for
both imported and non-imported sessions. Unknown imported providers use an
accessible no-art fallback and never fetch a remote image.

### Large Codex imports

The entire Codex root is intentionally not staged as one job: the current
local rollout corpus can be multiple gigabytes and would otherwise be blocked
by the single-import cap or create an unnecessarily large quarantine copy.
Discovery enumerates only regular `rollout-*.jsonl` files under the known
Codex sessions root, skips links/special files, and returns date-oriented
bounded batches. Settings → General presents those batches as one review
surface. Each batch stages only its selected files through the existing
quarantine boundary; users can preview projects plus chats, select individual
chats newest-first, retry, confirm selected chats, or roll back a single
batch. A failed batch does not block
the others, and a repeated scan/import remains idempotent through the normal
source digest and per-conversation provenance key.

## Verification

- `npm run test:external-import` covers flat and current Codex-rollout JSONL,
  native Hermes session-export JSONL,
  ChatGPT ZIP normalization,
  Codex/Hermes project metadata, project-mode grouping, and the explicit
  ChatGPT no-project-boundary warning,
  historical tool non-execution markers, archive resource mapping, setup secret
  redaction/reauthorization markers, disabled MCP commit, digest idempotency,
  rollback, and malformed-input retry.
- The same regression covers Codex TOML `[mcp_servers]` parsing, provider
  plugin metadata warnings, MCP-only scope, canonical redacted snapshots,
  and secret non-leakage.
- `npm run test:external-import-sidebar` covers the five source assets,
  provenance propagation, three desktop row render sites, accessibility and
  logo fallback, General placement, and the compatibility redirect.
- `npm run test:external-import-discovery` covers bounded known-location
  detection, source-specific adapters, official-export filename detection,
  Codex MCP configuration detection, absent-source handling, and the
  no-content/no-secret discovery contract.
- `npx tsc --noEmit --pretty false` is the focused backend type check when the
  repository-wide type surface is clean; unrelated dirty-worktree syntax or
  pre-existing type errors must be reported separately rather than hidden by
  the import regression.

The existing `/api/migration/*` service remains available for its older
Hermes/OpenClaw/LocalClaw workspace migration behavior. It is not the same
operation as the new transcript/setup job pipeline; the Settings navigation
compatibility redirect prevents users from mistaking the legacy archive/setup
flow for resumable conversation import.
