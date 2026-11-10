# Content-aware approvals
Surface: both
Parity: Shared preview component in desktop chat/Teams/Tasks/Proposals and phone chat/Tasks/Proposals. Existing decisions and channel text fallback retained.
Test: node --import tsx src/gateway/content-review.regression.ts
Size justification: One shared preview contract spans existing approval, proposal, generation, and desktop/mobile hosts; generated UI churn is required by sync.
## Problem
Approvals hide media and full captions/prompts. Raul approved the phone design and explicitly requested immediate solo build without tier/planning/review-agent ceremony. No merge authorization.
## Chosen approach
Extend existing cards with bounded content metadata and authenticated workspace media, full text and destination/settings. Inline edits request a new prepared approval, never mutate an authorized click. Proposal revision snapshots include previews. Gated generation tools derive previews from actual args, paid video quotes capture shot prompts/references. Preserve old cards. No new global generation gate or posting automation.
## Acceptance
Image/video/carousel/full text previews on both surfaces. Unsafe paths/text rejected or escaped. Long captions retained. Changes reject original grant and return feedback. Session/tool/one-shot tests retained. Proposal revision persistence tested. Video quote content changes require new review. Build/sync/typecheck/regression and actual renderer screenshots.
## Files
- .pr/SPEC.md
- src/gateway/content-review.ts
- src/gateway/content-review.regression.ts
- src/gateway/video-content-review.ts
- src/gateway/video-pending-approvals.ts
- src/gateway/final-action-approvals.ts
- src/gateway/verification-flow.ts
- src/gateway/approval-actions.ts
- src/gateway/agents-runtime/handlers/default-tools.ts
- src/gateway/tools/defs/cis-system.ts
- src/gateway/routes/settings.router.ts
- src/gateway/routes/video-project.routes.ts
- src/gateway/proposals/proposal-store.ts
- web-ui/src/components/ContentReview.js
- web-ui/src/pages/ChatPage.js
- web-ui/src/pages/TeamsPage.js
- web-ui/src/pages/TasksPage.js
- web-ui/src/pages/ProposalsPage.js
- web-ui/src/mobile/mobile-pages.js
- web-ui/src/mobile/mobile-tasks-pages.js
- web-ui/src/mobile/mobile-proposals-pages.js
- scripts/test-content-review-ui.mjs
- workspace/self/21-security-approvals-permissions.md
## Risks
Preview metadata does not attest browser composer state or freeze file bytes. Require new prepared request after edit, retain visual recheck. No new claim of verified publication; existing approved state is not posted. Generation autopolicies remain unchanged. Actual live publication/payment not tested or authorized. Rollback revert feature commit. Self docs read/updated: self/21-security-approvals-permissions.md.
