# SPEC: Mobile protected access card fit and blocked-state clarity
Surface: both
Parity: fixed both: shared blocked-owner presentation; mobile-only dock geometry, desktop layout unchanged
Test: node scripts/test-secure-access-ui.mjs
Size justification: Bounded UI-only restoration; no credential or permission changes.

## Problem
User screenshots IMG_1649/1650 show a large protected sign-in card drifting relative to mobile chat and disabled password input perceived as a broken tap. Owner approval is unavailable on that phone; PR855 intentionally covers plugin setup only.
## Existing code
web-ui/src/features/secure-access/secure-access-core.js createMobileDockFit and mountSecureAccessCard.
## Options
- Remove permission check: rejected security regression.
- Change paired-device permission: separate Tier2 policy change.
- Fix geometry and hide unusable form while retaining explanation/cancel: smallest safe restoration.
## Chosen approach
Correct ancestor-scroll coordinates, real composer anchor, viewport height cap and scroll lifecycle. Show owner-blocked explanation and cancel without a dead password form.
## Acceptance
Authorized card retains editable inputs and secret clearing. Unauthorized card collects no secrets and retains cancellation. Mobile card bounded above composer when scrolling and keyboard changes. Server gates unchanged.
## Out of scope
Granting owner approvals; changing browser-password permission policy; restart/deploy; TikTok publishing.
## Files
- `web-ui/src/features/secure-access/secure-access-core.js` - geometry and blocked UI
- `scripts/test-secure-access-ui.mjs` - regression coverage
- `workspace/self/18-mobile-app.md` - documentation
## Risks
Mobile coordinate differences; validate browser geometry fixtures and review. No secrets used in tests.

## Scope notes
- `.pr/SPEC.md` - task-specific specification replaces tracked prior specification.
