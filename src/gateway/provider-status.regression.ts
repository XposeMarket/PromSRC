import assert from 'node:assert/strict';
import {
  PROVIDER_STATUS_CACHE_MS,
  invalidateProviderStatusCache,
  isProviderStatusChecking,
  markProviderStatus,
  markProviderStatusChecking,
  readProviderStatusCache,
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

    let probes = 0;
    const first = await resolveProviderStatus(async () => { probes += 1; return true; }, 'provider-b');
    const second = await resolveProviderStatus(async () => { probes += 1; return false; }, 'provider-b');
    assert.equal(first, true);
    assert.equal(second, true, 'fresh same-identity result should be reused');
    assert.equal(probes, 1, 'fresh cache should suppress duplicate provider probes');
    markProviderStatusChecking(true);
    await resolveProviderStatus(async () => { probes += 1; return false; }, 'provider-b');
    assert.equal(isProviderStatusChecking(), false, 'a periodic cache hit must clear the transient checking flag');
    assert.equal(probes, 1, 'checking-flag refresh must not force another provider probe');

    const oldProbe = resolveProviderStatus(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return false;
    }, 'old-provider');
    markProviderStatus(true, 'new-provider');
    await oldProbe;
    assert.equal(readProviderStatusCache('new-provider')?.connected, true, 'an old in-flight probe must not overwrite the new provider identity');
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
