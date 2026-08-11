import assert from 'node:assert/strict';
import {
  BRAIN_DREAM_MAX_PROPOSALS,
  claimBrainDreamProposalSlot,
  clearBrainDreamProposalBudget,
  getBrainDreamProposalBudget,
  isBrainDreamSession,
  releaseBrainDreamProposalSlot,
} from './brain-proposal-policy.js';

const sessionId = 'brain_dream_2099-12-31';
clearBrainDreamProposalBudget(sessionId);

assert.equal(isBrainDreamSession(sessionId), true);
assert.equal(isBrainDreamSession('brain_dream_cleanup_2099-12-31'), false);
assert.equal(isBrainDreamSession('interactive-session'), false);

for (let index = 1; index <= BRAIN_DREAM_MAX_PROPOSALS; index += 1) {
  const budget = claimBrainDreamProposalSlot(sessionId);
  assert.equal(budget.allowed, true);
  assert.equal(budget.used, index);
}

const exhausted = claimBrainDreamProposalSlot(sessionId);
assert.equal(exhausted.allowed, false);
assert.equal(exhausted.remaining, 0);
assert.equal(getBrainDreamProposalBudget(sessionId).used, BRAIN_DREAM_MAX_PROPOSALS);

releaseBrainDreamProposalSlot(sessionId);
const released = claimBrainDreamProposalSlot(sessionId);
assert.equal(released.allowed, true);
assert.equal(released.used, BRAIN_DREAM_MAX_PROPOSALS);

clearBrainDreamProposalBudget(sessionId);
assert.deepEqual(getBrainDreamProposalBudget(sessionId), {
  used: 0,
  remaining: BRAIN_DREAM_MAX_PROPOSALS,
  limit: BRAIN_DREAM_MAX_PROPOSALS,
});

// Ordinary proposals are not subject to the Brain Dream budget.
assert.equal(claimBrainDreamProposalSlot('interactive-session').allowed, true);
console.log('brain proposal policy regression passed');
