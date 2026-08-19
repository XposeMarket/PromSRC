# Prometheus Web UI architecture contract

This document is the default engineering contract for `web-ui/`. It is intentionally framework-agnostic. Existing vanilla ES modules remain valid; the rules are about ownership, state, lifecycle and performance.

## 1. Nameable concepts get owners

A recognizable UI concept with its own markup, behavior or lifecycle should have an explicit module owner.

Examples:

- approval request → `ApprovalCard`
- message timeline → `MessageTimeline`
- composer → `Composer`
- attachment tray → `AttachmentTray`
- toast/confirmation → shared UI primitive/service

Do not create files simply to reduce line count. `misc.js`, `helpers2.js`, `chat-functions.js` and similar buckets are not decomposition.

## 2. Pages orchestrate

A page module may:

- mount/unmount feature components;
- connect page-level navigation/context;
- compose feature controllers;
- own page-only presentation state.

A page module should not implement every card, renderer, persistence rule, transport transition and feature-specific state machine reachable from that page.

`ChatPage.js` and `mobile-pages.js` are legacy exceptions being migrated. New behavior should not expand their ownership unless there is no safe seam yet.

## 3. Separate presentation from behavior

Prefer three conceptual layers:

1. **presentation** — DOM/visual component;
2. **feature state/controller** — transitions, derived state and user actions;
3. **transport/persistence** — API, WebSocket/SSE and durable storage.

A card should generally receive data plus callbacks rather than deciding which gateway endpoint to call itself.

Complex components may colocate pure logic and tests:

```text
ApprovalCard.js
approval-model.js
approval-model.test.mjs
```

## 4. State lives with its authority

Ask who is allowed to be right about the value.

- Gateway/backend: cross-device/session facts, durable agent work and shared thread truth.
- Electron: machine/runtime/window capabilities.
- Renderer: ephemeral presentation and direct-manipulation state.

Inside the renderer, use the narrowest scope that remains correct:

- component-local state for local interaction;
- feature-owned state for cross-component feature coordination;
- shared state only when genuinely cross-feature;
- non-render refs/queues for hot coordination that should not cause paint.

Do not add new `window.*` mutable state merely because existing chat code uses that compatibility bridge. Compatibility aliases are allowed while migrating, but the feature module should become authoritative.

## 5. Subscribe narrowly

A surface that needs `latestTurn` should not have to consume a whole session record including messages and tool activity.

Feature stores/controllers should expose narrow reads/subscriptions for independently changing concerns. Preserve object/array identity on no-op updates where practical.

High-frequency cosmetic state must not wake heavy unrelated trees.

## 6. Shared behavior, surface-specific presentation

Desktop and mobile may need different markup and navigation, but concepts such as streaming, approval decisions, queued prompts, retry, interruption, attachments and message normalization should not acquire independent business rules per surface.

Shared behavior belongs in feature core modules. Desktop/mobile views adapt it to their interaction model.

## 7. Streaming: coalesce noise, flush signal

Network events may arrive faster than useful display cadence.

- Cosmetic text/progress deltas may be buffered and committed at most once per animation frame or another measured short interval.
- Terminal transitions — completion, failure, approval/input required, cancellation — should flush immediately.
- Final state must never depend on a scheduled cosmetic flush firing later.
- Stream queues must be disposed when their session/surface is destroyed.

## 8. Long transcripts are windowed data

The target chat timeline is not an indefinitely growing DOM tree.

A future timeline implementation must provide:

- stable row identity;
- bounded mounted rows;
- older-history paging/window expansion;
- preserved visible position when rows above the viewport change;
- explicit live-follow vs history-reading modes;
- deterministic handling of expanding tool/card content.

Do not land transcript virtualization without scroll-anchor regression coverage.

## 9. Retain expensive state intentionally

Visibility and lifecycle are different.

Expensive stateful surfaces (terminal/editor/browser/creative canvases) may remain mounted while hidden if reinitialization is materially more expensive and memory remains bounded. Conversely, old thread detail should not remain live forever merely because it was once opened.

Use bounded retention/TTL policies and measure their memory impact.

## 10. Hot interactions stay cheap

For drag, resize, typing, scrolling and streaming:

- avoid layout reads immediately after layout writes;
- coalesce pointer work per frame;
- avoid broad DOM scans in repeated callbacks;
- avoid `transition-all` on hot controls;
- avoid animating expensive blur/backdrop-filter geometry during movement;
- do not mount heavy content mid-gesture;
- update immediate visual feedback before persistence/network reconciliation.

Respect reduced-motion preferences for nonessential motion.

## 11. Shared primitives are actually shared

Toast, confirmation, modal, tooltip, loading, error and empty-state behavior should converge on shared owners. Do not fork a second implementation for one page.

During migration, existing imports may remain as compatibility re-exports so feature extraction does not force a repo-wide rewrite in one PR.

## 12. CSS follows ownership after JS boundaries stabilize

Do not split large CSS merely to create smaller files if cascade order changes unpredictably.

CSS decomposition should:

- preserve rule order/specificity during the first move;
- follow feature/component ownership where practical;
- use semantic theme tokens rather than new raw theme-specific colors;
- be validated across desktop/mobile and all supported themes.

Theme System v2 work remains a separate concern from this architecture migration.

## 13. Lazy work by default for expensive optional features

Heavy optional features should initialize on demand. Preserve the current lazy loaders for CodeMirror/creative dependencies and move toward natural feature chunks as modules become well-owned.

A future bundler migration should be justified by measured startup/transfer gains and should not precede the ownership cleanup it is meant to package.

## 14. Performance proof is part of correctness

For changes to chat rendering, streaming, composer input, navigation or expensive panes, validate realistic load rather than an empty screen.

The performance suite should evolve toward repeatable scenarios for:

- cold/warm startup;
- keystroke → paint;
- long transcript mount/scroll;
- stream frame cadence/long tasks;
- session switch/load;
- busy right pane + chat;
- mobile long chat;
- idle work while background sessions stream.

Numerical baselines should be captured on a documented reference environment and compared with tolerances rather than copied from another product.

## 15. Legacy-size ratchet

The largest legacy surfaces have exact byte baselines in `scripts/web-ui-architecture-baseline.json`.

- They may shrink without updating the baseline.
- They must not grow above the recorded baseline.
- When a refactor shrinks one, lower its recorded baseline in the same PR.
- New individual JS/CSS modules must stay below the configured module-size ceiling unless a deliberate exception is added with review.

This ratchet is a migration tool, not a claim that byte count alone measures architecture quality.

## 16. PR discipline

Prefer one architectural concern per PR. Structural moves should preserve behavior and visuals unless the PR explicitly owns a behavior change.

Recommended sequence:

1. guardrails/tests;
2. safe component/controller extractions;
3. shared desktop/mobile behavior;
4. hot-path performance changes;
5. timeline windowing;
6. CSS decomposition/build modernization.

Each stage should leave compatibility seams for the next stage rather than requiring a flag-day rewrite.
