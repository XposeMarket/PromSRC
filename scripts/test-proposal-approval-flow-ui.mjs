import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const proposals = read('web-ui/src/pages/ProposalsPage.js');
const api = read('web-ui/src/api.js');
const router = read('src/gateway/routes/proposals.router.ts');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(/formatProposalActionError/.test(proposals), 'proposal UI must normalize approval errors');
assert(/showToast\('Approval failed',\s*formatProposalActionError/.test(proposals), 'approval failures must use concise actionable UI copy');
assert(/finally\s*\{[\s\S]{0,260}await loadProposals\(\)/.test(proposals), 'approval must refresh proposal state after success or failure');
assert(/proposalActionsInFlight/.test(proposals), 'proposal approval clicks must be coalesced in the UI');
assert(/getApiErrorMessage/.test(api) && !/throw new Error\(`API \$\{r\.status\}: \$\{body\}`\)/.test(api), 'API errors must not dump raw response payloads');
assert(/compactProposalState/.test(router) && /compactProposalError\(err/.test(router), 'approval API errors must return bounded proposal state and messages');
assert(/idempotent\?: boolean/.test(router) && /IDEMPOTENT_APPROVAL_STATUSES/.test(router), 'approval API must support idempotent responses');

console.log('proposal approval UI regression passed');
