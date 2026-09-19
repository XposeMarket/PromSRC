import assert from 'assert';
import { normalizeWebFetchBatchUrls, webMediaCapabilityExecutor } from './web-media-executor';

// Regression: the model-facing `web_fetch` schema advertises `urls: string[]`
// for parallel fetches, but the capability executor only ever read `url`, so
// every batch-shaped call returned "url is required". These checks run
// offline: an empty/invalid batch must be rejected up front, a well-formed
// batch must reach the batch fetcher (which tolerates unreachable hosts and
// reports per-URL status instead of throwing), and the single-URL path must
// keep rejecting a missing url with an actionable message.

async function main(): Promise<void> {
  assert.deepEqual(normalizeWebFetchBatchUrls(undefined), []);
  assert.deepEqual(normalizeWebFetchBatchUrls('https://a.example'), []);
  assert.deepEqual(
    normalizeWebFetchBatchUrls([' https://a.example ', '', null, 'https://a.example', 'https://b.example']),
    ['https://a.example', 'https://b.example'],
  );

  const execute = (args: any) => webMediaCapabilityExecutor.execute({
    name: 'web_fetch',
    args,
    workspacePath: process.cwd(),
    sessionId: 'regression-web-fetch-batch',
    deps: {} as any,
  });

  const missing = await execute({});
  assert.equal(missing.error, true);
  assert.ok(/url is required/i.test(String(missing.result)), missing.result);
  assert.ok(/urls/i.test(String(missing.result)), 'missing-url error should point at the batch option');

  const emptyBatch = await execute({ urls: [] });
  assert.equal(emptyBatch.error, true, 'empty urls array must fall through to the single-url validation');

  const batch = await execute({
    urls: ['http://127.0.0.1:9/one', 'http://127.0.0.1:9/two'],
    max_chars: 200,
    concurrency: 2,
  });
  const rows = Array.isArray(batch.data?.results) ? batch.data.results : [];
  assert.equal(rows.length, 2, `batch path should return one row per url, got: ${JSON.stringify(batch.data)}`);
  assert.ok(!/url is required/i.test(String(batch.result)), 'batch call must not hit the single-url guard');
  assert.deepEqual(rows.map((row: any) => row.url), ['http://127.0.0.1:9/one', 'http://127.0.0.1:9/two']);

  console.log('web-fetch-batch regression: ok');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
