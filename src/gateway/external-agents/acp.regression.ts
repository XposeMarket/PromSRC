import assert from 'assert';
import path from 'path';
import { AcpAdapter } from './adapters/acp';
import type { ExternalTurnInput } from './types';
async function main() {
 const outgoing: any[] = []; const events: any[] = []; let bound = '';
 const adapter = new AcpAdapter('cursor', { resolve: () => ({ command: process.execPath, args: [path.join(__dirname, 'testkit/fake-acp.mjs')], source: 'fixture' }), onOutgoing: (message) => { if (message.method === 'session/prompt') assert.ok(bound, 'persist upstream before prompt'); outgoing.push(message); } });
 assert.equal((await adapter.verify()).status, 'ready'); assert.equal(adapter.isRunning(), false);
 assert.ok(!outgoing.some((m) => m.method === 'session/new'), 'verify does not create sessions');
 const base: ExternalTurnInput = { sessionId: 'fixture-chat', cwd: process.cwd(), text: 'hi', signal: new AbortController().signal, onSessionBound: (id) => { bound = id; }, emit: (e) => events.push(e), requestUser: async (card) => {
   assert.ok(!card.options.some((o) => o.id === 'always'), 'no remembered grant');
   return { optionId: card.kind === 'question' ? 'answer' : card.kind === 'plan' ? 'accept' : 'once', answers: { q: ['a'] } };
 } };
 const first = await adapter.runTurn(base); assert.equal(first.status, 'completed'); assert.equal(first.finalText, 'Hello ACP');
 assert.deepEqual(outgoing.find((m) => m.method === 'session/new').params, { cwd: process.cwd(), mcpServers: [] });
 const resumed = await adapter.runTurn({ ...base, upstreamSessionId: first.upstreamSessionId }); assert.equal(resumed.finalText, 'Hello ACP', 'no historical or foreign-session replay');
 for (const mode of ['PERMISSION', 'QUESTION', 'PLAN']) {
  const turn = await adapter.runTurn({ ...base, text: mode }); assert.equal(turn.status, 'completed');
  assert.match(turn.finalText, mode === 'PERMISSION' ? /selected/ : mode === 'QUESTION' ? /answered/ : /accepted/);
 }
 const missing = await adapter.runTurn({ ...base, upstreamSessionId: 'missing' }); assert.equal(missing.upstreamMissing, true);
 assert.equal((await adapter.runTurn({ ...base, text: 'CRASH' })).status, 'failed');
 let expired = false;
 const pending = await adapter.runTurn({ ...base, text: 'PENDING_END', requestUser: (_card, options) => new Promise((resolve) => { options?.signal?.addEventListener('abort', () => { expired = true; resolve({ optionId: '__cancel' }); }, { once: true }); }) });
 assert.equal(pending.status, 'completed'); assert.equal(expired, true, 'terminal result expires unanswered card');
 const controller = new AbortController();
 const stopped = await adapter.runTurn({ ...base, text: 'WAIT', signal: controller.signal, emit: (event) => { if (event.type === 'state' && event.phase === 'running') setTimeout(() => controller.abort(), 30); } });
 assert.equal(stopped.status, 'interrupted'); assert.ok(outgoing.some((m) => m.method === 'session/cancel'));
 const before = outgoing.filter((m) => m.method === 'session/prompt').length;
 const duringBinding = new AbortController();
 await adapter.runTurn({ ...base, signal: duringBinding.signal, onSessionBound: () => duringBinding.abort() });
 assert.equal(outgoing.filter((m) => m.method === 'session/prompt').length, before, 'stop while binding sends no prompt');
 await adapter.shutdown(); assert.equal(adapter.isRunning(), false);
 assert.equal((await new AcpAdapter('hermes', { resolve: () => null }).verify()).status, 'not_installed');
 console.log('ACP regression: ok (fixture processes only)');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
