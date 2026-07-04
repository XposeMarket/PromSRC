# NebulaX Workspace Analysis (Investigation)

**Date:** 2026-07-04  
**Scope:** `repos/nebulax-test`, `repos/nebulax-exchange`, prior `reports/nebulax-trading-platform-analysis.md`  
**Method:** Repo tree, key source reads, specs/docs cross-check

---

## 1. What NebulaX Is

**NebulaX** is Raul’s **Solana memecoin trading + gamification product** (brand **@NXNebulaX** on X). Positioning: *“gaming-based Solana trading”* — neon UI, signal discovery (trending / new pairs / migration funnel), Jupiter swaps, portfolio/watchlist, theme store, and **Nebby** arcade games tied to **NEBX** tokenomics (staking, launchpad, anti-rug narrative).

**Workspace layout:**

| Path | Role |
|------|------|
| `repos/nebulax-test/` | Full static prototype (~149 files): pages, engines, games, Supabase SQL draft, Vercel Jupiter proxy |
| `repos/nebulax-exchange/` | Marketing **Coming Soon** site (`www.nebulax.exchange` CNAME) |
| `reports/nebulax-trading-platform-analysis.md` | Sparky audit (2026-07-01): security/architecture gaps |

There is **no** top-level `Nebula X` folder; GitHub clones `raulvianamx/Nebulax` / `xpose-market/Nebulax` were **not found** — local copies live under `repos/nebulax-*`.

---

## 2. Product Surface (Implemented in HTML/JS)

### User journey
1. `index.html` — Phantom connect → redirect `NebulaX.html`
2. **Hub** — `NebulaX.html` (~16 KB, dashboard shell + inline React-ish modules in `assets/js/inline-*.js`)
3. **Discovery** — `Trending.html` + `trending-engine.js`; `NewPairs-official.html`; `Adrenaline-official.html` + `adrenaline-engine.js` (new / migrating / migrated panels)
4. **Trade** — `Coinpage-Official.html` + Jupiter quote/swap (client + `api/jupiter.js` proxy)
5. **Holdings** — `portfolio_official_v_2_fixed.html`, `watchlist_official_v_2.html`
6. **Monetization UX** — `nebula_x_store_official.html` (themes/PFPs)
7. **Games** — `NEBX-Arcade.html`, `games/Nebby Run`, `Nebby Defender`, `Nebby Explore`, test duplicates in `games/Tests` and `New folder`

### Data pipeline (trending)
- **GeckoTerminal** trending pools → rate limit ~25/min client-side
- **DexScreener** batch enrichment
- **NebulaXTrendingScore** → S/A/B tiers (documented algorithm matches `trending-engine.js`)
- In-memory cache (200 tokens), 5s refresh config

### Planned backend (not wired to UI)
- `supabase/migrations/001_init.sql` — profiles, wallets, tokens, markets, watchlists, trades/orders/positions, games/leaderboards, RLS-oriented schema (~282 lines)
- **No** root `package.json`, **no** build pipeline, **no** evidence of live Supabase client keys in reviewed entry files

---

## 3. Business / Token Model (Specs vs Code)

`NEBULAX_CURRENT_SPECS.md` describes a **full launchpad economy** (NEBX fees, MC-tier creator splits, staking epochs, arcade → NEBX buyback, store burns, anti-rug penalties). **Important:** specs explicitly note **1% platform fee may be dropped** in favor of optional priority/bribery fees (Axiom/Photon style).

**Gap:** Most tokenomics, launchpad, staking, and on-chain anti-rug are **product/design documents**, not implemented as Solana programs in this repo. Arcade and store are **front-end experiences**; chain enforcement is aspirational.

Internal docs (`COMPREHENSIVE_ANALYSIS.md`, `DEPLOYMENT_READY.md`, `IMPLEMENTATION_COMPLETE.md`) claim **95–98% complete / production ready** — that reflects **feature breadth in static pages**, not audited production security.

---

## 4. Technical Architecture Assessment

### Strengths
- **Clear modular engines** (`trending-engine.js`, `adrenaline-engine.js`, `nx-wallet.js`, `nx-theme.js`)
- **Real external APIs** integrated (GeckoTerminal, DexScreener, Jupiter v6 via proxy host `public.jupiter-ag.workers.dev`)
- **Consistent visual system** (Orbitron, cyan neon, theme CSS variables)
- **Operator docs** — many Jupiter integration guides (duplicative but useful for onboarding)
- **Preview screenshots** folder documents intended UX (Dashboard, Trending, Arcade, Store, etc.)

### Weaknesses (confirmed + prior audit)
| Area | Finding |
|------|---------|
| **Project shape** | Static multi-page HTML; no monorepo tooling, tests, or CI |
| **Trading security** | Swaps initiated in **browser** with wallet; no server-side risk controls |
| **Secrets** | Prior audit flagged client-exposed keys; re-verify before any public deploy |
| **State** | Heavy **localStorage** / **sessionStorage** for wallet, watchlist, themes — no multi-device sync without Supabase work |
| **Duplication** | Multiple `.backup` HTML files, duplicate game folders, 12+ `inline-*.js` shards, many overlapping Jupiter markdown guides |
| **Deploy** | `vercel.json` is minimal (`version: 2` only); proxy relies on `/api/jupiter.js` serverless convention |
| **Backend** | Supabase schema is a **migration draft**; auth/profile/trade persistence not integrated in main flow |
| **Mobile** | Desktop-first; `MOBILE_PHANTOM_UX.md` exists but not a first-class app |

### Maturity score (honest)

| Dimension | Score (1–5) | Note |
|-----------|-------------|------|
| UI / UX prototype | 4 | Broad page coverage, polished aesthetic |
| Market data / discovery | 3.5 | Working client polling design; API rate limits fragile |
| Swap execution | 3 | Jupiter path exists; production hardening unclear |
| Backend / auth / DB | 1.5 | SQL only |
| On-chain product (launchpad, staking, anti-rug) | 1 | Spec-heavy |
| Engineering hygiene | 2 | No package.json, backups, doc sprawl |
| Production readiness | **2** | Demo / private beta only until secrets, backend, and swap audit |

---

## 5. Competitive Context

Comparable surfaces: **Photon**, **Axiom**, **BullX**, **Padre**-style Solana terminals — NebulaX differentiates on **arcade + store + Nebby launcher narrative**, not on raw execution speed alone.

**Moat if shipped:** branded discovery score + gamified retention + launchpad fee story. **Risk:** spec promises (anti-rug, staking APY, launcher rewards) require **programs + ops**, not HTML alone.

---

## 6. Recommended Next Steps (Prioritized)

1. **Single source of truth** — Pick `repos/nebulax-test` as canonical; archive duplicate game folders and `.backup` pages.
2. **Add `package.json`** — Vite or similar bundler, env for `VITE_*` only, lint, one Jupiter client module (`assets/jupiter-swap-engine.js` vs page copies).
3. **Security pass** — Grep all HTML/JS for keys; move any RPC/API keys to server; wallet-only signing in client.
4. **Wire Supabase or cut scope** — Either connect auth + watchlist + trades to `001_init.sql`, or document “wallet-only local mode” officially.
5. **Align marketing with reality** — `nebulax-exchange` “Coming Soon” vs `nebulax-test` full UI; decide public URL and which build ships.
6. **On-chain roadmap** — Separate repo for programs (launchpad, fee router, staking); link from specs with program IDs when deployed.
7. **Delete or quarantine misleading status docs** — `DEPLOYMENT_READY` / `IMPLEMENTATION_COMPLETE` unless tied to a checklist (secrets, RLS, swap testnet e2e).

---

## 7. Files Worth Reading First

- `repos/nebulax-test/NEBULAX_CURRENT_SPECS.md` — economics & launchpad intent  
- `repos/nebulax-test/trending-engine.js` — discovery logic  
- `repos/nebulax-test/api/jupiter.js` — only serverless backend in tree  
- `repos/nebulax-test/supabase/migrations/001_init.sql` — intended data model  
- `reports/nebulax-trading-platform-analysis.md` — prior security-oriented review  

---

*Generated from workspace investigation; not a live deploy or on-chain audit.*