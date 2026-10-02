// Deterministic gateway-handler regression and benchmark; mocks only the RPC transport.
// Run: node --import tsx scripts/test-browser-click-latency.mjs
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { browserClick, browserPressKey, syncInHouseBrowserState } from '../src/gateway/browser-tools.ts';

const originalFetch = globalThis.fetch;
const calls = [];
const sessionId = `browser-latency-regression-${process.pid}`;
const tabId = 'tab-regression';
process.env.PROMETHEUS_ELECTRON_BROWSER_RPC_URL = 'http://127.0.0.1:1';
process.env.PROMETHEUS_ELECTRON_BROWSER_RPC_TOKEN = 'regression-only';

globalThis.fetch = async (url, options) => {
  const route = String(url).split('/').at(-1);
  const payload = JSON.parse(options.body);
  calls.push({ route, payload });
  const result = route === 'click' ? { role: 'button', name: 'Test' }
    : route === 'snapshot' ? { snapshot: 'Snapshot: Test', activeTabId: tabId }
    : route === 'run-js' ? 'frame_quiet'
    : route === 'input' ? { acknowledged: true }
    : {};
  return { ok: true, json: async () => ({ ok: true, result }) };
};

function percentile(samples, fraction) {
  const sorted = [...samples].sort((a, b) => a - b);
  return Math.round(sorted[Math.ceil(sorted.length * fraction) - 1] * 100) / 100;
}

try {
  syncInHouseBrowserState(sessionId, { active: true, attached: true, url: 'about:blank', activeTabId: tabId, tabs: [{ id: tabId, active: true }] });
  for (const mode of ['none', 'compact', 'delta', 'screenshot']) {
    calls.length = 0;
    const stages = [];
    const result = await browserClick(sessionId, 1, { observe: mode, onPerformanceStage: (name, fields) => stages.push({ name, fields }) });
    assert.match(result, /^Clicked @1/);
    assert.deepEqual(calls.map(c => c.route), ['click'], `${mode} must not wait or observe silently`);
    assert.equal(stages.at(-1)?.fields.settledBy, 'not_requested');
    assert.equal(stages.at(-1)?.fields.observationMs, 0);
  }
  calls.length = 0;
  const stages = [];
  assert.match(await browserClick(sessionId, 1, { observe: 'snapshot', onPerformanceStage: (name, fields) => stages.push({ name, fields }) }), /Snapshot: Test/);
  assert.deepEqual(calls.map(c => c.route), ['click', 'run-js', 'snapshot']);
  assert.equal(stages.at(-1)?.fields.settledBy, 'frame_quiet');
  assert.equal(typeof stages.at(-1)?.fields.nativeRpcMs, 'number');
  assert.equal(typeof stages.at(-1)?.fields.observationMs, 'number');
  calls.length = 0;
  assert.match(await browserPressKey(sessionId, 'ArrowUp', { hold_ms: 50, keys: ['ArrowUp', 'Shift'], sequence: [{ key: 'ArrowUp', hold_ms: 20 }, { wait_ms: 10 }], tab_id: tabId }), /^Input sequence acknowledged/);
  assert.deepEqual(calls.at(-1).payload, { sessionId, tabId, action: 'key', key: 'ArrowUp', holdMs: 50, keys: ['ArrowUp', 'Shift'], sequence: [{ key: 'ArrowUp', holdMs: 20 }, { waitMs: 10 }] });
  for (const rejected of [{ hold_ms: 5001 }, { tab_id: 'stale' }, { keys: ['Enter'] }, { keys: ['KeyX'] }, { sequence: [{ key: 'Space' }] }, { sequence: [{ key: 'Digit1' }] }, { sequence: Array.from({ length: 33 }, () => ({ wait_ms: 1 })) }]) {
    calls.length = 0;
    assert.match(await browserPressKey(sessionId, 'ArrowUp', rejected), /^ERROR:/);
    assert.equal(calls.length, 0, 'invalid or unsafe key action must not dispatch');
  }
  calls.length = 0;
  const snapshotFailureFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    if (String(url).endsWith('/snapshot')) return { ok: false, json: async () => ({ error: 'capture unavailable' }) };
    return snapshotFailureFetch(url, options);
  };
  assert.match(await browserClick(sessionId, 1, { observe: 'snapshot' }), /observation failed\. Do not repeat the click/);
  globalThis.fetch = snapshotFailureFetch;
  const samples = {};
  for (const mode of ['none', 'compact', 'snapshot']) {
    const timings = [];
    for (let n = 0; n < 40; n++) {
      const start = performance.now();
      const value = await browserClick(sessionId, 1, { observe: mode });
      assert.match(value, /^Clicked/);
      timings.push(performance.now() - start);
    }
    samples[mode] = { p50Ms: percentile(timings, .5), p95Ms: percentile(timings, .95), count: timings.length };
  }
  console.log(JSON.stringify({ kind: 'gateway_actual_handler_mock_rpc', samples, limitations: 'Mock RPC excludes native Electron, real renderer, and network transport; do not quote as real browser latency.' }));
  console.log('PASS: browser click readiness/ack, key forwarding/safety, observation failures');
} finally {
  globalThis.fetch = originalFetch;
  delete process.env.PROMETHEUS_ELECTRON_BROWSER_RPC_URL;
  delete process.env.PROMETHEUS_ELECTRON_BROWSER_RPC_TOKEN;
}
