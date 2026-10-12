# Evidence review dashboard

## Entry points
- Desktop web and Electron: **Audit**, **Memory**, or **Hub** → **Review context evidence / Review skill routing evidence**. Both evidence tabs are available from every entry.
- Desktop deep links: `#context-review` and `#context-review/skills` activate Audit or Hub and open the dashboard.
- Mobile PWA: **More → Audit / Memory**, or **Hub** → **Review context & skill evidence**. This preserves the existing mobile glass shell and does not change voice modules.

The shared renderer is `web-ui/src/context-review.js`; host adapters use existing authenticated `api.js` transport. Desktop launcher re-anchors after page-owner markup replacement. Evidence is inserted using DOM `textContent`; no user evidence is interpolated into HTML.

## Semantics and limits
Receipts are bounded, privacy-scrubbed representations of assembled provider-bound attempts, not complete raw prompts or proof of provider acceptance. Original caller input is separate from the boundary fallback and transformed input. Redacted, truncated, duplicate and unavailable labels remain explicit. Completion is not retrieval efficacy. A manual usefulness review is reviewer judgment, not measured efficacy.

The list loads at most 100 receipts / 200 routing examples. Pagination is over the loaded sample, not a claim to cover all history. Context search and review filters operate locally; session/window filters query the backend. Partial sampling is labeled. Ranking and suppression are only shown when actual producer traces exist.

Context reviews POST `/:id/review` with relevance/reason; skill reviews use `/api/learning/skill-routing-feedback` with exact turnId/requestHash/skillId identity and user reviewer source. Skill read rate is not relevance; precision uses explicit relevant/irrelevant reviews. Unknown extra fields are ignored safely. Pending trigger proposals link to the existing Hub curator approval/apply/reject/rollback UI; no trigger is changed by review. The bounded curator feed can omit pending items: open curator for the full queue.

Capture pause is reversible and does not delete history. Retention is 1–30 days; reducing it requires confirmation because older receipts can be pruned. Reset has explicit irreversible-delete confirmation and does not implicitly disable capture. Credential redaction is not a guarantee against natural-language personal secrets.

## Verification
Run `node scripts/test-context-review-dashboard.mjs`. Requires existing Playwright Chromium. Screenshots default to `screenshots/`; set `CONTEXT_REVIEW_SCREENSHOTS` to another destination. Mocked tests cover 320/390/650px overflow, desktop/mobile list views, pagination, special characters/XSS literals, nested retrieval detail, context and skill review controls, cancel/confirm reset, empty/error responses, and actual desktop launcher re-anchoring after replacement. Live backend integration, Electron packaging, phone-device verification, generated bundles, typecheck and build are coordinator-owned.
