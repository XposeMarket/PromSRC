import assert from 'node:assert/strict';
import { isRetryableAccountFailure, orderProviderAccountIds, preferConnectedAccountId } from './provider-account-pool';

const accounts = { selected: {}, primary: {}, backup: {} };
assert.deepEqual(
  orderProviderAccountIds(accounts, 'selected', 'primary'),
  ['selected', 'primary', 'backup'],
  'the saved selection must be primary, followed by default and remaining accounts',
);
assert.equal(
  preferConnectedAccountId(accounts, 'selected', id => id === 'primary'),
  'primary',
  'an unfinished selected account must not displace a connected account',
);
assert.equal(
  preferConnectedAccountId(accounts, 'selected', id => id === 'selected' || id === 'primary'),
  'selected',
  'a connected selected account remains the default',
);
assert.equal(
  preferConnectedAccountId(accounts, 'selected', () => false),
  'selected',
  'the selection remains available while no account is connected',
);
assert.equal(isRetryableAccountFailure(429, 'usage limit exceeded'), true);
assert.equal(isRetryableAccountFailure(400, 'invalid request'), false);
assert.equal(isRetryableAccountFailure(503, 'upstream unavailable'), true);
console.log('provider account pool regression checks passed');
