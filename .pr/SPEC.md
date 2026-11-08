# SPEC: Keep background evidence out of replies and restore agent-list scrolling

Surface: both
Parity: fixed both: desktop completion routing and shared backend; mobile expanded agent dock tested separately.
Test: node scripts/test-background-result-chat-scroll.mjs
Size justification: bounded repair across completion and presentation boundaries.

## Problem
Worker output is appended to ordinary replies by ChatPage bg_agent_done and a handle-chat finalization fallback. Raul also reports expanded mobile agent list cannot scroll past about seven rows.

## Existing code
Typed internal background results already feed model context and are excluded from visible history. Agent dock has overflow rules and keyed reconciliation; effective scrolling still requires reproduction.

## Options
1. Hide marker text: masks symptoms and loses evidence.
2. Remove legacy raw append paths, preserve model synthesis and worker detail; repair confirmed scroll cause (chosen).

## Chosen approach
Use the existing internal result and agent-detail routes, never rewrite a prior answer from a completion event. Diagnose scroll with actual styles and renderer before changing it.

## Acceptance
Raw completion never mutates active/inactive parent replies. Worker details and main-model evidence remain. Many-agent list can reach final row and retains position through updates. Desktop/mobile regression tests pass.

## Out of scope
No history deletion, model routing, theme redesign, merge or deployment.

## Files
- .pr/SPEC.md - tracked task scope and verification contract
- src/gateway/routes/chat/pipeline/handle-chat.ts
- web-ui/src/pages/ChatPage.js
- web-ui/src/mobile/mobile-chat-renderer-runtime.js
- web-ui/src/styles/mobile-composer-stack.css
- scripts/test-background-result-chat-scroll.mjs

## Risks
Completion evidence could be lost if synthesis path removed: retain and test internal routing. Scroll changes could affect collapse: test both states. Revert PR to roll back.
