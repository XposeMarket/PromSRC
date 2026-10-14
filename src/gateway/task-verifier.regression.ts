import assert from 'node:assert/strict';
import { assessTaskVerification } from './tasks/task-verifier.js';

const failures = ['failed to verify', 'could not complete the task', 'unable to confirm output', 'did not meet requirements', 'acceptance criteria not met', 'blocked by missing access'];
for (const text of failures) assert.equal(assessTaskVerification({ text }).failed, true, text);
assert.equal(assessTaskVerification({ text: 'Success: all checks passed with no failures.' }).failed, false);
assert.equal(assessTaskVerification({ text: 'Looks good', status: 'failed' }).failed, true, 'structured failure status');
assert.equal(assessTaskVerification({ text: 'Success: no failures in unit tests.\nSummary: acceptance criteria not met.' }).failed, true);
assert.equal(assessTaskVerification({ text: 'No failed tests; all acceptance checks passed.' }).failed, false);
assert.equal(assessTaskVerification({ text: 'Complete. The task is not blocked.' }).failed, false);
assert.equal(assessTaskVerification({ text: 'Failed acceptance criteria', status: 'complete' }).failed, true);
assert.equal(assessTaskVerification({ text: '' }).failed, true);
console.log('task-verifier regression: 13 passed');
