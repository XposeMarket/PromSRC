# SPEC: Refresh website sign-in cards and protected entry
Surface: both
Parity: fixed both: shared secure-access core/presentation mounted by desktop/mobile docks and Saved access; browser handoff styled in both renderers.
Test: node scripts/test-secure-access-ui.mjs && node scripts/test-sign-in-presentation.mjs
Size justification: Cohesive presentation-only refresh with shared dialog lifecycle, two handoff renderers and browser regressions.

## Problem
Raul approved plans/sign-in-visual-refresh/PLAN.md and screenshots then requested implementation. Existing website entry/approval are dense inline forms.
## Existing code
secure-access-core.js owns entry, receipt, approval, clearing and transport. Browser handoffs in ChatPage.js/mobile-chat-renderer-runtime.js. Pending Tasks lane imports shared mounts; no overlapping edits.
## Options
CSS-only cannot provide launcher-to-modal. Replacing authorization is unnecessary. Smallest complete solution: presentation wrapper around existing cards/endpoints.
## Chosen approach
Tier 1 visual polish plus scoped opposite-model review. Native dialog, mobile sheet/desktop modal, neutral pills and in-field reveal. Save-only entry and prepared sign-in remain separate. No permission/storage/backend changes. Browser handoff retains current browser and completion decisions.
## Acceptance
Compact Continue/Skip, visible exact site, reachable actions, dark/light and 320/390/1440 widths. Clear secret on close/cancel/expiry/destroy/pagehide. Preserve replacement owner gate, mode variants, recovery, outcome semantics and default remembrance. Save never submits sign-in. No drafts/chat/log/storage secret exposure.
## Out of scope
No new authorization, combined endpoints, OAuth replacement, storage/schema/agent/channel changes or merge/deploy without Raul approval. Synthetic tests do not claim real iPhone keyboard/autofill or real account sign-in.
## Files
- web-ui/src/features/secure-access/secure-access-core.js
- web-ui/src/features/secure-access/sign-in-presentation.js
- web-ui/src/mobile/mobile-chat-renderer-runtime.js
- web-ui/src/pages/ChatPage.js
- web-ui/src/styles/components.css
- web-ui/src/styles/mobile.css
- scripts/test-sign-in-presentation.mjs
## Scope notes
Generated UI synchronized. Workspace self docs 17,18,19,21 read/updated this turn outside checkout.
## Risks
Global CSS/modal lifecycle collisions; browser fixtures test focus/clear/unmount. Revert scoped presentation changes; no data migration.
