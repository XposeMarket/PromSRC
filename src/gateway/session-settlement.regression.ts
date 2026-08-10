import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

async function main(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-session-settlement-'));
  process.env.PROMETHEUS_DATA_DIR = root;
  process.env.PROMETHEUS_WORKSPACE_DIR = root;

  try {
    const sessionApi = await import('./session');
    const settlementApi = await import('./session-settlement');
    const runtimeApi = await import('./live-runtime-registry');
    const sessionId = 'session_settlement_regression';

    sessionApi.addMessage(sessionId, { role: 'user', content: 'keep this history', timestamp: Date.now() });
    sessionApi.addMessage(sessionId, { role: 'assistant', content: 'history remains intact', timestamp: Date.now() + 1 });
    sessionApi.flushSession(sessionId);

    const before = sessionApi.listSessionSummaries({ scope: 'all', state: 'active', limit: 20, offset: 0 });
    assert.equal(before.sessions.some((session) => session.id === sessionId), true);

    const settled = settlementApi.settleSessionWithGuards(sessionId);
    assert.equal(settled.settled, true);
    assert.equal(sessionApi.listSessionSummaries({ scope: 'all', state: 'active', limit: 20, offset: 0 }).sessions.some((session) => session.id === sessionId), false);
    assert.equal(sessionApi.listSessionSummaries({ scope: 'all', state: 'settled', limit: 20, offset: 0 }).sessions.some((session) => session.id === sessionId), true);

    const reopened = settlementApi.unsettleSessionSafely(sessionId);
    assert.equal(reopened.settled, false);
    assert.equal(settlementApi.unsettleSessionSafely(sessionId).settled, false);

    const runtimeId = runtimeApi.registerLiveRuntime({
      kind: 'main_chat',
      label: 'settlement regression runtime',
      sessionId,
      source: 'regression',
    });
    const runtimeRecords = runtimeApi.listLiveRuntimes();
    assert.equal(runtimeRecords.some((runtime) => runtime.sessionId === sessionId), true);
    assert.equal(settlementApi.getSessionSettlementBlockers(sessionId, { runtimeRecords }).some((blocker) => blocker.code === 'active_runtime'), true);
    assert.throws(
      () => settlementApi.settleSessionWithGuards(sessionId, { runtimeRecords }),
      (error: any) => error?.code === 'active_runtime',
    );
    runtimeApi.finishLiveRuntime(runtimeId);

    sessionApi.setSessionPinned(sessionId, true);
    assert.throws(
      () => settlementApi.settleSessionWithGuards(sessionId),
      (error: any) => error?.code === 'pinned_confirmation_required',
    );
    settlementApi.settleSessionWithGuards(sessionId, { confirmPinned: true });

    const stored = JSON.parse(fs.readFileSync(path.join(root, '.prometheus', 'sessions', `${sessionId}.json`), 'utf-8'));
    assert.equal(stored.history.length, 2, 'settlement must not remove or summarize history');
    assert.equal(Number(stored.settledAt) > 0, true);
    console.log('session settlement regression passed');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
