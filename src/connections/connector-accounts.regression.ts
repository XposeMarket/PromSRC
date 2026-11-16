// Multi-account routing regression (2026-11-12). Run: npx tsx src/connections/connector-accounts.regression.ts
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  accountKeySuffix, armAddAccount, bindingKeyFor, listConnectorAccounts, removeAccountRecord,
  replaceAccountRecord, routeIncomingAccount, runWithConnectorAccounts,
} from './connector-accounts';
import { waitForSecureAccess, notifySecureAccessSteer, isSecureAccessBlocking } from '../security/secure-access-waits';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-accts-'));
const def = { email: 'raul@xposemarket.com' };

// 1. No add mode: a new grant goes to the default slot (first connect / reconnect).
assert.equal(routeIncomingAccount(dir, 'gmail', 'oauth', { email: 'raul@xposemarket.com' }, () => null), '');
// 2. Add mode + same identity as default: refresh the default, no new account.
armAddAccount(dir, 'gmail');
assert.equal(routeIncomingAccount(dir, 'gmail', 'oauth', { email: 'RAUL@xposemarket.com' }, () => def), '');
assert.equal(listConnectorAccounts(dir, 'gmail').length, 0);
// 3. Add mode + different identity: a new extra account.
armAddAccount(dir, 'gmail', { label: 'Personal' });
const slug = routeIncomingAccount(dir, 'gmail', 'oauth', { email: 'raul.personal@gmail.com' }, () => def);
assert.equal(slug, 'raul-personal');
assert.equal(listConnectorAccounts(dir, 'gmail')[0].label, 'Personal');
// 4. Re-auth of an extra account (no add mode) routes back to its own slot, never the default.
assert.equal(routeIncomingAccount(dir, 'gmail', 'oauth', { email: 'raul.personal@gmail.com' }, () => def), slug);
// 5. Ambient selection drives storage keys; default slot has no suffix.
assert.equal(accountKeySuffix('gmail'), '');
runWithConnectorAccounts(['gmail'], slug, () => {
  assert.equal(accountKeySuffix('gmail'), `.acct_${slug}`);
  assert.equal(bindingKeyFor('gmail'), `gmail::acct::${slug}`);
  assert.equal(accountKeySuffix('x'), '', 'scope is per connector');
  // Token refresh inside the scope stays on that account even with add mode armed.
  armAddAccount(dir, 'gmail');
  assert.equal(routeIncomingAccount(dir, 'gmail', 'oauth', { email: 'raul.personal@gmail.com' }, () => def), slug);
});
// 6. X: usernames, '@' insensitive.
armAddAccount(dir, 'x');
const xSlug = routeIncomingAccount(dir, 'x', 'x', { username: 'weoutsidedc', accountId: '2' }, () => ({ username: 'Raulinvests', accountId: '1' }));
assert.equal(xSlug, 'weoutsidedc');
// 7. Make default bookkeeping: previous default becomes an extra account.
const newSlug = replaceAccountRecord(dir, 'x', xSlug, { label: '@Raulinvests', kind: 'x', username: 'Raulinvests' });
assert.equal(newSlug, 'raulinvests');
assert.deepEqual(listConnectorAccounts(dir, 'x').map((a) => a.slug), ['raulinvests']);
// 8. Remove.
assert.ok(removeAccountRecord(dir, 'gmail', slug));
assert.equal(listConnectorAccounts(dir, 'gmail').length, 0);

// 9. Blocking secure_access wait: resolves, steers and marks blocking.
(async () => {
  let ready: string | undefined;
  setTimeout(() => { ready = 'saved'; }, 30);
  const resolved = await waitForSecureAccess({ id: 'req1', sessionId: 's1', timeoutMs: 5000, intervalMs: 10, check: () => ready });
  assert.deepEqual(resolved, { kind: 'resolved', value: 'saved' });
  assert.equal(isSecureAccessBlocking('req1'), true, 'resolved while blocking: chat must not get a duplicate continuation');
  const steered = waitForSecureAccess({ id: 'req2', sessionId: 's2', timeoutMs: 5000, intervalMs: 10, check: () => undefined });
  setTimeout(() => notifySecureAccessSteer('s2', 'hold on'), 20);
  assert.deepEqual(await steered, { kind: 'steer', message: 'hold on' });
  assert.equal(isSecureAccessBlocking('req2'), false, 'after a steer the card must continue the chat itself');
  const ctl = new AbortController();
  const aborted = waitForSecureAccess({ id: 'req3', sessionId: 's3', timeoutMs: 5000, intervalMs: 10, check: () => undefined, abortSignal: { signal: ctl.signal } });
  setTimeout(() => ctl.abort(), 20);
  assert.deepEqual(await aborted, { kind: 'aborted' });
  fs.rmSync(dir, { recursive: true, force: true });
  console.log('PASS connector-accounts: default/extra routing, add mode, re-auth, scoped keys, X, make-default, remove, blocking secure_access waits');
})().catch((error) => { console.error(error); process.exit(1); });
