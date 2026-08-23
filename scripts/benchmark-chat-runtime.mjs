import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { performance } from 'node:perf_hooks';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { ChatRuntime } from '../web-ui/src/features/chat/runtime/chat-runtime.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const budgets = JSON.parse(fs.readFileSync(path.join(root, 'benchmarks', 'chat-runtime-budgets.json'), 'utf8'));
const enforce = process.argv.includes('--enforce');

function percentile(values, ratio) {
  const sorted = values.slice().sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1))] || 0;
}

function pseudoText(seed, length = 720) {
  let value = (seed + 1) * 2654435761;
  let output = '';
  while (output.length < length) {
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    output += `${(value >>> 0).toString(36)} `;
  }
  return output.slice(0, length);
}

function makeHistory(count) {
  return Array.from({ length: count }, (_, index) => ({
    messageId: `turn-${index}`,
    role: index % 2 ? 'assistant' : 'user',
    content: pseudoText(index),
    timestamp: 1_700_000_000_000 + index,
    processEntries: index % 2 ? Array.from({ length: index % 7 }, (__, toolIndex) => ({
      id: `tool-${index}-${toolIndex}`,
      type: toolIndex % 2 ? 'result' : 'tool',
      content: pseudoText(index * 10 + toolIndex, 180),
    })) : undefined,
  }));
}

function measureHydration(count, samples = 24) {
  const history = makeHistory(count);
  const durations = [];
  for (let sample = 0; sample < samples + 3; sample += 1) {
    const runtime = new ChatRuntime({ gatewayId: 'bench', sessionId: `hydrate-${count}-${sample}` });
    const startedAt = performance.now();
    runtime.replaceHistory(history, { pageInfo: { totalCount: count, loadedCount: count } });
    const duration = performance.now() - startedAt;
    if (sample >= 3) durations.push(duration);
    assert.equal(runtime.snapshot.history.order.length, count);
  }
  return {
    count,
    p50Ms: Number(percentile(durations, 0.5).toFixed(3)),
    p95Ms: Number(percentile(durations, 0.95).toFixed(3)),
    maxMs: Number(Math.max(...durations).toFixed(3)),
  };
}

function measureStreaming(count = 1_000, chunks = 400) {
  const runtime = new ChatRuntime({ gatewayId: 'bench', sessionId: 'stream' });
  runtime.replaceHistory(makeHistory(count));
  runtime.beginStreaming({ clientRequestId: 'benchmark-stream' });
  const durations = [];
  let historyNotifications = 0;
  let queueNotifications = 0;
  runtime.subscribe((state) => state.history.revision, () => { historyNotifications += 1; });
  runtime.subscribe((state) => state.queue, () => { queueNotifications += 1; });
  for (let index = 0; index < chunks; index += 1) {
    const startedAt = performance.now();
    runtime.appendStreamDelta(index % 11 === 0 ? '\n' : 'token ');
    durations.push(performance.now() - startedAt);
  }
  runtime.completeStream();
  return {
    turns: count,
    chunks,
    deltaP50Ms: Number(percentile(durations, 0.5).toFixed(4)),
    deltaP95Ms: Number(percentile(durations, 0.95).toFixed(4)),
    deltaMaxMs: Number(Math.max(...durations).toFixed(4)),
    historyNotifications,
    unrelatedQueueNotifications: queueNotifications,
  };
}

function gzipJson(value) {
  return gzipSync(Buffer.from(JSON.stringify(value))).byteLength;
}

function measurePaging() {
  const history = makeHistory(1_000);
  const pageSize = 80;
  const loadedTarget = 480;
  let suffixBytes = 0;
  let cursorBytes = 0;
  const suffixMessages = [];
  const cursorMessages = [];
  for (let loaded = pageSize; loaded <= loadedTarget; loaded += pageSize) {
    const suffix = history.slice(-loaded);
    suffixBytes += gzipJson({ session: { history: suffix, totalHistoryCount: history.length } });
    suffixMessages.push(suffix.length);
    const end = history.length - (loaded - pageSize);
    const page = history.slice(Math.max(0, end - pageSize), end);
    cursorBytes += gzipJson({ items: page, pageInfo: { hasOlder: end - pageSize > 0, totalCount: history.length } });
    cursorMessages.push(page.length);
  }
  const reduction = 1 - (cursorBytes / suffixBytes);
  return {
    turns: history.length,
    loadedTarget,
    pageSize,
    suffixMessagesTransferred: suffixMessages.reduce((sum, value) => sum + value, 0),
    cursorMessagesTransferred: cursorMessages.reduce((sum, value) => sum + value, 0),
    suffixGzipBytes: suffixBytes,
    cursorGzipBytes: cursorBytes,
    gzipReductionPercent: Number((reduction * 100).toFixed(2)),
  };
}

const result = {
  schemaVersion: 1,
  node: process.version,
  platform: `${process.platform}-${process.arch}`,
  hydration: [100, 500, 1_000].map((count) => measureHydration(count)),
  streaming: measureStreaming(),
  paging: measurePaging(),
};

if (enforce) {
  const hydration1000 = result.hydration.find((item) => item.count === 1_000);
  assert.ok(hydration1000.p95Ms <= budgets.hydration1000P95MaxMs,
    `1000-turn hydration p95 ${hydration1000.p95Ms}ms exceeded ${budgets.hydration1000P95MaxMs}ms`);
  assert.ok(result.streaming.deltaP95Ms <= budgets.streamDeltaP95MaxMs,
    `stream delta p95 ${result.streaming.deltaP95Ms}ms exceeded ${budgets.streamDeltaP95MaxMs}ms`);
  assert.equal(result.streaming.unrelatedQueueNotifications, 0,
    'stream deltas woke an unrelated queue subscriber');
  assert.ok(result.paging.gzipReductionPercent >= budgets.cursorPagingGzipReductionMinPercent,
    `cursor paging reduction ${result.paging.gzipReductionPercent}% was below ${budgets.cursorPagingGzipReductionMinPercent}%`);
}

console.log(JSON.stringify(result, null, 2));
