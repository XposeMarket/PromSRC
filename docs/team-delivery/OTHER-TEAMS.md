# X Growth, Perf QA, and Teams Gauntlet payloads (portable, DRAFT, not active)

Status: staged text only. No skill catalog change, no skill activation, no live schedule change. Apply only through `docs/team-delivery/README.md`.

## X Growth: x-growth-engine skill source — patch

Replace only these two conflicting clauses. Each Before is a short quoted clause from the skill source, not a whole prompt.

- Before: `each item requires Raul's approval`
- Before: `team members never post`
- After (single replacement paragraph):

> Team members may research, build, review, and save drafts. They do not post, reply, like, repost, follow, or send direct messages. The designated main-chat X editor may select and post only within the currently enabled, user-approved policy and caps, and within applicable platform rules. Prompt text or auto-post configuration does not bypass the runtime's final-action approval gate. A rejected or denied action is not retried without fresh authorization. Draft and review work and posting are separate lanes.

Preserve: voice, research, build and review steps, files and JSON handling, limits, scheduling, caps, kill switch, logging, and fallback steps.

## X Growth: Morning Brief — no-op unless a live conflict matches

First verify the live text. If it already assigns main-editor publishing, team drafts only, JSON validation, and build review, make no change (no-op). Patch only if the live text contains one of the two clauses above, and then only that clause. Preserve the research step, the build-review step, JSON checks, and the Radar steps. A morning-brief completion does not equal a product launch.

## X Editor: auto-select + post — patch

- Add the clause: `Only the named main-chat editor may select or post. Every external post still goes through the runtime and tool approval gate. If an action is denied, stop and report it. Do not convert a denied action into a scheduled retry, and do not instruct team agents to post.`
- Preserve: selection workflow, caps, kill switch, and logging.

## Perf QA — on-demand contract (replace; no schedule)

Perf QA runs for a named real diff only. It does not run on idle time, and it does not present old results as current.

Required for each run:
- A named diff, baseline, environment, and commit.
- Before and after evidence on desktop and on phone, when the change affects those surfaces.
- A reproducible command.
- An actionable defect owner.
- A recheck result after any fix.
- Honest limitations, including what was not measured.

Historical Oct 1 measurements are reference only. No current performance claim or regression is inferred from them.

## Teams Gauntlet — fixture contract (replace; no schedule)

Gauntlet is a test fixture, not staff and not a KPI.

- A PASS requires a nonzero discovered test count and the actual test command and output.
- Zero discovered tests means "no evidence / blocked", not success.
- Before dispatch, verify that the reviewer can access the exact canonical project root and the task scope.
- Report historical friction as regression fixtures. Do not treat them as current faults unless reproduced.
- Do not broaden beyond the fixture project. Do not presume GitHub or posting permission.

No new team and no new schedule is created by this pack.

## X team mapping: README, team description, teamContext, roles (Growth, Scout, Sage)

- Live X README, team description, and teamContext: patch only the stale statements that say each item needs owner approval or that members never post, using the staged clause above. Keep the rest.
- Growth, Scout, and Sage role text: keep research, scouting, and writing steps. Remove only the per-item-approval or never-draft clause. Their output is drafts only; they do not post.
- Editor role (main chat): keeps selection, caps, kill switch, and approval. It is the only X poster.

## Roblox quality mapping

- Live quality bar (section 7) and TEAM QA references: use `roblox/QUALITY-ALIGNMENT.md`. Replace the older reference-floor and older eight-category clauses together (both are superseded). Stop on any unreconciled mismatch.

## Authority boundary (all teams)

X team members never post, reply, like, repost, follow, or DM. Only the main-chat X editor acts externally on X, through the existing runtime approval gates. Roblox responsible roles may publish under standing owner authorization after QA PASS. Spending stays owner-only. Prompt text does not grant permission.
