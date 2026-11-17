import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'background-manual-resume-'));
for (const key of ['PROMETHEUS_APP_DATA_DIR','PROMETHEUS_DATA_DIR','PROMETHEUS_WORKSPACE_DIR','APPDATA','USERPROFILE','HOME']) process.env[key] = root;
process.env.PROMETHEUS_CONFIG_PATH = path.join(root, 'config.json');
async function main() {
 const config = require('../../config/config').getConfig(); config.getConfigDir = () => root; config.getWorkspacePath = () => root;
 const runner = require('./task-runner'); const sessions = require('../session');
 let calls = 0; let firstSession = ''; let release!: () => void;
 runner.setBackgroundAgentDeps({ broadcastWS() {}, async handleChat(prompt: string, sid: string, send: any) {
   calls++;
   if (calls === 1) { firstSession = sid; sessions.addMessage(sid, { role: 'assistant', content: 'Durable checkpoint: wrote artifact A', timestamp: Date.now() }); send('error', { message: '429 rate limit' }); return { text: '' }; }
   assert.equal(sid, firstSession); assert.match(prompt, /Continue background task/);
   assert(sessions.getSession(sid).history.some((r: any) => String(r.content).includes('artifact A')));
   await new Promise<void>(resolve => { release = resolve; }); return { text: 'Resumed successfully' };
 }});
 const run = runner.backgroundSpawn({ prompt: 'Test recovery', workDir: root, spawnerSessionId: 'test-parent', providerOverride: 'openai_codex', modelOverride: 'gpt-6.1-sol', toolCategories: [] });
 await runner.backgroundJoin({ backgroundId: run.id, joinPolicy: 'wait_all' });
 assert.equal(runner.backgroundStatus(run.id).state, 'failed', 'provider error must not become success');
 assert.equal(runner.backgroundSteer(run.id, 'Continue').queued, true);
 for (let i=0; i<100 && !release; i++) await new Promise(r => setTimeout(r, 10));
 assert.equal(calls, 2); assert.equal(runner.backgroundStatus(run.id).id, run.id);
 runner.backgroundSteer(run.id, 'Continue'); assert.equal(calls, 2, 'second click steers, never creates another execution');
 release(); await runner.backgroundJoin({ backgroundId: run.id, joinPolicy: 'wait_all' });
 assert.equal(runner.backgroundStatus(run.id).state, 'completed');
 assert.equal(runner.backgroundSteer(run.id, 'Continue').queued, false, 'completed immutable');
 console.log('PASS same-ID failed worker resume, history preservation, provider error, duplicate and terminal guards');
}
main().then(() => process.exit(0), error => { console.error(error); process.exit(1); });
