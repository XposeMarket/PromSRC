# NebulaX — Relaunch Analysis & Best Next Steps
**Context:** Built ~August 2025, specs consolidated Nov 2025, **never officially launched**.  
**Analysis date:** 2026-07-04  
**Repos:** `repos/nebulax-test` (app), `repos/nebulax-exchange` (landing)

---

## Executive summary

You have a **strong product shell** (discovery UI, scoring, Adrenaline 3-panel narrative, coin-page swaps, themes, Phantom flow) that was credible for late-2025 degen UX. Eleven months later, **the market moved**: Pump.fun owns launch, pro terminals (Axiom / Photon / Bloom) own speed, and **Jupiter’s API surface is mid-migration**. Your **NEBX economy** (launchpad tiers, staking, anti-rug, arcade buybacks) exists almost entirely in `NEBULAX_CURRENT_SPECS.md` — not on-chain.

**Honest state:** ~**40% of a shippable v1** if you define v1 as *“connect wallet, discover tokens, swap safely”*; ~**15%** if v1 means *“NEBX + launchpad + arcade tokenomics as specced.”*

**Recommendation:** Pick **one wedge** and launch in phases. Trying to ship the full whitepaper before anything is live is why it stalled — and the competitive bar is higher in 2026, not lower.

---

## What you actually built (Aug–Nov 2025)

| Layer | Status | Notes |
|--------|--------|--------|
| **Hub + pages** | ✅ Usable prototype | `NebulaX.html`, Trending, New Pairs, Adrenaline, Coinpage, Portfolio, Store, Arcade shell |
| **Trending engine** | ✅ Real logic | GeckoTerminal + DexScreener, custom score, S/A/B tiers, 5s refresh |
| **Adrenaline** | ✅ Real logic | New / Migrating / Migrated panels; Pump→Raydium *story* in filters |
| **Swaps** | ⚠️ Fragile | Client → `quote-api.jup.ag/v6/*`; Vercel proxy → `public.jupiter-ag.workers.dev/v6` |
| **Wallet / theme** | ✅ | Phantom, `nx-wallet.js`, `nx-theme.js`, localStorage profile |
| **Backend** | ❌ | Supabase migration drafted, **not integrated** in app flows |
| **Games** | 🟡 Partial | Nebby Run / Defender / Explore folders; duplicates (`New folder`, backups) |
| **NEBX tokenomics** | 📄 Spec only | Launchpad, staking epochs, anti-rug, fee splits — **no programs in repo** |
| **Engineering** | ❌ | No `package.json`, 149 loose files, 20+ Jupiter markdown duplicates |

Internal docs claimed **“95–98% production ready”** (Dec 2024 analysis) — that measured **UI breadth**, not security, API longevity, or on-chain completeness.

---

## What changed on-chain & in the market (Aug 2025 → Jul 2026)

### Jupiter (blocks swaps if ignored)
- NebulaX hard-codes **`https://quote-api.jup.ag/v6/quote`** and **`/v6/swap`** in `assets/jupiter-swap-engine.js`.
- Proxy in `api/jupiter.js` targets **`public.jupiter-ag.workers.dev/v6`** — not the current documented gateway pattern.
- Jupiter **Developer Platform** migration (Apr–Jun 2026): base **`api.jup.ag`**, keys preserved, **`lite-api` deprecated**, credit-based tiers, grace period then paid plans.
- Community reports **v6 sunset** pressure; new integrations often target **Ultra** (`/ultra/v1/order` + `/execute`) or updated Metis routes — not your current client.

**Impact:** A relaunch that doesn’t migrate swap/quote paths will likely see **broken trades or rate-limit pain** on day one.

### Launch & discovery (Pump.fun is the gravity well)
- Pump.fun: bonding-curve launches, auto-graduation to Raydium, **$1B+ cumulative revenue** narrative, 2026 multichain expansion signals.
- Volume spikes (e.g. ~$180M launchpad day cited Jan 2026) concentrate attention on **Pump-native** flows, not generic Gecko “new pools” only.
- Alternatives (LetsBONK, etc.) exist but **Pump remains the reference**.

**Impact:** Your Adrenaline “migrating” panel is still **conceptually right**, but users expect **mint-level Pump data**, social proof, and **sub-second** updates — Gecko-only polling at 5s is baseline, not differentiator.

### Trading terminals (you’re not competing on “another scanner”)
- **Axiom / Photon / Bloom**: priority fees, bribery/MEV language, fast execution — your spec *planned* optional priority/bribery fees but **didn’t ship** fee engine.
- Terminals bundle **wallet + chart + social + launch**.

**Impact:** NebulaX wins only with a **clear second axis**: brand (Nebby), arcade, or **creator/launch economics** — not “we also have trending.”

### Wallets & UX
- Phantom + Wallet Standard expectations; mobile deep-link patterns you documented (`MOBILE_PHANTOM_UX.md`) are table stakes.
- More scams, more clone sites — **domain + no leaked keys + no fake swap modals** matter more in 2026.

### Memecoin lifecycle
- Shorter LP lock expectations (your Nov 2025 spec already moved from 6–12 months → **3 days–2 weeks**) — aligned with market, but needs **on-chain enforcement** to mean anything.

---

## Gap map: vision vs repo

```
NEBULAX_CURRENT_SPECS.md          repos/nebulax-test/
─────────────────────────         ───────────────────
NEBX fee engine (35/30/20/15)     ❌ not implemented
Launchpad + MC-tier creator %     ❌ not implemented
Anti-rug halt + burn/stakers      ❌ not implemented
NEBX + per-token staking epochs   ❌ not implemented
Arcade → market-buy NEBX          ❌ not implemented
Store burn/staker/treasury split  ❌ store UI only
Trending + Adrenaline + Jupiter   ✅ mostly there
Supabase profiles/trades/games    🟡 SQL only
```

---

## Strategic options (pick one primary path)

### Path A — **Terminal MVP** (4–8 weeks, solo-friendly)
**Goal:** `nebulax.exchange` goes live as **discover + swap**, no NEBX yet.

1. Modernize **Jupiter** (Ultra or current `api.jup.ag` swap API per Jupiter docs; kill dead v6 URLs).
2. Single **swap module**; remove duplicate Jupiter docs/files.
3. Add **`package.json`**, Vite or similar, env-based API keys (server proxy only).
4. **Pump enrichment**: DexScreener token profiles + explicit `pump.fun` link/mint metadata where available.
5. Security pass: no secrets in client, CSP, transaction preview copy.
6. **Hide or “coming soon”**: Arcade payouts, launchpad, staking, store NEBX sinks.

**Pros:** Ships; learns if anyone uses discovery UX. **Cons:** Competes directly with terminals without speed edge.

### Path B — **Culture terminal** (8–14 weeks) — *recommended if you still care about Nebby*
**Goal:** Same as A, plus **one** polished arcade game tied to wallet (scores on-chain or Supabase later), arcade **cosmetic** store (SOL/USDC only first).

1. Everything in Path A.
2. Pick **one** game (Nebby Run *or* Defender); delete duplicate folders.
3. Arcade panel: play → leaderboard → share card (X image).
4. Defer **NEBX buyback** until token exists; document “Phase 2 token.”

**Pros:** Differentiated story for @NXNebulaX. **Cons:** Game dev time.

### Path C — **Full NEBX platform** (3–6+ months, team/audit budget)
**Goal:** Launchpad + staking + anti-rug as specced.

1. Separate **Solana programs** repo (Anchor): launch template, fee routing, LP lock, rug hook — **audit before mainnet**.
2. Backend (Supabase or custom indexer) for epochs, leaderboards, flags.
3. Frontend refactor (not 12 monolithic HTML files).
4. Legal/comms: token, fees, jurisdictions.

**Pros:** Matches whitepaper. **Cons:** Highest risk; market may not wait.

---

## Best next steps (ordered, practical)

### Phase 0 — Decision (this week)
- [ ] Choose **A, B, or C** as the north star.
- [ ] Decide **NEBX token**: launch with product, later, or never (terminal-only SaaS).
- [ ] Confirm domain/deploy target (`nebulax-exchange` CNAME vs Vercel project for `nebulax-test`).

### Phase 1 — Unblock swaps (week 1–2)
- [ ] Audit all Jupiter URLs (`jupiter-swap-engine.js`, HTML inline, `api/jupiter.js`, `trending-engine.js` price enrich).
- [ ] Implement proxy on **`api.jup.ag`** with API key in Vercel env (never in browser).
- [ ] Run **one** live swap on devnet/mainnet small size; document slippage/priority fee UX.
- [ ] Delete or archive 15+ duplicate `JUPITER_*.md` files; keep one `docs/jupiter.md`.

### Phase 2 — Repo hygiene (week 2–3)
- [ ] Add `package.json`, lint, `npm run dev` / `build`.
- [ ] Consolidate HTML → shared layout/components (even partial).
- [ ] Remove `.backup`, `New folder`, duplicate `nx-theme.js` at root vs `assets/`.
- [ ] `grep` secrets / Supabase keys / RPC URLs in client.

### Phase 3 — Product truth in UI (week 3–4)
- [ ] Replace “production ready” copy with honest **beta** labels.
- [ ] Gate **Launchpad / Staking / Anti-rug** behind “Roadmap” (link to trimmed spec).
- [ ] Wire **Supabase** *or* officially commit to **local-only** v1 (update `profile-sync.js` accordingly).

### Phase 4 — Discovery upgrade (week 4–6)
- [ ] Tune Adrenaline for **2026 Pump graduation** signals (liquidity + DEX id + age).
- [ ] Optional: paid Gecko/DexScreener tier if rate limits bite at scale.
- [ ] Mobile pass on Trending + Coinpage (you already cared about Phantom mobile).

### Phase 5 — Launch (when Phase 1 green)
- [ ] Soft launch: X + small trader circle.
- [ ] Metrics: WAU, swap success rate, quote error rate, time-to-first-swap.
- [ ] Only then: NEBX token design, arcade buybacks, launchpad scope.

---

## What to **stop** doing (saves months)

1. **Don’t** add more Jupiter markdown guides — migrate APIs once.
2. **Don’t** build three games at once — one shipped game beats three demos.
3. **Don’t** implement 1% platform fee on swaps until you have volume *and* legal clarity; spec already pivoted to Axiom-style optional tips — match that in UI or stay **fee-free** at launch.
4. **Don’t** claim anti-rug without programs — it’s reputational risk.

---

## Competitive positioning (one sentence)

**2025 pitch:** “Solana terminal + arcade + NEBX economy.”  
**2026 pitch (realistic):** “NebulaX is the **culture-forward** Solana desk — fast discovery and Adrenaline-style migration radar, with Nebby arcade identity; **trade through Jupiter**, launchpad when the chain side is audited.”

---

## Files to treat as source of truth

| Doc | Use |
|-----|-----|
| `NEBULAX_CURRENT_SPECS.md` | Tokenomics *intent* — not shipped |
| `trending-engine.js` / `adrenaline-engine.js` | Core IP — keep and harden |
| `assets/jupiter-swap-engine.js` | **Must migrate** for relaunch |
| `supabase/migrations/001_init.sql` | Phase 2+ if you want accounts |
| `reports/nebulax-trading-platform-analysis.md` | Security themes still valid |

---

## Bottom line

You didn’t fail to launch because the UI was bad — you stalled because **the product story was full-platform** while the **repo was terminal-depth**. On-chain, Pump and Jupiter moved faster than the codebase. The best next step is **Phase 1 (Jupiter) + Path A or B**, ship something honest in weeks, then let usage decide whether NEBX and launchpad deserve Path C.

---

*Generated from workspace inspection + Jupiter dev docs migration page + 2026 launchpad market context.*