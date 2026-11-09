# Unified plugin Connect
Tier: 2
Surface: both
Parity: shared backend, desktop and mobile action UI; channels receive owner continuation

## Problem
Installed X is excluded from discovery and fuzzy x resolves to Nous. Mobile Connect loses identity in auto-sent chat prose. Existing protected entry, native OAuth, MCP and durable attempts are not joined end-to-end. Full existing plugin audit is required, not an X-only patch.

## Chosen approach
Follow locked workspace plans/plugin-connect-flow/PLAN.md and ACCEPTANCE.md with full-system amendment. Audit every existing manifest/family first. Reuse existing attempt store, protected credential cards, native provider auth and MCP flows. Canonical identity and support diagnostics, structured start/resume, owner-bound approval, safe verification and cancel guards. Preserve working direct hosted MCP/provider branches. No real account authorization or credential changes.

## Acceptance
- Every installed ID resolves itself, aliases respect token boundaries; unsupported setup stays its own identity.
- Connect UI and tools use structured server-selected setup without assistant self-navigation or model approval.
- Existing protected entry and X OAuth continue same attempt; correct safe profile verification.
- Idempotency, mixed IDs, cancelled/late callbacks, stale revisions, false-ready and secret canary regressions.
- Desktop/mobile isolated UI proof; native/physical-device proof limitations explicitly reported.
- Tests, full hard gates, independent opposite-model review, no merge until Raul approves.

## Files
- src/connections/*
- src/connections/adapters/*
- src/auth/x-api-oauth.ts
- src/extensions/bundled/connectors/*/prometheus.extension.json
- src/gateway/routes/connections-v2.router.ts
- src/gateway/routes/protected-plugins.router.ts
- src/gateway/routes/x-api-oauth.router.ts
- src/gateway/agents-runtime/capabilities/platform-executor.ts
- src/gateway/tools/defs/cis-system.ts
- web-ui/src/features/connectors/*
- web-ui/src/features/secure-access/protected-plugin-card.js
- web-ui/src/mobile/mobile-plugins-page.js
- web-ui/src/pages/PluginsPage.js
- web-ui/src/pages/ChatPage.js
- scripts/test-*connection*.mjs
- docs/PLUGIN-CONNECT.md
- .pr/SPEC.md

## Risks
Sensitive auth/approval boundaries require independent review. Preserve existing config and prior grants; cancellation must not resurrect late callbacks. Unsupported providers remain honestly unsupported rather than new implementations. Roll back this commit; no destructive migration or live credentials touched.

## Scope notes
System-wide approved scope exceeds legacy 8-file/400-line thresholds. Do not shrink acceptance to satisfy those warning thresholds. Audit matrix lives in workspace/plans/plugin-connect-flow/PLUGIN-AUDIT.md.

Additional discovered implementation sites: src/integrations/oauth-base.ts; src/gateway/tool-deny-policy.ts; electron/owner-consent.js; web-ui/src/features/secure-access/secure-access-core.js; web-ui/src/pages/ConnectionsPage.js. These are required to enforce owner-only consent and invalidate pending callbacks, not a new feature scope.

Size justification: Raul explicitly authorized system-wide existing-plugin remediation; identity, consent, callback invalidation and UI entrypoints require this cross-layer diff. No separate auth framework added.
Test: node scripts/test-plugin-connect-flow.mjs
Regression test: scripts/test-plugin-connect-flow.mjs

## Files
- src/integrations/oauth-base.ts
- src/gateway/mcp-oauth.ts
- src/gateway/tool-deny-policy.ts
- src/gateway/routes/settings.router.ts
- src/gateway/routes/connections.router.ts
- electron/owner-consent.js
- web-ui/src/features/secure-access/secure-access-core.js
- web-ui/src/pages/ConnectionsPage.js
- src/extensions/bundled/providers/nous/prometheus.extension.json
- scripts/test-protected-plugin-http.ts
- scripts/test-connector-oauth-contract.mjs
- scripts/test-plugin-connect-flow.mjs
- src/gateway/mcp-oauth.ts

## Proof
Isolated desktop1440/mobile390 controller screenshots: workspace/screenshots/plugin-connect/desktop.png and mobile.png. Full native owner/physical-phone provider flow remains not certified; real auth not authorized.

## Scope notes
Added src/integrations/connector-registry.ts if needed to close the existing native OAuth listener on cancel. Unified approval must not leave a provider locked behind an orphan listener. Full audit evidence docs/PLUGIN-AUDIT.md and docs/PLUGIN-AUDIT.json included as source classifications, not runtime account proof.

## Files
- docs/PLUGIN-AUDIT.md
- docs/PLUGIN-AUDIT.json
- src/integrations/connector-registry.ts

Test: node scripts/test-plugin-connect-flow.mjs
