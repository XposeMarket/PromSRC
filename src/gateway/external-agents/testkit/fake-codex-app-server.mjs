#!/usr/bin/env node
/**
 * Scripted FAKE `codex app-server` for tests. Speaks newline-delimited
 * JSON-RPC on stdio with the shapes from codex-cli 0.163.0. It never calls a
 * model and never touches any account. Tests point the Codex adapter at
 * `node fake-codex-app-server.mjs` instead of the real program.
 *
 * Env:
 *   FAKE_CODEX_MODE  ready (default) | signed_out | api_key | crash_on_start
 *   FAKE_CODEX_LOG   file that receives every line Prometheus wrote (JSONL)
 *
 * Turn behaviour is chosen by the user's text:
 *   contains APPROVAL -> asks item/commandExecution/requestApproval first
 *   contains UNKNOWN  -> sends an unknown server request first
 *   contains SLOW     -> streams one delta, then waits for turn/interrupt
 *   contains STUCK    -> streams one delta, acknowledges turn/interrupt, never ends the turn
 *   contains LONG     -> streams one delta, works for a moment, then completes on its own
 *   contains LATECMD  -> like RUNCMD, but the command's start is only reported after turn/interrupt arrived
 *   contains RUNCMD   -> starts a real child process as a command; turn/interrupt is confirmed but the
 *                        child keeps running (what codex-cli 0.163.0 does on Windows)
 *   contains BADMODEL -> without a turn/start model, or with 'refused-model', fails as a refused model;
 *                        with any other model answers 'ok with <model>'
 *   contains FAIL     -> turn/completed with status failed
 *   otherwise         -> command item, reasoning, two deltas, completed
 */
import fs from 'fs';
import { spawn } from 'child_process';

const args = process.argv.slice(2);
if (args.includes('--version')) {
  process.stdout.write('codex-cli 0.163.0\n');
  process.exit(0);
}
const mode = process.env.FAKE_CODEX_MODE || 'ready';
const logFile = process.env.FAKE_CODEX_LOG || '';
if (mode === 'crash_on_start') {
  process.stderr.write('fake codex: could not load config\n');
  process.exit(3);
}

const loaded = new Set();
const resumedReplay = new Set(); // threads that replay stale previous-turn events on the next turn/start
const waiting = new Map(); // server request id -> resolve
let serverRequestSeq = 0;
let turnSeq = 0;
let activeTurn = null; // { threadId, turnId, resolveInterrupt }

function send(message) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
}
function notify(method, params) { send({ method, params }); }
function log(line) {
  if (logFile) fs.appendFileSync(logFile, `${line}\n`);
}
function ask(method, params) {
  serverRequestSeq += 1;
  const id = `srv-${serverRequestSeq}`;
  return new Promise((resolve) => {
    waiting.set(id, resolve);
    send({ id, method, params });
  });
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function turnObject(id, status, items = [], error = null) {
  return { id, items, itemsView: 'full', status, error, startedAt: null, completedAt: null, durationMs: null };
}

async function runTurn(threadId, turnId, text, model) {
  const base = { threadId, turnId };
  notify('turn/started', { threadId, turn: turnObject(turnId, 'inProgress') });
  if (text.includes('UNKNOWN')) {
    const answer = await ask('item/somethingNew/request', { ...base, itemId: 'x1' });
    notify('item/agentMessage/delta', { ...base, itemId: 'm1', delta: answer.error ? 'declined-ok' : 'unexpected' });
    notify('turn/completed', { threadId, turn: turnObject(turnId, 'completed') });
    return;
  }
  if (text.includes('PENDING_END') || text.includes('PENDING_CRASH')) {
    void ask('item/commandExecution/requestApproval', { kind: 'command', ...base, itemId: 'c1', command: 'npm test', cwd: '/repo' });
    await sleep(30);
    if (text.includes('PENDING_CRASH')) process.exit(3);
    notify('turn/completed', { threadId, turn: turnObject(turnId, 'completed') });
    return;
  }
  if (text.includes('APPROVAL')) {
    const answer = await ask('item/commandExecution/requestApproval', {
      kind: 'command', ...base, itemId: 'c1', startedAtMs: Date.now(), environmentId: null,
      command: 'npm test', cwd: '/repo', reason: 'Run the tests',
    });
    const decision = answer.result?.decision;
    notify('item/agentMessage/delta', { ...base, itemId: 'm1', delta: `decision=${decision}` });
    notify('turn/completed', { threadId, turn: turnObject(turnId, 'completed') });
    return;
  }
  if (text.includes('STUCK')) {
    notify('item/agentMessage/delta', { ...base, itemId: 'm1', delta: 'partial answer' });
    await new Promise(() => {});
  }
  if (text.includes('LATECMD')) {
    notify('item/agentMessage/delta', { ...base, itemId: 'm1', delta: 'thinking' });
    await new Promise((resolve) => { activeTurn = { threadId, turnId, resolveInterrupt: resolve }; });
    const child = spawn(process.execPath, ['-e', 'setTimeout(()=>{},120000)'], { stdio: 'ignore' });
    notify('item/started', { ...base, startedAtMs: Date.now(), item: { type: 'commandExecution', id: 'c1', command: 'sleep 120', cwd: '/repo', processId: null, source: 'agent', status: 'inProgress', commandActions: [], aggregatedOutput: null, exitCode: null, durationMs: null, pluginId: null, scriptPath: null } });
    notify('item/agentMessage/delta', { ...base, itemId: 'm1', delta: `child=${child.pid}` });
    notify('turn/completed', { threadId, turn: turnObject(turnId, 'interrupted') });
    return;
  }
  if (text.includes('RUNCMD')) {
    const child = spawn(process.execPath, ['-e', 'setTimeout(()=>{},120000)'], { stdio: 'ignore' });
    notify('item/started', { ...base, startedAtMs: Date.now(), item: { type: 'commandExecution', id: 'c1', command: 'sleep 120', cwd: '/repo', processId: null, source: 'agent', status: 'inProgress', commandActions: [], aggregatedOutput: null, exitCode: null, durationMs: null, pluginId: null, scriptPath: null } });
    notify('item/agentMessage/delta', { ...base, itemId: 'm1', delta: `child=${child.pid}` });
    await new Promise((resolve) => { activeTurn = { threadId, turnId, resolveInterrupt: resolve }; });
    notify('turn/completed', { threadId, turn: turnObject(turnId, 'interrupted') });
    return;
  }
  if (text.includes('LONG')) {
    notify('item/agentMessage/delta', { ...base, itemId: 'm1', delta: 'working' });
    await sleep(900);
    notify('item/completed', { ...base, item: { type: 'agentMessage', id: 'm1', text: 'finished fine', phase: null, memoryCitation: null, delivery: null, questions: null } });
    notify('turn/completed', { threadId, turn: turnObject(turnId, 'completed') });
    return;
  }
  if (text.includes('SLOW')) {
    notify('item/agentMessage/delta', { ...base, itemId: 'm1', delta: 'partial answer' });
    await new Promise((resolve) => { activeTurn = { threadId, turnId, resolveInterrupt: resolve }; });
    notify('turn/completed', { threadId, turn: turnObject(turnId, 'interrupted') });
    return;
  }
  if (text.includes('BADMODEL')) {
    // Codex's configured model is refused unless the request names a model that is not 'refused-model'.
    if (!model || model === 'refused-model') {
      const error = { message: "The 'cfg-model' model is not supported when using Codex with a ChatGPT account.", codexErrorInfo: null, additionalDetails: null, misalignment: null };
      notify('error', { error, willRetry: false, ...base });
      notify('turn/completed', { threadId, turn: turnObject(turnId, 'failed', [], error) });
      return;
    }
    notify('item/completed', { ...base, item: { type: 'agentMessage', id: 'm1', text: `ok with ${model}`, phase: null, memoryCitation: null, delivery: null, questions: null } });
    notify('turn/completed', { threadId, turn: turnObject(turnId, 'completed') });
    return;
  }
  if (text.includes('FAIL')) {
    notify('error', { error: { message: 'usage limit reached', codexErrorInfo: null, additionalDetails: null, misalignment: null }, willRetry: false, ...base });
    notify('turn/completed', { threadId, turn: turnObject(turnId, 'failed', [], { message: 'usage limit reached', codexErrorInfo: null, additionalDetails: null, misalignment: null }) });
    return;
  }
  notify('item/started', { ...base, startedAtMs: Date.now(), item: { type: 'commandExecution', id: 'c1', command: 'ls', cwd: '/repo', processId: null, source: 'agent', status: 'inProgress', commandActions: [], aggregatedOutput: null, exitCode: null, durationMs: null, pluginId: null, scriptPath: null } });
  notify('item/commandExecution/outputDelta', { ...base, itemId: 'c1', delta: 'README.md\n' });
  notify('item/completed', { ...base, item: { type: 'commandExecution', id: 'c1', command: 'ls', cwd: '/repo', processId: null, source: 'agent', status: 'completed', commandActions: [], aggregatedOutput: 'README.md\n', exitCode: 0, durationMs: 5, pluginId: null, scriptPath: null } });
  notify('item/reasoning/summaryTextDelta', { ...base, itemId: 'r1', delta: 'thinking', summaryIndex: 0 });
  notify('item/agentMessage/delta', { ...base, itemId: 'm1', delta: 'Hello' });
  await sleep(5);
  notify('item/agentMessage/delta', { ...base, itemId: 'm1', delta: ' world' });
  notify('thread/tokenUsage/updated', { ...base, tokenUsage: { total: { totalTokens: 120, inputTokens: 100, cachedInputTokens: 0, cacheWriteInputTokens: 0, outputTokens: 20, reasoningOutputTokens: 0 }, last: { totalTokens: 120, inputTokens: 100, cachedInputTokens: 0, cacheWriteInputTokens: 0, outputTokens: 20, reasoningOutputTokens: 0 }, modelContextWindow: 1000 } });
  notify('item/completed', { ...base, item: { type: 'agentMessage', id: 'm1', text: 'Hello world', phase: null, memoryCitation: null, delivery: null, questions: null } });
  notify('turn/completed', { threadId, turn: turnObject(turnId, 'completed') });
}

function handle(message) {
  if (message.id !== undefined && message.method === undefined) {
    const resolve = waiting.get(message.id);
    if (resolve) { waiting.delete(message.id); resolve(message); }
    return;
  }
  const { id, method, params = {} } = message;
  const reply = (result) => send({ id, result });
  const fail = (text) => send({ id, error: { code: -32600, message: text } });
  switch (method) {
    case 'initialize':
      return reply({ userAgent: 'fake-codex/0.163.0', codexHome: '/fake/home', platformFamily: 'unix', platformOs: 'linux' });
    case 'initialized':
      return undefined;
    case 'model/list': return send({ id, result: { data: [{ model: 'gpt-6-astra', displayName: 'Astra', supportedReasoningEfforts: [] }, { model: 'gpt-6-luna', displayName: 'Luna', supportedReasoningEfforts: [] }], nextCursor: null } });
    case 'config/read': return send({ id, result: { config: { model: 'gpt-6-astra' } } });
    case 'account/read':
      if (mode === 'signed_out') return reply({ account: null, requiresOpenaiAuth: true });
      if (mode === 'api_key') return reply({ account: { type: 'apiKey' }, requiresOpenaiAuth: true });
      return reply({ account: { type: 'chatgpt', email: 'someone@example.com', planType: 'plus' }, requiresOpenaiAuth: true });
    case 'thread/start': {
      const threadId = `thr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      loaded.add(threadId);
      return reply({ thread: { id: threadId }, model: 'fake-model', modelProvider: 'openai', cwd: params.cwd });
    }
    case 'thread/resume':
      if (String(params.threadId || '').startsWith('missing')) return fail(`thread not found: ${params.threadId}`);
      loaded.add(params.threadId);
      resumedReplay.add(params.threadId);
      return reply({ thread: { id: params.threadId }, model: 'fake-model', modelProvider: 'openai' });
    case 'turn/start': {
      if (!loaded.has(params.threadId)) return fail('thread not loaded');
      if (resumedReplay.has(params.threadId)) {
        // Real Codex 0.163 replays the previous turn's usage after thread/resume, stamped with
        // the OLD turn id, before answering turn/start. Mirror that (plus a stale completion).
        resumedReplay.delete(params.threadId);
        const stale = { threadId: params.threadId, turnId: 'turn-previous' };
        notify('thread/tokenUsage/updated', { ...stale, tokenUsage: { total: { totalTokens: 1 }, last: { totalTokens: 1, inputTokens: 1 }, modelContextWindow: 1000 } });
        notify('turn/completed', { threadId: params.threadId, turn: turnObject('turn-previous', 'completed') });
      }
      turnSeq += 1;
      const turnId = `turn-${turnSeq}`;
      reply({ turn: turnObject(turnId, 'inProgress') });
      const text = (params.input || []).map((part) => part.text || '').join('');
      void runTurn(params.threadId, turnId, text, params.model);
      return undefined;
    }
    case 'turn/interrupt':
      reply({});
      if (activeTurn && activeTurn.turnId === params.turnId) {
        const resolve = activeTurn.resolveInterrupt;
        activeTurn = null;
        resolve();
      }
      return undefined;
    default:
      if (id !== undefined) return send({ id, error: { code: -32601, message: `unknown method ${method}` } });
      return undefined;
  }
}

let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  let newline;
  while ((newline = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, newline).trim();
    buffer = buffer.slice(newline + 1);
    if (!line) continue;
    log(line);
    let message;
    try { message = JSON.parse(line); } catch { continue; }
    handle(message);
  }
});
process.stdin.on('end', () => process.exit(0));
