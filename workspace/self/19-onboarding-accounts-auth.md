# 19 — Onboarding, accounts, and auth

> **Last verified:** 2026-10-07 against PromSRC `a48712ccc` · **Owner area:** `src/auth/`, `src/gateway/onboarding/`, `src/gateway/routes/account.router.ts`, `web-ui/src/onboarding/`
> **Read this when:** Changing first-run setup, account gating/login, model connection onboarding, or persisted account/onboarding state. Pairing is covered in [18 Mobile app](18-mobile-app.md).

## TL;DR
- Main at `a48712ccc` contains a working account router and applies `requireAccountAccess` to protected API routers; account login/status/config routes remain reachable to establish a session.
- Main's account gate checks for an authenticated account session. Don't infer “optional accounts” from a local desktop install.
- `PROMETHEUS_REQUIRE_ACCOUNT` and `account.required` were not found in the main source search. The opt-out-by-default change is **pending in PR #567** unless/until merged.
- Current `onboarding.json` storage schema is version 1; records are keyed by user ID and contain tutorial, migration, model and meet/memory-seed state.
- Current main onboarding order is tutorial → migration (skip allowed) → model → meet → memory confirmation → done. PR #567's model → meet → memory → tour sequence is **pending in PR #567**, not the main behavior.
- Main `src/auth/` has Anthropic OAuth and provider-account modules but no `src/auth/anthropic-cli-connect.ts`; Claude one-click CLI connect is **pending in PR #567**.
- Web onboarding flow is composed from small modules under `web-ui/src/onboarding/`; the controller refreshes backend state across steps.
- Treat account, provider, OAuth and onboarding state as sensitive. Avoid logging tokens or putting identity/secret data in query strings.

## Map
| Concern | Where (file → symbol) | Notes |
|---|---|---|
| Account API | `src/gateway/routes/account.router.ts` → `/api/account/*`, `requireAccountAccess()` | Login, password login, config, status, logout, refresh and gate. |
| Account router mounts | `src/gateway/server-v2.ts` → router mounting | Auth middleware wraps account routes; protected application routes add account access gate. |
| Gateway pre-auth allowlist | `src/gateway/gateway-auth.ts` → account paths | Account config/status/login need to be reachable before an account session exists. |
| Browser account client | `web-ui/src/auth/account.js` | Sends account interactions through local gateway paths. |
| Onboarding API | `src/gateway/routes/onboarding.router.ts` | Backend status and state mutations for the flow. |
| Record and sequence | `src/gateway/onboarding/onboarding-store.ts` → `getRecord()`, `nextStep()` | Main schema v1, current ordering. |
| Memory seed | `src/gateway/onboarding/memory-seed.ts` | Plan/apply approved memory-seed writes; check before altering consent. |
| Model health and meet | `src/gateway/onboarding/model-health.ts`, `meet-prompt.ts` | Readiness check and meet prompt. |
| First-run controller | `web-ui/src/onboarding/onboarding-controller.js` | Coordinates backend status and step UI. |
| Model setup | `web-ui/src/onboarding/model-picker.js` | Provider/model selection and validation. |
| Meet and memory | `web-ui/src/onboarding/meet-panel.js`, `memory-confirm.js` | Session intro, review and explicit memory confirmation. |
| Tutorial and reset | `web-ui/src/onboarding/tutorial-overlay.js`, `redo-onboarding.js` | Tour and destructive redo flow. |
| Settings placement | `web-ui/src/pages/SettingsPage.js` | Replay/dev-test/redo controls in system settings. |
| Provider auth | `src/auth/{anthropic-oauth,openai-oauth,xai-oauth}.ts` and account pools | Provider auth is distinct from product account login. |
| Intended one-click Claude connector | `src/auth/anthropic-cli-connect.ts` | **Pending in PR #567**; file absent from inspected main tree. |

## How it works

### Account login and request gating on main
`account.router.ts` owns the Supabase-backed account session lifecycle. Browser code calls the local gateway rather than speaking to the auth service directly. Gateway account config/status and login endpoints are reachable before an authenticated account exists; logout/refresh and protected data routes use the session helpers. `requireAccountAccess()` returns an unauthenticated response when no session is present. `server-v2.ts` mounts the account router behind gateway auth and applies the account middleware to application routers.

There are two different authentication layers: gateway/device authorization protects access to the local gateway, while a product account session is checked by `requireAccountAccess()` for account-gated APIs. Provider OAuth/API credentials are a third, separate concern. Never treat a connected model provider as proof of account login or a device pairing token as provider auth.

**Main vs PR #567:** current main has the account router/gate, but the account-off-by-default switch (`PROMETHEUS_REQUIRE_ACCOUNT` and `config.account.required`) was not found in source. Until PR #567 merges, do not document those as live knobs or use them to disable the gate. If coding on a worktree that includes the PR, verify the actual config/schema and middleware branch there before applying this description.

### Onboarding storage and sequencing on main
`onboarding-store.ts` persists an `onboarding.json` object beneath the runtime data directory, with `schemaVersion: 1`, install ID, and records keyed by user. The per-user record tracks tutorial shown/completed version, optional migration completion/skip/source, first model connection/provider/model, and meet-and-greet completion/session/memory seed timestamps. `getPrometheusLayout()` chooses the active runtime root; don't hardcode the file under one machine profile.

The current `nextStep()` requires tutorial completion first, then a migration completion/skip, then model connection, meet-and-greet completion, and finally memory seed confirmation. The web controller asks the backend for status and coordinates individual UI modules. Migration is distinct from ordinary first-run setup and should remain skippable. Memory seed writes are reviewed/applied through a dedicated confirmation module and backend service.

PR #567 proposes a simpler first-run experience and changes the record format/order. Those intended facts—accounts disabled unless opted in via the named setting, `onboarding.json` v2, model → meet → memory → tour, and Claude one-click connect—are **pending in PR #567** rather than guaranteed by main's schema/code. Do not mix a v2 record layout with main's v1 store unless the PR is present and its migration tested.

### Frontend modes
`onboarding-controller.js` is the flow coordinator; dedicated modules render tutorial, migration, model, meet and memory-confirm steps. Settings re-entry and destructive redo flows are not equivalent to first-run. A tutorial replay should not silently mutate persistent completion or enter all the remaining steps. Development/test mode should not seed real user memory. Redo/reset must preserve its confirmation barrier and use the backend-supported operation.

### Provider and CLI auth
`src/auth/` on main contains Anthropic/OpenAI/xAI OAuth and provider account pool/auth helpers, plus usage-OAuth and regression files. Provider credentials and account sessions should remain encrypted or owned by their respective vault/runtime stores. `anthropic-cli-connect.ts` was not present in the inspected main tree, so Claude CLI one-click behavior cannot be attributed to current main. Use the provider-specific modules and generated tool inventory for actually available connect controls.

## Config & knobs
- **Main:** no `PROMETHEUS_REQUIRE_ACCOUNT` env var or `account.required` setting was located. Both are **pending in PR #567**.
- **Main:** onboarding store uses `schemaVersion` 1 and file name `onboarding.json`; it resolves the data directory via `getPrometheusLayout()` and, for non-canonical layouts, the configured data-dir fallback.
- Current account UI calls `/api/account/config`, `/status`, `/login`, `/login/password`, `/logout`, and refresh from `web-ui/src/auth/account.js` / `account.router.ts`.
- Provider auth is not the same as product account auth. Check provider-specific configuration/vault code before changing secrets or login state.

## Gotchas / sharp edges
- **Wrong branch assumptions:** PR #567 has not been found in main history. Look at branch/worktree before claiming its behavior is merged. Current generated changelog contains PRs through #566.
- **Do not claim account-off by default in main:** the middleware currently exists and is mounted. Search and inspect the exact route gate before modifying.
- **Schema mismatch:** main reads schema v1. Writing v2 state without migration compatibility risks resetting/dropping a user's progress.
- **Ordering matters:** changing `nextStep()` alone can create a UI/store mismatch; controller and tests need to match.
- **Consent boundary:** memory seed is a user-approved write. Do not skip the confirmation or conflate meeting chat with memory consent.
- **Migration boundary:** keep optional migration skippable and separate from account/provider login.
- **Sensitive auth data:** don't expose Supabase bearer/refresh tokens or provider credentials in browser-visible config, logs, or onboarding JSON.
- **Test flows mutate state:** validate dev/test modes and use temporary data roots; don't experiment with production user workspace.

## How to change it safely
1. First identify whether your checkout is main `a48712ccc` or includes PR #567; use `git log --all --grep=567` and inspect the actual tree.
2. For account changes, read `account.router.ts`, `gateway-auth.ts`, `server-v2.ts` mounts, browser account client, and security docs together.
3. For onboarding changes, inspect `nextStep()`, record schema/migration, route validation, controller and memory consent tests together.
4. Use generated test list rather than maintaining a list here; search `generated/tests.md` for onboarding, account, OAuth, provider pool and memory-seed contracts.
5. Run focused tests in an isolated data root, then verify an unauthenticated boot, successful login, protected route, logout, and onboarding restart/resume.
6. If testing the pending PR behavior, verify both fresh schema-v2 setup and upgrade from schema-v1; record pending/merged status accurately.

## Related
- [18 Mobile app](18-mobile-app.md) · [21 Security, approvals, permissions](21-security-approvals-permissions.md)
- [20 Skills runtime](20-skills-runtime.md) · [24 Release, packaging, update](24-release-packaging-update.md)
- [routes inventory](generated/routes.md) · [tests inventory](generated/tests.md) · [tools inventory](generated/tools.md)
- Historical source hints: `workspace/self/19-onboarding-system.md`; main source, not the old guide, is authoritative.


## Route and state review details

### Account endpoint classes
- Public config/status endpoints allow the browser to learn whether login setup is available and whether a session exists.
- Login endpoints establish the account session; they are not a substitute for gateway authentication.
- Protected routes are mounted behind gateway auth and the account gate.
- Logout clears product-account session state but should not implicitly delete provider credentials or mobile pairing.
- Refresh updates the account session and should not log bearer material.
- A 401 from an account-gated endpoint is not automatically a gateway-token failure; inspect which middleware produced it.

### Onboarding transition review
For each `nextStep()` transition, check both its completion predicate and the corresponding mutation endpoint:
- Tutorial state tracks whether it was shown and completed.
- Migration state distinguishes completed from skipped and may hold a selected source identifier.
- Model state tracks first connection and the provider/model values observed.
- Meet-and-greet state records start/completion/session identity.
- Memory seeding has its own timestamp/consent boundary.
- The terminal `done` state depends on all required predicates, not merely closing the overlay.
- A backend restart should reload persistent state and resume at the next incomplete step.
- Multiple tabs should not silently race state writes or make a completed flow reappear.

### First-run and re-entry test matrix
- Fresh anonymous install: current main order and account response should be observed explicitly.
- Existing user with a completed tutorial but skipped migration: migration should not loop.
- User with a provider already connected: confirm how model health maps to stored first-connected state.
- Meet session interrupted by reload: resume or mark completion according to backend record.
- Memory confirmation declined: ensure no write occurs and UI can recover.
- Settings tutorial replay: verify no unrelated progress mutation.
- Dev test: verify no persistent memory seed or account mutation.
- Redo onboarding: test each confirmation gate and verify intended reset scope only.
- PR #567 worktree: test v1→v2 migration as well as clean v2 install before calling it safe.

## Account privacy and session handling
- Account status can reveal whether a user is logged in; expose only the UI fields needed by the client.
- Keep refresh tokens in the existing encrypted vault/session mechanism; don't invent localStorage persistence.
- A password-login UI should send credentials only to the expected local gateway endpoint over the protected origin.
- Strict status verification may make an upstream refresh request; don't add it to every render or polling loop.
- Session flags in memory do not necessarily indicate subscription/access billing states; read the session status contract.
- Remove auth state from browser UI on logout and handle invalid refresh without infinite retry.
- Account login and app user data records should not be keyed by untrusted display names.
- Do not migrate another provider's credentials into the product account session.


## PR #567 status ledger

| Requested behavior | Main at `a48712ccc` | Documentation status |
|---|---|---|
| Account enforcement off by default | `requireAccountAccess()` rejects unauthenticated requests when mounted | Opt-out/default-off change **pending in PR #567**. |
| Enable via `PROMETHEUS_REQUIRE_ACCOUNT` | Not found in main source search | **Pending in PR #567**; do not cite as live. |
| Enable via `config.account.required` | Not found in main config/type search | **Pending in PR #567**; verify schema in PR worktree. |
| `onboarding.json` v2 | Main store says `SCHEMA_VERSION = 1` | v2 **pending in PR #567**. |
| Model → meet → memory → tour | Main store currently begins tutorial → migration → model → meet → memory | Proposed order **pending in PR #567**. |
| Claude one-click connect at `src/auth/anthropic-cli-connect.ts` | File absent from main `src/auth/` | **Pending in PR #567**. |

This is a branch-sensitive note. Once #567 merges, update this table against the merge commit, remove the “pending” qualifier only for code actually present, and document migration/compatibility behavior from source and tests.

## Manual inspection checklist for PR/worktree comparison
- Compare `git merge-base`/branch commit to main and inspect the PR's changed-file list.
- Check environment parsing precedence: environment override vs `config.account.required` default.
- Check direct API route mounts as well as UI boot/auth wrapper; frontend-only gating is not enforcement.
- Check whether status/config/login endpoints remain accessible when account auth is required.
- Check onboarding version migration preserves existing tutorial/model/meet completion and memory consent.
- Check exact new sequence in store/controller and ensure no deprecated migration step is required for the new order.
- Check Claude CLI detection invokes a trusted local executable path and handles absent CLI/noninteractive environments.
- Check user consent for CLI OAuth/account scopes and preserve provider refresh credentials securely.
- Run fresh install, existing workspace upgrade, disabled-account mode and required-account mode.
- Verify tests cover both defaults and environment/config override precedence.


## Instrumentation and privacy checks

- Log transition labels/step names rather than onboarding record contents.
- Account login failures should surface safe reason codes; never echo raw upstream token responses to the UI.
- Do not attach user email or account IDs to analytics without the applicable consent/retention policy.
- Onboarding test fixtures should use synthetic names and memory content.
- Account status polling should be bounded and use cache/strict modes intentionally.
- Ensure redirects after OAuth/login are constrained to known local app paths.
- Invalidate account-dependent cached UI after logout or session expiry.
- Keep tutorial playback analytics separate from completion mutation.
- When reporting an auth problem, state whether it is gateway auth, account auth, provider auth, or device pairing.
- If a pending PR changes any of these behaviors, verify its tests and implementation before revising this main-branch reference.


## Safe support triage

- Identify whether the user is on a main build or a PR build before diagnosing a missing setting.
- Ask for the endpoint/status and safe error reason, not passwords, tokens or a raw account session dump.
- Establish which layer rejected the request by following route middleware order from `server-v2.ts`.
- Check whether the account router is mounted and whether the target route also has `requireAccountAccess`.
- Confirm a provider can answer a model-health check separately from confirming account login.
- Check onboarding JSON schema version with synthetic/redacted fields only; do not paste real record contents into a chat.
- If a user's onboarding flow loops, compare persistent step predicates to UI step completion, not local overlay visibility.
- If account status is stale, inspect normal vs strict status behavior and refresh result before changing client polling.
- If recovery requires a schema migration, make a backup and test on a copy before applying it to user data.
- Keep “current on main” and “expected after PR #567” clearly separated in issue notes and future docs.


When implementing account-required behavior in the PR worktree, keep the unauthenticated bootstrap path minimal: allow only the endpoints required to discover public account config/status and establish login, then gate application state behind the authenticated session. Verify gateway-token checks still run before account-session checks on protected APIs. A UI redirect alone is not access control, and enabling account gating must not make logout or password recovery unreachable.