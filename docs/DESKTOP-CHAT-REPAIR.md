# Desktop active-chat repair
Tier: Tier 1 + scoped quick review (protected-entry hookup and renderer recovery boundary)
Surface: sibling-check
Parity: not affected: mobile renderer unchanged; mobile recovery and actual summary/replay caller suites pass. Desktop Electron and web share the changed renderer.
Test: node scripts/test-desktop-chat-polish-recovery.mjs
Size justification: User-requested multi-area desktop repair, tests and generated mirrors.

## Problem
Desktop retains an old Add secret composer button; reasoning fails to recover/stream like mobile; active threads lag; background cards are oversized with a visible scrollbar and initials; effort menu has an unwanted backing and stays open after selection.

## Chosen approach
Repair owning desktop renderer and cascade. Reuse provider helpers. Measure active-thread rendering before optimizing. Preserve paste guards, stream ownership and private/summary visibility. No live edits or stored format changes.

## Acceptance
- No standing secret button; protected entry and guard remain.
- Compact agent strip, no visible scrollbar, wheel/keyboard access and provider marks.
- Floating panels without outer backing; successful effort selection closes picker.
- Reopened active threads recover and continue reasoning without duplicates/terminal revival.
- Measured improvement and reproducible regressions; desktop proof and mobile sibling checks.
- Hard gates pass. Explicit merge approval required.

## Files
- .pr/SPEC.md
- docs/DESKTOP-CHAT-REPAIR.md
- web-ui/src/pages/ChatPage.js
- web-ui/src/styles/components.css
- web-ui/src/styles/surfaces-polish.css
- web-ui/src/legacy-desktop-bootstrap.js
- web-ui/src/features/chat/*
- web-ui/src/features/secure-access/secure-access-desktop-dock.js
- scripts/test-desktop-chat-polish-recovery.mjs
- scripts/test-main-chat-reasoning-summary.regression.mjs
- scripts/test-background-agent-stream-ui.mjs
- scripts/test-desktop-stream-snapshot.mjs
- scripts/test-desktop-live-multithread-perf.mjs
- generated/public-web-ui/*

## Risks
Do not detach local SSE state, replay over terminal turns, expose private thinking or alter approvals. Revert PR for rollback. Self docs 04/08/17 read; update17 with findings and verification.

## Additional test updates
- scripts/test-main-chat-reasoning-summary.regression.mjs: inject scheduled-render dependency into real SSE switch fixture.
- scripts/test-background-agent-stream-ui.mjs: current exact summary channel metadata, not obsolete agent_progress tag.
- scripts/test-desktop-live-multithread-perf.mjs: theme registry stub and closed-current lazy render contract.

## Follow-up: thinking placeholder and user bubbles
Tier 1 presentation-only delta after reviewed head00062d1fa. Hide transport/setup metadata from the desktop conversation and use three animated thinking dots until real reasoning/tools/answer arrive. Keep approvals/plans/image placeholders visible and suppress empty dots while waiting for a question. Remove desktop user-bubble border/inset/pseudo frames for every built-in skin and custom palettes; mobile renderer/styles unchanged. Functional dots remain animated during streams, respecting reduced motion and hidden/paused state.
Acceptance: executable renderer-state tests plus real Chromium desktop CSS checks for p1/gray/dark/blue/purple/custom, actual app preview with source assets, existing streaming/perf regression retained. No backend, permission, stored-data or provider change.
