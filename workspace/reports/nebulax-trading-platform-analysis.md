# NebulaX Trading Platform Analysis

_Date: 2026-07-01_  
_Analyst: Sparky (`sparky_v1`)_

## Executive Summary

NebulaX is a static, browser-first Solana trading/arcade platform prototype. The main repo (`repos/nebulax-test/`) contains a multi-page HTML/CSS/JS app with Phantom wallet connection, Jupiter swap attempts, token discovery pages, portfolio/watchlist/store/game surfaces, Supabase schema planning, and Vercel deployment scaffolding. The companion repo (`repos/nebulax-exchange/`) is a small landing/custom-domain site pointing at `www.nebulax.exchange`.

The strongest parts already built are the UI breadth, Solana/Phantom connection work, GeckoTerminal/DexScreener data feeds, Jupiter quote/swap code, game/store prototypes, and an initial Supabase database schema. The biggest launch blockers are security and production architecture: exposed API/RPC keys, direct browser-side trading calls, no real backend/session/auth layer, many features stored only in `localStorage`, no package/build/test system, fragmented duplicated scripts, and a failing included integration check.

Bottom line: this is a promising visual/product prototype, not production-ready trading infrastructure yet. P0 work should focus on key rotation, backend proxy hardening, wallet/trade safety, deployment sanity, and consolidating duplicated code before any public relaunch.

## Repo Inventory

### `repos/nebulax-test/` — main platform

Observed structure:

- Static entry/login page: `repos/nebulax-test/index.html`.
- Main app shell/dashboard: `repos/nebulax-test/NebulaX.html`.
- Trading/token pages:
  - `repos/nebulax-test/Trending.html`
  - `repos/nebulax-test/NewPairs-official.html`
  - `repos/nebulax-test/Coinpage-Official.html`
  - `repos/nebulax-test/Adrenaline-official.html`
  - `repos/nebulax-test/portfolio_official_v_2_fixed.html`
  - `repos/nebulax-test/watchlist_official_v_2.html`
- Store/arcade surfaces:
  - `repos/nebulax-test/nebula_x_store_official.html`
  - `repos/nebulax-test/Arcadegamepanel.html`
  - `repos/nebulax-test/NEBX-Arcade.html`
  - `repos/nebulax-test/games/` with several standalone games.
- Shared scripts:
  - `repos/nebulax-test/assets/nx-wallet.js`
  - `repos/nebulax-test/assets/jupiter-swap-engine.js`
  - `repos/nebulax-test/assets/js/nx-jupiter.js`
  - `repos/nebulax-test/assets/js/nx-search.js`
  - `repos/nebulax-test/trending-engine.js`
  - `repos/nebulax-test/adrenaline-engine.js`
- Serverless API:
  - `repos/nebulax-test/api/jupiter.js`
- Database plan:
  - `repos/nebulax-test/supabase/migrations/001_init.sql`
  - `repos/nebulax-test/supabase/README.md`
- Vercel config:
  - `repos/nebulax-test/vercel.json` contains only `{ "version": 2 }`.
- Docs/status files:
  - `COMPREHENSIVE_ANALYSIS.md`, `DEPLOYMENT_READY.md`, `NEBULAX_CURRENT_SPECS.md`, `JUPITER_*`, `MOBILE_PHANTOM_UX.md`, etc.

No `package.json` exists in `repos/nebulax-test/`; a safe check returned `NO_PACKAGE_JSON`. That means there are no npm scripts, dependency locking, lint/build pipeline, or standard test runner in the repo root.

### `repos/nebulax-exchange/` — landing/custom-domain repo

Observed files:

- `repos/nebulax-exchange/index.html`
- `repos/nebulax-exchange/Shortdocs.html`
- `repos/nebulax-exchange/NebulaX-logo.png`
- `repos/nebulax-exchange/CNAME`

`repos/nebulax-exchange/CNAME:1` points to `www.nebulax.exchange`. This appears to be a lightweight static landing/custom-domain repo rather than the core app.

## Product/Feature Map

Built/prototyped features found in code and docs:

- **Wallet gate/login**: `index.html` is a “Connect Phantom” page. It uses `sessionStorage` key `nebula:wallet:session` at `index.html:74-84`, connects Phantom via `window.phantom?.solana` / `window.solana` at `index.html:101+`, and redirects into the app after connection.
- **Main trading dashboard/app shell**: `NebulaX.html` is the primary app surface and defines global RPC config (`NebulaX.html:141`).
- **Token discovery/trending**: `trending-engine.js` polls GeckoTerminal trending pools and enriches with DexScreener. Evidence: `trending-engine.js:1-5`, `trending-engine.js:88-99`, `trending-engine.js:161+`.
- **New pairs/adrenaline scanner**: `adrenaline-engine.js` fetches Solana new pools from GeckoTerminal (`adrenaline-engine.js:33-42`) and classifies new/migrating/migrated tokens using mcap, age, and DEX heuristics (`adrenaline-engine.js:1-17`, `adrenaline-engine.js:274-285`).
- **Coin detail/trading page**: `Coinpage-Official.html` contains Jupiter swap UI logic and token metric panels. It reads mint from URL/localStorage/window globals (`Coinpage-Official.html:1041-1075`).
- **Jupiter swaps**: two implementations exist:
  - Browser-side V6 engine in `assets/jupiter-swap-engine.js` with quote/swap endpoints (`assets/jupiter-swap-engine.js:18-26`, `assets/jupiter-swap-engine.js:68-147`) and transaction signing/sending (`assets/jupiter-swap-engine.js:248-356`).
  - Inline Jupiter V1-ish implementation in `Coinpage-Official.html:975-988`, including a hardcoded API key.
- **Portfolio/watchlist/store/game panels**: local app pages and Supabase schema include watchlists, trades, orders, positions, PnL, games, leaderboards, store items, purchases, launchpad projects, LP locks, and vesting (`supabase/migrations/001_init.sql:58-145`, `146-210`, `212-240`).
- **Mobile Phantom UX**: `assets/nx-wallet.js` includes mobile detection and Phantom universal/deep-link builders (`assets/nx-wallet.js:21-43`, `75-87`, `135-160`).

## Architecture and Tech Stack

Current architecture is mostly static frontend:

- Plain HTML files with large inline CSS/JS sections.
- Tailwind CDN on the login page (`index.html:10`) and external browser CDNs on pages such as Solana Web3 (`Adrenaline-official.html:13`).
- Browser-global JavaScript modules under `assets/` and many page-specific inline scripts.
- Vercel serverless function only for Jupiter proxying (`api/jupiter.js`).
- Supabase schema exists, but the live app appears to rely heavily on `localStorage`/`sessionStorage`, not a wired backend database.
- No package/build system: no root `package.json`, no dependency lock, no lint/test/build scripts.

Important architecture evidence:

- `vercel.json` is only 4 lines and declares version 2; it does not define routing, headers, rewrites, clean URLs, env requirements, or security headers (`repos/nebulax-test/vercel.json:1-4`).
- `api/jupiter.js` is an ESM Vercel function importing Node `https` and proxying to `public.jupiter-ag.workers.dev` (`api/jupiter.js:1-4`, `23-37`).
- Supabase schema is aspirational/comprehensive but not enough alone: `supabase/README.md:36-40` explicitly lists next steps such as adding granular migrations, RLS SQL, seed scripts, and a Supabase client.

## Trading/Data Integrations

### GeckoTerminal

- Trending engine fetches `https://api.geckoterminal.com/api/v2/networks/solana/trending_pools...` (`trending-engine.js:96-99`).
- Adrenaline/new-pairs engine fetches `https://api.geckoterminal.com/api/v2/networks/solana/new_pools...` (`adrenaline-engine.js:41-42`).

### DexScreener

- Adrenaline engine fetches `https://api.dexscreener.com/latest/dex/tokens/${mint}` (`adrenaline-engine.js:180`).
- Trending engine docs/code describe DexScreener enrichment and scoring (`trending-engine.js:1-5`, `DEPLOYMENT_READY.md:11-17`).

### Jupiter

- `assets/jupiter-swap-engine.js` uses public `quote-api.jup.ag/v6/quote` and `/swap` (`assets/jupiter-swap-engine.js:18-20`). It signs and sends transactions in-browser after Phantom signs (`assets/jupiter-swap-engine.js:282-309`).
- `api/jupiter.js` proxies `/v6/:endpoint` to `public.jupiter-ag.workers.dev` and allows CORS from `*` (`api/jupiter.js:5-8`, `23-36`).
- `Coinpage-Official.html` uses `https://api.jup.ag/swap/v1/quote` and `/swap` with a hardcoded `JUP_API_KEY` (`Coinpage-Official.html:982-988`).

### Solana / Phantom / Helius

- Many pages set `window.NX_RPC` to a Helius URL with a visible key. Example: `NebulaX.html:141`, `Trending.html:15`, `Coinpage-Official.html:18`, `portfolio_official_v_2_fixed.html:18`.
- `assets/nx-wallet.js` resolves RPC from `window.NX_RPC`, `localStorage.NX_RPC`, or Solana public RPC (`assets/nx-wallet.js:112-121`) and creates `solanaWeb3.Connection` instances (`assets/nx-wallet.js:124-130`).
- Phantom connection and mobile deep linking are present (`assets/nx-wallet.js:63-87`, `135-160`).

### Token/trade data flow

Observed flow:

1. Token lists come from GeckoTerminal/DexScreener.
2. Selected token data is pushed into browser storage, e.g. `nebula_selected_coin` (`Adrenaline-official.html:1342`, `Coinpage-Official.html:1052-1065`).
3. Coin page reads mint from URL/localStorage/global (`Coinpage-Official.html:1041-1075`).
4. Jupiter quote/swap code prepares transaction in browser, asks Phantom to sign, and sends via RPC (`assets/jupiter-swap-engine.js:248-356`).
5. Trade history is saved to `localStorage` under `nebulax_trades` (`assets/jupiter-swap-engine.js:25`, `156-184`).

This is functional for a prototype but weak for production analytics/account history because localStorage is device-local, tamperable, and not recoverable.

## Security and Secrets Findings

### Critical: hardcoded public API/RPC keys

A secret-pattern scan found visible keys:

- Helius RPC key repeated across many HTML pages, e.g.:
  - `Adrenaline-official.html:15`
  - `Arcadegamepanel.html:13`
  - `Coinpage-Official.html:18`
  - `NebulaX.html:141`
  - `Trending.html:15`
  - `watchlist_official_v_2.html:13`
- Jupiter API key exposed in browser code:
  - `Coinpage-Official.html:988` — `const JUP_API_KEY = '233fe202-5da0-4296-903f-8ca65bd71b36';`

Action: rotate these keys before public launch. Even if some are “public-ish” provider keys, they can be abused for quota drain and attribution risk.

### CORS/proxy risk

`api/jupiter.js` sets `Access-Control-Allow-Origin: *` and allows `GET, POST, OPTIONS` (`api/jupiter.js:5-8`). It does not restrict endpoint names, validate query/body shape, rate-limit, authenticate, or enforce origin. If deployed publicly, it can become an open Jupiter proxy.

### Browser-side transaction risk

The swap engine signs and sends transactions directly from the browser (`assets/jupiter-swap-engine.js:282-309`). That can be acceptable for Web3 apps, but production launch needs rigorous UX and safety controls:

- clear quote expiration and slippage display,
- transaction simulation/preflight feedback,
- route/token warnings,
- exact token decimals handling,
- malicious token/image/social sanitization,
- no hidden state from stale `localStorage`.

### LocalStorage/sessionStorage trust boundary

Examples:

- Wallet persistence via `localStorage` in `assets/nx-wallet.js:60-110` and session wallet state in `index.html:74-84`.
- Selected coin fallback from `localStorage` in `Coinpage-Official.html:1052-1065`.
- Trade history saved to localStorage in `assets/jupiter-swap-engine.js:156-184`.

This is fine for local UX memory, but not for balances, positions, achievements, purchases, or PnL truth.

### XSS/sanitization surface

There are many `innerHTML` uses that render dynamic token/game/store data. Examples:

- `Adrenaline-official.html:256`, `354`, `438`, `677`
- `assets/js/nx-search.js:292`, `300`, `378`
- `Coinpage-Official.html:1818`, `1874`
- `nebula_x_store_official.html:957`, `1141`

Some values are internal, but token names/symbols/logos/social links may come from external APIs. This needs a sanitation pass before public launch.

### Supabase/RLS not production-ready yet

`supabase/README.md:36-40` says recommended next steps include adding RLS policy SQL files and a Supabase client. The schema creates tables, but I did not find evidence of complete RLS enforcement or wired app usage. Treat Supabase as a schema draft until proven otherwise.

## Deployment/Vercel Readiness

Current readiness: **not production-ready** despite optimistic docs.

Evidence:

- `vercel.json` only has `version: 2` (`vercel.json:1-4`); no routes/rewrites/headers/env config.
- No `package.json`; no standard build command or install step.
- `api/jupiter.js` exists and may deploy as a serverless function, but the frontend mostly uses direct external APIs too.
- The included local verification script fails:

```text
node verify-integration.js
Files: ✅ All present
Code Integration: ❌ Some checks failed
Overall Status: ❌ NEEDS FIXES
Failure: Trending.html ❌ Engine initialization
```

The failing check expects `window.initTrendingEngine`; current `Trending.html` did not match that pattern according to `verify-integration.js:46-49` and the script output.

Likely deployment blockers:

1. Static pages may deploy, but deep-link routing/clean URLs are not configured.
2. Serverless API may work, but proxy is overly open and possibly misaligned with current Jupiter API versions.
3. Browser CDNs and inline scripts create CSP/security-header challenges.
4. Hardcoded keys must be moved/rotated.
5. No automated smoke tests to confirm wallet, quote, swap, token pages, and mobile UX after deploy.

## Code Quality and Maintainability

Strengths:

- Large amount of product surface is already prototyped.
- Docs are extensive and capture implementation thinking.
- Separation has started with shared files like `assets/nx-wallet.js`, `assets/jupiter-swap-engine.js`, `trending-engine.js`, and `adrenaline-engine.js`.
- The Supabase schema is broad and maps to real product domains.

Issues:

- Heavy duplication: wallet/RPC/header code appears repeated across many HTML pages.
- Multiple Jupiter implementations coexist (`assets/jupiter-swap-engine.js`, `assets/js/nx-jupiter.js`, inline code in `Coinpage-Official.html`, and `api/jupiter.js`). This increases drift and safety risk.
- Large monolithic HTML files: `Coinpage-Official.html` is 3,697 lines; `assets/jupiter-swap-engine.js` is 504 lines; `trending-engine.js` is 438 lines.
- No package manager/build/lint/test setup.
- Many status docs say “production ready,” but actual verification says “needs fixes.” Docs should be reconciled with code reality.
- Browser storage is being used as a pseudo-database for features that need server truth.

## Missing Production Pieces

P0 missing pieces:

- Key rotation and env-backed key management.
- Locked-down backend proxy/API layer for Jupiter and any paid/limited providers.
- Real auth/session model tied to wallet signatures and backend profiles.
- RLS policies and Supabase client integration if Supabase is the chosen backend.
- Transaction safety layer: quote freshness, simulation, clear route/slippage warnings, failure handling, token decimals correctness.
- XSS/sanitization pass on all external token/social/store rendering.
- Deployment config with headers, redirects/rewrites, env validation, and smoke tests.

P1 missing pieces:

- Consolidated shared wallet/trading/search modules.
- Central route/navigation model instead of many standalone pages.
- Persistent trade/order/position history beyond localStorage.
- Monitoring/logging/error capture.
- Mobile wallet callback handling verification.
- Basic CI checks.

P2 missing pieces:

- Product analytics.
- Admin/moderation tooling.
- Formal token risk scoring providers such as Rugcheck/Birdeye/Solscan/DefinedFi. `JUPITER_LIMITATIONS.md` notes Jupiter does not provide holder/sniper/dev/security metrics and suggests services like Rugcheck and Birdeye (`JUPITER_LIMITATIONS.md:186-210`).
- Accessibility and performance pass.
- Design-system extraction.

## Critical Risks

1. **Exposed keys before launch** — Helius and Jupiter keys are hardcoded in public files. Rotate and remove from frontend.
2. **Open proxy abuse** — `api/jupiter.js` currently allows `*` CORS and arbitrary endpoint-ish proxying.
3. **Real-money transaction UX risk** — browser-side swap execution exists, but production-grade safety/validation is not proven.
4. **Stale/local tamperable state** — selected coins, trade history, positions, store inventory, and wallet data depend heavily on localStorage/sessionStorage.
5. **XSS from token/social data** — many `innerHTML` render paths touch dynamic external data.
6. **Docs mismatch reality** — `DEPLOYMENT_READY.md` claims production-ready status, but `verify-integration.js` fails.
7. **No automated deployment confidence** — no npm scripts, package lock, Playwright/browser smoke tests, or CI.

## Recommended Fix Plan, prioritized as P0/P1/P2

### P0 — before any public relaunch

1. **Rotate exposed keys**
   - Rotate Helius key shown in multiple files.
   - Rotate Jupiter key in `Coinpage-Official.html:988`.
   - Remove all provider keys from frontend commits where possible.

2. **Harden backend/API layer**
   - Replace open `api/jupiter.js` CORS with allowlisted origins.
   - Validate endpoints and query/body schemas.
   - Add basic rate limiting and error normalization.
   - Use env vars for paid/keyed providers.

3. **Choose one Jupiter implementation**
   - Consolidate `assets/jupiter-swap-engine.js`, `assets/js/nx-jupiter.js`, inline `Coinpage-Official.html` logic, and `api/jupiter.js` into one reviewed flow.
   - Remove stale/duplicate paths after migration.

4. **Fix verification failure**
   - Align `Trending.html` with `verify-integration.js` or update the verification script if the expected init hook changed.
   - Re-run `node verify-integration.js` until it passes.

5. **Sanitize external data rendering**
   - Replace risky dynamic `innerHTML` paths for token symbols/names/socials with safe DOM construction or escaping.

6. **Add deployment safety config**
   - Expand `vercel.json` with headers, routes/rewrites if needed, and env expectations.
   - Add a small smoke-test checklist/script for deployed pages.

### P1 — production foundation

1. Add `package.json` with scripts for lint/check/smoke-test and a locked toolchain.
2. Wire Supabase intentionally:
   - create client module,
   - add RLS policies,
   - move persistent user data off localStorage,
   - migrate trade/order/position/watchlist/store state.
3. Implement wallet-signature auth, not just wallet-address identity.
4. Add transaction history reconciliation from chain/Jupiter signatures.
5. Centralize wallet/RPC/header/nav code.
6. Add monitoring and client error capture.

### P2 — polish/growth

1. Add token risk integrations: Rugcheck, Birdeye/Solscan holder data, LP burn checks, sniper/dev/bundler analysis.
2. Build admin controls for games/store/launchpad/token listings.
3. Add performance budget and lazy-load heavy pages/assets.
4. Improve mobile onboarding and Phantom callback testing.
5. Reconcile docs into one truthful launch checklist.

## Suggested Relaunch Roadmap

### Phase 1 — Stabilize the prototype

- Rotate exposed keys.
- Lock down Jupiter proxy.
- Fix the failing integration check.
- Pick one trading engine path.
- Add safe render helpers for external data.

### Phase 2 — Backend truth layer

- Finalize Supabase schema and RLS.
- Add wallet-signature auth.
- Persist watchlists, trades, positions, store purchases, game scores, and profiles in Supabase.
- Keep localStorage only as a cache/preferences layer.

### Phase 3 — Trading safety beta

- Add transaction preview/simulation.
- Add warnings for high slippage, stale quotes, unknown tokens, and poor liquidity.
- Add post-trade confirmation/reconciliation.
- Run private beta on limited pages: connect wallet → trending/new pairs → coin page quote → simulated/real small swap.

### Phase 4 — Public relaunch

- Deploy landing/custom-domain and app with security headers.
- Add uptime/error monitoring.
- Publish docs that match actual capabilities.
- Launch with clear beta/risk disclaimers if real trading remains enabled.

## Files/Areas Worth Inspecting Next

Highest-value follow-up files:

- `repos/nebulax-test/Coinpage-Official.html` — trading UX, hardcoded Jupiter key, duplicate swap logic.
- `repos/nebulax-test/assets/jupiter-swap-engine.js` — primary candidate for consolidated swap engine.
- `repos/nebulax-test/assets/js/nx-jupiter.js` — compare with swap engine and decide what survives.
- `repos/nebulax-test/api/jupiter.js` — harden or replace backend proxy.
- `repos/nebulax-test/assets/nx-wallet.js` — dedupe wallet state, switch away from localStorage where needed, verify mobile callback flow.
- `repos/nebulax-test/trending-engine.js` and `repos/nebulax-test/Trending.html` — fix verification mismatch.
- `repos/nebulax-test/adrenaline-engine.js` and `repos/nebulax-test/Adrenaline-official.html` — sanitize token/social rendering.
- `repos/nebulax-test/supabase/migrations/001_init.sql` — add RLS and migration discipline.
- `repos/nebulax-test/vercel.json` — add routing/security/env readiness.
- `repos/nebulax-exchange/index.html` + `CNAME` — confirm landing points users to the correct deployed app.

## Checks Run

- Repository tree inspection for `repos/nebulax-test/` and `repos/nebulax-exchange/`.
- Read key docs/config/source files including Vercel, Supabase, wallet, Jupiter, trending, landing site, and deployment docs.
- Secret/API-key pattern scan across HTML/JS/MD/JSON/SQL files.
- Integration/API usage grep across HTML/JS/MD files.
- Safe package metadata check: no `package.json` found in `repos/nebulax-test/`.
- Safe lightweight verification: `node verify-integration.js` ran and failed due to missing/mismatched Trending engine initialization.

## Final Assessment

NebulaX is best treated as a visually rich Web3 trading platform prototype with many valuable pieces already built, but it should not be relaunched publicly as a production trading platform until P0 security, backend, deployment, and verification issues are resolved. The fastest path is not a redesign; it is consolidation and hardening. Small win: the product direction is clear — now the code needs a spine.
