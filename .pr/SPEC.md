# SPEC: Restore mobile protected credential setup

Surface: both
Parity: shared module: web-ui/src/features/secure-access/protected-plugin-card.js:53 is imported by both desktop and mobile; temporary app hiding retains DOM inputs on both surfaces. Mobile additionally renders connection artifacts via main/agent renderers. Desktop existing connection cards unchanged. Screenshots .pr/screenshots/desktop-protected-form.png and mobile-protected-form.png show shared form on both sizes.
Test: node scripts/test-mobile-credential-cards.cjs
Size justification: Shared card lifecycle plus mobile artifact wiring and browser regressions are one bounded credential UX fix.

## Problem
Mobile chat omits connection_card artifacts. Protected plugin entry closes and clears fields on visibilitychange(hidden), preventing phone users from switching apps to copy credentials.

## Existing code
Desktop ChatPage renders connection cards. Shared openConnectFlow performs owner checks and protected setup. protected-plugin-card owns transient inputs and clears on close/pagehide.

## Options
1. Duplicate protected setup in mobile: unnecessary security surface.
2. Reuse shared setup from a mobile connection artifact with existing attempt ID; preserve DOM-only fields across temporary hidden state (chosen).

## Chosen approach
Render escaped mobile connection metadata and user-triggered setup. Resume original attempt via server lookup, never trust artifact metadata for credential requests. Keep pagehide/navigation/cancel/expiry clearing; bounded in-memory preservation during app switch only. No secret persistence.

## Acceptance
Mobile connection artifact visible in saved/live messages and actionable. User tap opens protected form for exact attempt. Background/foreground keeps fields without storage/network/chat leakage; cancel/pagehide/expiry clears. Untrusted surfaces still fail closed. Shared desktop behavior tested. No credentials or actual account writes in tests.

## Out of scope
X localhost OAuth callback, multi-account plugin implementation, merge/deployment without approval.

## Files
- `web-ui/src/features/connectors/connection-chat-card.js`
- `web-ui/src/features/connectors/connect-flow.js`
- `web-ui/src/features/secure-access/protected-plugin-card.js`
- `web-ui/src/mobile/mobile-chat-renderer-runtime.js`
- `scripts/test-mobile-credential-cards.cjs`

## Scope notes
- `.pr/SPEC.md` - existing tracked spec updated for this fix.
- `web-ui/src/mobile/mobile-chat-message-renderer.js` - ordinary main-chat renderer in addition to agent-message path.
- `web-ui/src/features/secure-access/secure-access-core.js` - correct lifecycle comment for protected plugin exception.
User's urgent explicit fix request is treated as bounded WIP exception; three unrelated PRs remain open. Independent lane avoids dirty plugin-multi-account; shared connect-flow edits require reconciliation with that future branch.

## Risks
Untrusted artifact text must be escaped; attempt identity verified server-side; no automatic submission or owner-approval bypass. App OS termination cannot preserve unsaved secrets and is not promised.
