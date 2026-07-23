# Proposals Page: Controlled Change Decisions

Owner: `web-ui/src/pages/ProposalsPage.js`; routes: proposal and approval gateway families.

Proposals separate an agent’s suggested consequential change from its execution. The page lists proposals by status, opens their scope/details, and provides approve or deny actions. Chat and Tasks can also render the originating proposal/approval inline; the page is the centralized review queue.

## What to explain in documents

- Proposal status is a lifecycle state—pending, executing, approved, denied, executed or filtered equivalents—not proof that a change was performed.
- Approval cards can describe source-edit, command, final-action or other governed work. Scope/risk, target files/paths and technical details are displayed when the gateway supplies them.
- “Allow once,” session or always options appear only when the action and policy allow persistent scope. Dev-source/elevated/final-action approvals can be one-shot by design.
- Denial rejects the proposed action; it does not delete the historical proposal/audit trail.

The page is a safety control surface. Do not market it as frictionless auto-execution.
