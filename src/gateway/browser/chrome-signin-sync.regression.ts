import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  clearChromeSigninSyncCache,
  listChromeAccounts,
  maybeAutoSyncChromeSignins,
  parseGoogleListAccounts,
  readChromeSigninGrant,
  setChromeSigninGrant,
  summarizeChromeSites,
  syncDomainsFor,
  type ChromeSigninSyncDeps,
} from './chrome-signin-sync';

async function main() {
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chrome-signin-sync-'));
try {
  // Google ListAccounts: XSSI prefix stripped, duplicates collapsed, signedIn from index 5.
  const raw = ")]}'\n" + JSON.stringify([
    [["Alice Example", "alice@example.com", null, null, null, 1]],
    [["Bob", "bob@example.com", null, null, null, 0]],
    [["Alice Example", "ALICE@example.com", null, null, null, 1]],
  ]);
  const accounts = parseGoogleListAccounts(raw);
  assert.deepEqual(accounts.map(a => a.email), ['alice@example.com', 'bob@example.com']);
  assert.equal(accounts[0].name, 'Alice Example');
  assert.equal(accounts[0].signedIn, true);
  assert.equal(accounts[1].signedIn, false);
  assert.deepEqual(parseGoogleListAccounts('not json'), []);
  assert.deepEqual(parseGoogleListAccounts(''), []);

  // Cookie counts group by registrable domain; leading dots are ignored.
  const sites = summarizeChromeSites([
    { domain: '.mail.google.com', count: 2 },
    { domain: 'google.com', count: 3 },
    { domain: 'example.co.uk', count: 4 },
    { domain: '', count: 9 },
  ]);
  assert.deepEqual(sites[0], { site: 'google.com', cookies: 5 });
  assert.ok(sites.some(s => s.site === 'example.co.uk' && s.cookies === 4));
  assert.equal(sites.some(s => s.site === ''), false);

  // Only syncable http(s) public hosts produce domains; the registrable domain comes first.
  assert.equal(syncDomainsFor('https://mail.google.com/inbox')[0], 'google.com');
  assert.ok(syncDomainsFor('https://mail.google.com/inbox').length <= 20);
  assert.deepEqual(syncDomainsFor('http://localhost:3000/'), []);
  assert.deepEqual(syncDomainsFor('http://127.0.0.1/'), []);
  assert.deepEqual(syncDomainsFor('file:///etc/hosts'), []);
  assert.deepEqual(syncDomainsFor('not a url'), []);

  // Grant file round-trip; a missing or broken file means off.
  const grantFile = path.join(dir, 'chrome-signin-sync.json');
  assert.equal(readChromeSigninGrant(grantFile).enabled, false);
  setChromeSigninGrant(true, grantFile, Date.UTC(2026, 9, 20));
  assert.equal(readChromeSigninGrant(grantFile).enabled, true);
  assert.equal(readChromeSigninGrant(grantFile).grantedAt, '2026-10-20T00:00:00.000Z');
  setChromeSigninGrant(false, grantFile);
  assert.equal(readChromeSigninGrant(grantFile).enabled, false);
  fs.writeFileSync(grantFile, '{broken');
  assert.equal(readChromeSigninGrant(grantFile).enabled, false);

  // Auto-sync decisions with injected deps. Each scenario uses its own profile id.
  const now = Date.UTC(2026, 9, 20, 12, 0, 0);
  const makeDeps = (over: Partial<ChromeSigninSyncDeps> = {}) => {
    const calls = { requestCookies: 0, importCookies: 0, reload: 0 };
    const deps: ChromeSigninSyncDeps = {
      getGrant: () => ({ enabled: true }),
      isPaired: () => true,
      waitForPeer: async () => true,
      requestRelay: async () => null,
      requestCookies: async () => { calls.requestCookies++; return [{ name: 'sid', domain: '.google.com' }]; },
      importCookies: async () => { calls.importCookies++; return 3; },
      reload: async () => { calls.reload++; },
      now: () => now,
      ...over,
    };
    return { deps, calls };
  };
  const input = { sessionId: 's1', profileId: 'p-disabled', url: 'https://mail.google.com/' };

  let off = makeDeps({ getGrant: () => ({ enabled: false }) });
  let r = await maybeAutoSyncChromeSignins(off.deps, input);
  assert.equal(r.synced, false);
  assert.equal(r.reason, 'disabled');
  assert.equal(off.calls.requestCookies, 0, 'disabled grant must not request cookies');

  const on = makeDeps();
  const onInput = { sessionId: 's2', profileId: 'p-enabled', url: 'https://mail.google.com/' };
  r = await maybeAutoSyncChromeSignins(on.deps, onInput);
  assert.deepEqual({ synced: r.synced, imported: r.imported, domain: r.domain }, { synced: true, imported: 3, domain: 'google.com' });
  assert.equal(on.calls.reload, 1, 'imported cookies reload the page once');
  r = await maybeAutoSyncChromeSignins(on.deps, onInput);
  assert.equal(r.reason, 'cached', 'second open inside the TTL must not sync again');
  assert.equal(on.calls.requestCookies, 1);

  const unpaired = makeDeps({ isPaired: () => false, waitForPeer: async () => false });
  r = await maybeAutoSyncChromeSignins(unpaired.deps, { ...onInput, profileId: 'p-unpaired' });
  assert.equal(r.reason, 'chrome-not-paired');
  assert.equal(unpaired.calls.requestCookies, 0);

  const failing = makeDeps({ requestCookies: async () => { throw new Error('relay down'); } });
  r = await maybeAutoSyncChromeSignins(failing.deps, { ...onInput, profileId: 'p-failing' });
  assert.equal(r.synced, false, 'auto-sync failure must not throw into the browser-open path');
  assert.equal(r.reason, 'relay down');

  // Agent inventory: emails and site counts only, never cookie names or values.
  const inv = makeDeps({
    requestRelay: async (method: string) => {
      if (method === 'google.accounts') return { raw: raw };
      if (method === 'cookies.sites') return [{ domain: '.github.com', count: 7 }];
      return null;
    },
  });
  const inventory = await listChromeAccounts(inv.deps);
  assert.equal(inventory.paired, true);
  assert.deepEqual(inventory.accounts.map(a => a.email), ['alice@example.com', 'bob@example.com']);
  assert.deepEqual(inventory.sites, [{ site: 'github.com', cookies: 7 }]);
  assert.equal(JSON.stringify(inventory).includes('sid'), false);

  // Unpaired Chrome: the second open inside the backoff must not wait again.
  let waits = 0;
  const backoff = makeDeps({ isPaired: () => false, waitForPeer: async () => { waits++; return false; } });
  await maybeAutoSyncChromeSignins(backoff.deps, { ...onInput, profileId: 'p-backoff-1' });
  r = await maybeAutoSyncChromeSignins(backoff.deps, { ...onInput, profileId: 'p-backoff-2' });
  assert.equal(r.reason, 'chrome-not-paired');
  assert.equal(waits, 1, 'unpaired backoff must skip the 3s wait on the next open');
  clearChromeSigninSyncCache();
  const paired = makeDeps();
  r = await maybeAutoSyncChromeSignins(paired.deps, { ...onInput, profileId: 'p-backoff-3' });
  assert.equal(r.synced, true, 'clearing the cache resets the unpaired backoff');

  // Old extension worker: the agent gets the reload instruction, not "none detected".
  const stale = makeDeps({ requestRelay: async (method: string) => { throw new Error(`Unsupported Personal Chrome relay method: ${method}`); } });
  const staleInv = await listChromeAccounts(stale.deps);
  assert.equal(staleInv.paired, true);
  assert.match(String(staleInv.reason), /chrome:\/\/extensions/);

  const notPaired = makeDeps({ isPaired: () => false, waitForPeer: async () => false });
  const missing = await listChromeAccounts(notPaired.deps);
  assert.deepEqual({ paired: missing.paired, reason: missing.reason }, { paired: false, reason: 'chrome-not-paired' });

  console.log('chrome-signin-sync regression passed');
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
}

main().catch(err => { console.error(err); process.exit(1); });
