import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ModelResponseRecovery, appendRecoveryTurn, recoverableEmptyCompletionResponse } from './model-response-recovery';
import { readChatRouterSource } from '../../testing/chat-router-source';
import { CodexIncompleteStreamError, type CodexStreamDiagnostics } from '../../providers/openai-codex-adapter';
import { ModelCallWorkerError } from '../process/model-call-worker-pool';
import { modelCallProviderErrorFields } from '../process/model-call-worker-protocol';

const recovery = new ModelResponseRecovery();
assert.equal(recovery.outputBudget('anthropic', 'claude-fable-5-1'), 16384);
assert.equal(recovery.outputBudget('openai', 'gpt'), 4096);
const limited = recovery.inspect({ content: null }, 'max_tokens');
assert.equal(limited.action, 'retry');
if (limited.action === 'retry') {
  assert.match(limited.prompt, /output token limit/);
  assert.match(limited.prompt, /fewer than 250 lines/);
  assert.match(limited.prompt, /NOT executed/);
}
assert.equal(recovery.outputBudget('anthropic', 'claude-fable-5-1'), 32768);
assert.equal(recovery.inspect({ content: null }, 'end_turn').action, 'retry');
assert.deepEqual(recovery.inspect({ content: null }, 'end_turn'), { action: 'exhausted', reason: 'end_turn' });
assert.equal(recovery.inspect({ tool_calls: [{}] }, 'tool_use').action, 'accept');
assert.equal(recovery.inspect({ content: null }, 'end_turn').action, 'retry');
assert.equal(recovery.inspect({ content: 'OK' }, 'end_turn').action, 'accept');
assert.equal(recovery.inspect({ content: null }, 'refusal').action, 'accept');
assert.equal(recovery.inspect({ content: null }, undefined, true).action, 'accept');
assert.equal(recovery.inspect({ content: 'Partial answer' }, 'max_tokens').action, 'retry');
const interrupted = recovery.inspect({ content: 'Partial answer' }, 'incomplete_stream');
assert.equal(interrupted.action, 'retry');
if (interrupted.action === 'retry') assert.match(interrupted.prompt, /stream was interrupted/);
assert.equal(recovery.outputBudget('anthropic', 'claude-fable-5-1'), 32768);
recovery.inspect({ tool_calls: [{}] }, 'tool_use');
assert.equal(recovery.inspect({}, 'end_turn').action, 'retry');
recovery.inspect({ tool_calls: [{}] }, 'tool_use');
assert.equal(recovery.inspect({}, 'end_turn').action, 'exhausted', 'total recovery cap survives intervening tool work');

const exhaustedOutput = new ModelResponseRecovery();
exhaustedOutput.inspect({}, 'max_tokens');
exhaustedOutput.inspect({}, 'max_tokens');
assert.deepEqual(exhaustedOutput.inspect({}, 'max_tokens'), { action: 'exhausted', reason: 'max_tokens' });

// Wiring matters: the historical bug removed tools and dropped recovered calls.
const router = readChatRouterSource();
assert.doesNotMatch(router, /salvageRound|Do not call any more tools|MAX_EMPTY_FINAL_SALVAGE/);
assert.match(router, /modelResponseRecovery\.inspect\(response, responseStopReason/);
assert.match(router, /num_predict:.*modelResponseRecovery\.outputBudget/);
assert.match(router, /stopReason: result\.stopReason/);
assert.match(router, /outputTokens: result\.usage\?\.outputTokens/);
assert.match(router, /recovery\.reason === 'max_tokens'/);
assert.equal((router.match(/responseStopReason = result.stopReason/g) || []).length, 2);
assert.doesNotMatch(router, /content: 'Understood\. I will steer/);
const shim = fs.readFileSync(path.join(__dirname, '../../agents/ollama-client.ts'), 'utf8');
assert.match(shim, /stopReason: result.stopReason/);

// ── Codex empty completion → shared recovery (direct and worker-serialized) ──
function diagnostics(failureClass: CodexStreamDiagnostics['failureClass'], extra: Partial<CodexStreamDiagnostics> = {}): CodexStreamDiagnostics {
  return {
    failureClass,
    sawCompleted: failureClass === 'empty_completion',
    eventTypes: ['response.completed'],
    outputItemTypes: ['reasoning'],
    outputItemCount: 1,
    finalTextChars: 0,
    toolCallCount: 0,
    ...extra,
  };
}
const directEmpty = () => new CodexIncompleteStreamError('openai_codex response.completed contained no assistant text or tool calls.', diagnostics('empty_completion'));
// Same shape the pool rebuilds after IPC: worker code stays MODEL_CALL_FAILED; provider code is separate.
const serializedEmpty = () => new ModelCallWorkerError(
  'openai_codex response.completed contained no assistant text or tool calls.',
  'MODEL_CALL_FAILED',
  false,
  true,
  modelCallProviderErrorFields('CODEX_INCOMPLETE_STREAM', { ...diagnostics('empty_completion'), leaked: 'secret' }),
);

/** Mirrors the handle-chat round contract around the provider catch and the shared recovery. */
function runRound(state: ModelResponseRecovery, messages: any[], outcome: { error?: unknown; response?: any; aborted?: boolean; partial?: string }) {
  let response = outcome.response;
  let cause: string | undefined;
  if (outcome.error) {
    const empty = recoverableEmptyCompletionResponse(outcome.error, { aborted: outcome.aborted, visiblePartialText: outcome.partial });
    if (!empty) return { kind: 'ended_on_error' as const };
    response = empty;
    cause = 'empty_completion';
  }
  const verdict = state.inspect(response, undefined, outcome.aborted, cause);
  if (verdict.action === 'retry') {
    appendRecoveryTurn(messages, response, verdict.prompt);
    return { kind: 'retry' as const, attempt: verdict.attempt, cause: verdict.cause };
  }
  if (verdict.action === 'exhausted') return { kind: 'exhausted' as const, reason: verdict.reason, cause: verdict.cause };
  return { kind: 'final' as const, content: response.content };
}
const history = () => [
  { role: 'user', content: 'research and summarize' },
  { role: 'assistant', content: '', tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'web_search', arguments: '{}' } }] },
  { role: 'tool', tool_call_id: 'call_1', content: 'search results' },
];

for (const [label, make] of [['direct', directEmpty], ['serialized', serializedEmpty]] as const) {
  const state = new ModelResponseRecovery();
  const messages: any[] = history();
  const before = JSON.parse(JSON.stringify(messages));
  const first = runRound(state, messages, { error: make() });
  assert.equal(first.kind, 'retry', `${label} empty completion must route into recovery`);
  assert.equal((first as any).cause, 'empty_completion');
  assert.deepEqual(messages.slice(0, before.length), before, `${label}: prior tool calls/results stay intact`);
  assert.equal(messages.length, before.length + 1, `${label}: exactly one nudge appended`);
  assert.equal(messages.at(-1).role, 'user');
  assert.match(messages.at(-1).content, /Do not repeat completed actions/);
  assert.equal(messages.filter((m) => m.role === 'tool').length, 1, `${label}: no tool replay or fabricated tool result`);
  assert.ok(!messages.slice(before.length).some((m) => m.role === 'assistant'), `${label}: no empty assistant turn`);
  assert.deepEqual(runRound(state, messages, { response: { content: 'Here is the summary.' } }), { kind: 'final', content: 'Here is the summary.' }, `${label}: recovered round finalizes`);
}
{
  // F1: handle-chat keeps a turn-wide accumulator (lastPartialText, for degraded text) and a
  // per-provider-call accumulator (roundVisibleText, reset before each generation). Only the
  // per-call value may block recovery.
  const state = new ModelResponseRecovery();
  const messages: any[] = history();
  let turnPartialText = '';
  // Round 1: model streams commentary, then the turn continues with tool results.
  turnPartialText += "I'll research this now.";
  messages.push({ role: 'assistant', content: "I'll research this now." });
  messages.push({ role: 'tool', tool_call_id: 'call_1', content: 'ok' });
  // Round 2: roundVisibleText reset, then empty Codex completion with no visible text this call.
  let roundVisibleText = '';
  assert.equal(
    runRound(state, messages, { error: directEmpty(), partial: roundVisibleText }).kind,
    'retry',
    'prior-round text (turn-wide accumulator) must not block recovery',
  );
  assert.ok(turnPartialText.length > 0, 'turn-wide text still exists, proving it is not the gate');
  // Round 3: current call streams visible text, then empty error. This must NOT recover.
  roundVisibleText = 'Visible text in this round';
  assert.equal(
    runRound(state, messages, { error: directEmpty(), partial: roundVisibleText }).kind,
    'ended_on_error',
    'current-round visible text still blocks recovery',
  );
}


{
  // Shared budget: two consecutive retries, then exhausted (truthful degraded finish).
  const state = new ModelResponseRecovery();
  const messages: any[] = history();
  assert.equal(runRound(state, messages, { error: directEmpty() }).kind, 'retry');
  assert.equal(runRound(state, messages, { error: serializedEmpty() }).kind, 'retry');
  const third = runRound(state, messages, { error: directEmpty() });
  assert.equal(third.kind, 'exhausted');
  assert.equal((third as any).cause, 'empty_completion');
  assert.equal(messages.length, history().length + 2, 'exhausted round appends nothing');
}
{
  // Total cap of six survives intervening tool rounds.
  const state = new ModelResponseRecovery();
  const messages: any[] = [];
  let retries = 0;
  for (let i = 0; i < 10; i++) {
    const out = runRound(state, messages, { error: i % 2 ? serializedEmpty() : directEmpty() });
    if (out.kind !== 'retry') { assert.equal(out.kind, 'exhausted'); break; }
    retries++;
    runRound(state, messages, { response: { content: '', tool_calls: [{ id: `t${i}` }] } });
  }
  assert.equal(retries, 6, 'total recoveries stay capped at six');
}
const excluded: Array<[string, unknown, { aborted?: boolean; partial?: string }]> = [
  ['aborted', directEmpty(), { aborted: true }],
  ['visible partial text', directEmpty(), { partial: 'Partial answer so far' }],
  ['missing_completed', new CodexIncompleteStreamError('ended', diagnostics('missing_completed')), {}],
  ['transport_terminated', new CodexIncompleteStreamError('terminated', diagnostics('transport_terminated')), {}],
  ['empty class but text counted', new CodexIncompleteStreamError('x', diagnostics('empty_completion', { finalTextChars: 3 })), {}],
  ['empty class but tools counted', new CodexIncompleteStreamError('x', diagnostics('empty_completion', { toolCallCount: 1 })), {}],
  ['non-Codex provider', Object.assign(new Error('other'), { code: 'OTHER_EMPTY', diagnostics: diagnostics('empty_completion') }), {}],
  ['worker error with unknown provider code', new ModelCallWorkerError('x', 'MODEL_CALL_FAILED', false, true, modelCallProviderErrorFields('OTHER_CODE', diagnostics('empty_completion'))), {}],
  ['worker error without diagnostics', new ModelCallWorkerError('x', 'MODEL_CALL_FAILED', false, true, modelCallProviderErrorFields('CODEX_INCOMPLETE_STREAM', undefined)), {}],
  ['unknown failure class', Object.assign(new Error('x'), { code: 'CODEX_INCOMPLETE_STREAM', diagnostics: { failureClass: 'weird', sawCompleted: true } }), {}],
  ['AbortError', Object.assign(new Error('aborted'), { name: 'AbortError', code: 'CODEX_INCOMPLETE_STREAM', diagnostics: diagnostics('empty_completion') }), {}],
  ['plain error', new Error('boom'), {}],
];
for (const [label, error, opts] of excluded) {
  const state = new ModelResponseRecovery();
  const messages: any[] = history();
  assert.equal(runRound(state, messages, { error, ...opts }).kind, 'ended_on_error', `${label} must not be retried`);
  assert.equal(messages.length, history().length, `${label}: history untouched`);
}
assert.deepEqual(
  modelCallProviderErrorFields('CODEX_INCOMPLETE_STREAM', { ...diagnostics('empty_completion'), usage: { inputTokens: 9 }, leaked: 'secret' }),
  { providerCode: 'CODEX_INCOMPLETE_STREAM', providerDiagnostics: { failureClass: 'empty_completion', sawCompleted: true, finalTextChars: 0, toolCallCount: 0 } },
  'only categorical/count diagnostics cross the worker boundary',
);
assert.deepEqual(modelCallProviderErrorFields('SOMETHING_ELSE', diagnostics('empty_completion')), {});
console.log('Model response recovery limits and chat-loop wiring passed.');
