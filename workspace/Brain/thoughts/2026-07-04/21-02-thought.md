# Brain Thought 1 — Observation + Seed Capture

**Run:** 2026-07-04 (cron)  
**Window 2:** 2026-07-04 **01:02 UTC** → **07:14 UTC**  
**Mode:** observe, verify live artifacts, light research, ledger maintenance only (no memory writes, proposals, or new skills).

## Executive read

This window shifts from **mobile game lab** (dominant on 2026-07-03) to **Prometheus product polish**: mobile markdown table UX, **full MEMORY.md runtime injection**, and a sharp **context-window / Hub honesty** thread. Game disks are stable; no new edits to Pocket Zombies in-window. Intraday notes (`memory/2026-07-04-intraday-notes.md`) are the authoritative timeline for dev edits and discoveries inside the window.

## Evidence scanned

| UTC (approx) | Source | Signal |
|--------------|--------|--------|
| 00:45 | `mobile_mr5n02o2_cahepa` + intraday DISCOVERY | X URL benchmark numbers captured (karpathy/TIME/USMC); overlaps prior ledger row |
| 01:07–03:00 | `mobile_mr5nxwer_k2cnon` + 3× DEV_EDIT_COMPLETE | Mobile `.markdown-body` tables: CSS fix, gesture skip, `.pm-md-table-scroll` wrapper |
| 03:38 | Brain Dream 2026-07-03 TASK note | Prior dream closure; proposals deferred; tool friction logged |
| 03:44 | `dev_edit_mr5tihqn` | Uncapped `MEMORY.md` in `prompt-context.ts`; build + gateway hot-restart OK |
| 04:00–04:02 | `mobile_mr5n02o2_cahepa` | User rejects weight-based EST drill-down; wants **measured** context sections |
| 05:12 | `mobile_mr5wgwt3` DISCOVERY | AI surface smoke: Codex focus, browser_doctor, Reddit/X read-only collection |

Transcript grep for `2026-07-04T0[1-6]:` in headers returned sparse hits (timestamps often live in message bodies); intraday + targeted transcript windows used instead.

## Live verification

| Artifact | Claim | Verified |
|----------|-------|----------|
| `games/mobile-sideways-fps/index.html` | 84-line minified game, perks fix | **Yes** — 84 lines, 34 237 B, mtime 2026-07-03T19:58:54Z; minified_like |
| `src/gateway/prompt-context.ts` L1241 | Full `loadFullMemoryProfile(..., 'MEMORY.md')` without cap on switch_model path | **Yes** — no `maxChars` arg at call site; helper still supports optional cap |
| Mobile table wrapper in repo grep | `pm-md-table-scroll` in web-ui | **Unverified in workspace tree** — dev_edit notes claim `mobile-pages.js` + `mobile.css` + sync; Brain should treat as **shipped via dev session**, confirm on next `web-ui` sync read |
| Context-window real metrics | Plan only at 04:01 | **Not in src** — seed for implementation |

## Themes

### 1. Mobile markdown tables (resolved UX pass)

Raul used repeated sample tables to tune rendering. Three dev edits: remove `display:block` on tables, horizontal scroll + touch on table-bearing bubbles, dedicated scroll wrapper so timestamp swipe does not fight table pan. **Pulse:** table-heavy assistant replies on phone should scroll horizontally without breaking iMessage-style gestures.

### 2. MEMORY injection vs UI honesty (split brain)

Runtime chat assembly can inject **~52 KB MEMORY.md** (user thread cited ~13k tokens). Context popover still **splits parent system prompt by weights** (USER/SOUL/MEMORY EST rows). User explicitly asked for **real section sizes**, weights only as fallback. **MEMORY uncap** (03:44) fixes injection cap mismatch; **does not** fix Hub/context-window drill-down. These are two different bugs — ledger tracks both.

### 3. Mobile lab carryover (idle in window)

Active-work rows for Figure 8, Pocket Zombies, canvas assets, Galaxy Drift, X benchmark remain valid. **No new game commits** in 01:02–07:14 UTC. Pocket Zombies ready for playtest; Galaxy/NPC/chat items still deferred from 2026-07-03.

### 4. Tooling / ops friction (recurring)

Brain Thought session hit `Unknown tool: write/grep/glob_file_search`; large reads spill to `temp/tool-results/`. `search_files` on a file path fails (directory-only). `dev_source_read` grep on `prompt-context.ts` returned empty despite readable file — prefer line-window `read` for citations. Post dev-edit: intraday records **sync:web-ui + apply_live** for mobile CSS/JS — good pattern to keep in runbooks.

### 5. Competitive / research smoke (05:12)

Light read-only browser pass (Reddit agent-stack threads, X search) — product intelligence, not Xpose lead gen. No `Brain/business-candidates/` row warranted.

## Seed capture (pulses for later thoughts / proposals)

1. **Context-window section manifest** — refactor `buildPersonalityContext` to emit measured `sections[]`; align `GET /api/sessions/:id/context-window` with `prompt-context.ts` (skills row already measured).
2. **Hub token truth** — after section manifest, surface same numbers on mobile with tooltip parity to desktop EST badge.
3. **Post–dev-edit gate** — document mandatory `prom_apply_dev_changes` / `sync:web-ui` before claiming mobile UI fixes (grep miss may mean generated-only or path drift).
4. **html-canvas-mobile-game skill** — still deferred aggregate from 2026-07-03 gardener; no new skill this window.
5. **X benchmark artifact** — consolidate `mobile_mr5n02o2` numbers into a single workspace markdown for Raul cost/latency comparisons.

## Skill maintenance (low-risk)

Prior pass updated **`codex-frontend-engineer`** metadata (triggers/entrypoint). No additional skill edits required this window; mobile table work is not yet captured as a dedicated skill (candidate: `mobile-markdown-table-ui` one-file playbook).

## Active Work Ledger actions

Upsert in `Brain/active-work.jsonl`:

- Refresh `lastVerified` → **2026-07-04** on game/benchmark rows; note **no disk movement** in window for games.
- **New:** `mobile-markdown-table-ui` — status **resolved** (pending phone confirmation).
- **New:** `context-window-measured-sections` — status **idea** (plan at 04:01 UTC).
- **Update:** `memory-md-full-injection` — status **resolved** (dev_edit_mr5tihqn).
- **Update:** `x-url-extraction-benchmark` — intraday DISCOVERY logged; still **in_progress** until written artifact.

## Business candidates

None for this window (internal Prometheus + mobile UX + research smoke only).

## Continuity

Prior **Brain Dream 2026-07-03** closed with 6 thoughts and 5 ledger rows; this thought extends the **2026-07-04** line without reopening Galaxy chat/NPC unless user returns. Next observation window should check whether context-window plan became a dev_edit or proposal.