# Team delivery contract pack (DRAFT, not active)

This PR prepares concrete operating contracts; nothing is activated. Merge alone changes no live team, role, schedule, skill, game or runtime behavior. A later explicit authorization covering the named rollout is required. No new scheduler or agent seats. Static tests validate document structure, not model behavior, permissions or game quality.

## Audit findings and evidence limits

2026-10-24 review covered Roblox Studio, X Growth, Perf QA and Teams Gauntlet using production artifacts, selected histories, current team inventory/schedules and source inspection. It was not an exhaustive replay or a fresh game playtest. Private transcripts/config snapshots are not committed.

- Roblox: the current sprint still carried a superseded one-milestone throttle; today's result targeted an obsolete fidelity floor. Latest reviewed runtime QA was FIX with missing required tests and inadequate play-mode evidence. Private testing was conflated with public release. Replacements below fix those contracts, not the actual game's defects.
- Quality drift: the first scoring table had Q1–Q10, but the whole file also contained Q11 social/co-op, geometry and intro-cinematic amendments. Read the full current contract; do not freeze an older range. Current draft scores Q1–Q11, minimum7/average8.
- X Growth: stale per-item approval language conflicts with the main Editor mandate. Morning Brief already correctly preserves member draft-only work, background build reconciliation, JSON/review validation and Radar steps; keep them. Missing post metrics are not proof of zero performance.
- Perf QA: historical Oct1 before/after measurements and remaining issues are not current measurements. Keep it an on-demand verification service for actual changes.
- Teams Gauntlet: historical routing/access/test-discovery friction followed by successful independent test runs; these are fixture cases, not proof current runtime is broken or production work shipped.
- Runtime: existing completion events update room state and wake managers. No dropped-wake defect was demonstrated, so no scheduler/poller was added.

## Operations and exact target mapping

Logical file paths resolve under the selected user's configured workspace, never a built-in personal path. Resolve each team first, then its roles; there are two managers called Atlas, so a manager name alone is not unique. Builder means Forge in Roblox and Niko in X. No new roles are created.

| Team | Target | Operation / payload |
|---|---|---|
| Roblox Studio | `projects/roblox-game/TEAM.md` | replace file with roblox/TEAM.md; privately retain old file |
| Roblox Studio | `projects/roblox-game/PIPELINE.md` | replace file with roblox/PIPELINE.md; migrate fresh state and archive old history first |
| Roblox Studio | `projects/roblox-game/QUALITY-BAR.md` | preserve complete existing art/reference/amendment detail; append once Quality payload below; mismatch in current requirements stops activation |
| Roblox Studio | manager / Forge / Probe / Designer / Growth role instructions; team context | append once Roblox role payload below; preserve unrelated role instructions and stop on conflicting authority |
| Roblox Studio | Scout / Sage role instructions | no-op when role already matches TEAM.md; otherwise stop for a separately reviewed exact patch |
| Roblox Studio | team description | replace with description below |
| Roblox Studio | Roblox Studio: Build Sprint (autonomous) | exact two replacements + marked block in roblox/PIPELINE.md |
| Roblox Studio | Roblox Studio: Daily Pulse | append marked checkpoint block in roblox/PIPELINE.md |
| Roblox Studio | Roblox Studio: Weekly Strategy | append same checkpoint block; preserve research |
| X Growth | `skills/x-growth-engine/SKILL.md`, project README, team description/context and member role text | targeted authority operations in OTHER-TEAMS.md; catalog not changed by this PR |
| X Growth | X Growth: Morning Brief | no-op when current contract matches; otherwise exact authority replacements only |
| X Growth | X Editor: auto-select + post | append-once Editor block in OTHER-TEAMS.md; retain caps/kill switch and approval controls |
| Perf QA | team context and desktop/mobile verifier role instructions | append-once Perf QA contract in OTHER-TEAMS.md; no new schedule |
| Teams Gauntlet | team context and manager instructions | append-once Gauntlet contract in OTHER-TEAMS.md; no new schedule |

Team description replacement: `Build, independently test, release and grow polished original-IP Roblox games. One active build plus a monitoring lane. Evidence-bound quality gates, bounded continuous increments, authorized publishing and owner-only spend.`

Roblox role/team-context payload (same scoped block for every listed target; role assignments remain in TEAM.md):

```text
[TEAM_DELIVERY_ROLE_V1]
Read the selected studio project's TEAM.md, PIPELINE.md and entire QUALITY-BAR.md on every run. Follow your named role's authority and handoff contract there. Continue ready bounded increments within budget, reconcile active work before retry, and preserve exact versioned evidence. Manager owns gated publish; Forge builds; Probe independently verifies; Designer owns references and test plans; Growth owns distribution/monitoring. Restricted staging uses the pre-staging safety/authority gate, not final public-release PASS. No source change reuses an older PASS. Conflicting instructions must be reconciled before action, not silently ignored.
[/TEAM_DELIVERY_ROLE_V1]
```

Quality payload (append to the whole existing QUALITY-BAR, never replace its art guidance with the alignment summary):

```text
[TEAM_DELIVERY_QUALITY_V1]
Apply every current scoring category and amendment. This revision includes Q1–Q11, each at least 7 and average at least 8; Q11 requires real two-player social/invite testing. No category may be self-declared N/A. Any exception needs dated owner approval recorded in DESIGN.md and QA. Match scores to the exact version and saved play-mode evidence; NOT TESTED is not PASS. The public-release PASS includes both local and restricted-staging tests. New categories added later must be included rather than silently omitted.
[/TEAM_DELIVERY_QUALITY_V1]
```

## Unique resolution and Preconditions

1. Obtain one explicit authorization covering the named rollout. This is not a new per-release approval requirement under existing standing authorization.
2. Resolve live targets through current team/agent/schedule tools and the configured workspace. Zero or multiple matches, missing files, unknown role mapping or drift since the reviewed snapshot: stop for fresh review; never guess an ID.
3. Snapshot full texts, context refs, revisions/hashes and enabled/paused states privately. Pause affected schedules, then wait for active runs to settle; do not rewrite or duplicate an active run. Teams not scheduled still require active-run reconciliation.
4. Exact replacement anchors must occur exactly once. Zero or multiple occurrences stop that target. For append-once blocks: no marker permits append; exactly one identical complete block is no-op; duplicate, partial or different marker block stops for review. Existing conflicting instructions outside a marked block also stop; appending does not magically override them.
5. Compare proposed complete texts, not just appended lines. Preserve valid security, reference, model, budget, authority and workflow instructions. Apply via supported `team_ops_wrapper` team updates/context refs, `agent_ops` instruction updates, `schedule_job_patch` preview then apply, and workspace file/skill edits only when explicitly authorized. No direct config database mutation.
6. Read back and diff each target before moving on. Restore exactly its prior enabled/paused state only after all coupled targets are consistent; a paused schedule stays paused. Record applied/no-op/blocked for each mapped target. Do not auto-dispatch a run during installation.
7. Separate post-activation acceptance: one bounded build → independent QA → repair → final QA → authorized publish → smoke → monitoring cycle with saved artifacts. Until that real cycle succeeds, report behavior UNVERIFIED even if every text readback matches. Use supported tools; never bypass action approvals for this test.

## Rollback

Pause affected schedules. Restore exact private pre-change snapshots through the same supported tools, verify complete readbacks, then restore original enabled/paused states. If restore cannot be verified leave affected work paused and escalate. Do not reconstruct from memory, replay old dispatches, backfill publications or commit private snapshots. Keep history; rollback is configuration restoration, not erasing game data.

## Static verification

`node --test tests/team-delivery-pack.test.mjs` checks required artifacts, Target mapping, marker/rollback vocabulary and selected negative document fixtures. It does not resolve live targets, execute patch operations, detect every semantic contradiction, enforce QA or prove safety. Independent human/model review and the separate live acceptance cycle remain necessary.
