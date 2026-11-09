# Connection runtime identity hotfix
Tier: 1, review waived by Raul's explicit live steer Nov9.
Surface: backend
Parity: shared backend runtime serves tools and HTTP for every client.
Test: node --import tsx scripts/test-connection-runtime-identity.cjs
## Problem
Under tsx, static extensionless imports and dynamic .js imports instantiate separate runtime module copies. Tool-created attempt exists on disk but HTTP returns404 from stale module-local state.
## Chosen approach
One process-global connection runtime, keyed by resolved configuration directory. Preserve normal resets across either import identity. No permission, vault, schema or transport changes.
## Files
- src/connections/runtime.ts
- scripts/test-connection-runtime-identity.cjs
- workspace/self/12-connectors-mcp-integrations.md
- .pr/SPEC.md
## Acceptance
Mixed static/dynamic source imports share identity and attempts; resets invalidate both; isolated config never touches real accounts. Compile and existing connection regressions pass. Live restart + same tool-issued attempt GET200. User authorized live hotfix/deployment and PR, no independent review.
