import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

async function main() {
  const deadline = setTimeout(() => { console.error('browser fixture timed out'); process.exit(1); }, 30_000);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-browser-contract-'));
  process.env.PROMETHEUS_DATA_DIR = root;
  process.env.PROMETHEUS_APP_DATA_DIR = root;
  process.env.PROMETHEUS_RUNTIME_DIR = path.join(root, 'runtime');
  process.env.PROMETHEUS_WORKSPACE_DIR = path.join(root, 'workspace');
  process.env.PROMETHEUS_ELECTRON_BROWSER_RPC_URL = 'http://browser-fixture.invalid';
  process.env.PROMETHEUS_ELECTRON_BROWSER_RPC_TOKEN = 'fixture-only';
  fs.mkdirSync(process.env.PROMETHEUS_WORKSPACE_DIR, { recursive: true });
  const realFetch = globalThis.fetch;
  const states = new Map<string, { url: string; clicks: number }>();
  let fault = '';
  let clickCalls = 0;
  globalThis.fetch = (async (url: any, init: any) => {
    assert.ok(String(url).startsWith('http://browser-fixture.invalid/'), 'no live network calls');
    const route = new URL(String(url)).pathname;
    const body = JSON.parse(init.body);
    if (fault === 'malformed') return new Response('not json');
    if (fault === 'missing_result') return Response.json({ ok: true });
    if (fault === 'disconnect') throw new TypeError('fixture disconnected');
    if (route === '/open') states.set(body.sessionId, { url: body.url, clicks: 0 });
    const state = states.get(body.sessionId);
    if (!state) return Response.json({ ok: true, result: { sessionId: body.sessionId, attached: false } });
    if (route === '/click' || route === '/fill') { state.clicks++; clickCalls++; }
    if (route === '/snapshot' && fault === 'snapshot') return Response.json({ ok: false, error: 'fixture snapshot failed' });
    return Response.json({ ok: true, result: {
      sessionId: fault === 'wrong_session' ? 'another-chat' : body.sessionId, attached: true,
      url: state.url, title: body.sessionId, profile: body.profile || 'main',
      snapshot: `Page: ${body.sessionId}\nURL: ${state.url}\nClicks: ${state.clicks}`,
      role: 'button', name: 'increment',
    } });
  }) as typeof fetch;
  try {
    const { executeTool } = require('./agents-runtime/subagent-executor') as typeof import('./agents-runtime/subagent-executor');
    const { getBrowserSessionInfo, syncInHouseBrowserState } = require('./browser-tools') as typeof import('./browser-tools');
    const deps = { executionPolicy: { mode: 'goal_autonomous', approvalMode: 'never' } } as any;
    const run = (chat: string, name: string, args: any) => executeTool(name, args, process.env.PROMETHEUS_WORKSPACE_DIR!, deps, chat);
    for (const chat of ['chat-contract-a', 'chat-contract-b']) {
      const opened = await run(chat, 'browser_session', { action: 'open', target: 'inhouse', url: `https://fixture.invalid/${chat}`, observe: 'none' });
      assert.equal(opened.error, false, opened.result);
      assert.equal(getBrowserSessionInfo(chat).active, true);
    }
    for (let i = 1; i <= 3; i++) {
      assert.equal((await run('chat-contract-a', 'browser_observe', { action: 'snapshot' })).error, false);
      const clicked = await run('chat-contract-a', 'browser_act', { action: 'click', selector: '#increment', fast: true });
      assert.equal(clicked.error, false, clicked.result);
      const observed = await run('chat-contract-a', 'browser_observe', { action: 'snapshot' });
      assert.match(observed.result, new RegExp(`Clicks: ${i}`));
      assert.match((await run('chat-contract-b', 'browser_observe', { action: 'snapshot' })).result, /Clicks: 0/);
    }
    const neverOpened = await run('chat-never-opened', 'browser_observe', { action: 'snapshot' });
    assert.equal(neverOpened.error, true);
    assert.match(neverOpened.result, /browser_not_opened/);
    // Simulate loss of gateway mapping while Electron still owns the same page.
    syncInHouseBrowserState('chat-contract-a', { active: false });
    const recovered = await run('chat-contract-a', 'browser_observe', { action: 'snapshot' });
    assert.equal(recovered.error, false, recovered.result);
    assert.match(recovered.result, /Recovered.*session=chat-contract-a/);
    assert.match(recovered.result, /Clicks: 3/);
    syncInHouseBrowserState('chat-contract-a', { active: false });
    const beforeRecoveryClick = clickCalls;
    const needsObservation = await run('chat-contract-a', 'browser_act', { action: 'click', selector: '#increment', fast: true });
    assert.equal(needsObservation.error, true);
    assert.equal(clickCalls, beforeRecoveryClick, 'mapping recovery must not issue an action against unobserved state');
    syncInHouseBrowserState('chat-contract-a', { active: false });
    fault = 'wrong_session';
    const mismatch = await run('chat-contract-a', 'browser_observe', { action: 'snapshot' });
    assert.equal(mismatch.error, true);
    assert.match(mismatch.result, /browser_target_mismatch/);
    fault = '';
    assert.equal((await run('chat-contract-a', 'browser_observe', { action: 'snapshot' })).error, false);
    fault = 'snapshot';
    const callsBefore = clickCalls;
    const unverified = await run('chat-contract-a', 'browser_act', { action: 'click', selector: '#increment', observe: 'snapshot' });
    assert.equal(unverified.error, true, 'failed post-action observation must not be reported as success');
    assert.match(unverified.result, /action completed|click completed/i);
    assert.equal(clickCalls, callsBefore + 1, 'failed observation must not replay the action');
    fault = 'disconnect';
    const disconnected = await run('chat-contract-a', 'browser_observe', { action: 'snapshot' });
    assert.equal(disconnected.error, true);
    assert.match(disconnected.result, /connect|disconnect/i);
    fault = '';
    assert.equal((await run('chat-contract-a', 'browser_observe', { action: 'snapshot' })).error, false);
    for (const bad of ['malformed', 'missing_result']) {
      fault = bad;
      const failed = await run(`chat-${bad}`, 'browser_session', { action: 'open', target: 'inhouse', url: 'https://fixture.invalid', observe: 'none' });
      assert.equal(failed.error, true, `${bad} RPC reply must fail open`);
      assert.equal(getBrowserSessionInfo(`chat-${bad}`).active, false, 'failed open must not invent a session');
    }
    console.log('browser continuity: repeated dispatch, chat isolation, disconnect recovery, and failure evidence passed');
  } finally {
    clearTimeout(deadline);
    globalThis.fetch = realFetch;
    // The fixture directory is intentionally retained until process exit: async audit writes may still be queued.
  }
}
main().then(() => process.exit(0)).catch((error) => { console.error(error); process.exit(1); });
