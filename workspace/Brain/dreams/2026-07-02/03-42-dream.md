# Dream - 2026-07-02
_Generated: 2026-07-03 03:42 UTC (Brain Dream session `brain_dream_2026-07-02`)_

## Run context
- **Thoughts:** 0 (`Brain/thoughts/2026-07-02` never materialized; kickoff explicitly said 0 thought(s)).
- **Business candidates:** absent (`Brain/business-candidates/2026-07-02/candidates.jsonl` missing).
- **Skill episodes:** 110 lines (`Brain/skill-episodes/2026-07-02/episodes.jsonl`, ~426 KB).
- **Skill gardener:** 155 captured lines (`Brain/skill-gardener/2026-07-02/live-candidates.jsonl`, ~556 KB), overwhelmingly one mobile session.
- **Skill curator:** `Brain/skill-curator/reports/skill_curator_2026-07-02T03-41-43-771Z.md` — 592 candidates reviewed, 4 applied recovery notes to `file-surgery` / browser verification paths tied to Pocket Zombies patch drift.
- **Active work ledger:** 59 rows — **15** `in_progress`, **11** `drafted`, **6** `stalled` (verified via literal grep 2026-07-03).

## What actually happened on 2026-07-02
The day was not quiet; it was **concentrated**. Almost all durable signal sits in **`mobile_mr2ors69_u35dij`** and **`memory/2026-07-02-intraday-notes.md`** (30+ task/debug entries), not in Brain Thought markdown.

### Dominant thread: Pocket Zombies / `games/mobile-sideways-fps`
Raul drove an extended mobile playtest-and-fix loop on a **single-file HTML/JS (later Three.js module)** game:

1. **Morning:** gameplay fixes (reload/BUY handlers, tracers, zombie grounding, hit flash, collision bites).
2. **Midday:** camera-control crisis — duplicate stale code after `</html>`, inverted pitch, movement lock, FIRE button also steering camera; multiple `file-surgery` passes with `validate_file` + local HTTP browser smokes.
3. **Afternoon:** balance/feel (zombie height, Juggernog HP, damage flash, SMG assets, bite cooldown regression fixes).
4. **Creative pipeline:** layer extraction on Pocket Zombies sprite sheets; ONNX weights installed; **wrong `.prometheus` directory** called out (workspace vs `getConfig().getConfigDir()`); MobileSAM rank bug fixed later in day; cutouts wired into game assets.
5. **Evening:** accidental overwrite by **`mobile_mr421tpg_oocxgi`** (figure-8 drift prototype replaced the game file); **full Three.js Pocket Zombies 3D rebuild** (~80 lines), look-pad yaw inversion fix, PNG billboard rendering fix, screenshots to mobile origin.

**Disk state verified this Dream run:** `index.html` exists (Three.js import, `#lookPad`, billboard zombies, mobile controls); `ZOMBIES_ROADMAP.md` documents rebuild + browser smoke success and lists next polish (aim feel, sprite sheets, control-test helpers).

### Secondary threads
- **`mobile_mr2tyvpn_5yj9rt`:** new `codex-desktop-restart` skill pattern.
- **`mobile_mr355ohw_oj66tk`:** Creative ONNX model weight install (path caveat above).
- **`mobile_mr2y1rgx_dnupxo`:** Composer 2.5 / Grok Build OAuth research (not on public api.x.ai).
- **Brain Thought 1** (`brain_thought_2026-07-02_12-55`): low-signal window note only; no `Brain/thoughts/2026-07-02` artifact on disk.
- **Brain Dream cleanup** for 2026-07-01: second pass no-op.

## Meta / reliability observations
| Issue | Evidence | Dream stance |
|-------|----------|--------------|
| Thought pipeline gap | Dream kickoff 0 thoughts; Thought agent noted missing `Brain/thoughts/2026-07-02` | Treat **intraday notes + skill episodes** as authoritative for 2026-07-02 synthesis |
| Gardener capture spam | 155 JSONL rows, same `requestExcerpt` cluster | **Aggregate** into one lesson; do not spawn 155 skill updates |
| Monolith HTML patch risk | Duplicate tail after `</html>`, patchset shape errors, overwrite incident | Keep **block-replace + syntax validate + browser smoke** as mandatory triad |
| Ledger drift | `pocket-zombies` row `stalled` / `lastVerified` 2026-06-28 while 2026-07-02 was active | Refreshed to **`in_progress` / 2026-07-02** in `Brain/active-work.jsonl` |
| Tool friction (report per USER rule) | `workspace_read` line windows noisy; `workspace_edit` patchset missing per-edit `filename`/`op`; Lite terminal blocking `node` checks; long `search_files` on `.` | Prefer **grep → narrow read**; sequential `find_replace`; `validate_file` over shell |

## Deferred ideas (quality gate — not promoted to proposals tonight)
| Idea | Why deferred |
|------|----------------|
| Split Pocket Zombies into multi-file Vite build | Raul asked “html or something better” speculatively; current Three.js monolith **works on disk**; migration is product decision |
| Auto-dedupe skill-gardener `captured` rows | Needs **src** design (`Brain/skill-gardener` classifier); not executor-ready without scoped code_change |
| Stale pending proposal sweep (34 files) | No per-proposal live verification in this run; risk of false stale closes |

## Proposals filed tonight
See `Brain/proposals.md` — **1** hardened proposal (Creative ONNX model path resolution).

## Memory / business
- **0** BUSINESS.md entity updates (no `business-candidates` file).
- **0** USER.md edits (existing 2026-07-02 preferences already captured: tool error reporting, skill-read filtering).
- **Ledger:** `pocket-zombies-mobile-fps-build-2026-06-28` refreshed.

## Phase checklist (this run)
1. Thoughts — **skipped** (0 on disk); substituted intraday + episodes.
2. USER/SOUL/MEMORY/BUSINESS — **read context**; no new durable USER facts beyond existing notes.
3. Proposals — **1** new (see proposals.md).
4. Business candidates — **noted absent**.
5. Skill episodes — **synthesized** (110).
6. Skill gardener — **synthesized** (155 aggregate).
7. Pending proposals — **counted** (34); no mutations.
8. Active work + dream artifacts — **this file + proposals.md + ledger line 57**.

Ready for 2026-07-03.