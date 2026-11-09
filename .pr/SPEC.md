# Plugin quick connect

## Tier
Tier 1 + scoped opposite-model review: repair plugin setup UX and protected-input sequencing after PR852. No owner-proof weakening, new permission or storage format.

## Problem
User Connect opens assistant-oriented approval and a second unstyled shell instead of plugin-specific setup; untrusted phone errors expose internal codes.

## Chosen approach
Direct Connect uses existing setup paths. Prepare credential input without starting external actions or granting consent. Protected saving retains owner checks. Trusted OAuth/other setup starts from the initiating tap. Shared styled, accessible form/panel; no adapter jargon. Optional Ask Prom to verify after saved/connected only, using metadata, never credentials. Untrusted devices get explicit pairing/desktop instructions without collecting secrets.

## Surface
both

## Files
- src/connections/orchestrator.ts
- src/gateway/routes/connections-v2.router.ts
- web-ui/src/features/connectors/connect-flow.js
- web-ui/src/features/secure-access/protected-plugin-card.js
- web-ui/src/features/secure-access/secure-access-core.js
- web-ui/src/mobile/mobile-plugins-page.js
- web-ui/src/pages/ConnectionsPage.js
- scripts/test-plugin-quick-connect.cjs
- scripts/test-plugin-connect-http-ui.cjs
- scripts/test-plugin-connect-oauth-ui.cjs
- docs/PLUGIN-CONNECT.md
- generated/public-web-ui/**

## Acceptance
One Connect tap opens plugin-specific protected form or OAuth flow; no assistant message or redundant approval panel. Save retains native/paired owner proof; no model self-approval. Untrusted surface is actionable, does not collect credentials. Saved is not verified. Optional verification sends service identity only. Desktop/mobile real components and route tests, negative permission regression, screenshots. Existing X/hosted MCP fallback preserved. No real account setup/merge/deploy this turn.

## Tests
node scripts/test-plugin-quick-connect.cjs; existing connection suites; typecheck; UI synchronization; desktop/mobile screenshot proof; pr-finish hard gates.

## Files
- src/connections/schema.ts
- src/connections/adapters/api-key.ts
- src/connections/adapters/connector-oauth.ts
- src/gateway/routes/connections.router.ts
- src/gateway/routes/settings.router.ts

## Size justification
Shared desktop/mobile controller, protected form, native/key adapter preparation and guarded save transitions require a coordinated multi-file fix. Existing ownership and consent guards are reused unchanged. Existing direct hosted MCP/provider/local setup remains intact; this is not a new auth framework.

Surface: both
Test: node scripts/test-plugin-quick-connect.cjs && node scripts/test-plugin-connect-http-ui.cjs
Size justification: coordinated shared UI, protected-input sequencing and first-time OAuth lifecycle regression across native/key adapters; existing owner proof is preserved.

Parity: same shared form/controller on desktop and mobile; specialist hosted MCP/provider/local flows preserved. Synthetic viewport evidence does not certify a physical phone.

## Scope notes
.pr/SPEC.md is the task-owned mini-spec and gate metadata.
