# Shared multi-account plugins — plan for lock

Tier 2 · both surfaces · 2026-11-09. Build/open PR authorized by original request; merge/deploy/live credential mutations forbidden. Independent Astra-high planning substituted by Raul's explicit 'Use astra' quota decision (not opposite-model evidence). Twelve findings accepted in DEBATE.md. One-extra-build WIP exception approved b07d3103-93e3-4487-b22d-0bb54b6d2fb7.

## Verdict and scope
Build a shared account/instance safety contract across the entire plugin system. No Gmail-only shortcut and no singleton credential swapping. Inventory COVERAGE.json:49 bundled manifests plus7 dynamic families; current primitives are not certifications. Every row must resolve to tested support, a genuine non-account resource contract, or explicit gated unsupported behavior with reason. Browser profiles are not verified OAuth accounts; local resources still require access scopes.

## Use cases
1 Owner retains personal Gmail and adds business Gmail on phone; both survive restart; sender is explicit.
2 Business team sees only granted business account and permitted read/send capabilities; no personal labels, tokens or fallback.
3 Fresh-install user adds two instances of one MCP preset, with independent credentials, health and disconnect.
4 User reauthenticates one expired account on desktop without affecting its sibling; stale refresh/callback cannot revive removed access.
5 Provider contribution selects existing model connection; browser/local integration selects an actual profile/resource instead of pretending to have OAuth identity.

## Canonical contract
Extend existing ConnectionRecord, not a duplicate account database: opaque stable ID; owner; family/plugin identity; label; external verified account identity; family instance reference; lifecycle generation; permission revision. Credential material stays in existing vault with instance-scoped references and owner bindings. Display names/emails never key storage or routing. Provider app credentials are separate from user token identities.

Trusted execution principal originates from runtime session/task/team metadata, never model arguments. Connection grants bind principal, capabilities, resources and optional expiry. Delegation intersects parent/task/team scope; absent authority denies. Owner legacy single identity remains available; teams receive no automatic migration grants. Discovery is filtered before labels/identity are returned.

Resolve explicit connection_id after wrapper canonicalization and before approval. Resolve exactly once to immutable binding {connectionId, family, instanceId, verifiedIdentity, generation, policyRevision, principal, actionDigest}. Preserve out-of-band through composite/wrapper dispatch. Revalidate immediately before credential access/execution and after approval waits. Unknown, ambiguous, revoked, deleted or ungranted selections fail closed. No first/newest/healthy/personal fallback. One legacy owner account may resolve without selector for compatibility, but binding must still be explicit internally.

## Implementation boundaries
- Canonical persistence: src/connections/types.ts, connection-store.ts, legacy-migration.ts. Add recoverable/idempotent migration checkpoints; cross-file metadata/vault writes are not atomic. Keep previous secret until verified new pointer durable; rollback fail-closed after multi-account writes.
- Native13: connector-registry.ts instance factories keyed by canonical ID; oauth-base.ts instance-scoped token and refresh state; OAuth attempts/callback ownership keyed separately; fixed callback port conflicts handled deterministically. connector-oauth bridge/adapter receives instance identity for all lifecycle actions. Local detach default; remote revoke explicit and warn if provider grant can affect siblings.
- Protected keys: plugin-credential-binding.ts and credential owner/tombstone state scoped by connection. Add never replaces sibling; reauth replaces only selected generation. X/Vercel dedicated clients included, not assumed covered by native OAuth base.
- Execution: shared resolver invoked at agents-runtime/subagent-executor boundary before approval plus extension runtime and MCP dispatch/credential sinks. Review all direct wrappers/API requests/composites. Model provider credential selection/fallback respects selected/granted identity. Unknown custom extensions cannot silently inherit singleton access.
- MCP: preset ID retained as template; each canonical connection owns immutable server ID, process/transport/env/OAuth namespace and tools. Legacy alias only when uniquely authorized.
- Provider contributions: associate existing provider account IDs; do not copy credentials to a new model store. Scope fallback pools and billing account selection; explicitly reject unsupported account scoping.
- Browser/local: preserve existing profile/vault/resource identity; enforce actual isolation and paths. Unsupported shared/external sessions cannot claim parallel account isolation.
- Catalog/UI: replace records[0] projection with account rows and truthful aggregate status. Shared desktop/mobile module for add/select/rename/re-auth/cancel/disconnect/status and team/task grants. Channel tools offer selectors plus owner-UI setup handoff, never secrets. Preserve PR855 paired plugin setup rights separately from general approvals/grants/destructive authority.

## Build sequence within one isolated PR
1 Canonical policy, migration and execution binding tests.
2 Family adapters and credential lifecycle, per-row coverage updates.
3 Shared desktop/mobile account and permission controls.
4 E2E fixture tests, self docs, mandatory gates, independent fresh exact-head implementation review under approved quota substitute if still required. Stop on unresolved security findings, no bypass.

## Test/acceptance matrix
Two synthetic Gmail identities from setup through read/draft/approval routing; no real sends. Legacy single identity/reload; ambiguous/unknown selector; wrong account reauth; revoke/disconnect sibling preservation; concurrent refresh/cancel/late callback; interrupted migration; secret isolation; policy expiry/revocation during approval; argument/account/generation swap; team discovery leakage/delegation widening; direct/wrapper/composite/MCP routes; repeated MCP preset; API-key siblings; provider fallback; browser/local isolation. Real UI screenshot proof desktop1440/mobile390 using isolated temp fixtures. All tests must exercise actual integration paths, not only standalone helpers. No live accounts/config mutations or provider submissions.

## Docs and release
Read/update self12,17,18,21 and relevant self09/08/04/13; repository docs with support ledger and migration semantics. Hard gates pr-finish; unmerged PR with exact SHA, coverage and honest limitations. Live main remains untouched by this task. No claim of shipped or real-account certification.

## Risks / stop criteria
Stop if any credential-bearing path bypasses bound account authority, adding deletes sibling credentials, callback/refresh resurrects detached account, approval executes a different identity, or migration cannot recover. No undocumented partial coverage. Do not broaden paired-device authority accidentally. No new provider capabilities/spend/real external actions. Plan requires Raul lock before production edits; build permission already supplied.

## Lock
Raul LOCKED and authorized full build via question3ed9c85c-79aa-4e45-8487-d22ede88eb48: 'Recommended: lock and build the full scope'. No merge/deploy authorization. WIP exception and Astra quota substitution remain as recorded above.
