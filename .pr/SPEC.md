# SPEC: paired-phone plugin setup is bound to a pending attempt and cannot set a model endpoint

Tier: 1 + review (fix inside a sensitive area: plugins/credentials and approvals)
Surface: backend
Parity: n/a (shared gateway guards; desktop owner path unchanged, phone flow already sends the attempt id)
Test: npx tsx src/gateway/routes/plugin-setup-access.regression.ts

## Problem
PR #855 let an enabled paired phone save plugin credentials without the separate owner-approval grant, contained by an adapter allow-list. Two gaps were left (Fable 5.2 shakedown, findings F1 and F2, both read in code):

1. `POST /api/connections/credentials` used `requirePluginSetup`, which has no allow-list. The attempt check in the handler runs only `if (req.body?.attemptId)`. With no attempt id, a paired phone could save an API key, access token or OAuth app credentials for any connector id in the body, with no pending setup at all.
2. `PAIRED_PLUGIN_SETUP_ADAPTERS` contained `openai-compatible-model`. That adapter writes `llm.providers[providerId].base_url`. Every prompt sent to that provider goes to that endpoint, which is a much larger capability than saving a key.

## Existing code
- `src/gateway/routes/plugin-setup-access.ts`: `requirePluginSetup`, `requirePluginSetupAdapter`, the allow-list.
- `src/gateway/routes/connections.router.ts:323`: the legacy credentials route; `nativeAppSetup` validates the attempt (state, adapter `connector-oauth`, service match, 15 minute age) and limits fields, but only when an attempt id is present.
- `web-ui/src/features/secure-access/protected-plugin-card.js:142-147`: the phone card posts to this route only in the native-app path, which always carries `attemptId`. Desktop `ConnectionsPage.js:1457` posts without one, on the owner-consent path.

## Options
1. New guard `requireAttemptBoundPluginSetup`: paired path only when the body has a string attempt id, else the owner gate. Remove the model adapter from the allow-list. Smallest, fully works.
2. Resolve the attempt in the guard and apply the allow-list there. Duplicates what the handler already validates.
3. Put the route back to owner-only. Breaks the phone OAuth-app setup Raul asked for.

## Chosen approach
Option 1. Guards take an optional injected `gates` object so the regression can drive the real guards over HTTP.

## Acceptance
- Paired phone + string `attemptId`: reaches the handler (which then validates the attempt).
- Paired phone with no, empty, numeric, array or object `attemptId`: 403 `OWNER_SURFACE_REQUIRED`, handler not reached.
- Desktop owner (cookie + consent) without an attempt id: still allowed; without consent: `OWNER_CONSENT_REQUIRED`.
- Transport and storage checks still run on the paired path.
- Paired phone cannot approve `openai-compatible-model`; the owner still can. The other four adapters are unchanged.

## Out of scope
`/api/auth/x-api/credentials` (already limited to X client id/secret fields; direct X setup from the phone is intended). The #861 OAuth findings. Allowing https-only model endpoints from a phone.

## Files
- `src/gateway/routes/plugin-setup-access.ts` - new guard, allow-list change, injectable gates
- `src/gateway/routes/connections.router.ts` - route uses the new guard
- `src/gateway/routes/plugin-setup-access.regression.ts` - HTTP regression, both polarities
- `scripts/test-paired-plugin-setup.cjs` - model adapter added to the denied list
- `package.json` - `test:plugin-setup-access`
- `docs/PLUGIN-CONNECT.md` - paired-phone section updated

## Risks
A paired phone can no longer connect a model endpoint (for example the bundled Nous local proxy) without owner approval. That is the intended tightening. Rollback: revert the commit.
