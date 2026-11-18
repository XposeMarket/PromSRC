# SPEC: video approval fails closed when no content review was recorded

Tier: 1 + one opposite-model review (fix inside a sensitive area: approvals)
Surface: backend
Parity: n/a (the approve route is shared by desktop and mobile Needs You)
Test: npx tsx src/gateway/video-approval-review.regression.ts

## Problem
- src/gateway/video-pending-approvals.ts:65 swallows a failed `videoContentReview`, leaving `record.contentReview` undefined.
- src/gateway/routes/video-project.routes.ts:208 only compared when `record.contentReview` existed, then ran `executeVideoProject(approved:true)`.
- A failed check defaulted to allow. Found by the Opus 5.5 review of PR #862 (finding 3) and confirmed at f3b4bd1f7.

## Chosen approach
A pure function `decideVideoApproval(recorded, recompute)` returns allow or refuse-with-reason. The approve route returns 409 before the executor is loaded unless a review was recorded at quote time and the recomputed review is identical. A refused record stays in Needs You so it can be dismissed. No video approval kind has nothing to review (only `run` and `generate`, both require a project id), so no separate state was added.

## Acceptance
- Recorded review + unchanged project: approve executes as before.
- Recorded review + project changed after the quote: 409, not executed.
- No recorded review: 409 asking for a new generation approval, not executed.
- Review cannot be recomputed at approve time: 409, not executed.
- Regression test asserts the decision in both directions.

## Files
- src/gateway/video-content-review.ts
- src/gateway/routes/video-project.routes.ts
- src/gateway/video-pending-approvals.ts
- src/gateway/video-approval-review.regression.ts

## Risks
- A quote recorded while its project was unreadable can no longer be approved; the user must re-quote. Noticed as a 409 with that message. Rollback: revert this commit.
- Not covered here: the agent-side `video_project` call with `approved:true` does not pass through this route; reference image contents are not hashed; the project can change between the check and execution.
