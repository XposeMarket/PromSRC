# OAuth pending action repair
Tier: 1; Raul explicitly authorized live repair and waived separate review in this ongoing incident.
Surface: backend
Parity: shared backend connector adapter serves desktop/mobile and tools.
## Problem
Native app save succeeds, but first pending OAuth poll returns state only and applyResult removes requiredUserAction. Shared UI falls into Preparing connection with no controls.
## Chosen approach
Return the pending OAuth user action on empty polls. If an existing awaiting_oauth attempt has already lost its action, restart only its bound OAuth flow through the adapter to recover instructions; never request app credentials again. Terminal outcomes still clear actions.
## Files
- src/connections/adapters/connector-oauth.ts
- scripts/test-plugin-quick-connect.cjs
- workspace/self/12-connectors-mcp-integrations.md
## Acceptance
Real shared form save -> two pending polls -> close/reopen retains exact action without new launch. Legacy missing-action attempt recovers once. Cancel cannot revive action. Desktop/mobile regression, typecheck/build and hard gates.
Test: node scripts/test-plugin-quick-connect.cjs
