# 11 — Memory, Notes & Brain

> **Last verified:** 2026-10-07 against PromSRC `a48712ccc` · **Owner area:** `src/gateway/memory/`, `src/gateway/memory-index/`, `src/gateway/brain/`, `src/gateway/audit/`, `src/gateway/projects/`, `src/gateway/learning/`
> **Read this when:** reading/writing durable user memory, recalling prior conversation, recording task continuity, tracing Brain Thought/Dream activity, inspecting audit continuity, or changing project knowledge.

## TL;DR

- The unified model tool is `memory(action:...)`: durable file `write`/`update`/`read`, ranked `search`, fast `recall`, and captured `ideas`. Use its schema for exact action arguments; older detailed memory tools remain executor internals or maintenance routes and their inventory is in [generated tools](generated/tools.md).
- `USER.md` is the user's durable profile/preferences; `SOUL.md` is assistant operating contract; `MEMORY.md` is durable cross-session history/decisions/runbooks. `BUSINESS.md` is company-wide context. Route each fact to the right file.
- Standalone subagents/team actors may only access their own `MEMORY.md` through generic file memory; `USER.md` and `SOUL.md` belong exclusively to main Prometheus. Per-project/session knowledge has its own project workspace/`CONTEXT.md` and knowledge store.
- `write_note` is a dated operational continuity log, not long-term user memory. `status:"open"`, `"done"`, `"info"`, optional stable `thread`, and `resolves` create a live open-work surface and close prior IDs. Explicit resolves can close notes of any age (#556).
- `memory(action:"search")` combines incremental lexical recall (transcripts, notes, memory bullets, ideas) with semantic/structured memory search. `recall` is the quick recall lane. Current chat is excluded by default; say `include_current_chat:true` only when deliberately searching it.
- Brain **Thought** reflects on recent activity roughly every six hours; it writes thought markdown, context capsules and the `Brain/active-work.jsonl` ledger, not durable MEMORY. Nightly **Dream** performs synthesis, durable memory updates, Pulse Cards/proposals and a `Brain/continuity/.../carry-forward.json` decision; cleanup later may only remove/dedupe memory.
- Audit continuity events are scrubbed before append; `audit-log.ts` is the raw append/query log, and `audit/materializer.ts` builds a bounded snapshot for analysis. Audit is evidence/history, not an authoritative source for live current state.
- Project store and `project-learning.ts` maintain per-project workspace, knowledge files and `CONTEXT.md`; Obsidian integration has explicit `read_only`/`assisted`/`full` modes.
- Brain, memory index, note writer and audit are separate subsystems with separate stores, freshness and permissions. Confirm the correct source and timestamp before treating a hit as present-day fact.

## Map

| Concern | Where (file → symbol) | Notes |
|---|---|---|
| Model-facing memory surface | `src/gateway/agents-runtime/capabilities/memory-executor.ts` → `runUnifiedRecall`, `memory` wrapper | Maps wrapper actions to durable file handlers, recall index, semantic search and structured worker. |
| Memory file authorization | `memory-executor.ts` → `resolveMemoryFile`, `resolveMemoryPath` | Main vs agent/manager memory ownership guard. |
| Recall index | `src/gateway/memory-index/recall-index.ts` → `searchRecall`, `searchRecallSemantic`, `listRecallIdeas` | Incremental append-oriented SQLite FTS, index stats and semantic recall. |
| Structured/operational memory | `src/gateway/memory-index/index.ts`, `operational.ts`, `memory-atoms.ts`, `sqlite-store.ts` | Bounded/structured records, search modes, refresh, claim review. |
| Memory maintenance gate | `src/gateway/memory-index/memory-access-gate.ts` → `acquireMemoryAccess` | Search vs maintenance concurrency; avoid stalling manual recall behind refresh. |
| Intraday notes | `src/gateway/memory/intraday-notes.ts` → `appendIntradayNote`, `resolveNotes`, `renderNotesForPrompt` | Dated Markdown note files with ID/status/thread; prompt renderer prioritizes open items. |
| Brain orchestrator | `src/gateway/brain/brain-runner.ts` → `BrainRunner` | Thought, nightly Dream and cleanup scheduling, sessions, provider routing and scoped files. |
| Brain persisted state | `src/gateway/brain/brain-state.ts` → `BrainLatestState`, `loadLatestState`, `saveLatestState` | `Brain/state/latest.json`, daily status, restart recovery. |
| Thought output & capsules | `src/gateway/brain/brain-thought-runtime.ts` → `registerBrainThoughtRun`; `brain-continuity.ts` | Writes `Brain/thoughts/...`, `context-capsules/...`, `active-work.jsonl`. |
| Dream carry-forward | `brain/brain-runner.ts`, `brain-continuity.ts` | Writes continuity decision and `Brain/carry-forward/<next date>.md`; not intraday notes. |
| Activity evidence package | `src/gateway/brain/activity-package.ts` → activity package builders | Reads bounded audit/task/session/note/work data for Thought and Dream. |
| Raw audit log | `src/gateway/audit-log.ts` → `appendAuditEntry`, `queryAuditLogAsync`, `getRecentAuditSummary` | Append-only events/messages/tool calls under config log storage. |
| Audit continuity/scrubbing | `src/gateway/audit/continuity.ts` → `scrubAuditValue`, `appendContinuityEvent`, `appendContinuityMessage` | Removes unsafe/sensitive detail before continuity events are recorded. |
| Audit snapshot/index | `src/gateway/audit/materializer.ts` → materializer startup/snapshot helpers; `audit-ops.ts` | Bounded periodic materialization and worker-backed audit queries. |
| Project knowledge | `src/gateway/projects/project-store.ts` → `getProjectWorkspaceDir`, `getProjectContextFilePath`, `buildProjectContextBlock` | Project CRUD, workspace, knowledge and session context assembly. |
| Project learning | `src/gateway/projects/project-learning.ts` → `extractAndWriteProjectContext`, refresh helpers | Learns goals/people/tools/milestones from project sessions into `CONTEXT.md`. |
| Learning analytics | `src/gateway/learning/turn-recorder.ts` → learning-turn and skill-routing analytics | Turn/candidate records and skill routing analytics; separate from editable durable memory. |
| Obsidian bridge | `src/gateway/obsidian/bridge.ts` → `loadObsidianBridgeState`, `syncObsidianVaults`, `writePrometheusNoteToObsidian` | External vault sync with explicit bridge mode/permissions. |
| Coverage | See [generated tests](generated/tests.md) for memory, Brain and audit regressions. | Keep the detailed list generated. |

## How it works

### Durable memory files and authority

`memory(action:"write")` takes `file`, `category`, and `content`; it appends a dated bullet to a category heading in the selected Markdown file. `update` replaces an exact category bullet, `read` reads a selected file, and `search`/`recall` use retrieval rather than full-file dumping. `file` names are `user`, `soul`, or `memory` and map to `USER.md`, `SOUL.md`, `MEMORY.md`. Use `memory_browse(file)` for category context before adding a bullet when unsure.

- **USER**: durable facts about Raul, preferences, roles, projects, identity and recurring expectations.
- **SOUL**: stable persona/voice/operating principles and user-specific operating rules.
- **MEMORY**: decisions, prior outcomes, runbooks, operational corrections and history that will matter later.
- **BUSINESS**: company/entity facts and product/project context. Enable `business_context_mode` only while the session actively needs automatic `[BUSINESS]` injection; disable afterward if it should not remain live.
- **Entity files**: company-level facts stay in BUSINESS; specific clients, people, vendors, social accounts and project entities live under `entities/`, per the workspace routing convention.
- **Project `CONTEXT.md`**: working knowledge scoped to a project, refreshed from related sessions; don't move it to global MEMORY unless it is truly broadly useful.

`resolveMemoryPath()` enforces actor scope. Main Prometheus can read/write its profile/persona/history files. An agent or team manager using the generic file-memory interface can only access its own personal `MEMORY.md`; it cannot read or mutate main `USER.md`/`SOUL.md`. Business/entity and structured-memory tools have their own explicit handlers and scopes—do not infer that generic file access grants them.

### Recall and indexes

The unified `memory(action:"search")` deliberately composes retrieval layers. The fast recall index searches transcripts, intraday notes, `MEMORY.md`/`USER.md` bullets, and captured idea records. It is incremental, time-sliced, indexed in SQLite, avoids maintenance lock contention and emits strong/partial/weak confidence (or `NO STRONG MATCH`). Current session is excluded unless `include_current_chat:true`; optional sources/date bounds restrict the search.

Semantic recall is added when embeddings are available. A second structured-memory worker can add operational records, project filtering, timeline/deep search and reranked hits. It is bounded by a short timeout; if maintenance/search is busy, lexical recall remains available with a note rather than blocking for a long refresh. `memory(action:"recall")` returns the recall side without the full structured search. `ideas` lists idea captures, which are proposals for possible work—not user-authorized tasks.

The larger `memory-index` includes a bounded structured record/atom layer (decisions, facts, constraints, preferences, relationships, entities, project and other typed memory), embeddings/semantic retrieval, claim review and controlled refresh/consolidation. The tool surface includes maintenance/debug actions; inspect [generated tools](generated/tools.md) and the handler before using them. Structured memory is not the same thing as the Markdown `MEMORY.md`; a model search may legitimately surface records from both.

### Intraday continuity notes

`write_note` appends a dated file under workspace `memory/` using `appendIntradayNote()`. Notes have generated IDs (`n_...`), tag, content/source, optional task ID, status and normalized thread key. Status roles:

- `open`: unfinished task, blocker or follow-up. It appears in future prompt context for a bounded carry window and gets priority over info/done notes.
- `info`: useful short-lived discovery or context, not an outstanding task.
- `done`: resolved work. If `resolves` is present, referenced note IDs are marked done; explicit resolution now scans older note files too (#556).

`thread` is a stable task key: appending another open note on the same thread supersedes previous open entries so prompt context shows the newest state, not a stale pile. Use a consistent normalized key for one thread. `write_note` returns ID/status/resolved/unresolved/superseded details; store IDs when future resolution matters. Notes written from `task_<id>` sessions also append a task journal event; a `task_complete` tag may complete the currently marked write-note-completion plan step.

`renderNotesForPrompt()` includes newest open items (today and recent carry), then current-day info notes, then compact done-today entries, subject to a shared char budget. It carries only open items across days; it deduplicates by thread. If an item vanishes from prompt because the budget is exceeded, search or inspect the daily note file rather than assuming it was resolved. The writer preserves history; resolve IDs or append a newer note—do not silently delete old notes.

### Brain Thought, Dream and continuity

Brain is a scheduled reflection pipeline with persisted state, not a general background subagent. `BrainRunner` evaluates eligibility approximately every 15 minutes. Thought is eligible after six hours since last successful covered window (with catch-up bounds); nightly Dream is eligible after configured local time once per date. `Brain/state/latest.json` and daily state persist timestamps, outcome/error/recovery, model overrides and enablement across gateway restarts.

- **Thought**: packages a bounded recent window of audit, tasks, sessions, notes, and workspace activity; a scheduled chat turn reflects on it. It writes `Brain/thoughts/<date>/<window>-thought.md` plus `Brain/context-capsules/<date>/<window>-capsules.json` and upserts work records in `Brain/active-work.jsonl`. Thought does **not** write permanent long-term memory or create proposals.
- **Context capsules**: typed, dated continuity snippets (active work, decisions, corrections, blockers, time-sensitive items, opportunities) extracted from observed activity. They are sidecars for later context selection, not a general chat memory database.
- **Active work ledger**: durable JSONL with stable item IDs and status; Thought may upsert current items, mark resolved only when current-state verification supports it, and later Dreams use it to enrich/dedupe activity. It is a current-work index, not an instruction to reopen every historical item.
- **Dream**: nightly synthesis reads the day’s Thought/Pulse Cards and supporting evidence, updates durable memory directly, creates at most the configured small set of lightweight plan proposals, and writes `Brain/dreams/<date>/<label>-dream.md` and `Brain/proposals.md`. Strict executable work remains for explicitly actionable cases.
- **Carry-forward**: Dream writes `Brain/continuity/<source date>/carry-forward.json` with target next date and source dream; selected temporary context is rendered to `Brain/carry-forward/<next-date>.md`. This is explicitly temporary and should be revalidated. It is separate from intraday note statuses.
- **Cleanup**: a later Dream is followed about 30 minutes later by a cleanup-only memory solidifier that may remove/dedupe but must not add new memory. Inspect run context and status before assuming a memory write came from cleanup.

Brain runs are session/task-mirrored, persist provider diagnostics/outcomes and use scoped mutation paths. `brain-thought-runtime.ts` validates model-produced schema/enums before touching active-work/capsule artifacts; `brain-continuity.ts` validates carry decisions. Do not bypass these runtime contracts by editing JSONL directly from an unconstrained tool call.

### Audit, learning, and projects

The raw audit log records runtime activity and can be queried by session/type/date; `audit/continuity.ts` offers scrubbed append helpers for session events, messages and tool observations. `materializer.ts` streams bounded records and builds an audit snapshot for analysis. `audit-ops.ts` routes structured query operations through a worker. The audit log is evidence of what happened, but may lag, be rotated, or capture a now-stale state—confirm the live task/session/project before acting.

Project store maps project IDs to workspaces, knowledge roots and project context files. A project can collect sessions and imported resources; helper paths use confined storage resolution. `buildProjectContextBlock()` attaches current project context to the relevant session. `project-learning.ts` extracts project name/goals/people/tools/milestones from session history and updates a dedicated `CONTEXT.md`; review its changes when moving durable memory across project boundaries.

Obsidian bridge stores vault registrations and sync state. `read_only` indexes/reads without writeback, `assisted` permits approved or explicitly requested writeback, and `full` allows configured write operations. The bridge synchronizes notes into the memory index and can write generated notes into the selected vault. Check the current bridge mode and vault root before creating or overwriting external notes.

Learning analytics are not a memory authority: `turn-recorder.ts` records learning-turn/candidate data and computes skill-routing stats; the note/memory flows may be evaluated by separate regressions. Ideas and learning candidates are not consent/approval to implement or post.

## Config & knobs

- Workspace root is selected per session/runtime. Keep all paths workspace-relative via subsystem helpers; never assume the live main workspace is the agent's personal memory root.
- `memory` wrapper limits recall results, accepts `sources`, `date_from`/`date_to`, `project_id`, `source_types`, `min_durability`, and `include_current_chat`. Omitted current-chat flag means exclude current session.
- Recall index uses incremental backfill/dirty-file refresh with bounded slices. Index statistics include availability, files/docs, pending files and backfill completion; a missing/new hit may mean “not yet indexed”, not necessarily “never existed”.
- Structured memory index has a separate maintenance gate, configured search/refresh/storage bounds, and worker lifecycle. Avoid hand-opening or editing its SQLite files while the service is running.
- Intraday notes live at `workspace/memory/YYYY-MM-DD-intraday-notes.md`. Prompt carry duration and character/entry limits are constants/options in `intraday-notes.ts`; inspect them before changing prompt budget.
- Brain Thought/Dream enablement, model/reasoning overrides and outcome timestamps are persisted in Brain state; Dream local clock configuration is read by `BrainRunner`. There is a periodic eligibility check, not an unconditional run on each tick.
- Brain artifact paths: `Brain/state/`, `Brain/thoughts/`, `Brain/dreams/`, `Brain/context-capsules/`, `Brain/active-work.jsonl`, `Brain/continuity/`, `Brain/carry-forward/`, and proposals. Use `ensureBrainDirs()`/state helpers.
- Project workspaces/knowledge path and external-import metadata are owned by `project-store.ts`; use `getProjectWorkspaceDir()`, `getProjectKnowledgeDir()`, `getProjectContextFilePath()`.
- Obsidian `ObsidianBridgeMode` is `read_only | assisted | full`; user vault paths are external state and should be validated by bridge helpers, not concatenated ad hoc.
- Generic memory `write/update` requires category and nonempty content. Search every actor-specific scope before enabling agent access to new files.

## Gotchas / sharp edges

- **Don't make daily notes the permanent memory file.** Use `write_note` for working continuity; use the routed durable memory file/tool for lasting fact/decision/preferences.
- **An unqualified “we discussed this before” needs a memory search.** Use relevant source filters/mode and distinguish no strong match from proof a conversation never happened.
- **Recall excludes the active session by default.** Set `include_current_chat:true` only when looking for current-turn facts; otherwise the query can echo itself and falsely validate a memory.
- **Memory search can be partially available.** A strong lexical answer can stand when the structured index is busy; empty results with incomplete backfill should not be reported as definitive absence.
- **Search result date is not the same as current truth.** Check chronology and source type, especially for project status, account access, provider configuration, routes and schedules.
- **Agent memory scope is a security boundary.** `USER.md`/`SOUL.md` reads and writes from agent/manager runtime should be denied; do not “fix” the denial by widening `resolveMemoryPath()`.
- **Use `update` exact-match semantics carefully.** Category plus exact prior bullet is required; if the source changed, read current file and update the actual bullet rather than duplicating stale text.
- **Explicit note resolves are durable across time.** Pass IDs such as `n_...` in `resolves`; wrong IDs return unresolved. #556 removed the seven-day ceiling for direct ID resolution, but the automatic same-thread supersede scan is still bounded to recent note files.
- **Thread key controls auto-supersession.** Reuse the same stable thread key for one task; an accidental key change leaves multiple open items, while an overly generic key can close another task's current note.
- **Open note prompt priority has a budget.** If many open notes accumulate, inspect the note file or memory search; don't infer from prompt omission that the item is done.
- **Brain activity package is bounded and time-windowed.** A missed run/catch-up cap or rotated audit input can cause a gap; inspect Brain run outcome/window timestamps before using the reflection as complete chronology.
- **Thought is not the Dream.** Thought outputs shouldn't mutate permanent memory; Dream carries that authority. Cleanup may only remove/dedupe; don't add new durable facts there.
- **Carry-forward is temporary.** Revalidate with live evidence before acting, and report a blocked/completed change using a new note so future Brain runs can reconcile it.
- **Active-work JSONL is not a task queue.** Upsert/resolve through Brain contract; it is a source for continuity ranking, not delegated-work authority or automatic user approval.
- **Audit snapshot is not source-of-truth live state.** Query raw audit/continuity or session/project APIs and verify present state before saying an agent/job is still running.
- **Obsidian writeback is external mutation.** Confirm vault + mode and destination before overwriting; `read_only` should never be silently promoted to `full`.
- **Project learned context may be wrong or stale.** It is extracted from session text; review project `CONTEXT.md` and keep client/company facts in their canonical entity/business files.

## How to change it safely

1. Trace the model tool/schema → `memory-executor.ts` → owner store/index → prompt projection. Preserve actor scopes and user/entity/project routing.
2. For notes, run `src/gateway/memory/intraday-notes.regression.ts` and `src/gateway/learning/learning-loop.regression.ts`; cover `open`/`done`/`info`, thread replacement, same-ID resolve and an ID older than seven days.
3. For recall/index, run `recall-index.regression.ts`, `memory-index.regression.ts`, `memory-access-gate.regression.ts`, `memory-search-worker.regression.ts`, `memory-atoms*.regression.ts`, automatic recall/prewarm tests and maintenance tests. Use stress fixtures only with explicit safe resource bounds.
4. For Brain, run `activity-package.regression.ts`, `brain-continuity.regression.ts`, `brain-thought-runtime.regression.ts`, `brain-runner-progress.regression.ts`, `brain-runner-scheduled-chat.regression.ts`, `brain-run-outcome.regression.ts`, `brain-cognition-integrity.regression.ts`, and `brain-dream-memory-contract.regression.ts` as relevant.
5. For audit, run `audit-ops.regression.ts`, materializer + worker + UTF-8 boundary regressions; for project changes run project store/learning regressions. For Obsidian, test mode enforcement, vault-root confinement, duplicate sync and writeback behavior using a temporary vault.
6. Prefer focused regressions from [generated tests](generated/tests.md). Do not run a live Dream, rewrite user memory, mutate an Obsidian vault or trigger project learning in the real workspace as an incidental smoke test.
7. Verify output on disk, actor/session scope, index invalidation/refresh, state timestamps and restart behavior. Regenerate inventories only from the designated source repo maintenance workflow, never by hand.

## Troubleshooting decision tree

### “I remember this, but search found nothing”

1. Rephrase with specific nouns, names, and date range; query lexical `memory(action:"search")` first, then `mode:"deep"` or `project` only if needed.
2. Try a source filter (`transcript`, `note`, `memory`, `idea`) and widen date bounds. A zero-match result means no indexed match for that query—not a broken index and not proof the event never existed.
3. Inspect recall-index stats/backfill if the relevant workspace recently changed or the file was just edited. Dirty-file refresh can take time; a fresh file may be absent from the index briefly.
4. If relevant text was in this same session, remember current session is excluded by default. Use `include_current_chat:true` intentionally.
5. If recall finds a transcript/note but structured memory does not, use the source directly and report its date; don't force a memory write to “fix” search.

### “Open task still appears after completion”

1. Note the visible `n_...` ID and actual status in the dated markdown under `memory/`.
2. Call `write_note(status:"done", resolves:["n_..."])` or use the explicit note ID with resolve helper. Check returned `resolved` vs `unresolved` values.
3. If a newer open note exists on the same thread, resolve that newest ID too. Direct ID resolution checks all dated note files; the prompt carries only recent open notes and same-thread latest wins.
4. Check UTC date note files and `thread` key normalization; prompt section may be omitted for budget even if note remains in storage.
5. Re-render prompt or search notes after the index is marked dirty; do not delete entries to hide them.

### “Brain seems stale, missing, or wrong”

1. Inspect `Brain/state/latest.json` and daily state for run attempt/completion/status/error/recovery; compare coverage-window end with the audit/task timestamps.
2. Verify Thought/Dream enabled flags, last success timestamp, current local time for nightly Dream, and catch-up eligibility. An eligibility tick may choose not to run.
3. Check task mirror/run record and provider diagnostics to distinguish disabled, scheduled, queued, provider error, tool-contract failure, aborted and successful.
4. Confirm expected artifact exists under the configured workspace Brain root: thought markdown, capsules JSON, active-work ledger, Dream output, proposals and carry decision/notes.
5. If Thought artifact exists but ledger didn't change, inspect schema validation/write result in `brain-thought-runtime.ts`; do not manually insert model JSON that failed validation.
6. Before acting on carry-forward, compare its source Dream and target date, then check current tasks/notes/audit for changes since it was generated.

### “Audit and live state disagree”

`audit-log.ts` can rotate raw files and materialized snapshots have their own schedule/bounds. First check timestamp, session ID, event type and freshness of the exact row; then query session/task/project registry for current state. Tool results in audit may show a previous successful action even if the resource was deleted or updated later. Conversely, a missing snapshot row may mean materializer has not consumed the newer raw tail. Preserve scrubbed event detail and query boundaries when reporting a discrepancy.

## Memory source selection table

| Question/fact | First source | Common confusion |
|---|---|---|
| User's durable preference/identity | `USER.md` via `memory(action:"read", file:"user")` or ranked memory search | Do not put every interaction or company fact here. |
| Assistant operating rules/persona | `SOUL.md` / workspace soul | Agent runtime cannot use generic memory file handler to read/write it. |
| Long-term project/company decision | `MEMORY.md` or scoped entity/business/project record | Separate transient work update from a decision intended to persist. |
| Current unfinished job/blocker | `write_note(status:"open", thread:...)` and task/team store | A note doesn't launch/own the task; task state remains authoritative. |
| Completion of a previous open item | `write_note(status:"done", resolves:[id])` | Do not rely on thread supersession when a specific historical ID must close. |
| Captured idea | `memory(action:"ideas")` or recall `source:"idea"` | Idea capture does not mean user approved implementation. |
| What happened in a prior chat | `memory(action:"search")` across transcript/note/memory | Results are ranked evidence and may be stale, incomplete or weak. |
| Reflective summary of last interval | Brain Thought report + activity package | Thought does not make durable-memory writes. |
| Cross-day selected working context | `Brain/carry-forward/<date>.md` with source decision | Temporary reminder; revalidate before reuse. |
| Per-project ongoing context | project workspace `CONTEXT.md` and knowledge refs | Project extraction is heuristic, not canonical client record. |
| What a prior tool/action did | scrubbed continuity log or raw audit query | Audit is not a live resource registry. |
| External research notes in Obsidian | selected vault + bridge state/mode | Vault writeback has external side effects and its own permissions. |

### Retention and change ownership

- `USER.md`, `SOUL.md`, `MEMORY.md` and `BUSINESS.md` are small curated context inputs; minimize duplicates, stale entries and facts that belong in entity/project stores.
- Intraday markdown is chronological. Its `done` entries remain evidence; status changes instead of deleting old text. Search index refresh is an eventual projection of those source files.
- Brain activity packages are intentionally bounded and keep durable state/artifacts in the workspace's `Brain/` tree. Don't create a competing Thought/Dream log or store main persistent agent tasks in `active-work.jsonl`.
- Recall/structured index databases are derived data. If a row is stale, use supported refresh/invalidation/worker APIs rather than hand-editing SQLite.
- Audit raw logs and materializer outputs may be large or rotated. Use `audit-ops`/query APIs with bounded time/session filters; don't copy complete production logs into durable memory.
- Project learning writes `CONTEXT.md` through the project store. Inspect diffs before treating it as a canonical source; promote broadly useful decisions to MEMORY only with a clear reason.
- Obsidian mode is persisted external state. Before changing it, inspect existing enabled vaults and the exact note path; sync can add/remove index entries without modifying local Markdown memory.

## Write-routing decision tree

When a new fact or work update arrives, classify it before choosing a tool:

1. **Is it a fact about Raul or a recurring personal preference?** Add/update a user-profile bullet in `USER.md` under a specific category.
2. **Is it an assistant behavioral rule or long-lived exception?** Put it in `SOUL.md` (operating voice/rule), or in `MEMORY.md` when it is a historical decision/runbook correction. Preserve scope: user preference does not become a product invariant.
3. **Is it about company structure, products, or an entity?** Use `BUSINESS.md` for generic company truths; entity/business tool for client/person/vendor/social-account specifics; project workspace for client/project execution knowledge.
4. **Will it be obsolete when the current task ends?** Write an `info` or `open` intraday note with a concise `thread` key and optional `task_id`; use a durable memory file only if the lesson or decision will matter across future work.
5. **Is a prior open item done?** Resolve its stable note ID in a `done` note, or write a new state on the same thread to supersede prior open state. Don't update the global memory file just to close a daily task.
6. **Was it only an idea or model-generated hypothesis?** Keep it in ideas/candidates or identify it as unverified; don't elevate to durable memory until accepted/evidenced.
7. **Did Brain surface it?** Read the activity evidence and source window first. Thought reflection is not a memory write, and a carry-forward entry is not durable authority.
8. **Does the fact belong to an autonomous agent or manager personally?** Use that actor's own memory scope; do not write the fact into main `USER.md` or Soul from an agent runtime.

### Search before writing

- Search for the fact using aliases/synonyms, names, or project terms to avoid adding duplicates to MEMORY/USER and structured memory.
- Read current file/category or entity/project context before update. Preserve category convention and avoid broad “miscellaneous” accumulation.
- Compare source confidence: direct user statement > system configuration/current source > reported action > generated summary > hypothesis. Store an attribution/qualification when needed.
- Date-sensitive facts should carry a review/expiry condition or remain in notes; stale facts in curated context can misdirect future actions.
- If one update affects both a durable decision and a short-term task, write the durable fact once and link to it in the open note rather than duplicating the full narrative.

## Related

- [08 Agents, tasks & background](08-agents-tasks-background.md) · [09 Teams](09-teams.md) · [10 Scheduling, automations & triggers](10-scheduling-automations-triggers.md)
- [01 Identity & paths](01-identity-and-paths.md) · [03 Prompt assembly & context](03-prompt-assembly-and-context.md) · [05 Tools & categories](05-tools-and-categories.md) · [25 Sharp edges](25-sharp-edges.md)
- [tools inventory](generated/tools.md) · [routes inventory](generated/routes.md) · [test inventory](generated/tests.md) · [merged PR history](generated/changelog.md)
