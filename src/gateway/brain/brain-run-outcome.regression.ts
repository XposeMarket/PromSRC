import assert from 'node:assert/strict';
import { brainRunOutcomeError, resolveBrainRunOutcome } from './brain-run-outcome';

assert.equal(resolveBrainRunOutcome({ verifiedSuccess: true, wasAborted: false }), 'success');
assert.equal(resolveBrainRunOutcome({ verifiedSuccess: true, wasAborted: true }), 'success');
assert.equal(resolveBrainRunOutcome({ verifiedSuccess: false, wasAborted: false }), 'failed');
assert.equal(resolveBrainRunOutcome({ verifiedSuccess: false, wasAborted: true }), 'aborted');
assert.equal(
  brainRunOutcomeError('thought', 'aborted', 'artifact missing'),
  'Brain thought run aborted before verified artifact completion.',
);
assert.equal(
  brainRunOutcomeError('thought', 'aborted', 'artifact missing', 'signal_sigterm'),
  'Brain thought run aborted (signal_sigterm) before verified artifact completion.',
);

console.log('brain run outcome regression passed');
