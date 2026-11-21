/**
 * Runner-level hardening for background follow-ups (isolated temp root, mock
 * handleChat that records the ACTIVE workspace scope the worker would run in):
 *  1) current-scope recomputation: removed grants / new denies / revoked roots
 *     narrow or fail closed with no model dispatch;
 *  2) admission identity: turn + tool-call id + message digest, incl. missing ids
 *     and repeated local_text_0 across rounds;
 *  3) callerContext carries no raw prior tool output; evidence lives once in a
 *     labelled user-role assignment;
 *  4) parent deletion retires live rounds, storage and admissions without stale
 *     writes, deliveries, or model dispatch.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = process.env.BG_HARDEN_ROOT || fs.mkdtempSync(path.join(os.tmpdir(), 'bg-followup-harden-'));
for (const key of ['PROMETHEUS_APP_DATA_DIR', 'PROMETHEUS_DATA_DIR', 'PROMETHEUS_WORKSPACE_DIR', 'APPDATA', 'USERPROFILE', 'HOME']) process.env[key] = root;
process.env.PROMETHEUS_CONFIG_PATH = path.join(root, 'config.json');
process.env.PROMETHEUS_PREVIEW_MODE = '0';

const config = require('../../config/config').getConfig();
config.getConfigDir = () => root;
config.getWorkspacePath = () => root;
const runner = require('./task-runner');
const sessions = require('../session');
const registry = require('../live-runtime-registry');
const ceiling = require('../agents-runtime/tool-ceiling');
const ws = require('../../tools/workspace-context');

const FACT = 'FACT_HARDEN_TOOL_OUTPUT_9d2e';
const mainWs = path.join(root, 'main');
const wt = path.join(mainWs, 'wt');
const other = path.join(root, 'other');
for (const dir of [wt, other, path.join(mainWs, 'other-sibling')]) fs.mkdirSync(dir, { recursive: true });
const PARENT = 'harden-parent';

type Seen = { prompt: string; sid: string; callerContext: string; scopeWork: string; scopeAllowed: string[]; scoped: boolean };
const seen: Seen[] = [];
let hold: Promise<void> | null = null;
let holdPrompt = '';
runner.setBackgroundAgentDeps({
  broadcastWS() {},
  async handleChat(prompt: string, sid: string, send: any, ...args: any[]) {
    seen.push({
      prompt, sid, callerContext: String(args[2] || ''),
      scopeWork: ws.getActiveWorkspace('UNSCOPED'),
      scopeAllowed: ws.getActiveAllowedWorkspaces('UNSCOPED'),
      scoped: ws.hasActiveWorkspaceScope(),
    });
    sessions.addMessage(sid, { role: 'user', content: prompt, timestamp: Date.now() });
    if (prompt.includes('SEED_TOOL')) {
      send('tool_call', { name: 'workspace_read', toolCallId: 'read-1', args: { path: 'x.ts' } });
      send('tool_result', { name: 'workspace_read', toolCallId: 'read-1', result: `observed ${FACT}` });
      return { text: 'SEED_VERDICT' };
    }
    if (hold && holdPrompt && prompt.includes(holdPrompt)) await hold;
    return { text: `ANSWER(${prompt.slice(-40)})` };
  },
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function settle(id: string) {
  const waited = await runner.backgroundWait({ backgroundId: id, timeoutMs: 10_000 });
  assert.equal(waited.running, 0, `${id} must settle`);
}
const opts = (requestId: string, parentTurnId: string, spawnerSessionId = PARENT) => ({ spawnerSessionId, requestId, parentTurnId });
const withScope = <T>(dir: string, allowed: string[], fn: () => T): Promise<T> => ws.runWithWorkspace(dir, async () => fn(), allowed);
const convFile = (rootId: string) => path.join(root, 'background-conversations', `${rootId}.json`);

async function main() {
  ceiling.recordSessionToolCeiling(PARENT, ['workspace_read']);
  const head = runner.backgroundSpawn({
    prompt: 'SEED_TOOL: review the synthetic fixture.', spawnerSessionId: PARENT, workDir: wt, allowedWorkPaths: [wt, mainWs],
    providerOverride: 'openai_codex', modelOverride: 'gpt-6.1-sol', toolCategories: [],
  });
  await runner.backgroundJoin({ backgroundId: head.id, joinPolicy: 'wait_all' });
  const convSid = `background_${head.id}`;

  // ── 3) callerContext: no raw prior tool output; evidence once, user-role, labelled ──
  const base = seen.length;
  const ctxRound = runner.backgroundFollowUp(head.id, 'QUESTION_CTX', opts('ctx-1', 'turn-1'));
  assert.equal(ctxRound.queued, true, String(ctxRound.error));
  await settle(ctxRound.id);
  const ctxCall = seen[base];
  assert.ok(ctxCall, 'follow-up dispatched once');
  assert.equal(seen.length, base + 1);
  assert.ok(!ctxCall.callerContext.includes(FACT), 'system-authority callerContext must not carry raw tool output');
  assert.ok(!ctxCall.callerContext.includes('QUESTION_CTX'), 'system-authority callerContext must not carry the assignment');
  assert.match(ctxCall.callerContext, /FOLLOW-UP ROUND/, 'a short follow-up notice remains in system context');
  assert.ok(ctxCall.prompt.includes(FACT), 'bounded evidence is carried in the user-role assignment');
  assert.match(ctxCall.prompt, /NEW ASSIGNMENT/, 'new assignment is labelled distinctly');
  assert.match(ctxCall.prompt, /PRIOR TOOL EVIDENCE/, 'evidence is labelled as reference data');
  assert.ok(ctxCall.prompt.trimEnd().endsWith('QUESTION_CTX'), 'the new question is the final user assignment');
  const userWithFact = sessions.getSession(convSid).history.filter((e: any) => e.role === 'user' && String(e.content).includes(FACT));
  assert.equal(userWithFact.length, 1, 'evidence is stored in history exactly once (no duplicate evidence/assignment entries)');
  assert.equal(sessions.getSession(convSid).history.filter((e: any) => e.role === 'user' && String(e.content).includes('QUESTION_CTX')).length, 1, 'assignment stored once');
  assert.equal(sessions.getSession(convSid).history.filter((e: any) => e.role === 'system' && String(e.content).includes(FACT)).length, 0, 'never system-authority evidence');

  // ── 1) scope recomputation at admission ──
  // Removed grant: head may reach mainWs; requester now holds only wt.
  const removed = await withScope(wt, [wt], () => runner.backgroundFollowUp(head.id, 'Q_REMOVED_GRANT', opts('scope-1', 'turn-2')));
  assert.equal(removed.queued, true, String(removed.error));
  await settle(removed.id);
  const removedCall = seen.find((s) => s.prompt.includes('Q_REMOVED_GRANT'));
  assert.ok(removedCall?.scoped, 'worker runs scoped');
  assert.deepEqual(removedCall!.scopeAllowed, [path.resolve(wt)], 'removed grant: main workspace root is no longer allowed');
  assert.equal(ws.isPathInAnyWorkspace(removedCall!.scopeAllowed, path.join(mainWs, 'README.md')), false, 'main workspace file blocked');

  // New deny narrowing a wider original root to a descendant; sibling descendant blocked.
  const wide = runner.backgroundSpawn({
    prompt: 'SEED_TOOL: wide review.', spawnerSessionId: PARENT, workDir: wt, allowedWorkPaths: [mainWs],
    providerOverride: 'openai_codex', modelOverride: 'gpt-6.1-sol', toolCategories: [],
  });
  await runner.backgroundJoin({ backgroundId: wide.id, joinPolicy: 'wait_all' });
  const narrowed = await withScope(wt, [wt], () => runner.backgroundFollowUp(wide.id, 'Q_NARROW', opts('scope-2', 'turn-3')));
  assert.equal(narrowed.queued, true, String(narrowed.error));
  await settle(narrowed.id);
  const narrowCall = seen.find((s) => s.prompt.includes('Q_NARROW'))!;
  assert.deepEqual(narrowCall.scopeAllowed, [path.resolve(wt)], 'wider original root narrowed to current descendant');
  assert.equal(ws.isPathInAnyWorkspace(narrowCall.scopeAllowed, path.join(mainWs, 'other-sibling', 'x.txt')), false, 'descendant outside current root is blocked');

  // Revoked working directory: fail closed before any model dispatch.
  const dispatchedBefore = seen.length;
  const revoked = await withScope(other, [other], () => runner.backgroundFollowUp(head.id, 'Q_REVOKED', opts('scope-3', 'turn-4')));
  assert.equal(revoked.queued, false);
  assert.equal(revoked.code, 'scope_revoked', JSON.stringify(revoked));
  assert.match(String(revoked.error), /working directory/i);
  assert.equal(seen.length, dispatchedBefore, 'no model dispatch on revoked scope');
  const headAfterRevoke = runner.backgroundFollowUp(head.id, 'Q_AFTER_REVOKE', opts('scope-4', 'turn-4'));
  assert.equal(headAfterRevoke.queued, true, 'the conversation remains usable when the requester is in scope again');
  await settle(headAfterRevoke.id);

  // ── 2) idempotency: turn + tool-call id + normalized digest ──
  const r1 = runner.backgroundFollowUp(head.id, 'Q_ID', opts('local_text_0', 'turn-A'));
  assert.equal(r1.queued, true, String(r1.error));
  await settle(r1.id);
  const retry = runner.backgroundFollowUp(head.id, '  Q_ID  ', opts('local_text_0', 'turn-A'));
  assert.equal(retry.id, r1.id, 'genuine retry (same turn, id, normalized message) returns the same run');
  assert.equal(retry.deduplicated, true);
  const distinct = runner.backgroundFollowUp(head.id, 'Q_ID_DISTINCT', opts('local_text_0', 'turn-A'));
  assert.equal(distinct.queued, true, String(distinct.error));
  assert.notEqual(distinct.id, r1.id, 'distinct question with a repeated local_text_0 must not alias');
  await settle(distinct.id);
  const nextTurn = runner.backgroundFollowUp(head.id, 'Q_ID_DISTINCT', opts('local_text_0', 'turn-B'));
  assert.equal(nextTurn.queued, true, String(nextTurn.error));
  assert.notEqual(nextTurn.id, distinct.id, 'repeated local_text_0 in a later turn is a new admission');
  await settle(nextTurn.id);

  const noIdA = runner.backgroundFollowUp(head.id, 'Q_NOID', opts('', 'turn-C'));
  assert.equal(noIdA.queued, true, `missing tool-call id is admitted: ${noIdA.error}`);
  await settle(noIdA.id);
  const noIdRetry = runner.backgroundFollowUp(head.id, 'Q_NOID', opts('', 'turn-C'));
  assert.equal(noIdRetry.id, noIdA.id, 'missing-id retry in the same turn dedupes');
  const noIdDistinct = runner.backgroundFollowUp(head.id, 'Q_NOID_2', opts('', 'turn-C'));
  assert.equal(noIdDistinct.queued, true, String(noIdDistinct.error));
  assert.notEqual(noIdDistinct.id, noIdA.id, 'missing-id distinct question is not aliased');
  await settle(noIdDistinct.id);
  const noTurn = runner.backgroundFollowUp(head.id, 'Q_NOTURN', opts('x', ''));
  assert.equal(noTurn.queued, false, 'no parent turn means no stable identity');

  // ── 4) parent deletion: live rounds, storage and admissions ──
  const parent2 = 'harden-parent-2';
  ceiling.recordSessionToolCeiling(parent2, ['workspace_read']);
  hold = new Promise<void>(() => { /* never released: the deleted run must not deliver */ });
  holdPrompt = 'HOLD_ROOT';
  const root2 = runner.backgroundSpawn({
    prompt: 'HOLD_ROOT: long review.', spawnerSessionId: parent2, workDir: wt, allowedWorkPaths: [wt],
    providerOverride: 'openai_codex', modelOverride: 'gpt-6.1-sol', toolCategories: [],
  });
  // Simulate a root run whose conversation index never persisted: only its envelope/live record remain.
  for (let i = 0; i < 500 && runner.backgroundStatus(root2.id)?.state !== 'in_progress'; i++) await sleep(10);
  assert.equal(runner.backgroundStatus(root2.id)?.state, 'in_progress', 'held run is live before deletion');
  fs.rmSync(convFile(root2.id), { force: true });
  const seenBeforeDelete = seen.length;
  assert.equal(sessions.deleteSession(parent2), true);
  await sleep(50);
  const rec2 = runner.backgroundStatus(root2.id);
  assert.notEqual(rec2?.state, 'completed', 'a live run never completes after its parent is deleted');
  assert.equal(rec2?.result, undefined, 'no result is retained or delivered for a deleted parent');
  assert.equal(registry.consumePendingRuntimeSteersForSession(parent2, 50).length, 0, 'no delivery to deleted parent');
  const execFile = path.join(root, 'background-executions', `${root2.id}.json`);
  assert.equal(fs.existsSync(execFile), false, 'envelope-only run snapshot removed with the parent');
  assert.equal(seen.length, seenBeforeDelete, 'deleted parent run dispatched no new model call');

  // Admission then deletion: the admitted round must not reach the model.
  holdPrompt = '';
  hold = null;
  const parent3 = 'harden-parent-3';
  ceiling.recordSessionToolCeiling(parent3, ['workspace_read']);
  const root3 = runner.backgroundSpawn({
    prompt: 'SEED_TOOL: three.', spawnerSessionId: parent3, workDir: wt, allowedWorkPaths: [wt],
    providerOverride: 'openai_codex', modelOverride: 'gpt-6.1-sol', toolCategories: [],
  });
  await runner.backgroundJoin({ backgroundId: root3.id, joinPolicy: 'wait_all' });
  const dispatchBeforeRace = seen.length;
  const raced = runner.backgroundFollowUp(root3.id, 'Q_RACE', opts('race-1', 'turn-r', parent3));
  assert.equal(raced.queued, true, String(raced.error));
  sessions.deleteSession(parent3);
  await sleep(300);
  assert.equal(seen.length, dispatchBeforeRace, 'admitted round retired by deletion never dispatches');
  assert.equal(fs.existsSync(convFile(root3.id)), false, 'deletion does not leave or resurrect conversation metadata');
  const afterDelete = runner.backgroundFollowUp(root3.id, 'Q_AFTER', opts('race-2', 'turn-r', parent3));
  assert.equal(afterDelete.queued, false);
  assert.match(String(afterDelete.error), /not found|deleted/i);

  console.log('PASS background follow-up hardening: scope recomputed at admission, identity by turn+tool id+digest, callerContext free of tool output, parent deletion retires rounds without dispatch');
}

main().then(async () => {
  sessions.flushAllSessions();
  await sessions.flushPendingSessionWrites();
  await sleep(300);
  if (!process.env.BG_HARDEN_ROOT) fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  process.exit(0);
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
