# NebulaX Revival Audit — 2026-07-17

**Scope:** Canonical evidence reviewed in `repos/nebulax-test/` and the separate `repos/nebulax-exchange/` marketing repository. This is a source and repository-state audit, not a production deployment test, smart-contract audit, legal opinion, or custody assessment.

---

## Executive status

**NebulaX is a broad Solana platform/ecosystem prototype, not a generic terminal MVP.** Its strongest asset is a recognizable ecosystem concept: discovery and Jupiter routing wrapped in the Nebby universe, Adrenaline migration/risk discovery, a games Arcade, launcher/launchpad ambitions, store/PFP/theme identity, portfolio/watchlist surfaces, and an intended NEBX-funded economic loop. The static prototype contains substantial visual and interaction work across those surfaces.

It is **not ready to operate as a production financial platform**. The canonical implementation is a static multipage repository with no package manager, lockfile, build pipeline, test suite, server-side application boundary, authenticated user model, contract implementation, or production-grade data/transaction controls. Several screens have real browser interactions and provider calls, but the platform’s authoritative state is largely browser-local and the intended NEBX economy, staking, anti-rug enforcement, and launchpad safety guarantees are specifications rather than shipped systems.

**Status judgment:**

- **Exists / meaningful prototype:** ecosystem IA and visual language; wallet connection helpers; discovery pages; Adrenaline page/engine; Jupiter integration artifacts; portfolio/watchlist presentation; Arcade shell/game panel; store, PFP, and theme surfaces; individual Nebby game assets/projects.
- **Partially functional:** browser wallet/session and balance display; provider-fed discovery and scoring; Jupiter quote/swap integration paths; page navigation; some game embedding and local profile presentation.
- **Prototype-only:** user profile/portfolio persistence, store ownership, game points/rewards, launchpad UI, trading controls, anti-rug claims, mobile behavior, error handling, and analytics/observability.
- **Missing / rebuild:** secure backend, canonical identity/data model, transaction policy service, real entitlement/reward ledger, contracts and independent audits, NEBX token/reward operations, launchpad program and moderation, compliance program, CI/CD, secrets management, observability, and an integrated responsive application shell.

**Revival recommendation:** preserve NebulaX’s full-platform thesis. Do not collapse it into “another terminal.” But ship a disciplined first ecosystem slice: **wallet-optional discovery plus authenticated wallet profile/watchlist, with Adrenaline as the differentiated first-class module**, and make every trading/NEBX/launchpad claim explicitly staged until its technical and legal prerequisites exist.

---

## Evidence-backed inventory

### Repository and delivery evidence

| Evidence | Finding | Implication |
|---|---|---|
| `repos/nebulax-test/.git` | Canonical prototype remote: `https://github.com/XposeMarket/nebulaxtest.github.io.git`. | This is the product-prototype baseline to inventory and selectively migrate, not a deployable modern app. |
| `repos/nebulax-test/package.json` | Absent. | No declared dependencies, reproducible install, lockfile, build, lint, typecheck, test, or release workflow. |
| `repos/nebulax-test/` | Static multipage HTML/JS/CSS repository with direct CDN dependencies and browser scripts. | Shared logic is distributed across pages; modernization needs an intentional app-shell/data-layer extraction rather than another page patch. |
| Git status, 2026-07-17 | Modified: `NebulaX.html`, `assets/js/inline-02.jsx`, `assets/nx-wallet.js`, `index.html`. Untracked: `assets/css/nx-dashboard-mobile.css`, `assets/js/portfolio-card.js`, `reports/`. | Current work is dirty and must be snapshot/reviewed before migration or a release decision. |
| `repos/nebulax-exchange/` | Separate remote `https://github.com/XposeMarket/NebulaX.exchange.git`; contains `CNAME`, `index.html`, `NebulaX-logo.png`, `Shortdocs.html`. | This is a separate lightweight marketing/custom-domain site, not the canonical application implementation. Assign it a marketing/redirect role only after product routing is decided. |

### Product-surface inventory

| Surface | Primary evidence | Current evidence-backed state | Classification |
|---|---|---|---|
| Core dashboard / ecosystem navigation | `NebulaX.html`, `index.html`, shared assets | A multipage branded interface and navigation exist. There is no unified router, API boundary, or backend session. | Prototype implemented |
| **Adrenaline** | `Adrenaline-official.html`, `adrenaline-engine.js` | Dedicated migration/risk-oriented discovery surface and engine are present. It is the clearest differentiated module, but browser/provider data is not a trading-grade risk service. | Partially functional prototype |
| Trending | `Trending.html`, `trending-engine.js` | Solana discovery UI and client-side data/scoring logic exist. It relies on third-party feeds and browser execution. | Partially functional prototype |
| New Pairs | `NewPairs-official.html` | Separate discovery surface exists. Freshness, source normalization, availability, and abuse/risk guarantees are not established. | Prototype implemented |
| Coin page | `Coinpage-Official.html` | Token-detail presentation exists. It is not evidence of verified asset metadata, risk labeling, holdings reconciliation, or execution safety. | Prototype-only / partial UI |
| Portfolio and watchlist | `portfolio_official_v_2_fixed.html`, `watchlist_official_v_2.html`, untracked `assets/js/portfolio-card.js` | Screens and client-side presentation exist; no canonical server portfolio, entitlement, or synchronized watchlist model was found. | Prototype-only |
| Wallet entry | `assets/nx-wallet.js`, page-level wallet bootstraps | Phantom/Solana-provider detection, connection paths, mobile/deep-link-related handling, and balance display are implemented in browser scripts. Wallet address is not a secure app identity or authorization model. | Partially functional |
| Jupiter trading | `assets/jupiter-swap-engine.js`, related Jupiter docs, `api/jupiter.js` | Jupiter integration artifacts and proxy exist. Transaction path needs a formal policy/quote/confirmation architecture and live test evidence before beta. | Partially functional, unsafe for production |
| **Nebby Arcade / Arcadegamepanel** | `NEBX-Arcade.html`, `Arcadegamepanel.html` | Arcade surface and an iframe/game-panel experience exist. Page code includes a wallet display and direct CDN dependencies; no durable score, reward, anti-cheat, or payout service is evidenced. | Prototype implemented |
| **Nebby Run / Defender / Explore** | `games/` subdirectories and game assets | Distinct game projects/assets are present under `games/`; their exact runnable entry paths and cross-device behavior need a dedicated smoke pass. | Prototype-only, preserve as content assets |
| Store / PFPs / themes | `nebula_x_store_official.html`, `PFPs/`, `nx-theme.js` | Store presentation, PFP asset collections, and theme behavior exist. Ownership, purchase settlement, inventory, refund/support, and content governance do not. | Prototype-only |
| NebbyLauncher / launchpad | `NebbyLauncher.html`, `NEBULAX_CURRENT_SPECS.md` | Launchpad-branded UI and extensive conceptual rules exist. No deployed launchpad program, token factory, LP lock mechanism, monitoring/penalty enforcement, moderation workflow, or contract audit is evidenced. | Prototype-only / missing core |
| NEBX economy / staking | `NEBULAX_CURRENT_SPECS.md` | Detailed proposed fee splits, buyback/burn, arcade/store flows, global/token staking, and anti-rug economics are specified. They are roadmap assumptions, not an implemented financial system. | Intended roadmap only |
| Supabase direction | `supabase/migrations/001_init.sql`, `supabase/README.md` | A draft initialization migration exists. It is not evidence of a deployed schema, RLS policy review, auth integration, or production data lifecycle. | Draft / partial foundation |

---

## Current product thesis

NebulaX’s defensible thesis is **a Solana-native discovery, execution, identity, and entertainment ecosystem where Nebby-branded experiences create retention beyond one trading screen**. The ecosystem should connect:

1. **Discovery:** Trending, New Pairs, Coin pages, and Adrenaline—especially a clear migration/risk lens rather than generic token lists.
2. **Personal command center:** wallet-linked profile, portfolio, watchlists, preferences, PFPs/themes, and an activity record.
3. **Execution:** Jupiter-routed non-custodial swaps with an explicit transaction-safety model.
4. **Culture and retention:** Nebby Arcade, the game panel, Nebby Run/Defender/Explore, collectible PFPs/themes, and a store.
5. **Longer-term platform economy:** NEBX utility, launchpad fees, staking/rewards, and safety tooling—but only after contracts, governance, disclosure, operational controls, and audits exist.

The thesis fails if all of those are described as live today. The near-term product should lead with an honest **“NebulaX discovery ecosystem”** beta, use Adrenaline as the wedge, and steadily connect the other surfaces through a shared identity/data layer.

---

## Implemented-vs-missing capability matrix

| Capability | Exists / works evidence | Partial or prototype limitation | Missing / rebuild requirement |
|---|---|---|---|
| Shared user identity | Wallet connection helpers exist. | Wallet-only entry and browser-local session/state do not establish a secure account, recovery, consent, or cross-device profile. | Wallet-sign-in challenge, account/profile service, session management, optional non-wallet onboarding, consent and account recovery policy. |
| State and persistence | `localStorage`/browser-state patterns are used by the prototype. | Browser storage can be cleared, altered, become stale, or diverge across devices; it cannot be authoritative for balances, ownership, rewards, or security decisions. | Server-authoritative data model, event/audit history, cache strategy, reconciliation jobs, and explicit offline/local preference boundary. |
| Market discovery | Client discovery pages/engines exist. | Provider dependence, client-side calls, inconsistent freshness/error behavior, and no normalized asset/risk record. | Provider adapters, cached normalized feeds, timestamp/source labels, rate limiting, data-quality monitoring, abuse/risk pipeline. |
| Adrenaline intelligence | `Adrenaline-official.html` and `adrenaline-engine.js` exist. | Current computation is presentation/prototype logic, not a verified migration/risk oracle. | Defined signals, provenance, confidence model, backend scoring, alert delivery, false-positive handling, and “not financial advice” UX. |
| Portfolio/watchlist | Screens exist. | No authoritative holdings/indexing/watchlist sync is evidenced. | Indexed holdings service, wallet reconciliation, server watchlists, alert preferences, pagination, retention/deletion controls. |
| Swaps | Jupiter artifacts and a Vercel proxy exist. | Current proxy and browser paths do not provide production policy, quote integrity, fee transparency, transaction simulation, or incident controls. | Closed BFF contract, allowlisted routes, server rate limiting, quote/tx validation, simulation policy, explicit signing flow, staging tests, monitoring. |
| Wallet security | Browser provider support exists. | Wallet-only gating excludes discovery users and risks conflating connection with identity or authorization. | Wallet connect/sign separation, scoped permissions, multi-wallet support, mobile QA, phishing-safe copy, revocation/disconnect behavior. |
| Arcade/games | Arcade/panel and game assets/projects exist. | No durable accounts, score validation, entitlement, reward, or anti-cheat evidence. | Game catalog service, signed score/event ingestion, anti-cheat policy, account linkage, moderation/support, telemetry. |
| Store/PFP/themes | UI/assets/theme scripts exist. | No real catalog/inventory/ownership/settlement. | Catalog CMS, entitlement ledger, checkout/payments architecture, receipts, refund/support process, content review. |
| NEBX / rewards / staking | A detailed intended model is documented. | No token program, reward ledger, staking contract, accounting, tax/reporting, governance, or audit. | Legal/product decision, token architecture, programs, audits, treasury controls, reward accounting, disclosures, incident response. |
| Launchpad / anti-rug | UI/specification exists. | “Transaction halted,” LP locks, penalties, and safety claims are not implemented evidence. | Token factory/program design, authority model, monitoring, lock/vesting contracts, moderation/KYC policy as applicable, audits, dispute/incident operations. |
| Engineering delivery | Static files can be served. | No package manifest or CI; CDN Tailwind is used in pages and emits the production warning path. | Typed app workspace, pinned dependencies/lockfile, CI, tests, environment schema, secrets management, deploy promotion and rollback. |

---

## UX and technical debt

1. **Fragmented multipage architecture:** duplicated page bootstraps, styles, wallet wiring, and state assumptions make changes inconsistent and regressions likely.
2. **No product-wide source of truth:** local browser state is used as practical authority for user-facing data that needs secure server reconciliation.
3. **Wallet-only entry:** discovery and culture surfaces should be explorable before connection; connecting a wallet should not be the only identity/product entry path.
4. **Direct CDN dependency:** pages load Tailwind from `https://cdn.tailwindcss.com` (including `Arcadegamepanel.html` and `NebbyLauncher.html`), an explicitly development-oriented runtime pattern; versions, integrity, performance, CSP, and offline behavior are uncontrolled.
5. **Mobile uncertainty:** current dirty files include `assets/css/nx-dashboard-mobile.css`; this signals active mobile work but no controlled responsive acceptance baseline.
6. **Inconsistent data ownership:** portfolio, rewards, store ownership, profiles, and game scores need explicit boundaries instead of page-local behavior.
7. **Prototype copy can overpromise:** anti-rug, “rugs = pumps,” staking/reward economics, and launchpad protections must never be treated as current guarantees.
8. **No observability or support plane:** no verified error tracking, feature flags, status page, product analytics, admin tools, or user-support audit trail.

---

## Security, compliance, and product risks for a Solana platform

### Critical technical risks

- **Open Jupiter proxy:** `repos/nebulax-test/api/jupiter.js` is a Vercel proxy with CORS/open endpoint behavior and arbitrary endpoint-selection risk. It can be abused as an open relay, creates rate-limit/cost exposure, and weakens the transaction/data trust boundary. Replace it before any real-money beta.
- **Client-visible infrastructure configuration:** representative pages directly set an Helius RPC URL/API key (for example `Arcadegamepanel.html:13` and `NebbyLauncher.html:13`). Even if a key is intended as public quota configuration, it needs rotation, domain/rate controls, and an environment-managed provider strategy.
- **Browser-local authoritative state:** localStorage/session/browser state is user-controlled and unreliable for balances, ownership, game rewards, eligibility, fees, or safety decisions.
- **No transaction policy layer:** Jupiter routing is not enough. The platform must control quote freshness, route/asset policy, simulation feedback, fee disclosure, approval wording, retry/cancellation state, and signing boundaries.
- **No tested deployment supply chain:** absent `package.json` means no reproducible dependency graph, scripts, lockfile, or automated checks. Static CDN assets also complicate CSP/SRI and availability control.

### Financial, legal, and operational risks

- **Non-custodial does not eliminate responsibility:** user-facing swap/launchpad/reward flows require accurate disclosures, incident support, phishing defenses, accessibility, privacy terms, and clear service boundaries.
- **NEBX economics create regulated-product and consumer-protection questions:** staking rewards, buyback/burn, treasury use, fee sharing, and yield-like marketing need jurisdiction-specific legal review and factual disclosure before public launch.
- **Launchpad and anti-rug claims are high-risk:** guaranteeing halted rugs, LP protection, or loss prevention creates technical, legal, reputational, moderation, and adversarial-monitoring obligations. Do not make those claims until independently audited mechanisms and documented limitation handling exist.
- **Token/discovery risk:** ranking/migration signals must show source, timestamp, confidence, conflicts, and “not financial advice” language. Avoid implied endorsements or deterministic safety scores.
- **Store/Arcade rewards:** any value-bearing rewards require anti-fraud, age/geography rules as applicable, accounting, tax/consumer disclosures, support, and an immutable event ledger.

---

## Recommended full-ecosystem MVP scope and architecture

### Product scope: the first credible ecosystem MVP

The MVP should be called a **NebulaX Discovery Beta**, not a terminal launch. It should include:

- Public, wallet-optional landing/app access.
- Trending, New Pairs, token page, and **Adrenaline** as the featured differentiated discovery module.
- Wallet sign-in only for personal features: synced watchlist, profile, PFP/theme preference, and opt-in alerts.
- A lightweight Nebby Arcade catalog with games clearly marked as entertainment; no cash-equivalent rewards or NEBX payouts.
- A read-only store/catalog preview with no purchase/ownership claims until entitlement/payment work exists.
- Jupiter swaps only after the execution readiness gate; otherwise show a clearly labeled **“execution coming in beta”** state rather than a broken/live-looking trade control.
- NEBX, staking, launchpad, fee sharing, buybacks, and anti-rug protections shown as **roadmap concepts**, not enabled economics.

### Architecture target

| Layer | Recommended responsibility |
|---|---|
| Web application | One responsive application shell with shared design system, routes for Discovery, Adrenaline, Portfolio, Arcade, Store, and Profile; legacy HTML acts as a visual/content reference, not the runtime core. |
| Identity | Wallet connection plus a signed nonce challenge for authenticated profile actions; wallet-optional public browsing; consent, disconnect, and deletion paths. |
| Backend-for-frontend | A closed API surface for market adapters, identity, watchlists, preferences, game/catalog metadata, and transaction preparation. Never expose arbitrary provider endpoint forwarding. |
| Market/data pipeline | Provider adapters, cache/normalization, asset metadata, data timestamps, rate limits, source attribution, stale/error states, and separate Adrenaline scoring service. |
| Transaction service | Allowlisted Jupiter integration, server-side policy/validation, quote freshness, simulation/transaction metadata, fee disclosure, client-side wallet signing only, telemetry and incident controls. |
| Data | Production database/RLS designed from the Supabase draft but reviewed and deployed deliberately; server is authoritative for user data/entitlements, chain indexers authoritative for on-chain balances/events. |
| Arcade/store | Catalog and entitlement service first; signed game-event ingestion later; no monetary rewards until risk/accounting/compliance gates are passed. |
| Platform operations | Versioned configuration and secrets, CI/CD, SAST/dependency/secret scans, CSP/security headers, observability, feature flags, admin/support tooling, privacy/terms/risk notices. |


### Critical credential and transaction-boundary finding

- `repos/nebulax-test/Coinpage-Official.html:988` embeds a Jupiter API key directly in browser JavaScript and uses it as `x-api-key` later in the page. Treat it as compromised: revoke/rotate it, remove it from public source and deployment history, and move any key-backed Jupiter access behind a constrained server boundary. This audit does not reproduce the key value.
- `repos/nebulax-test/api/jupiter.js` accepts a caller-controlled Jupiter endpoint and returns `Access-Control-Allow-Origin: *`; it has no evidenced endpoint allowlist, request schema validation, authentication, request-size guard, rate limit, or abuse controls. It is not safe as a public transaction/data proxy.
- `assets/jupiter-swap-engine.js` contains a real mainnet-capable path—wallet signature, raw transaction broadcast, and `confirmed` status—but not a complete production safety layer (route/mint policy, quote-expiry and expected-output guards, simulation/result review, finalized reconciliation, durable audit trail, or kill switch). It must remain gated until the controlled-trading phase.
- `supabase/migrations/001_init.sql` explicitly leaves row-level security as placeholders. It must not be exposed through Supabase APIs until RLS is enabled on every user-linked table and ownership/admin policies, validation constraints, and migration controls are reviewed.

---

## Phased build sequence

### Phase 0 — Preserve and establish truth (1–2 weeks)

1. Snapshot the dirty prototype state and classify every changed/untracked file.
2. Build a route/surface inventory with screenshots and a reproducible local smoke checklist.
3. Freeze public language to prototype/pre-beta state; remove or qualify all unimplemented financial guarantees.
4. Define a single product owner for each ecosystem surface and a source-of-truth migration map.

### Phase 1 — Foundation and discovery beta (2–5 weeks)

1. Create a modern typed application workspace with pinned dependencies, lockfile, lint/typecheck/test scripts, CI, staging, and secrets policy.
2. Implement shared shell/design tokens and wallet-optional access.
3. Move Trending, New Pairs, Coin page, and **Adrenaline** behind normalized read-only data adapters.
4. Implement wallet sign-in plus server-synced watchlist/profile/PFP/theme preferences.
5. Add telemetry, error states, source timestamps, risk disclosures, and support/status basics.

### Phase 2 — Personal ecosystem and culture (3–6 weeks)

1. Add portfolio reconciliation/indexing and activity history.
2. Release the Arcade catalog and embed validated Nebby Run/Defender/Explore builds; collect non-value scores/events only.
3. Turn the store into a managed catalog/entitlement preview; keep purchases and NEBX claims disabled.
4. Create a unified mobile acceptance suite rather than page-by-page CSS patches.

### Phase 3 — Controlled trading beta (only after gate completion)

1. Replace `api/jupiter.js` with a closed BFF and transaction policy layer.
2. Ship staged, allowlisted Jupiter execution with quote freshness, simulation, signing clarity, full fee disclosure, monitoring, and rollback/kill switch.
3. Run internal then invite-only real-wallet testing with incident response and explicit beta terms.

### Phase 4 — NEBX and launchpad research-to-production (separate program)

1. Obtain legal/product decisions on token utility, staking/rewards, geography, marketing, treasury, and governance.
2. Design and independently audit programs, reward ledger/accounting, authority controls, and safety mechanisms.
3. Build launchpad moderation, anti-abuse, lock/vesting, monitoring, disclosure, and support operations before public claims.
4. Only then decide whether Arcade/store economics and NEBX staking are in scope for release.

---

## Ten highest-leverage next tasks

1. **Create a clean evidence snapshot of `repos/nebulax-test`** and review the exact dirty files before any migration or deployment decision.
2. **Disable or replace the open Jupiter proxy** in `api/jupiter.js`; do not expose real swap flows through arbitrary CORS/endpoint forwarding.
3. **Create the new application workspace and CI baseline**: package manifest, lockfile, env schema, formatter/linter/typecheck/unit tests, secret scan, build, and staging deploy.
4. **Define the authoritative data model** from `supabase/migrations/001_init.sql`: wallet identity, profiles, preferences, watchlists, game events, store catalog, entitlements, audit history, RLS.
5. **Ship the Discovery Beta shell** with the four discovery surfaces: Trending, New Pairs, Coin, and Adrenaline—read-only first.
6. **Make Adrenaline rigorous**: define inputs, sources, confidence, stale/error behavior, and what it does *not* claim to know.
7. **Implement wallet sign-in and synced personal preferences**, keeping browsing wallet-optional and treating localStorage as a cache only.
8. **Do a dedicated mobile and accessibility pass** for the shared shell and representative flows before importing more legacy screens.
9. **Repackage Arcade as a catalog** and smoke-test Nebby Run, Defender, and Explore with explicit content/telemetry boundaries, no value-bearing rewards.
10. **Write the NEBX/launchpad decision memo** separating confirmed product intent from contracts, legal review, audits, accounting, treasury operations, and public claims.

---

## Open decisions and assumptions

1. **Canonical product repository:** should `repos/nebulax-test` evolve in place or be retained as a frozen reference while a new app repository becomes canonical? Recommendation: freeze/reference it and build a clean app with explicit migrations.
2. **Domain strategy:** what should `repos/nebulax-exchange` do—marketing only, waitlist, documentation, or redirect to the application? It must not be mistaken for the implementation repository.
3. **Adrenaline’s promise:** is it a migration radar, risk signal feed, social/community signal, or execution filter? It needs a bounded answer before scoring logic is productized.
4. **Jupiter execution timing:** discovery beta should not depend on trading. Decide whether swaps are a controlled Phase 3 feature or intentionally deferred.
5. **Wallet-only policy:** recommendation is no—allow public exploration and require signed wallet auth only for personal/server actions.
6. **NEBX status:** is NEBX an internal roadmap, planned token, or active external asset? This audit assumes it is intended roadmap only because no production implementation evidence was found.
7. **Store value model:** decide whether the first store is free/cosmetic catalog only, fiat checkout, on-chain NFT/asset entitlement, or a later NEBX utility. Each has different requirements.
8. **Arcade rewards:** do not tie scores to money/tokens until anti-cheat, accounting, legal, and abuse controls have a funded owner.
9. **Launchpad posture:** do not call it safe/anti-rug before contracts/audits/operations exist; decide whether it is a long-term vertical or should be removed from near-term navigation.
10. **Jurisdiction and compliance:** token, staking, rewards, marketing, privacy, and launchpad geofencing require counsel and operational assumptions before public beta terms are written.

---

## Recommended first execution slice

**Slice: NebulaX Discovery Beta — Adrenaline-first, wallet-optional.**

Build one responsive app shell that ships:

- Landing/dashboard navigation;
- Trending, New Pairs, token detail, and Adrenaline through normalized read-only adapters;
- source/timestamp/loading/stale/error states and “not financial advice” disclosure;
- wallet connection plus signed-in, server-synced watchlist/profile/preferences; and
- a visible roadmap card for Arcade, Store, NEBX, and Launcher instead of pretending their financial mechanics are live.

**Explicit exclusions from the first slice:** swaps, deposit/withdraw semantics, launchpad creation, NEBX issuance/staking/rewards, store purchases, paid game rewards, anti-rug enforcement, and any custody-like balance claim.

**Why this slice:** it protects the full ecosystem thesis while delivering the most differentiated, low-custody value first. It also establishes the data, identity, UI, and operations foundations every later surface needs.

**Acceptance gate:** reproducible build/CI; secure environment configuration; no arbitrary proxy; authenticated server watchlists/preferences; a populated/read-only data path with source/freshness/error labels; mobile and accessibility smoke tests; and reviewed public beta disclosures.

---

## Exact paths and blockers

### Primary evidence paths

- `repos/nebulax-test/`
- `repos/nebulax-test/NebulaX.html`
- `repos/nebulax-test/index.html`
- `repos/nebulax-test/Adrenaline-official.html`
- `repos/nebulax-test/adrenaline-engine.js`
- `repos/nebulax-test/Trending.html`
- `repos/nebulax-test/trending-engine.js`
- `repos/nebulax-test/NewPairs-official.html`
- `repos/nebulax-test/Coinpage-Official.html`
- `repos/nebulax-test/portfolio_official_v_2_fixed.html`
- `repos/nebulax-test/watchlist_official_v_2.html`
- `repos/nebulax-test/assets/nx-wallet.js`
- `repos/nebulax-test/assets/jupiter-swap-engine.js`
- `repos/nebulax-test/api/jupiter.js`
- `repos/nebulax-test/NEBX-Arcade.html`
- `repos/nebulax-test/Arcadegamepanel.html`
- `repos/nebulax-test/games/`
- `repos/nebulax-test/NebbyLauncher.html`
- `repos/nebulax-test/nebula_x_store_official.html`
- `repos/nebulax-test/PFPs/`
- `repos/nebulax-test/nx-theme.js`
- `repos/nebulax-test/supabase/migrations/001_init.sql`
- `repos/nebulax-test/NEBULAX_CURRENT_SPECS.md`
- `repos/nebulax-exchange/index.html`
- `repos/nebulax-exchange/CNAME`

### Current blockers

1. No `repos/nebulax-test/package.json`, lockfile, build, test, CI, or release pipeline.
2. Dirty working tree: `NebulaX.html`, `assets/js/inline-02.jsx`, `assets/nx-wallet.js`, `index.html`, plus untracked `assets/css/nx-dashboard-mobile.css`, `assets/js/portfolio-card.js`, and `reports/`.
3. `api/jupiter.js` has open CORS/arbitrary-endpoint proxy risk and is not a production transaction boundary.
4. Supabase is a draft migration, not verified deployed/authenticated/RLS-reviewed infrastructure.
5. Browser/localStorage state is effectively authoritative in portions of the prototype and cannot safely represent user/account/financial truth.
6. Wallet connection is the primary entry mechanism; no secure signed identity or server session model is evidenced.
7. Direct CDN Tailwind appears in representative pages and requires replacement/pinning as part of the modern build/security posture.
8. Games, store, PFPs/themes, and launcher visuals exist but lack a common entitlement, moderation, support, and audit model.
9. NEBX, staking, launchpad, and anti-rug claims remain specification-level concepts with no evidenced programs/contracts/audits/operations.
10. The separate `repos/nebulax-exchange` marketing repository requires a deliberate domain/CTA relationship to the future app.

---

## Audit conclusion

NebulaX should be revived as a **cohesive Solana ecosystem**—discovery, Adrenaline intelligence, identity, culture, Arcade, collectibles, and eventually execution/economics—not reduced to a generic terminal. The codebase is useful prototype capital, but it must be treated as a visual/interaction reference rather than production financial infrastructure.

The correct next move is a clean, Adrenaline-first Discovery Beta that establishes secure identity, normalized data, product truthfulness, and a shared ecosystem shell. Trading, NEBX, staking, launchpad, store settlement, and anti-rug claims follow only after their separate technical, legal, security, and operating gates are actually complete.
