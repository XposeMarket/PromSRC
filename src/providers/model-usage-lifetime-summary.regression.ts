// Rotated usage rows leave the active log. Their per-provider/model totals must
// survive in the lifetime summary, and repeated rotations must not double-count.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readLifetimeSummary, rotateModelUsageLog } from './model-usage-history';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-usage-lifetime-'));
const file = path.join(tmp, 'model-usage.jsonl');
const now = new Date('2026-10-18T00:00:00.000Z');
const OLD = '2026-07-01T00:00:00.000Z';
const RECENT = '2026-10-15T00:00:00.000Z';

const row = (timestamp: string, provider: string, accountId: string | undefined, tokens: number) => JSON.stringify({
  timestamp, provider, model: 'm', accountId, callType: 'chat', inputTokens: tokens, outputTokens: 1,
  reasoningTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: tokens + 1, source: 'provider',
}) + '\n';

async function main() {
  fs.writeFileSync(file, row(OLD, 'anthropic', undefined, 100) + row(OLD, 'anthropic', undefined, 100)
    + row(OLD, 'openai_codex', 'acct1', 50) + row(RECENT, 'anthropic', undefined, 7));

  const first = await rotateModelUsageLog(file, { maxBytes: 10, now });
  assert.equal(first.archivedRows, 3, 'old rows are archived');
  assert.equal(first.activeRows, 1, 'recent row stays in the active log');

  let summary = await readLifetimeSummary(file);
  const anthropic = summary.totals.find((t) => t.provider === 'anthropic');
  assert.ok(anthropic, 'archived anthropic totals are persisted');
  assert.equal(anthropic.calls, 2, 'archived call count persisted');
  assert.equal(anthropic.inputTokens, 200, 'archived input tokens persisted');
  assert.equal(anthropic.totalTokens, 202, 'archived total tokens persisted');
  const codex = summary.totals.find((t) => t.provider === 'openai_codex');
  assert.equal(codex?.accountId, 'acct1', 'account is kept in the summary key');
  assert.equal(codex?.calls, 1, 'codex archived call persisted');

  // A second rotation adds only newly archived rows: no double-counting.
  fs.appendFileSync(file, row(OLD, 'anthropic', undefined, 100));
  const second = await rotateModelUsageLog(file, { maxBytes: 10, now });
  assert.equal(second.archivedRows, 1, 'only the new old row is archived');
  summary = await readLifetimeSummary(file);
  assert.equal(summary.totals.find((t) => t.provider === 'anthropic')?.calls, 3, 'second rotation adds exactly one call');

  // A rotation with nothing to archive leaves the summary untouched.
  const third = await rotateModelUsageLog(file, { maxBytes: 10, now });
  assert.equal(third.archivedRows, 0, 'nothing old remains to archive');
  summary = await readLifetimeSummary(file);
  assert.equal(summary.totals.find((t) => t.provider === 'anthropic')?.calls, 3, 'no-op rotation does not change totals');

  console.log('model-usage-lifetime-summary regression: ok');
}

main().catch((err) => { console.error(err); process.exit(1); });
