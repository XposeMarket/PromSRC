# Web UI component ownership refactor program

Status: approved for execution after the prerequisite PR is reviewed. This document is the handoff contract for the supervising GPT-5.6 Sol High thread and the implementing GPT-5.6 Luna Max thread.

## Outcome

Make every recognizable chat UI concept have a nameable source owner without changing frameworks or regressing the runtime/performance work already completed.

After the program:

- question changes start in `features/chat/questions/`;
- tool-stream changes start in `features/chat/tools/`;
- composer changes start in `features/chat/composer/`;
- message row changes start in `features/chat/messages/`;
- generic anchored popover behavior starts in `ui/popover/`;
- `ChatPage.js`, `mobile-pages.js` and the mobile renderer are orchestration/compatibility layers rather than implementations;
- feature CSS is colocated with its owner while mobile/global styles retain only shell and legacy compatibility rules.

The source lookup contract lives in `web-ui/src/features/chat/OWNERSHIP.md`.

## Non-goals

- No React, Vue or other framework migration.
- No visual redesign combined with structural extraction.
- No requirement that desktop and mobile use identical DOM.
- No bundler migration.
- No transcript virtualization in this program.
- No automatic merges or auto-merge configuration.

## Baseline captured from main

Canonical LF byte sizes at `b483de8f`:

| Surface | Bytes | Lines | Program role |
|---|---:|---:|---|
| `web-ui/src/pages/ChatPage.js` | 2,331,725 | 48,292 | Legacy desktop composition root |
| `web-ui/src/mobile/mobile-pages.js` | 892,023 | 18,057 | Legacy mobile route owner |
| `web-ui/src/mobile/mobile-chat-renderer-runtime.js` | 176,072 | 3,615 | Legacy mobile renderer/orchestrator |
| `web-ui/src/styles/mobile.css` | 577,919 | 17,747 | Legacy mobile style bucket |
| `web-ui/src/styles/components.css` | 281,178 | 10,164 | Legacy component style bucket |
| `web-ui/src/features/chat/canonical-desktop-composer.js` | 8,480 | 216 | Composer migration bridge |
| `web-ui/src/styles/mobile-composer-stack.css` | 16,326 | 439 | Existing positive CSS ownership example |

The mobile static chat closure is 831,463 raw bytes / 249,939 gzip bytes across 22 modules. Its 250,000-byte test ceiling has 61 bytes of headroom. Refactors must shrink or preserve this measurement; raising the ceiling is not an accepted migration technique.

The mobile renderer currently accepts 114 context dependencies. The prerequisite ratchet prevents that boundary from growing.

## Ownership architecture

```text
page / route composition root
  -> timeline controller + surface timeline view
    -> message row view
      -> feature presenters
        -> questions
        -> approvals
        -> tools
        -> media/artifacts
        -> message actions

composer surface adapter
  -> composer controller
    -> draft / attachments / commands / send-stop state
    -> surface-specific desktop or mobile view

feature controller
  -> ChatRuntime narrow reads/subscriptions
  -> desktop/mobile transport adapter
```

State contract:

- Gateway/backend remains durable cross-device truth.
- `ChatRuntime` is the renderer authority for per-session history, questions, approvals and stream state.
- Feature controllers own transitions and commands.
- Transport adapters own endpoint and resume differences.
- Views own DOM and local focus/draft details only.
- Legacy page/session state is a one-way compatibility projection until removed.

## PR sequence

### PR 0 — Component-ownership prerequisites

Branch: `codex/chat-component-ownership-prereqs`

Scope:

- Add this execution plan and `features/chat/OWNERSHIP.md`.
- Ratchet all five mega-surfaces to current sizes.
- Add a 150 KB ceiling for modules under `features/chat/`.
- Prevent chat feature modules from importing page owners.
- Prevent the 114-dependency mobile renderer context from growing.
- Repair background-agent and composer-stack tests that still inspect the pre-extraction file location.
- Add the canonical `npm run test:web-ui-architecture` command.

No product behavior or presentation changes.

### PR 1 — Question domain and controller

Create:

```text
web-ui/src/features/chat/questions/
  question-model.js
  question-controller.js
  desktop-question-transport.js
  mobile-question-transport.js
```

Move and test:

- normalization and field aliases;
- five-question/eight-option limits;
- single-select, multi-select and text answer payloads;
- required-answer validation;
- composer target selection and general-other fallback;
- pending/submitting/answered/cancelled transitions;
- local-record preference, submit/cancel and resume-prompt coordination;
- idempotent duplicate WebSocket events and session targeting.

Existing cards and CSS remain in place. Both page implementations call the shared model/controller. Make `ChatRuntime.questions` the writable renderer authority while maintaining a one-way compatibility projection to legacy history.

Acceptance:

- pure Node tests cover every answer mode and lifecycle;
- existing question-suspension gateway test passes;
- no presentation changes;
- desktop/mobile duplicate behavior code shrinks;
- affected ratchets move down.

### PR 2 — Question views, composer host and CSS

Create surface-specific views plus a feature-owned placement policy:

```text
questions/
  desktop-question-view.js
  mobile-question-view.js
  question-composer-host.js
  questions.desktop.css
  questions.mobile.css
```

Move pending/completed transcript policy out of broad message renderers. Pending questions render once in the actionable composer host; completed questions render in history.

Acceptance scenarios:

- draft, focus and caret survive transcript reconciliation;
- session switching restores the correct pending question;
- pending question submission intercepts normal composer send;
- attachments retain current submission restrictions;
- optimistic mobile submitting state remains duplicate-free;
- answered/cancelled cards remain readable in history;
- desktop/mobile/theme screenshots show no unintended visual change;
- CSS is loaded in the original cascade position before any specificity cleanup.

### PR 3 — Importable desktop chat surface

Create an importable desktop chat surface owner for history, live message, composer and live trace rendering.

Migrate Subagents, Teams, side chat and Prom-bot callers away from dynamically importing `ChatPage.js` for `window.__PROM_UNIFIED_DESKTOP_CHAT`. Retain a compatibility global only while remaining callers need it.

Acceptance:

- secondary chat surfaces no longer import `ChatPage.js` as a rendering library;
- existing desktop subagent/team tests pass;
- no eager bundle regression;
- `ChatPage.js` ratchet decreases.

### PR 4 — Tool model and descriptor registry

Move `tool-activity.js` under `features/chat/tools/` while preserving the optional facade. Split lifecycle/coalescing, edit statistics, command process behavior and normalized descriptor-family matching.

Use ordered family matchers rather than a raw exact-name object so aliases and sub-actions retain their current labels.

Acceptance:

- tool lifecycle, edit-stat and optional-ownership tests pass;
- stale-chunk retry and lazy loading remain intact;
- generic fallback covers unknown tools;
- no tool feature enters the eager mobile closure unexpectedly.

### PR 5 — Desktop/mobile tool stream views

Create shared trace grouping/model behavior and separate desktop/mobile stream views. Move live/completed disclosure and keyed patch behavior only where semantics match. Move tool CSS without reordering the cascade.

Acceptance:

- working -> grouped tool calls -> final answer sequence is unchanged;
- live-to-completed drawer transitions preserve expansion state;
- command terminal output and edit counts remain correct;
- alias families and unknown fallback render on both surfaces;
- mobile static gzip stays at or below the preceding branch;
- desktop/mobile page and CSS ratchets decrease.

### PR 6A — Composer foundation and main surfaces

Create shared composer model/controller, attachment owner and separate desktop/mobile views. Mount the main desktop composer through the new owner while preserving compatibility IDs, inline handler contracts and transport behavior. Migrate mobile behavior only where it is genuinely shared.

Acceptance covers draft persistence, attachment transfers, paste/drop, slash and skill selection, voice, send/stop, focus, IME/keyboard behavior, mobile safe areas and streaming state.

### PR 6B — Secondary composer adapters and clone removal

Create adapters for main, subagent, team and side-chat transports. Migrate every secondary surface to mount the actual composer view. Remove the `canonical-desktop-composer.js` clone/MutationObserver bridge only after all callers are migrated.

Acceptance:

- secondary composers retain attachment, model, send/stop and focus behavior;
- no caller clones the main composer DOM;
- no secondary page loads `ChatPage.js` for composer markup;
- compatibility globals are removed only when unused.

### PR 7 — Message row composition and renderer decomposition

Create `messages/` owners for the row shell, user view, assistant view and actions. Compose questions, approvals, tools, media, file changes and other rich content through narrow feature presenter interfaces.

Move one vertical slice at a time out of `_renderChatMessageHtml()`. Timeline modules continue to own keys, ordering, scroll and reconciliation.

Acceptance:

- settled row identity and live row replacement remain deterministic;
- question/tool/approval lifecycle decisions are absent from the broad renderer;
- renderer context dependency count decreases in every extraction PR;
- mobile authority, recovery, lifecycle telemetry and keyed timeline tests pass.

### PR 8 — Anchored popover primitive and CSS closure

Create `web-ui/src/ui/popover/anchored-popover.js` for positioning, collision, Escape, outside press, focus return and disposal. Migrate only genuinely similar anchored model/slash/context surfaces. The question composer host remains question-owned.

Complete the feature CSS moves, then perform specificity simplification in a separate commit/PR if visual proof supports it.

### PR 9 — Program closure

- Remove dead compatibility facades and globals.
- Verify ownership documentation matches the final tree.
- Tighten every legacy ratchet to its final value.
- Record before/after raw, gzip, line and dependency measurements.
- Run the complete verification matrix.

Do not turn program closure into another feature/refactor bucket.

## Required verification

Every PR:

```text
npm run check:web-ui
npm run test:web-ui-architecture
node scripts/test-chat-core-contract.mjs
node scripts/test-shared-chat-runtime.mjs
node scripts/test-keyed-chat-timeline.mjs
node scripts/test-mobile-chat-renderer-ownership.mjs
node scripts/test-mobile-chat-renderer-authority.mjs
node scripts/test-mobile-chat-runtime-authority.mjs
```

Run affected suites in addition:

- Questions: `node scripts/test-prometheus-question-suspension.mjs` plus new question model/view tests.
- Tools: tool activity stream/edit-stat/optional-ownership suites.
- Composer: desktop subagent chat, mobile composer stack, voice, attachment and keyboard tests.
- Message/timeline: mobile recovery, lifecycle telemetry, keyed reconciliation and performance benchmarks.
- CSS: source/generated parity, mobile CSS ownership and desktop/mobile/theme screenshot review.

`npm run check:web-ui` must be run after any canonical source change. Generated output is updated only through the repository generation command; it is never hand-edited.

## PR and branch protocol

Nothing in this program is merged by an agent.

1. Work exclusively in worktrees below `C:\Users\rafel\promsrc-pr`; never edit `C:\Users\rafel\PromSRC`.
2. PR 0 targets `main`.
3. While PR 0 is unmerged, PR 1 branches from PR 0 and targets `codex/chat-component-ownership-prereqs`.
4. Dependent work is opened as a transparent stacked PR targeting the immediately preceding branch. Independent work may target `main` only when it does not duplicate prerequisite changes.
5. Open a draft PR once a coherent review unit and its tests exist. Include dependency/base information in the body.
6. Never merge, enable auto-merge, force-push shared review branches, or rewrite an opened PR branch without explicit user approval.
7. One architectural concern per PR. Keep behavior/visual changes separate.
8. Every PR body lists moved owners, compatibility seams retained/removed, ratchet deltas, raw/gzip impact, and exact test commands/results.

## Sol/Luna execution protocol

The GPT-5.6 Sol High thread is the supervisor, not the primary implementer.

Sol must:

- create a GPT-5.6 Luna Max task thread with this document as its execution contract;
- require Luna to create and use dedicated worktrees under `promsrc-pr`;
- record the Luna thread ID and monitor it with thread inspection at meaningful checkpoints;
- review each diff, dependency direction, test output, bundle measurement and draft PR before Luna advances;
- send corrective follow-ups when a PR mixes concerns, changes visuals unintentionally, grows a protected surface, raises a performance ceiling or touches the live checkout;
- keep a checklist of PRs, branches, bases, URLs, tests and unresolved risks;
- never merge or enable auto-merge;
- stop Luna and request user input if safe continuation requires destructive history changes, merging, a product-design decision or materially broader authority.

Luna must:

- implement the plan sequentially in review-sized branches/worktrees;
- report before editing, after tests and after opening each draft PR;
- preserve unrelated work and generated-source discipline;
- wait for Sol's review before beginning the next dependent PR;
- finish the full program unless blocked by a decision reserved for the user.

The supervisor may make a small corrective commit only when necessary to protect safety or unblock verification; it should otherwise steer and review Luna rather than duplicating implementation.

## Completion definition

The program is complete only when all PRs are open for user review, no PR is merged, required tests pass, performance ceilings are preserved or improved, ownership documents match the code, and the legacy mega-files are demonstrably orchestration/compatibility layers with reduced ratchets.
