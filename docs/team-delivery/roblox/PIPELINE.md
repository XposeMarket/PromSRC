# Roblox Studio pipeline (portable replacement, DRAFT, not active)

Status: staged. Apply only through `docs/team-delivery/README.md`. One active title at a time. No shared framework unless a slice needs it. No third-party IP.

## Gates (in order)

1. **Preflight and authority.** Studio and tool access work. The place is owned and isolated. Record the result. Failure is a blocker.
2. **Reference, tier, mockup.** Designer picks one tier (A, B, or C) in DESIGN and REFS notes. Mockup or reference frames are produced before any build. Artifact: mockup and reference note.
3. **Integrated playable slice.** A first-minute and full-round slice, built by Forge to the mockup. Artifact: build note with version.
4. **Same-cycle saved runtime evidence and independent QA.** Save play-mode screenshots or video of the exact build. Probe executes the checks against that build. Artifact: QA report with version, checks executed, NOT TESTED list, and evidence links. Edit-mode shots support layout review only.
5. **Bounded defect repair and retest.** At most two repair loops per defect. Each repair is retested on the same checks. Changed build means earlier results do not carry over.
6. **Private staging DataStore and save/rejoin test.** Only in the authorized restricted owned place, with the owner authority and tool approval present. Not a public release.
7. **Public release gate.** Requires an independent version-bound QA PASS, every mandatory check executed, Q1–Q10 each at least 7 and average at least 8, saved play-mode evidence, and owner authorization. Then the release, with URL, version, and smoke evidence.
8. **Accountable promotion and review.** Owner-authorized promotion. Timestamped review at 24 or 72 hours, or the window stated in the schedule, with the cohort, sample size, and source named. Missing analytics is UNKNOWN.

## Current-state block (one per title, the only current status)

```
title: <friendly title name>
version: <build identifier>
QA verdict: <PASS | FIX | NOT TESTED | none>
checks executed: <list>
checks NOT TESTED: <list>
evidence links: <artifact references that exist>
blocker owner: <role or owner, or none>
active dispatch state: <none | task reference>
next action: <one line>
updated: <YYYY-MM-DD>
```

Historic narrative belongs in the ledger, not in these rows. Do not hard-code any live state as a default. A new build clears QA verdict to NOT TESTED until re-scored.

## Schedule clauses (exact before and after)

Each "Before" quotes only the anchor line. Everything not listed stays unchanged.

### Roblox Studio: Build Sprint (autonomous) — patch

- Before: `Do ONE milestone per sprint`
- After: `Each scheduled run is a checkpoint. Reconcile active task IDs and status first. Continue successive ready bounded increments while budget remains; at budget end, checkpoint with the exact resumable next action. Do not start a second task for work already in progress. There is no per-sprint milestone cap.`
- Before (quality line): the older reference floor wording (superseded)
- After: `Score Q1–Q10 for the exact version. Each category at least 7, average at least 8. A category under 7 or an average under 8 is a FIX.`
- Before (release line, if present): any wording that lets a staging or private test imply public release
- After: `Private staging is not public release. Public release needs the independent version-bound QA PASS and owner authorization.`
- Preserve: role details, the existing build and checkpoint steps, reporting format, and any approval gate.
- Activation stop: if an active run exists, wait for it to settle and review the current snapshot before applying.

### Roblox Studio: Daily Pulse — patch (status vocabulary only)

- Before: the existing status labels
- After: align the labels to `version`, `QA verdict`, `blocker owner`, `active dispatch state`, `next action`.
- Preserve: the pulse and checklist. The pulse implies no dispatch and no publish.

### Roblox Studio: Weekly Strategy — patch

- Before: the existing research and backlog steps (keep)
- After: add `Align to one active title, the next accepted evidence-backed increment, original IP, and a named monitoring owner.`
- Add: `This schedule never overrides a release gate.`
- Preserve: research and backlog steps.

## Evidence schema (versioned)

- Each record: version identifier, date, role, checks executed, checks not executed, sample size for any metric, source, and retention class.
- Evidence is versioned to a build. Evidence for an older build is kept in the ledger and is not reused for a new build.
- Acquisition and retention metrics are stored in a separate record from QA evidence, with their own sample size and window. A QA PASS does not imply any acquisition or retention result.

## Rollback

Pause the schedule with its supported control. Restore the exact pre-change snapshot through the same authorized connector or UI. Verify the readback. If it cannot be verified, leave the schedule paused and escalate. Snapshot contents stay out of the repo.
