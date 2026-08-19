# Web UI architecture and performance review — 2026-08-19

## Scope

This review compares the current Prometheus web/mobile frontend against two current reference implementations:

- **T3 Code** — `pingdotgg/t3code` at `3b8e7bbbe0c49b00630f0c89e931056df679a650`
- **Hermes Agent** — `NousResearch/hermes-agent` at `395c70d616f6426e990632ff8b57cf1e9499702f`
- **Prometheus** — `XposeMarket/PromSRC` at `c2c51978d80a5c1c922b418dabf92aa32a618374`

The goal is not to copy React, React Native, Vite, nanostores, Effect Atom, or any other framework. The goal is to identify the architectural and performance invariants that make those products easier to extend and harder to regress, then apply the same principles to Prometheus's existing ES-module frontend.

## Executive summary

Prometheus has already made important progress: page modules exist, several meaningful components have been extracted, creative dependencies are lazy-loaded, Settings and Connections can load dynamically, client performance marks exist, and there is a Playwright performance benchmark. The problem is that the core chat surfaces still predate those patterns and now act as application-wide coordination layers.

The highest-risk legacy files on this baseline are:

| File | Baseline bytes | Problem |
| --- | ---: | --- |
| `web-ui/src/pages/ChatPage.js` | 2,424,866 | Desktop chat rendering, streaming, browser/canvas, creative state, sessions, voice, tools and persistence share one ownership boundary. |
| `web-ui/src/mobile/mobile-pages.js` | 1,987,275 | Multiple mobile pages and chat behavior share one module. |
| `web-ui/src/styles/mobile.css` | 586,774 | Mobile feature styles, component styles and overrides share one cascade surface. |
| `web-ui/index.html` | 564,863 | App shell, boot compatibility logic and substantial static feature markup remain coupled. |

The correct migration is **not** a single rewrite. It is a ratcheted decomposition with behavior and performance proof at each step.

T3 Code is the stronger reference for **shared client/runtime architecture, narrow reactive state, warm-state retention and transcript virtualization**. Hermes is the stronger reference for **feature/component ownership, state authority rules, shared assistant UI primitives, hot-path discipline and performance-regression infrastructure**.

Prometheus should combine those lessons:

1. Keep page modules as orchestrators, not feature implementations.
2. Give recognizable UI concepts explicit owners (`ApprovalCard`, `MessageTimeline`, `Composer`, `ToastHost`, etc.).
3. Separate shared chat behavior from desktop/mobile presentation.
4. Move shared mutable state away from broad `window.*` ownership into small feature stores/controllers.
5. Window long transcripts and load older history incrementally.
6. Coalesce cosmetic stream deltas to a frame-sized cadence while flushing terminal state transitions immediately.
7. Retain recently visited thread detail for a bounded period instead of keeping all detail hot forever or cold-starting every navigation.
8. Turn performance measurement into a regression gate with realistic workloads and committed baselines.
9. Keep expensive stateful surfaces alive when hidden when reinitialization is more expensive than retention.
10. Prevent the existing god-files from growing while the migration proceeds.

## Prometheus current state

### What is already good

Prometheus is not starting from zero.

- `web-ui/src/performance.js` records privacy-safe timing marks in a bounded in-memory ring and exposes them to the benchmark harness.
- `scripts/benchmark-performance.mjs` already measures browser navigation, FCP, resource weight, API timing, route changes and a synthetic SSE chat path.
- `index.html` demand-loads CodeMirror, Iconify, Lottie, Fabric/GIF assets and dynamically imports Settings and Connections.
- `ChatPage.js` demand-loads the creative feature runtime and Hyperframes feature instead of eagerly initializing every creative dependency.
- Existing extractions such as `ProcessRunCard.js`, coding diff rendering, tool activity and reasoning/model controls demonstrate that the current vanilla-module stack supports real component ownership.
- Source/generated public-web parity is already enforced in CI.

These are foundations to preserve, not replace.

### Structural debt

`ChatPage.js` describes itself as owning sessions, chat send/SSE, message rendering, process logs, progress, agent execution, canvas, upload and queued prompts. Its initialization also reaches into terminal/channel sessions, browser canvas state, creative state, side chats, voice turns, abort controllers, stream state and global model/theme state through `window.*`.

That creates three costs:

1. **Discovery cost** — a developer cannot reliably predict where a piece of chat UI or behavior lives.
2. **Change blast radius** — small feature edits touch a module that coordinates unrelated systems.
3. **Performance coupling** — high-frequency state can accidentally trigger work in trees that do not need it.

Mobile has the same ownership problem in `mobile-pages.js`; CSS has the same problem in `mobile.css`.

### Build/loading debt

Prometheus performs useful manual lazy loading, but `build:web` is currently a source-sync verification step rather than a production frontend compilation pipeline. That means there is no general tree-shaking/chunking/minification strategy yet. A future bundler migration is justified, but it should follow feature decomposition so chunk boundaries are based on real ownership rather than arbitrary file splits.

## T3 Code review

### 1. Shared behavior lives below the presentation surfaces

T3 has separate web, desktop and native mobile applications while shared client behavior lives in `packages/client-runtime` and wire contracts live in `packages/contracts`.

The useful lesson for Prometheus is the boundary, not the package manager structure:

- **core/client behavior** should not belong to desktop markup or mobile markup;
- **presentation** can diverge by surface;
- **wire/state contracts** should be shared.

For Prometheus that maps naturally to feature modules such as `chat/core`, desktop chat components and mobile chat components.

### 2. State is narrow and keyed by entity

T3's `threadDetail.ts` exposes separate per-thread reactive units for messages, activities, plans, checkpoints, status, error, session and latest turn. It also preserves reference identity when the source did not change.

That prevents a component that only needs `latestTurn` from subscribing to the full thread payload and avoids no-op redraws caused by fresh-but-equivalent arrays.

Prometheus should adopt the same principle even without Effect Atom:

- one feature store/controller can expose narrow selectors/subscriptions;
- state changes should preserve identity on no-op updates;
- high-frequency stream state should not live in an object observed by unrelated surfaces.

### 3. Recently visited thread state is warm, but bounded

T3 gives thread detail a five-minute idle TTL. The reason is practical: mobile routes unmount during navigation, so short subscriber gaps should not throw away useful live state, but every thread ever visited should not remain active forever.

Prometheus should use a similar bounded warm cache for session/thread detail. The exact TTL should be benchmarked rather than copied blindly.

### 4. Long transcripts are a list problem, not a giant DOM problem

T3's current `MessagesTimeline` uses `LegendList` virtualization, stable row derivation, memoization, maintained visible-content position, live-follow state and explicit `load earlier turns` behavior. It also separates stable row context from activity that changes frequently.

Prometheus should reproduce those invariants with a framework-appropriate windowing implementation:

- only a bounded window of message rows should be mounted;
- history should hydrate backward on demand/scroll;
- stable row keys and DOM reuse matter;
- live-follow and history-reading modes must be distinct;
- inserting/expanding content must preserve the reader's anchor.

### 5. Performance is a repository-level product rule

T3's contributor contract explicitly calls out WebSocket payload size, CSS/GPU animation cost and expensive lists as recurring regression sources. Its Vite configuration also warms the module graph, optimizes heavy dependencies, supports bundled development and compresses remote development traffic.

Prometheus should adopt the product rule first. A full bundler migration can follow later.

## Hermes Agent Desktop review

### 1. Feature directories own feature behavior

Hermes's chat area is split into a chat root, `composer/`, `hooks/`, `sidebar/`, overlays, pane logic and dedicated small feature modules. Assistant-specific visual concepts live under `components/assistant-ui`, including artifacts, clarification/tool UI, markdown and embeds.

This is the strongest direct answer to Prometheus's component question:

- an Approval Card is a component;
- a Composer is a component family;
- a Toast is a shared primitive/service;
- a chat page is an orchestrator that composes these owners.

The goal is not tiny files. The goal is predictable ownership.

### 2. UI and pure logic are separated where complexity earns it

Hermes and T3 both use colocated logic/tests around complex components. Prometheus should prefer:

```text
ApprovalCard.js
approval-model.js
approval-model.test.mjs
```

or a similar structure when rendering logic and state transitions are independently testable. Avoid replacing one god-file with `misc.js`, `helpers.js` and other unowned buckets.

### 3. State is placed by authority

Hermes's desktop engineering contract asks who is allowed to be authoritative:

- backend for cross-surface facts;
- Electron for machine/runtime facts;
- renderer for ephemeral presentation state.

It then narrows renderer state further: shared state in small feature-owned stores, request-shaped server data in a cache/query layer, interaction detail local to a component, and hot coordination that should not paint in non-render state.

This is the model Prometheus should use while retiring `window.*` coupling.

### 4. Server truth is reconciled rather than blindly replaced

Hermes explicitly requires:

- merge rather than clobber;
- optimistic interaction with visible rollback;
- stale-response guards;
- foreground isolation;
- coalescing cosmetic noise while flushing important transitions;
- reference preservation for no-op updates.

These rules apply directly to Prometheus's multi-gateway, multi-session, streaming chat architecture.

### 5. Performance is tested with realistic synthetic load

Hermes has a dedicated desktop performance probe and scenario harness. It can build a 200-turn mixed-markdown transcript, synthesize streaming, exercise terminals/right panes, collect React Profiler data, generate CPU profiles and compare results against a committed baseline.

Its scenario set covers stream frame pacing, keystroke-to-paint latency, transcript mount, render churn, idle cost, right-pane load, cold start, first-token paint, submit, session switch/load and profile switch.

Prometheus has measurement infrastructure, but not yet this baseline/gating discipline. That is the next evolution of `benchmark-performance.mjs`.

### 6. Hot interactions have explicit design rules

Hermes's design contract bans common sources of jank in hot paths:

- no broad high-frequency subscriptions;
- coalesce pointer work per frame;
- avoid `transition-all` on hot interactions;
- avoid backdrop-filter repaint during movement;
- do not mount expensive content in the middle of a gesture;
- state/interaction feedback paints immediately;
- expensive stateful surfaces can remain mounted while hidden.

Prometheus should make these contributor invariants, then audit glass/blur, terminal, browser, creative and drag/resize surfaces against them.

## Cross-examination

| Concern | Prometheus now | T3 pattern | Hermes pattern | Prometheus target |
| --- | --- | --- | --- | --- |
| Chat ownership | Multi-megabyte page coordinator | Chat components + shared client runtime | Feature directories + assistant UI primitives | Thin page orchestrator + feature-owned components/controllers |
| Desktop/mobile sharing | Significant parallel implementation | Shared `client-runtime` | Backend owns work; renderer owns presentation | Shared `chat/core`; surface-specific views |
| State granularity | Broad globals / `window.*` bridge | Per-thread narrow atoms/selectors | Small feature stores + authority rules | Feature stores with narrow subscriptions |
| Thread retention | Mixed local/global persistence | Bounded idle TTL | Cache server truth; scope persistence | Warm bounded session cache |
| Transcript | Full-page DOM-oriented implementation | Virtualized/windowed list | Perf-tested realistic long transcripts | Windowed timeline + history paging |
| Streaming | Functional SSE + timing marks | Narrow derived state | Coalesce noise, flush signal | Buffered cosmetic deltas; immediate terminal transitions |
| Components | Partial extraction | Meaningful components + logic/tests | Assistant primitives and feature folders | Predictable component ownership |
| Performance measurement | Playwright benchmark + client marks | Performance repository rule | Baseline-gated scenario harness | Extend benchmark into regression suite |
| Lazy loading | Manual targeted loaders | Bundler/code graph optimization | Feature boundaries | Preserve loaders; migrate to bundler later |
| CSS/GPU discipline | Large cascade, rich glass/motion | Explicitly audits animation/GPU | Hot-path motion rules | CSS split + GPU audit after JS boundaries |

## Target frontend shape

The exact paths can evolve, but ownership should converge on a structure like:

```text
web-ui/src/
  shared/
    ui/
      toast.js
      confirm-dialog.js
      modal.js
      tooltip.js

  features/
    chat/
      core/
        chat-store.js
        session-cache.js
        stream-controller.js
        message-model.js
        approval-controller.js
      components/
        ChatHeader.js
        Composer.js
        MessageTimeline.js
        MessageRow.js
        AttachmentTray.js
      cards/
        ApprovalCard.js
        ToolActivityCard.js
        ArtifactCard.js
        ErrorCard.js

  mobile/
    pages/
      MobileChatPage.js
      MobileTasksPage.js
      MobileSettingsPage.js
    chat/
      MobileComposer.js
      MobileMessageTimeline.js

  pages/
    ChatPage.js       # orchestration only
```

Desktop and mobile should share behavior where the concept is the same. They are allowed to render different markup when their interaction models differ.

## Migration sequence

### PR 1 — architecture/performance guardrails

- record this review;
- establish the frontend architecture contract;
- add a CI file-size ratchet so the four largest legacy surfaces cannot silently grow;
- cap new individual JS/CSS modules to keep future extractions reasonably scoped.

### PR 2 — shared UI + chat foundation

- establish feature/shared directories;
- extract safe, behavior-preserving primitives first;
- centralize toast/confirm ownership while retaining compatibility exports;
- introduce explicit chat state/controller seams without changing visuals.

### PR 3 — chat hot-path performance

- add frame-coalesced cosmetic stream commits;
- separate signal transitions from cosmetic deltas;
- add deterministic stream/long-transcript scenarios to the performance harness;
- add committed baseline/budget comparison once reference measurements are captured.

### PR 4 — transcript windowing

- introduce a windowed timeline with stable row identity and scroll anchoring;
- page/load earlier history;
- prove behavior on desktop and mobile before removing old full-history rendering paths.

### PR 5+ — mobile/page/CSS decomposition

- split `mobile-pages.js` by feature/page;
- move shared behavior into the same chat core;
- split `mobile.css` in cascade-preserving stages;
- shrink `index.html` after ownership has moved outward;
- evaluate Vite/esbuild bundling only after natural feature chunks exist.

## Non-goals

- Do not rewrite Prometheus in React.
- Do not simultaneously redesign the chat UI.
- Do not change the current five themes as part of this program.
- Do not combine componentization with unrelated product features.
- Do not virtualize the transcript without scroll-anchor and long-history tests.
- Do not introduce a universal state framework merely to imitate T3/Hermes.

## Definition of success

The migration is complete when a developer can name a UI concept and predict its owner; desktop/mobile share behavior instead of duplicating it; long sessions do not grow DOM/work linearly; streaming does not repaint faster than useful display cadence; recently visited sessions stay warm without unbounded retention; and CI catches meaningful architecture/performance regressions before merge.
