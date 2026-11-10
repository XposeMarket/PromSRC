# OAuth pending action and phone completion repair
Tier: 1; explicit live-fix authorization and separate review waiver in this incident.
Surface: both
Parity: shared module: web-ui/src/features/connectors/connect-flow.js:92 shared controller and backend; mobile uses existing secure browser viewer, desktop retains external-browser flow. Real Chromium tests at desktop1440/mobile390.
Size justification: one bounded end-to-end authorization repair requires shared controller, existing viewer, route helper, two regression tests and docs.
## Problem
Saved credentials lost pending action after poll. After that fix, mobile still suppresses loopback authorization and sends user to PC.
## Chosen approach
Retain/recover pending action; wire mobile loopback connector OAuth to the existing in-house login handoff with paired/native-owner checks and server-derived browser identity/URL. Recheck exact attempt on viewer return, keep secrets DOM-only. No public callback or redirect config changes.
## Files
- .pr/SPEC.md
- src/connections/adapters/connector-oauth.ts
- src/connections/oauth-phone-handoff.ts
- src/gateway/routes/connections-v2.router.ts
- web-ui/src/features/connectors/connect-flow.js
- web-ui/src/mobile/mobile-login-handoff.js
- scripts/test-plugin-quick-connect.cjs
- scripts/test-oauth-phone-handoff.cjs
- workspace/self/12-connectors-mcp-integrations.md
## Acceptance
Test: node scripts/test-oauth-phone-handoff.cjs && node scripts/test-plugin-quick-connect.cjs
Actual shared form -> save -> pending polls -> phone viewer -> provider callback -> connected; close/reopen without key reentry; desktop unchanged. Reject unpaired/spoofed/expired/terminal/wrong-adapter handoffs; no caller URL/session override. Build/UI checks plus live browser readiness. Synthetic test provider is not real X consent.
## Risks
OAuth user consent still required by X; do not claim account connection until live status says connected. In-house Electron bridge required, fail clearly if unavailable. Preserve existing user approval and callback state/PKCE validation. Rollback only this branch's changed files, preserving other live hotfixes.
