import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-thread-settled-'));
process.env.PROMETHEUS_DATA_DIR = tempRoot;
process.env.PROMETHEUS_WORKSPACE_DIR = path.join(tempRoot, 'workspace');

async function main(): Promise<void> {
  try {
    const sessionApi = await import('../session');
    // Load the canonical session module before thread-ops' settlement import;
    // this keeps the in-memory session cache shared under tsx's mixed import
    // paths, matching the existing settlement regression pattern.
    const threadOps = await import('./thread-ops');
    const toolDefs = await import('../tools/defs/agent-team-schedule');

    const ownerId = 'thread_ops_settled_owner';
    const activeId = 'thread_ops_active_target';
    const settledId = 'thread_ops_settled_target';
    const addMessage = (id: string, text: string): void => {
      sessionApi.touchSession(id, { channel: 'web', title: text });
      sessionApi.addMessage(id, { role: 'user', content: text, timestamp: Date.now() }, {
        disableCompactionCheck: true,
        disableMemoryFlushCheck: true,
      });
      sessionApi.flushSession(id);
    };

    addMessage(ownerId, 'Thread ops owner');
    addMessage(activeId, 'Active thread ops target');
    addMessage(settledId, 'Settled thread ops target');
    sessionApi.settleSession(settledId, true);
    const historyBeforeReopen = JSON.stringify(sessionApi.getSession(settledId).history);

    assert.equal(threadOps.normalizeThreadSessionState({}), 'all');
    assert.equal(threadOps.normalizeThreadSessionState({ state: 'active' }), 'active');
    assert.equal(threadOps.normalizeThreadSessionState({ include_settled: false }), 'active');
    assert.throws(() => threadOps.normalizeThreadSessionState({ state: 'unknown' }));

    const all = await threadOps.executePrometheusThreadOps(ownerId, { action: 'list', limit: 100 }, {});
    assert.equal(all.state, 'all');
    assert.equal(all.sessions.some((session: any) => session.id === settledId && session.settled === true), true);

    const active = await threadOps.executePrometheusThreadOps(ownerId, { action: 'list', state: 'active', limit: 100 }, {});
    assert.equal(active.sessions.some((session: any) => session.id === settledId), false);
    const settled = await threadOps.executePrometheusThreadOps(ownerId, { action: 'list', state: 'settled', limit: 100 }, {});
    assert.deepEqual(settled.sessions.map((session: any) => session.id), [settledId]);

    const found = await threadOps.executePrometheusThreadOps(ownerId, {
      action: 'find',
      query: 'Settled thread ops target',
      state: 'settled',
    }, {});
    assert.equal(found.state, 'settled');
    assert.equal(found.sessions.some((session: any) => session.id === settledId), true);

    const defaultFound = await threadOps.executePrometheusThreadOps(ownerId, {
      action: 'search',
      query: 'Settled thread ops target',
    }, {});
    assert.equal(defaultFound.state, 'all');
    assert.equal(defaultFound.sessions.some((session: any) => session.id === settledId && session.settled === true), true);

    const status = await threadOps.executePrometheusThreadOps(ownerId, {
      action: 'status',
      session_id: settledId,
    }, {});
    assert.equal(status.session.settled, true);
    assert.equal(status.session.settledAt > 0, true);

    const broadcasts: any[] = [];
    const reopened = await threadOps.executePrometheusThreadOps(ownerId, {
      action: 'reopen',
      session_id: settledId,
    }, { broadcastWS: (event) => broadcasts.push(event) });
    assert.equal(reopened.reopened, true);
    assert.equal(reopened.session.settled, false);
    assert.equal(sessionApi.getSession(settledId).settledAt, undefined);
    assert.equal(JSON.stringify(sessionApi.getSession(settledId).history), historyBeforeReopen);
    assert.equal(broadcasts.at(-1)?.reason, 'manual_reopen');

    sessionApi.settleSession(settledId, true);
    const alias = await threadOps.executePrometheusThreadOps(ownerId, {
      action: 'unsettle',
      session_id: settledId,
    }, {});
    assert.equal(alias.reopened, true);
    assert.equal(sessionApi.getSession(settledId).settledAt, undefined);

    const schemaSource = fs.readFileSync(path.resolve(__dirname, '../tools/defs/agent-team-schedule.ts'), 'utf8');
    assert.match(schemaSource, /action="reopen"/);
    assert.match(schemaSource, /state.*active.*settled.*all/);
    console.log('prometheus thread-ops settled regression passed');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

void main();
