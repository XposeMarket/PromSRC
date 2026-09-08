import assert from 'node:assert/strict';
import {
  PROVIDER_STATUS_CACHE_MS,
  invalidateProviderStatusCache,
  isProviderStatusChecking,
  markProviderStatus,
  markProviderStatusChecking,
  readProviderStatusCache,
  readProviderStatusEvidence,
  resolveProviderStatus,
} from './provider-status.js';

async function main(): Promise<void> {
  const realNow = Date.now;
  let now = 1_000_000;
  Date.now = () => now;
  try {
    invalidateProviderStatusCache();
    markProviderStatus(true, 'provider-a');
    assert.equal(readProviderStatusCache('provider-a')?.connected, true);
    assert.equal(readProviderStatusCache('provider-b'), null, 'provider/account/config identity changes must not reuse another health result');

    markProviderStatus(true, 'provider-a');
    now += PROVIDER_STATUS_CACHE_MS + 1;
    assert.equal(readProviderStatusCache('provider-a'), null, 'expired health results must not remain readable indefinitely');
    assert.equal(readProviderStatusEvidence('provider-a').freshness, 'stale');
    assert.equal(readProviderStatusEvidence('provider-a').scope, 'unverified_runtime_route');
    assert.equal(readProviderStatusEvidence('provider-a').provider, null, 'an unscoped runtime report must not identify the executed provider');

    let probes = 0;
    const first = await resolveProviderStatus(async () => { probes += 1; return true; }, 'provider-b');
    const second = await resolveProviderStatus(async () => { probes += 1; return false; }, 'provider-b');
    assert.equal(first, true);
    assert.equal(second, true, 'fresh same-identity result should be reused');
    assert.equal(probes, 1, 'fresh cache should suppress duplicate provider probes');
    assert.equal(readProviderStatusEvidence('provider-b').scope, 'configured_provider_connection');
    assert.equal(readProviderStatusEvidence('provider-b').result, 'success');
    markProviderStatusChecking(true, 'provider-b');
    markProviderStatusChecking(true, 'another-check');
    await resolveProviderStatus(async () => { probes += 1; return false; }, 'provider-b');
    assert.equal(isProviderStatusChecking('provider-b'), false, 'a periodic cache hit must clear its transient checking flag');
    assert.equal(isProviderStatusChecking('another-check'), true, 'one provider must not clear another provider check');
    assert.equal(probes, 1, 'checking-flag refresh must not force another provider probe');

    const oldProbe = resolveProviderStatus(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return false;
    }, 'old-provider');
    markProviderStatus(true, 'new-provider');
    await oldProbe;
    assert.equal(readProviderStatusCache('new-provider')?.connected, true, 'an old in-flight probe must not overwrite the new provider identity');

    await resolveProviderStatus(async () => { throw new Error('secret must not leak'); }, 'exception-provider');
    assert.equal(readProviderStatusEvidence('exception-provider').result, 'exception');
    assert.ok(!JSON.stringify(readProviderStatusEvidence('exception-provider')).includes('secret'));
    await resolveProviderStatus(() => new Promise(() => {}), 'timeout-provider');
    assert.equal(readProviderStatusEvidence('timeout-provider').result, 'timeout');
    let finish!: (value: boolean) => void;
    const obsolete = resolveProviderStatus(() => new Promise<boolean>((resolve) => { finish = resolve; }), 'same-provider');
    await Promise.resolve();
    markProviderStatus(true, 'same-provider');
    finish(false);
    assert.equal(await obsolete, true, 'late failed probe must not replace newer successful evidence');
    assert.equal(readProviderStatusEvidence('same-provider').result, 'success');
    const invalidated = resolveProviderStatus(() => new Promise<boolean>((resolve) => { finish = resolve; }), 'invalidate-provider');
    await Promise.resolve();
    invalidateProviderStatusCache();
    markProviderStatusChecking(true, 'invalidate-provider');
    finish(false);
    await invalidated;
    assert.equal(readProviderStatusCache('invalidate-provider'), null, 'late completion must not resurrect invalidated evidence');
    assert.equal(isProviderStatusChecking('invalidate-provider'), true, 'an invalidated probe cannot clear the new generation checking flag');
  } finally {
    Date.now = realNow;
    invalidateProviderStatusCache();
  }
  console.log('provider status cache regression: ok');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
