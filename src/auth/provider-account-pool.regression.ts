import assert from 'node:assert/strict';
import { isRetryableAccountFailure, orderProviderAccountIds } from './provider-account-pool';

const accounts = { selected: {}, primary: {}, backup: {} };
assert.deepEqual(
  orderProviderAccountIds(accounts, 'selected', 'primary'),
  ['selected', 'primary', 'backup'],
  'the saved selection must be primary, followed by default and remaining accounts',
);
assert.equal(isRetryableAccountFailure(429, 'usage limit exceeded'), true);
assert.equal(isRetryableAccountFailure(400, 'invalid request'), false);
assert.equal(isRetryableAccountFailure(503, 'upstream unavailable'), true);
console.log('provider account pool regression checks passed');
