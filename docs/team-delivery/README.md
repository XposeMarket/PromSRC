# Team delivery contract pack (DRAFT, not active)

Status: DRAFT for review. Nothing here is applied to any live team, role, schedule, prompt, or skill. Merging this PR does not change runtime behavior, the managed-team store, or any wake path. Any change to a live target needs a separate explicit owner authorization and follows the rollout steps below.

Scope: four managed teams (Roblox Studio, X Growth, Perf QA, Teams Gauntlet). Friendly display names only. No private IDs, job IDs, account names, local paths, tokens, or copied live prompt blobs appear in this pack.

## Evidence and date limits

Source: a 2026-10-24 audit of the four teams, plus a live read of team inventory and schedule text on the same day. The audit notes are private and are not reproduced here. Each row below is the finding, the staged change, and what the evidence cannot show.

| Team | Audit finding (2026-10-24) | Staged change | Evidence limit |
|---|---|---|---|
| Roblox Studio | Build Sprint schedule still carries a one-milestone-per-sprint throttle. Its 2026-10-24 13:01 result reported a Forge loop judged against a superseded reference floor. | Replace the throttle with checkpoint cadence and active-work reconciliation (PIPELINE.md, schedule payload). | Schedule text read on one day. A running task is not proven stalled. |
| Roblox Studio | TEAM QA text still uses the superseded reference floor and older quality-range wording. | Replace with the Q1–Q10 alignment (QUALITY-ALIGNMENT.md, TEAM.md). | Read of the live contract on one day. The live file is not edited by this PR. |
| Roblox Studio | Latest reviewed QA was FIX. Several required checks were NOT TESTED. Edit-mode images were used for appearance scoring, and the saved play-mode capture was missing. | NOT TESTED is not PASS. Appearance scoring uses saved play-mode evidence only. | Describes the audit snapshot, not the current build. |
| Roblox Studio | The current-state table was stale. | One current-state block per title, with a version, verdict, and next action (PIPELINE.md). | No current title state is asserted here. |
| X Growth | The x-growth-engine skill text says each item needs owner approval and team members never post. The newer editor mandate lets the main editor post within caps. | Staged authority clause (OTHER-TEAMS.md). The skill catalog is not changed. | Skill text as read on the audit day. |
| X Growth | Morning Brief already assigns main-editor publishing, team drafts only, JSON validation, and build review. | Preserve. Patch only where a live conflict is found, otherwise no-op. | No current analytics or follower facts are claimed. |
| Perf QA | Its measurements are historical, from 2026-10-01 sessions (for example, a session payload near 1 MB). | On-demand service for a named real diff. No schedule. | Oct 1 results are not current. No current performance claim or regression is inferred. |
| Teams Gauntlet | Historical failures appear in the friction log. Later independent runs reading 5/5 and 3/3 passed when read on 2026-10-24. The old faults were not reproduced. | Fixture regression cases, not staff or KPI. Zero discovered tests is "no evidence". | Fixture only. Not a product quality measure. |
| Runtime | Completion events already route to room state and manager auto-wake. No dropped-wake defect was proven. | No scheduler, poller, watcher, or runtime change. | Based on the existing source; not re-tested here. |

What this pack does not show: sample sizes, acquisition, retention, revenue, current analytics, live schedule state, Roblox quality of any current build, or whether any external change is safe to run.

## Files

- `roblox/TEAM.md`: full replacement text for the Roblox manager and role payloads (manager, Forge, Probe, Designer).
- `roblox/PIPELINE.md`: full replacement pipeline with named gates, current-state block, and schedule clauses for Build Sprint, Daily Pulse, and Weekly Strategy.
- `roblox/QUALITY-ALIGNMENT.md`: Q1–Q10 contract and evidence rules, aligned to one scoring threshold.
- `OTHER-TEAMS.md`: X authority clause, X schedule anchors, and the Perf QA and Teams Gauntlet contract payloads.

## Target map (friendly display names only)

Operations: `replace` (write the full staged text into that target), `patch` (change only the listed anchor clauses), `no-op` (verify the live text already matches and change nothing).

| Team | Target (display name) | Kind | Operation |
|---|---|---|---|
| Roblox Studio | Manager instructions | Team role payload | replace with roblox/TEAM.md manager section |
| Roblox Studio | Forge role instructions | Team role payload | replace with roblox/TEAM.md Forge section |
| Roblox Studio | Probe role instructions | Team role payload | replace with roblox/TEAM.md Probe section |
| Roblox Studio | Designer role instructions | Team role payload | replace with roblox/TEAM.md Designer section |
| Roblox Studio | Roblox Studio: Build Sprint (autonomous) | Schedule prompt | patch (PIPELINE.md, Build Sprint clauses) |
| Roblox Studio | Roblox Studio: Daily Pulse | Schedule prompt | patch (PIPELINE.md, Daily Pulse status vocabulary) |
| Roblox Studio | Roblox Studio: Weekly Strategy | Schedule prompt | patch (PIPELINE.md, Weekly Strategy clauses) |
| X Growth | x-growth-engine skill source | Skill text (staged only) | patch (OTHER-TEAMS.md, authority clause) |
| X Growth | X Growth: Morning Brief | Schedule prompt | no-op unless a live conflict matches the anchor; then patch |
| X Growth | X Editor: auto-select + post | Schedule prompt | patch (OTHER-TEAMS.md, main-editor clause) |
| Perf QA | Perf QA contract text | Team contract | replace with OTHER-TEAMS.md Perf QA payload (no schedule) |
| Teams Gauntlet | Teams Gauntlet contract text | Team contract | replace with OTHER-TEAMS.md Gauntlet payload (no schedule) |

Unresolved targets fail closed: if a display name does not resolve, skip that target and stop for fresh review.

## File and logical-path mapping (portable; no private paths)

| Live object (logical path or display name) | Staged source | Operation |
|---|---|---|
| Roblox team contract: manager, Forge, Probe, Designer role text | `roblox/TEAM.md` (role sections) | replace only the role sections that conflict; keep non-conflicting role text |
| Roblox pipeline and schedule clauses | `roblox/PIPELINE.md` | patch the named schedule clauses |
| Roblox quality bar (live `projects/roblox-game/QUALITY-BAR.md`, section 7) | `roblox/QUALITY-ALIGNMENT.md` | reconcile Q1–Q10 thresholds (each at least 7, average at least 8); stop on any unreconciled mismatch |
| Roblox TEAM QA references (live `projects/roblox-game/TEAM.md`) | `roblox/TEAM.md` and `roblox/QUALITY-ALIGNMENT.md` | replace stale reference-floor and Q1–Q8 clauses together |
| Roblox pipeline (live `projects/roblox-game/PIPELINE.md`) | `roblox/PIPELINE.md` | replace the stale throttle and release wording |
| X Growth skill source (`x-growth-engine`) | `OTHER-TEAMS.md` (authority clause) | patch two conflicting clauses only; no catalog change |
| X Growth README and team description, teamContext (live `projects/x-growth/README.md`, `EDITOR.md`) | `OTHER-TEAMS.md` (X authority mapping) | patch stale authority wording only; preserve other text |
| X Growth roles: Growth, Scout, Sage | `OTHER-TEAMS.md` (X role mapping) | keep role text; remove only the never-post or per-item-approval clause |
| Perf QA and Teams Gauntlet contracts | `OTHER-TEAMS.md` | replace contract text; no schedule |

## Unique resolution (activation only, never in the repo)

1. Search the current connector and team inventory by the exact display name.
2. Exactly one match, and the revision matches the reviewed snapshot: proceed to the rollout steps.
3. Zero or multiple matches: stop. Do not guess an ID and do not fall back to workspace files.
4. Revision changed since review, or the live text has a workflow not covered by the staged anchor: skip that target and stop for fresh review.

Resolved IDs go only into the operator's private change record.

## Rollout preconditions

1. One owner approval covering the named pack targets listed in the target map (not one approval per setting). Roblox standing authorization covers owned publish after QA PASS and does not need a new per-release confirmation.
2. Active runs for the target are drained or settled. Do not rewrite or duplicate an active run.
3. A local pre-change snapshot of the complete current text is captured privately for that target.
4. Staged anchors are compared against the live text. A mismatch means a stop, not a best guess.
5. One target at a time: apply, read back, and diff against the staged operation.
6. A paused schedule stays paused unless the owner resumes it. Do not unpause as a side effect.
7. Post-apply smoke: read back the saved text. Confirm that no dispatch, post, publish, or spend was triggered.

## Rollback

Pause the affected schedule with its supported control. Restore the exact pre-change snapshot through the same authorized connector or UI, then verify the readback. If the restore cannot be verified, leave the target paused and escalate to the owner. Never reconstruct text from memory. Do not include snapshot contents in PR artifacts. No backfill, no replay, no automatic dispatch.

## Authority boundaries

- All four teams: members research, build, review, and save drafts.
- X Growth members never post, reply, like, repost, follow, or DM. Only the designated main-chat X editor posts, within caps and runtime approvals.
- Roblox responsible roles may publish an owned version under standing owner authorization after an independent version-bound QA PASS and the actual tool approvals. No new per-release owner confirmation is required while that standing authorization is valid.
- Spending and paid third-party tools stay owner-only. Restricted staging and public release are separate gates.
- Prompt text does not grant platform permission and does not bypass runtime approval gates.

## Reviewing this PR

Static check only: `node --test tests/team-delivery-pack.test.mjs`. It verifies that the pack is complete (four teams, roles, five schedule names, operations, rollback, unresolved-target rule), that prohibited content is absent, and that negative fixtures fail as expected. It does not check live config, runtime behavior, Roblox quality, release readiness, or the safety of any external change.
