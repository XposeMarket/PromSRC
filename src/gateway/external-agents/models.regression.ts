import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { CodexAdapter } from './adapters/codex';
import { ClaudeCodeAdapter } from './adapters/claude-code';
async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-models-'));
  const log = path.join(root, 'wire.jsonl');
  const adapter = new CodexAdapter({ resolveCommand: () => ({ command: process.execPath, args: [path.join(__dirname, 'testkit/fake-codex-app-server.mjs')], source: 'fixture' }), env: { ...process.env, FAKE_CODEX_LOG: log }, idleMs: 1000 });
  try {
    const catalog = await adapter.listModels({ cwd: root });
    assert.deepEqual(catalog.models.map(m => m.id), ['gpt-6-astra', 'gpt-6-luna']);
    assert.equal(catalog.currentModel, 'gpt-6-astra');
    const wire = () => fs.readFileSync(log, 'utf8').trim().split('\n').map(line => JSON.parse(line));
    assert.ok(!wire().some(message => /thread\/start|turn\/start/.test(message.method || '')), 'catalog sends no prompt or thread start');
    const result = await adapter.runTurn({ sessionId: 'model-test', cwd: root, text: 'hi', model: 'gpt-6-luna', signal: new AbortController().signal, emit() {}, requestUser: async () => ({ optionId: 'deny' }) });
    assert.equal(result.status, 'completed'); assert.equal(result.model, 'gpt-6-luna');
    assert.equal(wire().find(message => message.method === 'turn/start').params.model, 'gpt-6-luna');
  } finally { await adapter.shutdown(); fs.rmSync(root, { recursive: true, force: true }); }
  let prompts = 0; let closes = 0;
  const claude = new ClaudeCodeAdapter({ resolve: () => ({ command: '/fixture/claude', args: [], source: 'fixture' }), query: input => {
    void input.prompt[Symbol.asyncIterator]().next().then((value: IteratorResult<unknown>) => { if (!value.done) prompts++; });
    return { supportedModels: async () => [{ value: 'sonnet', displayName: 'Sonnet' }], close() { closes++; } };
  } });
  assert.deepEqual((await claude.listModels({ cwd: '/fixture' })).models.map((m: { id: string }) => m.id), ['sonnet']);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(prompts, 0); assert.equal(closes, 1); assert.equal(claude.isRunning(), false);
  console.log('External model catalogs: fake Codex own-model discovery/selection and Claude no-prompt discovery PASS');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
