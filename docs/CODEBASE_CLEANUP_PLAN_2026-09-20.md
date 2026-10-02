# PromSRC cleanup program

Status: proposed implementation plan; this PR changes documentation only.

## Objective and audited baseline

Make the maintained application easier to navigate, change, test, and package. Remove proven dead behavior, complete migrations, and reduce the largest active modules without changing product behavior as an incidental consequence of cleanup.

Audit date: 2026-09-20. Source revision: `7198858f8175f6208f3195deb1b58d44756d1f00`, which matched remote `main` when checked. The application checkout is on `gateway/turn-worker-extraction`; use separate worktrees for cleanup. Other work may continue concurrently, so recheck each candidate against the actual implementation base.

Three parallel investigations covered repository hygiene, active architecture, and verification/build boundaries. Findings are static evidence unless a check is explicitly recorded below. No dead-code scanner result or filename alone authorizes deleting runtime behavior.

| Baseline | Observed value |
| --- | --- |
| Tracked entries | 8,000 |
| `src/` / `web-ui/` / `scripts/` | 847 / 293 / 286 entries |
| `generated/` / `workspace/` | 1,715 / 4,650 entries |
| npm commands / test commands | 197 / 147 |
| Backend regression files | 177 tracked `*.regression.ts` files |
| `ChatPage.js` | 48,084 lines |
| `chat.router.ts` | 23,095 lines |
| `subagent-executor.ts` | 21,694 lines |
| Registered local worktrees | 106; inventory only, no deletion proposed here |

Counts include different file types and some gitlinks; they are navigation measurements, not proof of waste. The earlier initial review preceded a source commit and reported fewer tracked backend files.

Baseline checks actually run:

- `node node_modules/typescript/bin/tsc --noEmit`: PASS.
- `node scripts/test-web-ui-architecture-guardrails.mjs`: FAIL before cleanup:
  - `mobile-chat-renderer-runtime.js`: 248,323 LF bytes vs 245,354 ceiling.
  - `mobile.css`: 608,447 LF bytes vs 607,287 ceiling.
  - `mobile-chat-page-runtime.js`: 435,840 LF bytes vs 433,668 ceiling.
- Full CI, packaging, live providers, and desktop/mobile browser scenarios were not run for this planning PR.

## PR structure and stack policy

Use small independent PRs against `main` for unrelated cleanup. Use short stacks only where a child requires code introduced by its parent. The passes are milestones, not three giant PRs.

1. Give every PR one responsibility and a clearly reviewable handwritten diff. Prefer a few hundred changed lines; a mechanical extraction may exceed this if moves and semantic edits remain distinguishable.
2. Keep stacks to two or three open implementation PRs. Merge bottom-up, then retarget/restack descendants and rerun their checks. Do not force-update another person's branch.
3. Each PR description names its parent, expected behavior, removal evidence, validations, and rollback boundary. Keep generated changes distinguishable from authored changes.
4. Regenerate web assets from canonical source in each relevant PR. Do not resolve generated conflicts by retaining arbitrary historical bundles.
5. First make CI run against cleanup branch bases. `.github/workflows/pr-regression.yml` and `privacy-secret-scan.yml` currently filter PR targets to `main`, so a stacked child targeting `cleanup/*` can miss these checks.
6. Retain existing required checks. Confirm repository rules also cover stacked targets; a workflow trigger change alone does not prove branch protection is configured.
7. A downstream extraction must remove the corresponding implementation from its former owner. Creating another facade or copy is not completion.

Illustrative dependency graph (IDs are planned work units, not existing GitHub PR numbers):

```text
P00 planning document
  P02 restore existing architecture limits -> P01 stack-aware CI
    (foundation changes land on main before dependent stacks)
  Independent hygiene/testing/build PRs -> main
  Feature behavior coverage -> extraction -> migrate callers/remove compatibility
  Backend behavior coverage -> extraction -> migrate callers/remove compatibility
```

## Pass 1: establish boundaries and remove proven leftovers

### P01 — Make cleanup stacks verifiable

Scope: `.github/workflows/pr-regression.yml`, `.github/workflows/privacy-secret-scan.yml`, and an inventory of other workflow triggers.

Allow the chosen cleanup base namespace or all intended PR targets while retaining the existing main push behavior. The storage-layout and mobile-v2 workflows already use PR path filters without PR branch restrictions; preserve that distinction. Review the regression workflow's `contents: write` permission and reduce it to read if no step requires writing. Keep ordinary `pull_request` semantics. Document which checks are required on every stack level. Record pre-existing baseline failures distinctly from new failures; do not skip them or label the current baseline green.

Acceptance: a real child PR targeting a cleanup branch triggers the expected checks; bottom and child PRs retain equivalent relevant checks. Merge this prerequisite before opening implementation stacks. Validate workflow syntax and event filters, then inspect actual GitHub runs.

### P02 — Restore architecture guardrails without expanding budgets

Scope: the three over-budget mobile files and their existing feature owners.

Use focused, behavior-preserving extraction or proven duplication removal to bring each file below its existing ceiling. Keep selector order/specificity and runtime state ownership intact. Prefer one coherent mobile-feature reduction that brings all three budgets back under their limits. If independent extractions are necessary, compose and validate the baseline-repair changes before treating the merge gate as green. Do not achieve a line/byte target through minification, reformatting, or moving an entire monolith into an equally opaque new file.

Acceptance: architecture guard passes at the unchanged ceilings; relevant mobile tests and source/generated sync pass; browser checks cover the affected feature. Record before/after LF bytes and explain the resulting responsibility boundary.

Scheduling note: P01 and P02 are the first foundation work. The baseline restoration may need to land before P01 can pass the unchanged full regression workflow. P01 must land before dependent cleanup stacks are used. Do not waive the architecture check to merge unrelated cleanup.

### P03 — Remove temporary request diagnostics

Evidence: `src/providers/anthropic-adapter.ts:721-732` unconditionally emits an `[anthropic-debug]` request summary, including the first 60 characters of the first system block. The nearby request-failure record is a distinct diagnostic path.

Remove the temporary preview logger or place a redacted version behind an explicit debug option. Preserve request IDs, failure classification, and existing failure diagnostics. Inspect other logging by purpose; do not blanket-delete `console.*` calls, including already flag-gated realtime diagnostics.

Acceptance: normal successful requests emit no prompt preview; failure diagnostics remain useful; provider request construction and streaming behavior are unchanged. Use mocked requests and log capture rather than a paid provider call.

### P04 — Separate production compilation from regression artifacts

Evidence: `tsconfig.json` includes `src/**/*` and only excludes `*-legacy.ts` in addition to dependency/output directories. Both desktop package configurations include `dist/**/*`; the public package excludes maps/declarations but does not explicitly exclude regression JavaScript.

The verification audit found 780 test-suffixed output files (JavaScript, maps, and declarations, approximately 2.23 MB) in the existing local `dist`. This is a local-output measurement, not an inspected release archive. `Dockerfile` also copies the builder's `dist` into the runtime image, so its build boundary needs review alongside Electron.

Confirm the actual emitted and packaged file inventory, then introduce a production build boundary while retaining type-checking for tests. Account for stale output from earlier builds: exclusion from a new compiler invocation does not remove old regression files from `dist`. Check whether any runtime code imports a test-marked helper before excluding it, and move shared production utilities to an appropriate owner.

Acceptance: an isolated clean production build contains no test-only entrypoints/fixtures; test type-checking still includes them; public/private app startup and the affected packaging verification pass. Never clean the application's live `dist` directory to test this change.

Separate Docker follow-up: `Dockerfile:13-19` runs `npm ci` before copying `scripts/postinstall.js`, then invokes the root build after copying only `src` and `tsconfig.json`. Current npm build commands also need `scripts/`, `web-ui/`, and generated/build inputs. The runtime dependency install has the same lifecycle-script concern. This is a static build-input mismatch, not a reproduced Docker failure. Repair the stage inputs/lifecycle policy in its own PR and validate with a clean Docker build; do not hide it by describing an untested image as verified.

### P05 — Make tests discoverable and lint useful

Inventory tests into deterministic behavior, architecture contract, browser, integration, benchmark, and live-service groups. Preserve individual commands while adding a small set of documented aggregate commands and an explicit record for intentionally manual tests. Review indirect runners before calling a test orphaned. Introduce a suite manifest only if CI and local commands consume the same inventory; avoid creating another disconnected list. Discovery checks should require a group or an explicit manual/platform-specific rationale, not blindly execute every test in one job.

`scripts/test-background-agent-side-chat-contract.mjs` illustrates a mixed test: it executes behavior and checks source text. `scripts/test-mobile-composer-launcher.mjs:75-76` requires a particular nested animation-frame expression; a behavior test should instead demonstrate the required final scroll anchoring. Preserve architectural prohibitions, but replace source-shape assertions with observable behavior coverage as the corresponding feature is extracted. Do not delete tests simply because they use regexes. Public skill privacy checks, browser security/package contracts, and mobile CSS ownership checks protect meaningful invariants.

The current ESLint config has `rules: {}` and the lint script targets backend TypeScript. Enable a small useful rule set on owned/changed surfaces first, then expand to frontend and Electron. Do not turn on a repository-wide strict ruleset and hide the resulting debt with blanket disables.

Acceptance: documented test groups resolve to real tests; no existing required check silently disappears; newly extracted modules have useful unused-symbol checks; at least one selected mixed test becomes less coupled to source layout while retaining behavior coverage. Split test inventory and lint rollout into independent PRs.

### P06 — Clarify repository, generated, and workspace ownership

Evidence: `.gitignore` explicitly keeps portions of the personal workspace tracked for synchronization. `electron-builder-public.yml` consumes `generated/public-web-ui`, and PR CI regenerates assets and checks the diff. Architecture tests also reference documentation in `workspace/self/`.

Classify tracked entries as maintained source, generated deliverable, reusable asset, fixture, personal project, historical document, or runtime artifact. Add navigation guidance and generated-file review treatment where appropriate. Move authoritative engineering documents into `docs/` only with their consumers and links updated. Historical reports can remain available with clear archival status.

Acceptance: canonical edit locations and build commands are explicit; moved documents have no dangling references; release inputs and workspace synchronization continue to work. Removing generated output from Git is a separate build-system proposal requiring reproducibility evidence. Moving personal projects out of this repository is a separate ownership decision, not part of automatic deletion.

Concrete hygiene PRs (independent unless a dependency is stated):

| ID | Scope and evidence | Exit criteria / dependency |
| --- | --- | --- |
| H1 | Remove `workspace/Trash - Investigation folder/` (13 tracked files: old investigation outputs, temporary scripts, duplicate library, OS metadata) and `workspace/self/.DS_Store`. Audit found no references outside the trash folder. | Review the exact deletion list; repeat reference search across tracked code/docs/build scripts; confirm no active consumer. Source behavior tests are unnecessary for inert artifacts. Keep any historical material deliberately retained in the inventory. |
| H2 | Retire old one-time skill migration scripts listed below. No maintained source/docs/CI/package basename consumers were found by the audit. | Establish whether a script is still a manual tool; archive/document retained procedures or delete completed one-shot tools. Lack of an npm command alone is insufficient. |
| H3 | Relocate the tracked `workspace/tools/xurl-local/node_modules/` dependency, including its roughly 13.1 MiB binary. `src/gateway/routes/connections.router.ts:51` actively uses it. | Implement install/cache resolution and repair in the runtime-owned location, test fresh and existing installations plus failure recovery, then remove the tracked dependency. Installation migration -> caller migration -> tracked-tree removal. |
| H4 | Reconcile `workspace/self/Legacy self.md/SELF.md` with split self-documentation. The index explicitly retains the historical monolithic copy today. | Compare coverage, establish the authoritative documents, update synchronization/links, then archive or remove the duplicate. No automatic deletion based on its name. |
| H5 | Classify workspace projects, outputs, and source assets; reconcile generated-output ownership documentation. | Preserve current private synchronization and release behavior. Any repository split or move to CI generation is a separately reviewed migration with rollback. |

H2 candidates: `apply-hyperframes-skill-routing.mjs`, `apply-skill-health-phase1.mjs`, `apply-skill-phase2c-2d.mjs`, `consolidate-dated-skill-resources.mjs`, `copy-skill-body-reference.mjs`, `normalize-skill-frontmatter.mjs`, `normalize-skill-manifests.mjs`, `preserve-skill-details.mjs`, `set-skill-lifecycle.mjs`, and `write-final-skill-classification.mjs`, all under `scripts/`. These remain candidates, not established safe deletions.

Retain unreferenced but plausible operational tools such as `mint-realtime-key.ts`, `export-html-motion-mp4.js`, `monitor-gateway-resources.ps1`, and `watch-gateway-exits.ps1` until their manual-use ownership is resolved. Generated output currently comprises 1,291 bundled-skill entries and 424 public-web entries; both have active build/verification consumers.

## Pass 2: finish migrations and remove compatibility layers

Use `web-ui/src/features/chat/OWNERSHIP.md` as a starting map, then verify every stated migration against code. Some entries are planned rather than implemented.

For each seam: list live consumers, specify the canonical owner, cover behavior, migrate consumers, then remove the old entrypoint and obsolete source-layout tests. No removal is complete while the same implementation survives in another page or a generated source copy.

Known active examples:

- `web-ui/src/background-agent-work.js` is a compatibility re-export; `ChatPage.js` and `mobile-pages.js` still import it. A small migration/removal PR is possible after checking all build/test consumers.
- `src/extensions/legacy-connector-adapter.ts` performs active extension loading and X/xAI status initialization despite its name. A rename/responsibility clarification may be justified; deletion is not.
- `src/connections/runtime.ts` calls `migrateLegacyConnections`; stored-account migration behavior must remain until retirement criteria are met.
- `web-ui/src/desktop-entry.js` imports `legacy-desktop-bootstrap.js`; this remains part of application startup.

### G1 — Retire unreachable gateway orchestration and file-op plumbing

This is the strongest substantial deletion candidate. `chat.router.ts:272-285` has null/empty orchestration stubs, `:359-364` disables configuration/eligibility/preflight, and `src/gateway/skills-runtime/skill-windows.ts:27-29` always disables the retired orchestration skill. The router's `:1727-1759` contains a similar retired file-op watchdog/classification/verification layer. A trigger is still instantiated around `:4716` and many branches remain through approximately `:10012`.

First trace every guard, argument evaluation, helper, and fallback; delete code proven unreachable under the actual constant implementations. Do not treat all nearby functions as no-ops: file-mutation classification and target extraction helpers still perform real work. Preserve any reachable local fallback, recovery operation, screenshot/tool dispatch, and progress behavior unless deliberately changed in a separate fix.

Preserve the observable disabled response for `request_secondary_assist` (`chat.router.ts:9614-9685`) and `/api/status`'s `orchestration: null` field (`:12178-12210`) until tool advertisements and external consumers are explicitly migrated. `task-store.ts`, `tasks.router.ts`, and `background-task-runner.ts` still persist `orchestrationLog`; do not remove stored fields in this deletion PR. Follow references through `chat/chat-helpers.ts:1351-1368`, skills initialization, and the no-op setter in `routes/skills.router.ts`.

Validation: type-check; normal chat/tool/continuation/restart behavior; `test:main-chat-stream`, `test:background-agent-steering`, relevant agent/route contracts, and an explicit check that the retained disabled/status responses remain compatible. Repeat caller searches after removal. Target a reduction in router complexity; record actual removed lines rather than promising a speculative amount.

### W0 — Close a small compatibility re-export

Migrate all consumers of `web-ui/src/background-agent-work.js` to its existing canonical feature module, update the contract tests and generator expectations, then remove the re-export. This is independent of deeper UI restructuring if its consumer inventory is complete.

Validation: background-agent reducer/stream/side-chat checks and source/generated parity. No UI behavior change is intended.

### W1 — Finish question views and projections

The question model, controller, and desktop/mobile transports already exist; do not repeat that extraction. Remaining desktop draft/pending/render logic is around `ChatPage.js:14809`, `:14863`, `:16652`, `:16672`, and `:44413`; mobile normalization/draft logic remains around `mobile-pages.js:8024`, with rendering in `mobile-chat-renderer-runtime.js:1089`.

Create the intended desktop/mobile question views and composer host/adapters, migrate duplicate normalization/rendering, and retain the legacy session projection until its consumers are gone. Keep state authority in the existing question controller/runtime. Include a before/after consumer map.

Validation: `test:chat-question-controller`, `test:desktop-question-composer`, question session-isolation and resume-transport-error tests, mobile question contracts, and browser scenarios covering answer, skip, cancel, reconnect, and session switching. This may provide the coherent mobile reduction needed by P02; if so, track one implementation rather than duplicate the work.

### W2 -> W3 — Importable desktop surface, then composer clone removal

W2 introduces an importable chat-surface owner and migrates `SubagentsPage.js:1891-1895`, `TeamsPage.js:2479-2490`, `prom-bot-collab.js:343-346`, and `prom-bot.js:308` away from dynamic page imports/global fallback. Audit Teams' other global consumers (`:2565-2591`, `:4756-4767`) and the global installer in `ChatPage.js:45015` before deleting it. Keep optional features lazy.

W3 depends on W2: mount the canonical composer through surface adapters, then remove cloning/replacement (`canonical-desktop-composer.js:298-344`) and the document-wide mutation observer (`:357-375`). Preserve attachment state, IDs/handlers still required by consumers, draft isolation, focus/selection, model selection, voice controls, and listener disposal.

Validation: main/subagent/team/Prom Bot composer contracts; multi-chat isolation; browser tests for send/stop, attachments, question transitions, surface switching, focus, and teardown. Detect duplicate listeners and duplicate sends. W1 is a prerequisite only if W2/W3 consume its newly extracted question host; do not create an artificial dependency otherwise.

### W4 -> W5 — Tool activity model, then surface-specific views

Extract normalized lifecycle/descriptors into a feature owner. Keep `optional/tool-activity-runtime.js` as the lazy facade while consumers migrate. Then move desktop and mobile grouping/rendering in independently reviewable view slices. Remove old implementations only after parity, and reduce the mobile renderer's roughly 124 injected context dependencies as responsibilities leave it.

Validation: tool start/progress/result/error/abort, out-of-order or replayed events, reasoning visibility, reconnect, stream grouping, and existing performance budgets. Do not eagerly load optional creative/tool code as a side effect of extraction. Run relevant tool-activity contracts and actual desktop/mobile streaming scenarios.

## Pass 3: reduce large active modules by responsibility

Prioritize boundaries that already have canonical owners: question lifecycle/views, composer behavior, tool activity, runtime adapters, and backend capability execution. Preserve desktop/mobile differences where they represent intentional interactions.

Every extraction PR must state:

- Which responsibility leaves the old file and where it lives afterward.
- Who owns state and lifecycle cleanup, including cancellation and listener disposal.
- Which callers change and which compatibility exports remain temporarily.
- How the handwritten implementation shrinks rather than merely spreading duplication.
- Which deterministic behavior tests and real UI scenarios demonstrate parity.

Keep gateway restart/handoff, stream cancellation, task continuation, auth, and storage ownership changes separate from mechanical cleanup. These are sensitive behaviors with active development. Recheck the current base before touching their shared files.

### G2 — Extract one remaining subagent capability family

The existing capability registry (`agents-runtime/capabilities/registry.ts:15-56`) and dispatch (`subagent-executor.ts:5596-5605`) provide a usable boundary. Seven family executors already exist; the remaining large switch and broad `ExecuteToolDeps` (`:533-584`) should be reduced one family at a time.

Before selecting the first family, inventory its actual remaining cases, shared context, approval/policy checks, evidence handling, and tests. Browser/desktop or workspace/source tools are candidates, not predetermined deletions. Extract one bounded family with a narrow context and preserve dispatch/approval semantics. Validate allowed and denied cases, cancellation, error normalization, tool-surface parity, and evidence delivery. Later families repeat this pattern after the first is proven.

### Deferred architecture decision: dormant execution contract

`runtime/execution-contract.ts` and `execution-controller.ts` have a regression consumer but no production adopter found by the audit. `docs/universal-execution-runtime.md` explicitly describes an intended migration with BackgroundTaskRunner first. Decide whether to keep it as scheduled architecture work or retire the unused scaffold; do not silently turn cleanup into a full-turn worker rewrite.

If adopted, give it a separate functional PR requiring stable execution IDs, incremented attempt IDs, and unchanged retry/restart/mutation-safety behavior. Coordinate with the active `gateway/turn-worker-extraction` work before touching these files. This is outside the initial behavior-preserving cleanup queue.

## Execution queue and review checkpoints

1. **Foundation:** P02 baseline restoration (potentially the mobile part of W1), P01 stack-aware CI. Keep the first implementation changes directly based on current `main` until CI support lands.
2. **Early independent wins:** H1 tracked trash, P03 temporary logger, W0 re-export closure, and G1 unreachable gateway code. Each is a separate PR; avoid concurrent writers in shared files.
3. **Maintainability/build lane:** P05 test inventory, P04 production compilation, its separate Docker repair, then incremental lint and selected test modernization. Production compilation can start independently of the manifest; test modernization should use the established test groups.
4. **UI stacks:** W1 question closure as needed; W2 -> W3 for desktop surface/composer; W4 -> W5 for tool model/views. Keep a maximum of two or three open dependent PRs in any lane.
5. **Subsequent scope:** G2 one capability family; H2 manual-tool decisions; H3 binary install/cache migration; H4 documentation consolidation; H5 workspace/generated policy. Re-estimate after the early PRs reveal actual dependency and verification costs.

P00 is this planning PR. All other IDs are proposed units, not opened implementation PRs. Some named areas intentionally split into several PRs; this is a sequenced backlog, not a promise to finish the entire codebase in three changes. No dependable completion date can be inferred from file counts alone.

After each wave, update this inventory with the PR URL, merged SHA, removed callers/files, measured legacy-byte reduction, validation result, and remaining blockers. Treat a candidate as complete only when the old implementation is removed and its replacement is demonstrably in use, or when the evidence establishes that no replacement is needed.

## Existing work and exclusions

- Open PR [#375](https://github.com/XposeMarket/PromSRC/pull/375) changes transactional compaction and removes a separate obsolete compaction path. Do not duplicate that deletion or silently fold its functional change into cleanup. Reconcile the base before extracting nearby session/context logic.
- Open historical PRs [#142](https://github.com/XposeMarket/PromSRC/pull/142) and [#145](https://github.com/XposeMarket/PromSRC/pull/145) are feature work, not cleanup dependencies. Old local branches/worktrees are not evidence that an implementation is current or should be revived.
- Do not remove desktop/mobile versions, personal workspaces, migration readers, tests, generated deliverables, or vendored libraries solely because they look old or duplicated.
- Do not delete worktrees/branches as part of this code cleanup. Any later inventory must check dirty files, unique commits, active processes, and ownership first.
- Do not publish a release or merge PRs automatically as part of this planning task.

## Validation and completion

Each implementation PR reports its actual base SHA, focused checks, pre-existing failures, authored/generated diff, and limitations. Run full required CI before merge. A docs-only plan does not claim runtime or package validation.

Frontend changes require source/generated parity, the architecture guard, affected contract/behavior tests, and browser verification for the changed desktop/mobile flow. Preserve lazy loading and existing performance thresholds. CSS moves preserve cascade order before any visual simplification is considered.

Backend changes require production and test type-checking, targeted behavior regressions, and relevant integration contracts. Use temporary fixtures for stateful tests. Packaging changes additionally require a clean staged build, archive inventory, and supported-platform smoke verification; a Windows check cannot certify macOS packaging.

Program completion means the agreed candidate inventory is resolved, the selected old seams have no remaining callers, extracted features have one authoritative owner, production packages exclude test-only artifacts, required checks are passing, and the maintenance guide identifies canonical locations and verification commands. File counts alone are not success criteria.

Rollback is per PR. Revert a dependent stack in reverse order if necessary; retain data compatibility until its explicit migration contract allows removal.
