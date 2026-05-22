# Example: Small Web UI Fix With Dev Fast Approval

Scenario: Raul says, "the approval card has a ghost duplicate; please fix it."

## Inspection

- Run `git status --short`.
- Search for approval render paths:
  - `rg -n "approval_created|approval-card|session-approvals" web-ui/src web-ui/index.html`
- Read the focused functions/classes before editing.
- Confirm whether the UI is vanilla JS/static modules or another stack from actual files.

## Short Plan

Plan:

- Files likely to change: `web-ui/src/pages/ChatPage.js`, maybe `web-ui/src/styles/pages.css`.
- Why: duplicate approval surfaces are rendered from the desktop chat page and legacy pending-actions panel.
- Verification: `npm run sync:web-ui`, browser smoke on active chat approval.
- Risk: approval UI must still work inline; do not alter backend approval gates.

## Approval Request

Call `request_dev_source_edit` with:

- `files`: `["web-ui/src/pages/ChatPage.js", "web-ui/src/styles/pages.css"]`
- `reason`: "Fix duplicate/legacy approval rendering while preserving inline approval cards."
- `verification_command`: `npm run sync:web-ui`

## After Approval

- Patch only approved files.
- Reread changed areas.
- Run `npm run sync:web-ui`.
- If behavior changed, smoke test the web UI and check console errors.
- Prefer `prom_apply_dev_changes({ changed_surfaces:["web-ui"] })` when available to request desktop reload.

## Final Report

Changed:

- Disabled legacy approval panel rendering during live approval streams.

Files:

- `web-ui/src/pages/ChatPage.js`
- `web-ui/src/styles/pages.css`

Verified:

- `npm run sync:web-ui` passed.
- Browser smoke: approval appears only inside tool stream, no duplicate panel.

Notes:

- Backend approval behavior unchanged.
