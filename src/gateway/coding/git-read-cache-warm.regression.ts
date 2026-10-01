// A remembered read that went cold (past STALE_MAX_MS) must be refreshed by
// warmGitReads with the async refresher, so the following synchronous call is a
// cache hit and never blocks the event loop with execFileSync.
import assert from 'node:assert/strict';
import { cachedGitRead, resetGitReadCacheForTests, warmGitReads } from './git-read-cache';

const realNow = Date.now;
let clock = realNow();
Date.now = () => clock;

async function main(): Promise<void> {
  resetGitReadCacheForTests();
  let syncRuns = 0;
  let asyncRuns = 0;
  let maxParallel = 0;
  let parallel = 0;
  const run = () => { syncRuns += 1; return `sync-${syncRuns}`; };
  const refresh = async () => {
    asyncRuns += 1; parallel += 1; maxParallel = Math.max(maxParallel, parallel);
    await new Promise((r) => setTimeout(r, 15));
    parallel -= 1;
    return `async-${asyncRuns}`;
  };

  // 1. Nothing remembered yet: warm-up is a no-op.
  assert.equal(await warmGitReads(), 0, 'no refreshers yet');

  // 2. A cold miss runs sync once and remembers the refresher.
  assert.equal(cachedGitRead('/repo-a', ['status'], run, 't', refresh), 'sync-1');
  assert.equal(syncRuns, 1);

  // 3. Fresh entries are not refreshed.
  assert.equal(await warmGitReads(), 0, 'fresh entry skipped');

  // 4. After going fully cold (> 60 s), warm-up refreshes asynchronously and the
  //    next read is a hit with the refreshed value, with no extra sync run.
  clock += 120_000;
  assert.equal(await warmGitReads(), 1, 'cold entry refreshed');
  assert.equal(asyncRuns, 1);
  assert.equal(cachedGitRead('/repo-a', ['status'], run, 't', refresh), 'async-1', 'hit after warm');
  assert.equal(syncRuns, 1, 'no blocking sync run after warm-up');

  // 5. Root filter: only reads under the requested root are warmed.
  cachedGitRead('/repo-b', ['status'], run, 't', refresh);
  clock += 120_000;
  assert.equal(await warmGitReads(['/repo-b']), 1, 'only repo-b warmed');
  assert.equal(cachedGitRead('/repo-b', ['status'], run, 't', refresh), `async-${asyncRuns}`);

  // 6. Bounded fan-out: many due reads never run more than 4 refreshers at once.
  for (let i = 0; i < 12; i += 1) cachedGitRead('/repo-c', ['log', String(i)], run, 't', refresh);
  clock += 120_000;
  maxParallel = 0;
  const warmed = await warmGitReads();
  assert.ok(warmed >= 12, `warmed ${warmed}`);
  assert.ok(maxParallel <= 4, `max parallel refreshers ${maxParallel}`);

  // 7. Max wait: a hung refresher cannot hold the request forever.
  resetGitReadCacheForTests();
  cachedGitRead('/repo-d', ['status'], run, 't', () => new Promise<string>(() => {}));
  clock += 120_000;
  const t0 = realNow();
  await warmGitReads(undefined, 50);
  assert.ok(realNow() - t0 < 1_000, 'maxWaitMs honoured');

  Date.now = realNow;
  console.log('[git-read-cache-warm] cold reads refreshed off the event loop, bounded fan-out and wait');
}

void main().catch((error) => { console.error(error); process.exitCode = 1; });
