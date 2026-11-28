import assert from 'assert';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { AcpAdapter } from './adapters/acp';
import { resolveFromCandidates, resolveWindowsShim } from './executable';
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
 const catalog = await adapter.listModels({ cwd: process.cwd(), upstreamSessionId: first.upstreamSessionId });
 assert.deepEqual(catalog.models.map(m => m.id), ['fixture-a', 'fixture-b']);
 const resumed = await adapter.runTurn({ ...base, model: 'fixture-b', upstreamSessionId: first.upstreamSessionId }); assert.equal(resumed.finalText, 'Hello ACP', 'no historical or foreign-session replay');
 assert.equal(outgoing.find(m => m.method === 'session/set_model').params.modelId, 'fixture-b');
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
 // Antigravity (Google's `agy acp`). The fixture follows the real 1.5.14 binary: v1 handshake, and
 // JSON-RPC -32000 "Authentication required" from session/new while signed out.
 const agyOut: any[] = [];
 const fixture = path.join(__dirname, 'testkit/fake-acp.mjs');
 const agy = (...flags: string[]) => new AcpAdapter('antigravity', { resolve: () => ({ command: process.execPath, args: [fixture, '--antigravity', ...flags], source: 'fixture' }), onOutgoing: (message) => agyOut.push(message) });
 const signedOut = await agy('--signed-out').verify();
 assert.equal(signedOut.status, 'signed_out'); assert.match(signedOut.statusText, /acp --login/, 'names Google\'s own sign-in command');
 const signedOutTurn = await agy('--signed-out').runTurn(base);
 assert.equal(signedOutTurn.status, 'failed'); assert.match(String(signedOutTurn.error), /not signed in/i);
 const google = agy();
 assert.equal((await google.listModels({ cwd: process.cwd() })).models.length, 0, 'no choices before the connection check');
 const ready = await google.verify(); assert.equal(ready.status, 'ready'); assert.equal(ready.version, '1.5.14');
 assert.ok(agyOut.some((m) => m.method === 'session/close'), 'the connection check closes the session it opened');
 assert.ok(!agyOut.some((m) => m.method === 'session/prompt'), 'the connection check never sends a prompt');
 const offered = await google.listModels({ cwd: process.cwd() });
 assert.deepEqual(offered.models.map((m) => m.id), ['gemini-4-neon', 'gemini-4-hydrogen', 'claude-fable-5-2'], 'grouped and flat choices, offered before the first message');
 assert.deepEqual(offered.models[0].efforts, ['low', 'medium', 'high', 'xhigh'], 'reasoning levels belong to the current model');
 agyOut.length = 0;
 const hydrogen = await google.runTurn({ ...base, model: 'gemini-4-hydrogen', effort: 'low' });
 assert.equal(hydrogen.status, 'completed'); assert.equal(hydrogen.finalText, 'Hello ACP');
 assert.deepEqual(agyOut.filter((m) => m.method === 'session/set_config_option').map((m) => [m.params.configId, m.params.value]), [['model', 'gemini-4-hydrogen'], ['thinking', 'low']]);
 assert.ok(!agyOut.some((m) => m.method === 'session/set_model'), 'config-option agents are not sent session/set_model');
 agyOut.length = 0;
 await google.runTurn({ ...base, model: 'gemini-4-hydrogen', effort: 'xhigh' });
 assert.equal(agyOut.filter((m) => m.method === 'session/set_config_option').length, 1, 'a level the model does not offer is not sent');
 assert.equal((await google.runTurn({ ...base, model: 'gemini-9' })).status, 'failed', 'a model the account does not list is refused');
 await google.shutdown();
 const impostor = new AcpAdapter('antigravity', { resolve: () => ({ command: process.execPath, args: [fixture], source: 'fixture' }) });
 assert.equal((await impostor.verify()).status, 'unsupported', 'an unrelated program named agy is refused');
 // Real OpenClaw install (Nov 2026): the npm cmd-shim probes `%dp0%\node.exe` BEFORE naming the program.
 // Taking the first match launched bare node, which exited immediately and looked like "cannot connect".
 const shimDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-shim-'));
 fs.writeFileSync(path.join(shimDir, 'node.exe'), '');
 fs.mkdirSync(path.join(shimDir, 'node_modules', 'openclaw'), { recursive: true });
 fs.writeFileSync(path.join(shimDir, 'node_modules', 'openclaw', 'openclaw.mjs'), '');
 fs.writeFileSync(path.join(shimDir, 'openclaw.cmd'), '@ECHO off\r\nSETLOCAL\r\nIF EXIST "%dp0%\\node.exe" (\r\n  SET "_prog=%dp0%\\node.exe"\r\n) ELSE (\r\n  SET "_prog=node"\r\n)\r\n"%_prog%"  "%dp0%\\node_modules\\openclaw\\openclaw.mjs" %*\r\n');
 const shim = resolveWindowsShim(path.join(shimDir, 'openclaw.cmd'));
 assert.ok(shim, 'npm shim resolves');
 assert.equal(path.basename(shim!.command).toLowerCase(), 'node.exe', 'bundled interpreter runs the program');
 assert.deepEqual(shim!.args.map((a) => path.basename(a)), ['openclaw.mjs'], 'program is the entry script, not node.exe');
 // The extensionless POSIX shim beside it is found first on PATH; on Windows it must resolve to the same program.
 fs.writeFileSync(path.join(shimDir, 'openclaw'), '#!/bin/sh\nbasedir=$(dirname "$0")\nif [ -x "$basedir/node" ]; then\n  exec "$basedir/node"  "$basedir/node_modules/openclaw/openclaw.mjs" "$@"\nelse\n  exec node  "$basedir/node_modules/openclaw/openclaw.mjs" "$@"\nfi\n');
 if (process.platform === 'win32') {
   const posix = resolveFromCandidates([path.join(shimDir, 'openclaw')]);
   assert.ok(posix && path.basename(posix.command).toLowerCase() === 'node.exe', 'extensionless shim is never spawned directly on Windows');
   assert.deepEqual(posix!.args.map((a) => path.basename(a)), ['openclaw.mjs']);
 }
 fs.rmSync(shimDir, { recursive: true, force: true });
 console.log('ACP regression: ok (fixture processes only)');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
