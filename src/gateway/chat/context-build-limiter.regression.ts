import assert from 'node:assert/strict';

process.env.PROMETHEUS_CONTEXT_BUILD_CONCURRENCY = '2';

async function main(): Promise<void> {
  const { getContextBuildLimiterStatus, runWithContextBuildPermit } = await import('./context-build-limiter');
  let running = 0;
  let peak = 0;
  const order: string[] = [];
  const run = (id: string) => runWithContextBuildPermit(id, async () => {
    running += 1;
    peak = Math.max(peak, running);
    order.push(`${id}:start`);
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
    order.push(`${id}:end`);
    running -= 1;
  });

  const pending = [run('a'), run('b'), run('c'), run('d')];
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(getContextBuildLimiterStatus().active, 2);
  assert.equal(getContextBuildLimiterStatus().queued, 2);
  await Promise.all(pending);
  assert.equal(peak, 2);
  assert.ok(order.indexOf('c:start') > order.indexOf('a:end') || order.indexOf('c:start') > order.indexOf('b:end'));
  assert.equal(getContextBuildLimiterStatus().queued, 0);
  assert.equal(getContextBuildLimiterStatus().active, 0);
  console.log('context-build limiter regression passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
