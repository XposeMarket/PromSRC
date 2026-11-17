// Multi-account routing regression (2026-11-12). Run: npx tsx src/connections/connector-accounts.regression.ts
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  accountKeySuffix, armAddAccount, bindingKeyFor, disarmAddAccount, listConnectorAccounts, planReplacementSlug,
  removeAccountRecord, replaceAccountRecord, routeIncomingAccount, runWithConnectorAccounts,
} from './connector-accounts';
import { moveAccountPluginCredential, swapAccountPluginCredential } from './plugin-credential-binding';
import { waitForSecureAccess, notifySecureAccessSteer, isSecureAccessBlocking } from '../security/secure-access-waits';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-accts-'));
const def = { email: 'alex@example.com' };

// 1. No add mode: a new grant goes to the default slot (first connect / reconnect).
assert.equal(routeIncomingAccount(dir, 'gmail', 'oauth', { email: 'alex@example.com' }, () => null), '');
// 2. Add mode + same identity as default: refresh the default, no new account.
armAddAccount(dir, 'gmail');
assert.equal(routeIncomingAccount(dir, 'gmail', 'oauth', { email: 'ALEX@example.com' }, () => def), '');
assert.equal(listConnectorAccounts(dir, 'gmail').length, 0);
// 3. Add mode + different identity: a new extra account.
armAddAccount(dir, 'gmail', { label: 'Personal' });
const slug = routeIncomingAccount(dir, 'gmail', 'oauth', { email: 'alex.personal@gmail.com' }, () => def);
assert.equal(slug, 'alex-personal');
assert.equal(listConnectorAccounts(dir, 'gmail')[0].label, 'Personal');
// 4. Re-auth of an extra account (no add mode) routes back to its own slot, never the default.
assert.equal(routeIncomingAccount(dir, 'gmail', 'oauth', { email: 'alex.personal@gmail.com' }, () => def), slug);
// 5. Ambient selection drives storage keys; default slot has no suffix.
assert.equal(accountKeySuffix('gmail'), '');
runWithConnectorAccounts(['gmail'], slug, () => {
  assert.equal(accountKeySuffix('gmail'), `.acct_${slug}`);
  assert.equal(bindingKeyFor('gmail'), `gmail::acct::${slug}`);
  assert.equal(accountKeySuffix('x'), '', 'scope is per connector');
  // Token refresh inside the scope stays on that account even with add mode armed.
  armAddAccount(dir, 'gmail');
  assert.equal(routeIncomingAccount(dir, 'gmail', 'oauth', { email: 'alex.personal@gmail.com' }, () => def), slug);
});
// 6. X: usernames, '@' insensitive.
armAddAccount(dir, 'x');
const xSlug = routeIncomingAccount(dir, 'x', 'x', { username: 'brandaccount', accountId: '2' }, () => ({ username: 'MainAccount', accountId: '1' }));
assert.equal(xSlug, 'brandaccount');
// 7. Make default bookkeeping: previous default becomes an extra account.
const newSlug = replaceAccountRecord(dir, 'x', xSlug, { label: '@MainAccount', kind: 'x', username: 'MainAccount' });
assert.equal(newSlug, 'mainaccount');
assert.deepEqual(listConnectorAccounts(dir, 'x').map((a) => a.slug), ['mainaccount']);
// 8. Remove.
assert.ok(removeAccountRecord(dir, 'gmail', slug));
assert.equal(listConnectorAccounts(dir, 'gmail').length, 0);

// 8b. Review #892 finding 1: an add flag past its display TTL must still route a NEW identity
// to a new slot. It must never be downgraded into an overwrite of the default.
{
  armAddAccount(dir, 'gmail', { label: 'Late' });
  const idx = JSON.parse(fs.readFileSync(path.join(dir, 'connector-accounts.json'), 'utf8'));
  idx.gmail.adding.at = Date.now() - 60 * 60_000; // an hour old, past ADD_ACCOUNT_TTL_MS
  fs.writeFileSync(path.join(dir, 'connector-accounts.json'), JSON.stringify(idx));
  const late = routeIncomingAccount(dir, 'gmail', 'oauth', { email: 'late.signin@gmail.com' }, () => def);
  assert.notEqual(late, '', 'late grant of a new identity must not land in the default slot');
  removeAccountRecord(dir, 'gmail', late);
  // Cancelled add (flag removed): an unseen identity with no add mode is a plain reconnect of the default.
  disarmAddAccount(dir, 'gmail');
  assert.equal(routeIncomingAccount(dir, 'gmail', 'oauth', { email: 'alex@example.com' }, () => def), '');
}

// Resolve against a private fixture, never the running gateway's account store.
{
  const cfg = require('../config/config').getConfig();
  const prevDir = cfg.getConfigDir;
  cfg.getConfigDir = () => dir;
  try {
    const { resolveAccountRef } = require('./connector-account-service');
    const accounts = [{slug:'alice',label:'billing',username:'shared'}, {slug:'billing',label:'Primary credential',username:'shared'}].map(a => ({...a,kind:'credential',addedAt:'fixture'}));
    fs.writeFileSync(path.join(dir, 'connector-accounts.json'), JSON.stringify({fixture:{accounts}}));
    assert.deepEqual(resolveAccountRef('fixture','billing'),{slug:'billing'});
    assert.match(resolveAccountRef('fixture','@shared').error, /Ambiguous/);
    assert.match(resolveAccountRef('fixture','Primary credential').error, /Ambiguous/);
    assert.deepEqual(resolveAccountRef('fixture','default'),{slug:''});
  } finally { cfg.getConfigDir = prevDir; }
}

// 8c. Review #892 finding 3: credential make-default = swap + move to the planned slug, with no throw,
// and the bindings and index agree afterwards.
{
  const bfile = path.join(dir, 'plugin-credential-bindings.json');
  fs.writeFileSync(bfile, JSON.stringify({ vercel: { reference: 'vault:A', attemptId: 'a1' }, 'vercel::acct::team': { reference: 'vault:B', attemptId: 'b1' } }));
  fs.writeFileSync(path.join(dir, 'connector-accounts.json'), JSON.stringify({ vercel: { accounts: [{ slug: 'team', label: 'Team', kind: 'credential', addedAt: 'x' }] } }));
  const prev = { label: 'Primary credential', kind: 'credential' as const };
  const planned = planReplacementSlug(dir, 'vercel', 'team', prev);
  swapAccountPluginCredential(dir, 'vercel', 'team');
  moveAccountPluginCredential(dir, 'vercel', 'team', planned);
  replaceAccountRecord(dir, 'vercel', 'team', prev, planned);
  const b = JSON.parse(fs.readFileSync(bfile, 'utf8'));
  assert.equal(b.vercel.reference, 'vault:B', 'chosen account is now default');
  assert.equal(b[`vercel::acct::${planned}`].reference, 'vault:A', 'previous default kept under its new slug');
  assert.equal(b['vercel::acct::team'], undefined, 'old slot emptied');
  assert.deepEqual(listConnectorAccounts(dir, 'vercel').map((a) => a.slug), [planned], 'index matches bindings');
  assert.throws(() => moveAccountPluginCredential(dir, 'vercel', planned, ''), /DEFAULT_ACCOUNT_PROTECTED/);
}

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
