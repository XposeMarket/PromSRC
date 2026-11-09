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

## Approved Tier 2 extension: paired fresh credential entry
Supersedes UI-only scope above. User locked plans/paired-website-entry/PLAN.md cardfcf199a8 and authorized build. Astra planning exception approved due Opus quota. Ordinary active pairing allows ONLY fresh request submission; separate entry.canEnter, unchanged owner.canApprove, broker entryOnly rejects replacements. Existing main-only credential use/preparation remains; final sign-in approval unchanged. No team grants or storage migration.
Scope: src/gateway/routes/secure-access.router.ts, src/security/secure-access.ts, shared secure-access UI, scripts/test-secure-access-paired-entry.ts and UI tests, generated bundle, self18/self21, this spec.
Test: npx tsx scripts/test-secure-access-paired-entry.ts; npx tsx scripts/test-secure-access-owner.ts; node scripts/test-secure-access-ui.mjs

## Scope notes
- `src/gateway/routes/secure-access.router.ts` - scoped paired entry authorization.
- `src/security/secure-access.ts` - broker replacement prevention.
- `scripts/test-secure-access-paired-entry.ts` - synthetic paired HTTP regressions.
- `workspace/self/21-security-approvals-permissions.md` - separate entry/approval documentation.
- `.pr/SPEC.md` - approved Tier2 scope amendment.
