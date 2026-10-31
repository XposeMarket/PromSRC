import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import * as policy from './main-chat-execution-owner';

// Execute the ACTUAL watchdog function with synthetic time/owners, without importing
// the router (which starts live runtime services). No live data, ports or timers.
function loadFunction(file: string, name: string, globals: Record<string, any>) {
  const source = ts.createSourceFile(file, fs.readFileSync(path.resolve(file), 'utf8'), ts.ScriptTarget.Latest, true);
  const fn = source.statements.find((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.ok(fn, `function ${name} exists`);
  const code = ts.transpileModule(fn.getText(source).replace(/^export\s+/, '') + `\nglobalThis.result = ${name};`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const context = vm.createContext({ ...globals });
  vm.runInContext(code, context);
  return context.result;
}
const start = 1_000_000;
const now = start + 7 * 60 * 60_000;
function scenario(options: { status?: string; expiresAt?: number; liveWaiter?: boolean; sessionId?: string; createdAt?: number; waits?: any[]; abortRequestedAt?: number; age?: number } = {}) {
  const aborted: string[] = [];
  const stream = { active: true, runtimeId: 'runtime', sessionId: 'session', startedAt: options.age ? now - options.age : start, lastSemanticProgressAt: start, lastSemanticEvent: 'tool_call', blockingWaits: options.waits ?? [{ name: 'ask_prometheus_questions', startedAt: start }] };
  const card = { id: 'card', sessionId: options.sessionId ?? 'session', status: options.status ?? 'pending', createdAt: new Date(options.createdAt ?? start + 10).toISOString(), expiresAt: options.expiresAt ?? start + 24 * 60 * 60_000 };
  const reconcile = loadFunction('src/gateway/routes/chat.router.ts', 'reconcileMainChatExecutionOwners', {
    ...policy, Date, process: { memoryUsage: () => ({ rss: 1, heapUsed: 1, external: 1 }) }, console: { warn() {} },
    pruneMainChatStreams() {}, mainChatStreams: new Map([['session', stream]]),
    getLiveRuntime: () => ({ id: 'runtime', status: 'running', abortRequestedAt: options.abortRequestedAt }),
    listActiveBackgroundIdsForSession: () => [], listLiveRuntimes: () => [],
    getPrometheusQuestionQueue: () => ({ listPending: () => [card], hasResolveCallback: () => options.liveWaiter !== false }),
    updateLiveRuntimeCheckpoint() {}, abortLiveRuntime: (_id: string, reason: string) => aborted.push(reason),
  });
  reconcile(now);
  return aborted;
}
assert.deepEqual(scenario(), [], 'live 24h question survives 7h age and semantic-stall clocks');
for (const invalid of [{ status: 'answered' }, { status: 'cancelled' }, { expiresAt: now }, { liveWaiter: false }, { sessionId: 'other' }, { createdAt: start - 1 }, { waits: [] }]) {
  assert.deepEqual(scenario(invalid), ['max_age_exceeded'], JSON.stringify(invalid));
  assert.deepEqual(scenario({ ...invalid, age: 30 * 60_000 }), ['semantic_progress_stall'], 'stall guard uses same live-card test');
}
assert.deepEqual(scenario({ waits: [{ name: 'await_prometheus_question_response', startedAt: now - 1000, args: { question_id: 'card' } }] }), [], 'exact resumed question');
assert.deepEqual(scenario({ waits: [{ name: 'request_browser_login', startedAt: start }] }), [], 'login is backed by a question card');
assert.deepEqual(scenario({ abortRequestedAt: now - 1 }), [], 'explicit abort branch is not suppressed');
const provenance = loadFunction('src/gateway/routes/chat/pipeline/restart-continuity.ts', 'describeRestartProvenance', { Date });
for (const reason of ['semantic_progress_stall', 'max_age_exceeded']) {
  const text = provenance({ checkpoint: { toolName: 'ask_prometheus_questions' }, interruptReason: reason, interruptedAt: Date.now() - 1000 });
  assert.match(text, /TURN WATCHDOG/);
  assert.doesNotMatch(text, /gateway process stopped|gateway was down/);
}
assert.match(provenance({ checkpoint: { toolName: 'gateway_restart' }, interruptReason: 'gateway_restart' }), /PLANNED/);
console.log('actual foreground watchdog + recovery provenance isolated regression passed');
