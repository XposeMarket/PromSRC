/**
 * Completed background reviewer follow-ups (locked plan background-review-followups).
 * A follow-up starts a FRESH immutable execution in the SAME worker conversation,
 * admitted only for the owning chat, serialized per conversation, idempotent per
 * request, narrowed to current permissions, and retained until the parent chat
 * is deleted (even after execution snapshots/receipts are pruned and restart).
 *
 * Turn identity: a follow-up is keyed by the CANONICAL root turn id (the original
 * runtime id, carried as turnContextId / recoveryData.rootTurnId). A restart-recovered
 * turn gets a NEW runtime id but keeps the root id, so retries dedupe and results
 * deliver to the recovered runtime. Client request ids are not turn identity.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const stage = process.env.BG_FOLLOWUP_STAGE || 'main';
const root = process.env.BG_FOLLOWUP_ROOT || fs.mkdtempSync(path.join(os.tmpdir(), 'bg-followup-'));
for (const key of ['PROMETHEUS_APP_DATA_DIR', 'PROMETHEUS_DATA_DIR', 'PROMETHEUS_WORKSPACE_DIR', 'APPDATA', 'USERPROFILE', 'HOME']) process.env[key] = root;
process.env.PROMETHEUS_CONFIG_PATH = path.join(root, 'config.json');
const idsFile = path.join(root, 'followup-ids.json');
const PARENT = 'followup-parent';
const FACT = 'FACT_K7Q_UNIQUE_TOOL_READ';

const config = require('../../config/config').getConfig();
config.getConfigDir = () => root;
config.getWorkspacePath = () => root;
const runner = require('./task-runner');
const sessions = require('../session');
const registry = require('../live-runtime-registry');
const ceiling = require('../agents-runtime/tool-ceiling');

type Captured = { prompt: string; sid: string; callerContext: string; toolFilter: any; history: any[] };
const captured: Captured[] = [];
let calls = 0;
let hold: Promise<void> | null = null;
runner.setBackgroundAgentDeps({
  broadcastWS() {},
  async handleChat(prompt: string, sid: string, send: any, ...args: any[]) {
    calls++;
    const history = sessions.getSession(sid).history.slice();
    captured.push({ prompt, sid, callerContext: String(args[2] || ''), toolFilter: args[5], history });
    sessions.addMessage(sid, { role: 'user', content: prompt, timestamp: Date.now() });
    if (prompt === 'ORIGINAL_REVIEW') {
      send('tool_call', { name: 'workspace_read', toolCallId: 'read-1', args: { path: 'x.ts' } });
      send('tool_result', { name: 'workspace_read', toolCallId: 'read-1', result: `file says ${FACT}` });
      return { text: 'VERDICT_ONE: object to x.ts' };
    }
    // Follow-up assignments are labelled evidence + the final question line.
    const question = prompt.split('\n').pop() || prompt;
    if (question === 'FAIL_PLEASE') { send('error', { message: 'provider 429' }); return { text: '' }; }
    if (/Continue background task/.test(prompt)) return { text: 'RECOVERED' };
    if (hold) await hold;
    return { text: `ANSWER(${question})` };
  },
});

// A stored follow-up assignment is the labelled evidence block plus the final question line.
const historyCount = (sid: string, content: string) => sessions.getSession(sid).history
  .filter((entry: any) => entry.role === 'user' && (entry.content === content || String(entry.content).endsWith(`\n${content}`))).length;
const steersFor = (id: string) => registry.consumePendingRuntimeSteersForSession(PARENT, 50)
  .filter((event: any) => event.backgroundAgentId === id);
// Pending steers queued on one specific runtime (checked before any session-wide consumption).
const pendingOn = (runtimeId: string) => {
  const snapshot = registry.listLiveRuntimes().find((entry: any) => entry.id === runtimeId);
  return Number(snapshot?.checkpoint?.pendingSteerCount || 0);
};
// The requesting turn is identified by the id the chat pipeline passes (the live runtime id).
let currentTurn = '';
const opts = (requestId: string, parentTurnId = currentTurn, spawnerSessionId = PARENT) => ({ spawnerSessionId, requestId, parentTurnId });
async function settle(id: string) {
  const waited = await runner.backgroundWait({ backgroundId: id, timeoutMs: 10_000 });
  assert.equal(waited.running, 0, `${id} must settle`);
}

async function main() {
  assert.equal(typeof runner.backgroundFollowUp, 'function', 'backgroundFollowUp must be exported');
  // The chat pipeline must bind follow-ups to the canonical stable turn id, not the per-attempt runtime id.
  const handleChatSource = fs.readFileSync(path.join(__dirname, '../routes/chat/pipeline/handle-chat.ts'), 'utf8');
  assert.match(handleChatSource, /backgroundParentTurnId: editLogTurnId,/,
    'follow-up parent must be the canonical turn id (editLogTurnId), never the restart-replaced runtime id');
  let turn = registry.registerLiveRuntime({ kind: 'main_chat', label: 'parent turn 1', sessionId: PARENT, clientRequestId: 'turn-1' });
  ceiling.recordSessionToolCeiling(PARENT, ['web_fetch', 'workspace_read']);
  const first = runner.backgroundSpawn({ prompt: 'ORIGINAL_REVIEW', spawnerSessionId: PARENT, workDir: root,
    providerOverride: 'openai_codex', modelOverride: 'gpt-6.1-sol', toolCategories: ['workspace_write'] });
  await runner.backgroundJoin({ backgroundId: first.id, joinPolicy: 'wait_all' });
  assert.equal(calls, 1);
  const convSid = `background_${first.id}`;
  assert(!String(sessions.getSession(convSid).history.find((e: any) => e.backgroundAgentId === first.id)?.content).includes(FACT),
    'first verdict must not contain the tool fact');
  registry.consumePendingRuntimeSteersForSession(PARENT, 50);

  // Admission rejections happen before any model call.
  for (const [label, result] of [
    ['wrong chat', runner.backgroundFollowUp(first.id, 'steal', opts('x1', 'turn-x', 'other-chat'))],
    ['missing parent turn', runner.backgroundFollowUp(first.id, 'q', { spawnerSessionId: PARENT, requestId: 'x2' })],
    ['unknown id', runner.backgroundFollowUp('bg_unknown-followup', 'q', opts('x3'))],
    ['empty message', runner.backgroundFollowUp(first.id, '   ', opts('x4'))],
  ] as const) {
    assert.equal(result.queued, false, `${label} must be rejected`);
    assert.equal(result.newExecution, false, label);
    assert(result.error, `${label} must explain`);
  }
  assert.equal(calls, 1, 'rejections spend no model call');

  // Current, narrower permissions; requesting parent turn changes.
  ceiling.recordSessionToolCeiling(PARENT, ['web_fetch']);
  registry.finishLiveRuntime(turn);
  // Ordinary initial turn: runtime id, client request id and edit id are all distinct.
  turn = registry.registerLiveRuntime({ kind: 'main_chat', label: 'parent turn 2', sessionId: PARENT, clientRequestId: 'turn-2' });
  currentTurn = turn;
  let release!: () => void;
  hold = new Promise<void>((resolve) => { release = resolve; });
  const second = runner.backgroundFollowUp(first.id, 'WHY_OBJECT?', opts('req-1'));
  assert.equal(second.queued, true, String(second.error));
  assert.equal(second.newExecution, true);
  assert.match(second.id, /^bg_/);
  assert.notEqual(second.id, first.id, 'a follow-up is a fresh execution id');
  assert.equal(second.conversationId, first.id);
  assert.equal(second.predecessorId, first.id);
  const retry = runner.backgroundFollowUp(first.id, 'WHY_OBJECT?', opts('req-1'));
  assert.equal(retry.id, second.id, 'retry of the same request returns the same execution');
  assert.equal(retry.deduplicated, true);
  const overlap = runner.backgroundFollowUp(second.id, 'another question', opts('req-overlap'));
  assert.equal(overlap.queued, false, 'overlapping request is busy, not a silent steer/branch');
  assert.match(String(overlap.error), /busy|still running|in progress/i);
  for (let i = 0; i < 200 && calls < 2; i++) await new Promise((r) => setTimeout(r, 10));
  release(); hold = null;
  await settle(second.id);
  assert.equal(calls, 2, 'one execution per accepted request');
  const call2 = captured[1];
  // The user-role assignment is the new question, labelled after bounded prior evidence (no restart wrapper).
  assert.match(call2.prompt, /\[NEW ASSIGNMENT:[^\]]*\]\nWHY_OBJECT\?$/, 'the new message is the labelled final assignment');
  assert.ok(!call2.prompt.includes('Continue background task'), 'no restart wrapper');
  assert.equal(call2.sid, convSid, 'same worker conversation');
  assert.equal(call2.history.filter((e: any) => e.role === 'user' && e.content === 'ORIGINAL_REVIEW').length, 1, 'original assignment once, not repeated');
  assert(call2.history.some((e: any) => e.role === 'assistant' && String(e.content).includes('VERDICT_ONE')), 'prior verdict visible');
  assert(call2.prompt.includes(FACT), 'bounded prior tool evidence visible to the model as user-role data');
  assert(!call2.callerContext.includes(FACT), 'system-authority callerContext never carries raw tool output');
  assert.deepEqual(call2.toolFilter, ['web_fetch'], 'current restricted permission intersection');
  assert.equal(runner.backgroundStatus(first.id).result.startsWith('VERDICT_ONE'), true, 'first answer never changes');
  assert.match(runner.backgroundStatus(second.id).result, /ANSWER\(WHY_OBJECT\?\)/);
  assert.equal(runner.backgroundStatus(second.id).backgroundSessionId, convSid);
  assert.equal(steersFor(second.id).length, 1, 'result delivered to the requesting turn once');
  const rejoin = await runner.backgroundJoin({ backgroundId: first.id, joinPolicy: 'wait_all' });
  assert.match(rejoin.result, /^VERDICT_ONE/);

  // Identical question text is a distinct round (identity by round, not text).
  const third = runner.backgroundFollowUp(second.id, 'WHY_OBJECT?', opts('req-2'));
  assert.equal(third.queued, true, String(third.error));
  assert.equal(third.predecessorId, second.id);
  await settle(third.id);
  assert.equal(historyCount(convSid, 'WHY_OBJECT?'), 2, 'identical question appended per round');
  assert.equal(runner.backgroundFollowUp(first.id, 'WHY_OBJECT?', opts('req-1')).id, second.id, 'late retry still deduplicated');
  assert.equal(calls, 3);
  assert.match(runner.backgroundStatus(second.id).result, /ANSWER/, 'older round result frozen');

  // Requesting turn gone: result retained for explicit retrieval, no other turn or idle wake.
  let wakes = 0;
  runner.registerBackgroundCompletionWake(() => { wakes++; });
  registry.finishLiveRuntime(turn);
  turn = registry.registerLiveRuntime({ kind: 'main_chat', label: 'unrelated turn', sessionId: PARENT, clientRequestId: 'turn-other' });
  const orphan = runner.backgroundFollowUp(first.id, 'ORPHAN_Q', opts('req-3', 'turn-gone'));
  assert.equal(orphan.queued, true, String(orphan.error));
  await settle(orphan.id);
  assert.equal(steersFor(orphan.id).length, 0, 'never injected into an unrelated turn');
  assert.equal(wakes, 0, 'no idle wake for a gone requesting turn');
  assert.match(runner.backgroundStatus(orphan.id).result, /ORPHAN_Q/);

  // Failed head keeps failed-resume semantics; follow-up waits for a completed head.
  const failed = runner.backgroundFollowUp(first.id, 'FAIL_PLEASE', opts('req-4', 'turn-other'));
  await settle(failed.id);
  assert.equal(runner.backgroundStatus(failed.id).state, 'failed');
  const blocked = runner.backgroundFollowUp(first.id, 'next', opts('req-5', 'turn-other'));
  assert.equal(blocked.queued, false);
  assert.match(String(blocked.error), /failed|resume/i);
  assert.equal(runner.backgroundSteer(failed.id, 'retry').queued, true, 'existing failed resume retained');
  await settle(failed.id);
  assert.equal(runner.backgroundStatus(failed.id).state, 'completed');
  const afterResume = runner.backgroundFollowUp(first.id, 'AFTER_RESUME', opts('req-6', 'turn-other'));
  assert.equal(afterResume.queued, true, String(afterResume.error));
  assert.equal(afterResume.predecessorId, failed.id);
  await settle(afterResume.id);

  // Restart-recovered turn: the original runtime and the recovered runtime have DIFFERENT ids,
  // but the same client request id and the same canonical root turn id.
  const originalTurn = registry.registerLiveRuntime({ kind: 'main_chat', label: 'turn 3 original', sessionId: PARENT, clientRequestId: 'edit-3' });
  registry.finishLiveRuntime(originalTurn);
  const recoveredTurn = registry.registerLiveRuntime({ kind: 'main_chat', label: 'turn 3 (restart recovery)', sessionId: PARENT,
    clientRequestId: 'edit-3', recoveryPolicy: 'mark_interrupted',
    recoveryData: { recoveredFromRuntimeId: originalTurn, rootTurnId: originalTurn } });
  assert.notEqual(recoveredTurn, originalTurn, 'recovered runtime gets a new id');
  // The pipeline binds the follow-up to the canonical root id (editLogTurnId), not to recoveredTurn.
  const restartQ = runner.backgroundFollowUp(first.id, 'RESTART_Q', opts('req-restart', originalTurn));
  assert.equal(restartQ.queued, true, String(restartQ.error));
  await settle(restartQ.id);
  assert.equal(pendingOn(recoveredTurn), 1, 'canonical root turn id delivers to the recovered runtime exactly once');
  // Stable dedupe: a retry of the same tool call and message after recovery returns the same execution, no new round.
  const callsBeforeRetry = calls;
  const restartRetry = runner.backgroundFollowUp(first.id, 'RESTART_Q', opts('req-restart', originalTurn));
  assert.equal(restartRetry.id, restartQ.id, 'retry after recovery dedupes to the same execution');
  assert.equal(restartRetry.deduplicated, true);
  assert.equal(calls, callsBeforeRetry, 'deduplicated retry spends no model call');
  assert.equal(pendingOn(recoveredTurn), 1, 'deduplicated retry does not deliver a second time');
  // Negative: an unrelated newer turn in the same chat never receives the recovered round's result.
  registry.finishLiveRuntime(recoveredTurn);
  const newerTurn = registry.registerLiveRuntime({ kind: 'main_chat', label: 'newer unrelated turn', sessionId: PARENT, clientRequestId: 'edit-4' });
  const newerQ = runner.backgroundFollowUp(first.id, 'NEWER_Q', opts('req-newer', originalTurn));
  assert.equal(newerQ.queued, true, String(newerQ.error));
  await settle(newerQ.id);
  assert.equal(pendingOn(newerTurn), 0, 'unrelated newer turn never receives the result');
  assert.equal(steersFor(newerQ.id).length, 0, 'requesting recovered turn already ended: result retained for retrieval, not injected anywhere');
  registry.finishLiveRuntime(newerTurn);
  registry.finishLiveRuntime(turn);

  // Revoked workspace fails closed before a model call.
  const goneDir = path.join(root, 'gone-dir'); fs.mkdirSync(goneDir);
  const other = runner.backgroundSpawn({ prompt: 'ORIGINAL_REVIEW', spawnerSessionId: PARENT, workDir: goneDir,
    providerOverride: 'openai_codex', modelOverride: 'gpt-6.1-sol', toolCategories: [] });
  await settle(other.id);
  fs.rmSync(goneDir, { recursive: true, force: true });
  const before = calls;
  const revoked = runner.backgroundFollowUp(other.id, 'q', opts('req-7', 'turn-other'));
  assert.equal(revoked.queued, false);
  assert.match(String(revoked.error), /working directory/i);
  assert.equal(calls, before);

  fs.writeFileSync(idsFile, JSON.stringify({ first: first.id, second: second.id, turn: currentTurn }));
  sessions.flushAllSessions();
  await sessions.flushPendingSessionWrites();
  // Ordinary snapshot/receipt pruning must not end the conversation.
  const execDir = path.join(root, 'background-executions');
  for (const name of fs.readdirSync(execDir)) if (name.endsWith('.json')) fs.rmSync(path.join(execDir, name));
  fs.rmSync(path.join(root, 'background-spawn-continuity.json'), { force: true });
  const child = spawnSync(process.execPath, ['--import', 'tsx', __filename], { cwd: process.cwd(), encoding: 'utf8', timeout: 90_000,
    env: { ...process.env, BG_FOLLOWUP_STAGE: 'restart', BG_FOLLOWUP_ROOT: root } });
  assert.equal(child.status, 0, `restart stage failed:\n${child.stdout}\n${child.stderr}`);
  console.log('PASS background follow-up: fresh immutable rounds, same conversation/history/evidence, owner/request/turn gates, serialization, idempotency, permission narrowing, failed-resume retained, restart-recovered turn identity (original vs recovered ids, unrelated newer turn negative, stable dedupe), revoked workspace');
}

async function restart() {
  const ids = JSON.parse(fs.readFileSync(idsFile, 'utf8'));
  assert.deepEqual(runner.recoverBackgroundExecutions(), []);
  assert.equal(calls, 0, 'nothing re-executes on boot');
  const convSid = `background_${ids.first}`;
  const turn9 = registry.registerLiveRuntime({ kind: 'main_chat', label: 'parent turn 9', sessionId: PARENT, clientRequestId: 'turn-9' });
  // Same turn (the original turn id), same tool-call id, same message: a genuine retry across restart returns the same run.
  assert.equal(runner.backgroundFollowUp(ids.first, 'WHY_OBJECT?', opts('req-1', ids.turn)).id, ids.second, 'admission dedupe survives restart');
  assert.equal(calls, 0);
  const next = runner.backgroundFollowUp(ids.first, 'AFTER_RESTART', opts('req-9', turn9));
  assert.equal(next.queued, true, String(next.error));
  await settle(next.id);
  assert.equal(calls, 1);
  const call = captured[0];
  assert.match(call.prompt, /\nAFTER_RESTART$/, 'the new message is the final labelled assignment');
  assert.equal(call.sid, convSid);
  assert(call.history.some((e: any) => e.role === 'user' && e.content === 'ORIGINAL_REVIEW'), 'history retained after pruning/restart');
  assert(call.history.some((e: any) => String(e.content).includes('VERDICT_ONE')));
  assert(call.prompt.includes(FACT), 'bounded evidence retained after snapshot pruning (user-role data)');
  assert(!call.callerContext.includes(FACT), 'system-authority context never carries tool evidence');
  assert.equal(steersFor(next.id).length, 1);
  sessions.flushAllSessions();
  await sessions.flushPendingSessionWrites();
  // Deleting the parent chat removes continuations.
  assert.equal(sessions.deleteSession(PARENT), true);
  const after = runner.backgroundFollowUp(ids.first, 'AFTER_DELETE', opts('req-10', turn9));
  assert.equal(after.queued, false);
  assert.match(String(after.error), /not found|deleted|no longer/i);
  assert.equal(fs.existsSync(path.join(root, 'background-conversations', `${ids.first}.json`)), false, 'conversation metadata removed');
  assert.equal(fs.existsSync(path.join(root, 'sessions', `${convSid}.json`)), false, 'conversation context removed');
  assert.equal(calls, 1);
  console.log('PASS restart stage: retained conversation after pruning, deduped admission, parent deletion removes continuation');
}

(stage === 'restart' ? restart() : main())
  .then(() => { if (stage === 'main') fs.rmSync(root, { recursive: true, force: true }); process.exit(0); })
  .catch((error) => { console.error(error); process.exit(1); });
