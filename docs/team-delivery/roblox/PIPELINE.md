# Roblox Studio pipeline (DRAFT, not active)

Staged full replacement for `projects/roblox-game/PIPELINE.md`. During activation migrate the current state from fresh evidence into the schema below; archive history privately, never erase it. One active build plus one monitored live title. Follow TEAM.md and the entire current QUALITY-BAR.md.

## Gates in order

1. **Preflight:** saved source, target identity/ownership, tools/input/camera/capture, mobile and two-player capabilities. No unrelated Studio writes.
2. **References and slice:** Designer fixes scope, art tier, UI mockups, social loop, REFS and TESTPLAN. Forge builds a playable first minute, complete round, progression and game feel against those files.
3. **Pre-staging QA:** Probe checks source security, local runtime/console and available mobile/reference tests. Record persistence and other staging-only checks as NOT TESTED, not a final verdict. Fix unsafe code before staging.
4. **Restricted staging:** manager verifies standing authorization, owned target, restricted access, isolated test data and actual tool approval. Provision/publish privately for testing. Final QA PASS is NOT required here; the pre-staging safety checks are required. Unknown visibility/ownership or denied approval stops this action. Never reuse a production data namespace for tests.
5. **Staging QA and repair:** Probe tests real DataStore save/leave/rejoin and two-player social/invite flow. Save play-mode evidence. At most two repairs per defect before rescope/escalation. Changed source requires relevant tests rerun and a fresh whole-version verdict; don't merge evidence from different versions into PASS.
6. **Final QA PASS:** combine local and staging checks for the exact build. Zero console errors; clear goal within 10 seconds; first minute/full round on mobile; solo and two-player social play; persistence; security; all current quality categories Q1–Q11 at least 7 and average at least 8. Missing required checks block release unless an explicit owner-approved scope exception exists.
7. **Public release:** manager publishes under standing owner authorization and tool approvals only after final PASS. Probe verifies public URL/version and published-build smoke test. Record ledger evidence. On smoke failure stop promotion and repair/rollback; do not call it shipped.
8. **Distribution and monitoring:** Growth supplies the main X Editor with real build URL/version, screenshot/clip paths, evidence-backed copy and claim sources. Team members do not post. The Editor uses current caps/kill switch and actual approvals, records posted URL or rejection. A denied item is not silently resubmitted. Growth verifies receipt, records both T+24h and T+72h reviews (cohort/window, sample size/source, acquisition, retention, co-play/invites and feedback), then owns a named next review. After this handoff the manager may start the next game; a winner gets more capacity.

## Current-state (one record per title)

```text
title: friendly name
buildVersion: exact source/build identifier
stage: preflight | build | pre-staging | staging | final-qa | release | monitoring
QA verdict: NOT TESTED | FIX | BLOCK | PASS
checksExecuted: evidence paths
checksNotTested: requirements and reasons
activeDispatch: verified task identity or none
blocker: reason, lowest authorized owner and next action, or none
nextAction: exact bounded increment
monitoringOwner: named role after launch, otherwise not assigned
nextReviewAt: absolute timestamp after launch
updatedAt: timestamp
```

History belongs in ledger.md. New builds clear prior PASS. A checkpoint is not product completion. Reconcile active work before dispatch; continue successive bounded increments while budget remains. When budget ends, persist exact continuation; existing manager events continue ready work, daily cron only recovers/checkpoints. Never reset the repair counter merely to keep looping.

## Schedule patches (exact operations)

All schedule changes go through README Preconditions, unique-name resolution, private snapshot, pause/drain, drift check and readback. These retired Before strings are replacement anchors only, not active instructions.

### Roblox Studio: Build Sprint (autonomous)

Replace exactly once:
- Before: `Do ONE milestone per sprint:`
- After: `Reconcile active dispatches first. Continue successive ready bounded increments within the run budget; checkpoint accepted evidence and the exact next action at budget end. Do not duplicate active work. Daily cron is a recovery checkpoint, not a milestone throttle.`

Replace exactly once:
- Before: `If there's no PASS, do not publish; log why in PIPELINE.md and carry the work into the next sprint.`
- After: `Without final PASS do not publish publicly. Resolve ready defects within budget and continue on member completion; checkpoint at budget end. Restricted owned staging for save/rejoin tests follows the pre-staging safety/authority gate in PIPELINE.md and does not require final PASS.`

Append the following block once at the end of this schedule, using marker rules in README:

```text
[TEAM_DELIVERY_ROBLOX_V1]
Read current TEAM.md, PIPELINE.md and the whole QUALITY-BAR.md. Use pre-staging safety checks, then restricted owned isolated staging, then real persistence/two-player QA, then final version-bound PASS before public release. Score every current quality category (Q1–Q11 in this revision), each >=7 and average >=8; no self-waived checks. Manager owns publish; Forge builds, Probe independently verifies. Preserve research/reference generation, source saving, security, build and reporting steps. Record both T+24h and T+72h monitoring and the Growth-to-main-Editor handoff. No new budget, permissions or scheduler is granted by this text.
[/TEAM_DELIVERY_ROBLOX_V1]
```

### Roblox Studio: Daily Pulse / Roblox Studio: Weekly Strategy

Preserve existing research/chart/backlog steps. Append once to each schedule:

```text
[TEAM_DELIVERY_CHECKPOINT_V1]
Report exact build version, QA verdict/evidence, active dispatch identity, blocker owner and next action. A pulse/strategy report does not mean a game shipped. Keep one active build plus one monitoring lane; do not switch concepts merely because a daily report is due. Never override current quality, original-IP or release gates. Missing metrics are UNKNOWN, not zero. Identify the monitoring owner and next review for each launched title.
[/TEAM_DELIVERY_CHECKPOINT_V1]
```

## Evidence and Rollback

Evidence identifies version, timestamp, author, checks run/not run and existing artifacts. Analytics additionally identify source, cohort/window and sample size. QA is not evidence of market traction. Snapshot and Rollback procedures are centralized in README; no backfill, replay or dispatch is triggered by applying this file.
