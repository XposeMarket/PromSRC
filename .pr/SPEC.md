# Paired-phone plugin setup

## Tier
Tier 1 + scoped opposite-model review under Raul's explicit fix request. Correct misplaced general owner-approval requirement for direct user plugin credential setup. Not a grant of agent/secure-access owner rights.

## Problem
An enabled paired phone can use the app but cannot even enter plugin credentials without a second desktop owner-provenance opt-in. User explicitly wants direct credential entry/save from the app.

## Chosen approach
Separate plugin-configuration authorization from general owner consent. Enabled, server-validated paired-device tokens may prepare and submit typed plugin credentials using same-origin JSON over HTTPS (local test loopback retained). Desktop retains existing consent. Keep general password storage/access, grant mutation, pairing administration, destructive lifecycle and arbitrary executable setup owner-gated. No changes to stored pairing permissions or schemas. No credentials in chat.

## Surface
both

## Files
- src/gateway/routes/plugin-setup-access.ts
- src/gateway/routes/protected-plugins.router.ts
- src/gateway/routes/connections-v2.router.ts
- src/gateway/routes/connections.router.ts
- src/gateway/routes/settings.router.ts
- web-ui/src/features/connectors/connect-flow.js
- web-ui/src/features/secure-access/protected-plugin-card.js
- scripts/test-paired-plugin-setup.cjs
- scripts/test-plugin-quick-connect.cjs
- scripts/test-plugin-connect-http-ui.cjs
- docs/PLUGIN-CONNECT.md
- generated/public-web-ui/*
- .pr/SPEC.md

## Acceptance
Existing enabled pairing with no owner provenance reaches X form and saves synthetic app credentials; API-key provider uses real vault path. Native desktop unaffected. Disabled/revoked/unknown/no tokens, hostile origin, HTTP remote and token-in-body reject; ordinary paired phone still cannot approve general secret access or launch local executables via connection approval. Explicit scope-bound save, restart and no-secret-output coverage retained. Tests use real pairing store in temp config, real routes/controller and synthetic external providers. Screenshots desktop/mobile, not claim physical phone certification. Build, sync, hard gates, scoped review; no merge/live permission change without approval.

## Test
node scripts/test-paired-plugin-setup.cjs

## Risks
Paired-token possession authorizes plugin configuration by product intent, not general owner approval. Revoke/disable immediately removes it; do not treat ordinary gateway authentication or Origin alone as sufficient. No real X credentials/auth in tests.

Surface: both
Parity: shared controller and protected credential card used by desktop and mobile; backend authorization shared across both.
Size justification: One narrow authorization correction touches shared helper, four existing route modules, both shared UI gates and real-pairing regression fixtures; generated UI is required synchronized output.

Test: node scripts/test-paired-plugin-setup.cjs
