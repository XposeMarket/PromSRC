# Brain Dream — 2026-06-18 23:42

Nightly synthesis run resumed after context compaction. Focus: re-verify live active-work state, avoid duplicate proposals, and preserve concrete next actions.

## Verified active state

### Smokers Paradise / Xpose Market demo
- Current artifact exists at `xpose-demos/smokers-paradise/index.html` with supporting `README.md`.
- README confirms no outreach has been sent, no CRM record exists, and no email/call/DM/form submission happened.
- Current demo positioning is good: 21+ age gate, official brand-style homepage, reserve-for-pickup cart, no online payment, in-store ID verification/payment framing, multi-location section.
- Important correction: older pending proposal `prop_1781754019396_8e6938` targets stale path `demos/smokers-paradise/index.html`. The real artifact is already built under `xpose-demos/smokers-paradise/`.
- Live deployment remains blocked for public outreach: unauthenticated fetch to `https://smokers-paradise-demo-2voxvuu79-xpose-markets-projects.vercel.app` returned HTTP 401. Web research confirms Vercel Deployment Protection / Vercel Authentication can intentionally 401 deployment URLs. Do not use this URL in outreach until public access/domain is verified.

### Skill Gardener business-classifier false positives
- Active ledger item `skill-gardener-business-classifier-false-positives` remains live and was verified against 2026-06-18 Skill Gardener output.
- Existing pending source proposal `prop_1781734228086_5a496c` already covers the needed hardened fix in `src/gateway/brain/skill-episodes.ts` plus self docs. Do not file a duplicate.
- Proposal is still good directionally: add negative guards for Prometheus internal dev/mobile/source/model work, trading/market briefs, and social/X automation; require stronger business evidence before emitting business workflow context.

### Dev-edit hot restart logging
- Existing pending source proposal `prop_1781753474168_6d4e91` already covers classifying expected completion-note logging during hot restart as expected rather than unexpected. No duplicate needed.

### X browser automation playbook drift
- Existing pending skill evolution proposal `prop_1780803879760_957e3c` already covers numeric browser snapshot refs and `schedule_job` cron requirement. No duplicate needed.

### Mobile docs drift / self-doc compliance
- `self/16-mobile-app.md` last modified 2026-06-18 03:16, but later 2026-06-18 mobile source work added behavior that is not fully reflected there.
- Current source evidence from `web-ui/src/mobile/mobile-pages.js` includes:
  - `PM_MOBILE_THREAD_CACHE_MAX = 30` at line 116.
  - session cache sanitization preserves `liveTraceEntries` for server history but strips them from branch clones.
  - `liveTraceEntries` are merged, rendered live, persisted to server history, restored from server messages, and hidden behind completed-turn trace drawers.
  - `_mobileHasPendingImageGeneration(...)` now only treats active non-result/non-error entries as pending generation.
  - `pagehide` and `visibilitychange` handlers stamp/trigger recovery behavior.
- This remains a documentation debt under Raul's self-edit rule. Best next action is a scoped self-doc update, not another source proposal.

### Cron scheduler deadlock/parallel dispatch
- Active ledger marks `cron-scheduler-parallel-dispatch-and-deadlock-recovery` resolved.
- No new proposal should be filed. Current source already tracks running jobs and dispatches overdue jobs in parallel with cleanup.

### Memory search SQLite/embedding performance
- Active ledger marks this in progress, but live source has already mitigated earlier suspicion with read DB caching and indexes.
- Treat as optimization audit only, not a ready bug claim. Any future proposal should first benchmark/query-trace current source instead of repeating the stale missing-index diagnosis.

## Decisions

1. No duplicate proposals were created in this run. Existing pending proposals already cover the major actionable source/skill fixes.
2. Smokers Paradise should not move to outreach until Vercel public access is fixed or a public production domain is provided.
3. The stale Smokers Paradise build proposal should be treated as superseded by the real `xpose-demos/smokers-paradise/` artifact.
4. Mobile self-doc drift is the most concrete remaining non-duplicate follow-up: update `self/16-mobile-app.md` to document 2026-06-18 recovery/cache/trace-drawer/image-generation behavior.

## Hardened next actions

1. **Public demo access check**: verify Vercel project/domain settings or deploy a public production alias for `xpose-demos/smokers-paradise/` before any Smokers Paradise outreach.
2. **Self-doc sync**: update `self/16-mobile-app.md` with the later 2026-06-18 mobile changes: cold-open cache limit, pagehide/visibility disconnect stamping, pending image-generation guard, completed-turn trace drawer, and `liveTraceEntries` persistence rules.
3. **Proposal cleanup**: when proposal-admin tooling is available and appropriate, revise or close `prop_1781754019396_8e6938` as superseded/stale path rather than executing it as-is.
4. **Await approvals**: if Raul approves existing pending proposals, execute:
   - `prop_1781734228086_5a496c` for Skill Gardener classifier hardening.
   - `prop_1781753474168_6d4e91` for hot restart completion-note logging.
   - `prop_1780803879760_957e3c` for X browser automation playbook hardening.

## Blockers

- Vercel deployment URL currently returns HTTP 401 without authentication.
- xAI/Grok search provider failed earlier because spending limit/Grok subscription access is required.
- No external outreach/contact should happen for Smokers Paradise without Raul approval.
