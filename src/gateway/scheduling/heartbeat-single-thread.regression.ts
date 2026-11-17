/**
 * Heartbeat output lives in ONE chat per agent (auto_heartbeat_<agentId>).
 * Legacy per-run sessions (heartbeat_<agentId>_<ms>) are folded into it by
 * consolidateLegacyAutomatedSessions, and the per-turn handleChat session
 * heartbeat_<agentId> (no run suffix) is left alone.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-heartbeat-thread-'));
process.env.PROMETHEUS_DATA_DIR = root;
process.env.PROMETHEUS_WORKSPACE_DIR = path.join(root, 'workspace');
fs.mkdirSync(process.env.PROMETHEUS_WORKSPACE_DIR, { recursive: true });

(async () => {
const { getConfig } = await import('../../config/config');
const session = await import('../session');
const { heartbeatThreadId } = await import('./heartbeat-runner');

assert.equal(heartbeatThreadId('radar_mulgojhh'), 'auto_heartbeat_radar_mulgojhh');
assert.equal(heartbeatThreadId('main'), 'auto_heartbeat_main');

const dir = path.join(getConfig().getConfigDir(), 'sessions');
fs.mkdirSync(dir, { recursive: true });
const write = (id: string, history: any[]) => fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify({ id, history, createdAt: 1, lastActiveAt: 1 }));
write('heartbeat_radar_mulgojhh_1794840408125', [
  { role: 'user', content: 'run A', timestamp: 1794840408124 },
  { role: 'assistant', content: 'result A', timestamp: 1794840408125 },
]);
write('heartbeat_radar_mulgojhh_1794844008125', [
  { role: 'user', content: 'run B', timestamp: 1794844008124 },
  { role: 'assistant', content: 'result B', timestamp: 1794844008125 },
]);
write('heartbeat_radar_mulgojhh', [{ role: 'user', content: 'turn session', timestamp: 5 }]);

const n = session.consolidateLegacyAutomatedSessions();
assert.equal(n, 2, 'both legacy heartbeat runs consolidated');
assert.ok(!fs.existsSync(path.join(dir, 'heartbeat_radar_mulgojhh_1794840408125.json')));
assert.ok(!fs.existsSync(path.join(dir, 'heartbeat_radar_mulgojhh_1794844008125.json')));
assert.ok(fs.existsSync(path.join(dir, 'heartbeat_radar_mulgojhh.json')), 'per-turn heartbeat session untouched');

const thread = session.getSession('auto_heartbeat_radar_mulgojhh');
assert.deepEqual(thread.history.map((m: any) => m.content), ['run A', 'result A', 'run B', 'result B']);
assert.equal(thread.title, '\u{1F493} radar_mulgojhh heartbeat');
assert.equal(session.consolidateLegacyAutomatedSessions(), 0, 'idempotent');

console.log('heartbeat-single-thread regression: PASS');
})().catch((err) => { console.error(err); process.exit(1); });
