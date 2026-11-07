#!/usr/bin/env node
// Regression: shared Tasks live-run-card view-model (desktop + mobile).
import assert from 'node:assert/strict';
import {
  cleanTaskTitle, dispatchedMessage, rawInstructions, taskKind, statusTone, progressSummary,
  isLikelyStalled, attentionText, actorLabel, collapseActivity, buildTaskCard, detailSections, taskAvatar,
} from '../web-ui/src/features/tasks/task-card-view-model.js';

const NOW = 10_000_000_000;

// ── Title cleaning ──
const envelope = '[TEAM DISPATCH]\nFrom manager.\nYOUR TASK:\nWrite the weekly digest for the newsroom\n\nCONSTRAINTS:\n- be brief';
assert.equal(cleanTaskTitle({ title: 'Ledger: [TEAM DISPATCH] YOUR TASK: Write the weekly digest', prompt: envelope }), 'Write the weekly digest for the newsroom');
assert.equal(cleanTaskTitle({ title: envelope }), 'Write the weekly digest for the newsroom');
assert.ok(!/TEAM DISPATCH|YOUR TASK/.test(cleanTaskTitle({ title: '[TEAM DISPATCH] YOUR TASK: Fix the build' })));
assert.equal(cleanTaskTitle({ title: 'Plain title' }), 'Plain title');
assert.equal(cleanTaskTitle({}), 'Untitled task');
assert.equal(dispatchedMessage({ prompt: envelope }), 'Write the weekly digest for the newsroom');
assert.equal(dispatchedMessage({ originalAssignment: 'Raw job', prompt: envelope }), 'Raw job');
assert.equal(dispatchedMessage({ prompt: 'Header\nMessage:\nHello there\n\nCONSTRAINTS: none' }), 'Hello there');
assert.equal(rawInstructions({ originalAssignment: 'Raw job', prompt: envelope }), envelope);
assert.equal(rawInstructions({ prompt: 'same' }), '');
console.log('PASS title cleaning + dispatched message');

// ── Kinds, tones, actor ──
assert.equal(taskKind({ sourceKind: 'planned_chat' }), 'plan');
assert.equal(taskKind({ scheduleId: 'j1' }), 'scheduled');
assert.equal(taskKind({ teamSubagent: { teamId: 't', agentId: 'a' } }), 'team');
assert.equal(taskKind({ brainJob: 'dream' }), 'brain');
assert.equal(taskKind({}), 'background');
assert.equal(statusTone('running'), 'run');
assert.equal(statusTone('complete'), 'ok');
assert.equal(statusTone('completed'), 'ok');
assert.equal(statusTone('failed'), 'bad');
assert.equal(statusTone('needs_assistance'), 'warn');
assert.equal(statusTone('awaiting_user_input'), 'warn');
assert.equal(statusTone('stalled'), 'warn');
assert.equal(statusTone('interrupted'), 'warn');
assert.equal(statusTone('paused'), 'muted');
assert.equal(statusTone('queued'), 'muted');
assert.equal(actorLabel({ sourceKind: 'planned_chat' }).actor, 'Prometheus plan');
assert.equal(actorLabel({ teamSubagent: { teamId: 't', agentName: 'Ledger' }, teamName: 'Meridian Newsroom' }).actor, 'Ledger · Meridian Newsroom');
assert.equal(actorLabel({ scheduleId: 'j', title: 'Merge Steward' }).actor, 'Scheduled · Merge Steward');
assert.equal(actorLabel({}).actor, 'Background task');
console.log('PASS kinds, tones, actor labels');

// ── Progress + durations ──
const p = progressSummary({ status: 'running', startedAt: 1000, plan: [
  { description: 'A', status: 'done', completedAt: 4000 },
  { description: 'B', status: 'running' },
  { description: 'C', status: 'pending' },
] });
assert.equal(p.done, 1); assert.equal(p.total, 3); assert.equal(p.current, 1); assert.equal(p.currentText, 'B');
assert.equal(p.items[0].durationMs, 3000);
assert.deepEqual(p.items.map(i => i.state), ['done', 'current', 'pending']);
const rp = progressSummary({ status: 'running', runtimeProgress: { items: [{ text: 'x', status: 'completed', startedAt: 10, completedAt: 70 }, { text: 'y', status: 'in_progress', startedAt: 70 }] } });
assert.equal(rp.items[0].durationMs, 60); assert.equal(rp.items[1].state, 'current');
assert.equal(progressSummary({}).total, 0, 'old records without plan/progress');
console.log('PASS progress summary + durations');

// ── Stall detection ──
assert.equal(isLikelyStalled({ status: 'running', lastProgressAt: NOW - 31 * 60_000 }, NOW), true);
assert.equal(isLikelyStalled({ status: 'running', lastProgressAt: NOW - 5 * 60_000 }, NOW), false);
assert.equal(isLikelyStalled({ status: 'paused', lastProgressAt: 0 }, NOW), false);
assert.equal(isLikelyStalled({ status: 'running' }, NOW), false, 'no timestamps -> not stalled');
const stalledCard = buildTaskCard({ id: 's', status: 'running', title: 't', lastProgressAt: NOW - 2 * 3600_000, startedAt: NOW - 3 * 3600_000 }, NOW);
assert.equal(stalledCard.tone, 'warn'); assert.ok(stalledCard.stalledFor.startsWith('2h'));
console.log('PASS stall detection');

// ── Attention priority ──
const full = {
  status: 'paused', pendingClarificationQuestion: 'Which repo?', pauseAnalysis: { message: 'Pause msg' },
  recoveryConversation: [{ role: 'assistant', content: 'Recovery msg' }, { role: 'user', content: 'ok' }], finalSummary: 'Final',
};
assert.equal(attentionText(full), 'Which repo?');
assert.equal(attentionText({ ...full, pendingClarificationQuestion: '' }), 'Pause msg');
assert.equal(attentionText({ ...full, pendingClarificationQuestion: '', pauseAnalysis: null }), 'Recovery msg');
assert.equal(attentionText({ status: 'failed', finalSummary: 'Boom' }), 'Boom');
assert.equal(attentionText({ status: 'paused', attentionMessage: 'From list row' }), 'From list row');
assert.equal(attentionText({ status: 'paused', pauseReason: 'user_pause' }), 'Paused by you.');
assert.equal(attentionText({ status: 'running', pauseAnalysis: { message: 'x' } }), '');
assert.equal(attentionText({ status: 'complete', finalSummary: 'done' }), '');
assert.ok(attentionText({ status: 'paused', pauseAnalysis: { message: 'x'.repeat(900) } }).length <= 320);
console.log('PASS attention priority');

// ── Activity collapse ──
const rows = collapseActivity({ journal: [
  { t: 1, type: 'status_push', content: 'Processing…' },
  { t: 2, type: 'status_push', content: 'Processing…' },
  { t: 3, type: 'tool_call', content: 'web_search("x")' },
  { t: 4, type: 'tool_result', content: 'web_search: 5 results' },
  { t: 5, type: 'status_push', content: 'Wrote draft' },
  { t: 6, type: 'status_push', content: 'Wrote draft' },
  { t: 7, type: 'error', content: 'File missing' },
  { t: 8, type: 'tool_call', content: 'read_file a.md' },
] });
assert.deepEqual(rows.map(r => r.type), ['hidden', 'tool', 'status', 'status', 'error', 'tool']);
assert.equal(rows[0].count, 2);
assert.equal(rows[1].name, 'web_search'); assert.ok(rows[1].result.includes('5 results'));
assert.equal(rows[3].text, 'Wrote draft', 'lone duplicate status renders inline, not as "Hiding 1"');
assert.equal(rows[5].pending, true);
const planned = collapseActivity({ activity: [
  { t: 1, kind: 'tool', name: 'workspace_read', detail: '{"path":"a"}' },
  { t: 2, kind: 'error', name: 'workspace_read', detail: 'ENOENT' },
] });
assert.equal(planned.length, 1); assert.equal(planned[0].error, true);
assert.deepEqual(collapseActivity({}), [], 'old records without activity/journal');
// single status row renders inline; 3 consecutive folded rows become one "Hiding 3"
const single = collapseActivity({ journal: [
  { t: 1, type: 'tool_call', content: 'read_file a' },
  { t: 2, type: 'status_push', content: 'Processing…' },
  { t: 3, type: 'tool_call', content: 'read_file b' },
] });
assert.deepEqual(single.map(r => r.type), ['tool', 'status', 'tool']);
assert.equal(single[1].text, 'Processing…');
const triple = collapseActivity({ journal: [
  { t: 1, type: 'status_push', content: 'Processing…' },
  { t: 2, type: 'status_push', content: 'Thinking' },
  { t: 3, type: 'status_push', content: 'Working…' },
] });
assert.deepEqual(triple.map(r => [r.type, r.count]), [['hidden', 3]]);
console.log('PASS activity pairing + noise collapse');

// ── Detail model + old records ──
const oldRecord = { id: 'old', status: 'needs_assistance', title: 'Old task', prompt: 'Do it' };
const d = detailSections(oldRecord);
assert.equal(d.startedFrom, 'Do it'); assert.equal(d.canMessage, true); assert.equal(d.openChat, false);
const runningDetail = detailSections({ id: 'r', status: 'running', title: 'R' });
assert.equal(runningDetail.canMessage, true, 'composer available while running');
assert.equal(detailSections({ id: 'c', status: 'complete', finalSummary: 'Result!' }).result, 'Result!');
const plan = detailSections({ id: 'chat-plan:x', sourceKind: 'planned_chat', status: 'running', title: 'P', originalAssignment: 'user msg', lastToolCall: { name: 'web_fetch' } });
assert.equal(plan.openChat, true); assert.equal(plan.canMessage, false); assert.equal(plan.startedFrom, 'user msg');
assert.equal(plan.card.tool, 'web_fetch');
// ── Failed-task recovery composer ──
assert.equal(detailSections({ id: 'f', status: 'failed', title: 'F', finalSummary: 'Boom' }).canMessage, true, 'failed task is messageable for recovery');
assert.equal(detailSections({ id: 'c2', status: 'complete', title: 'C' }).canMessage, false, 'complete task has no composer');
assert.equal(detailSections({ id: 'x', status: 'cancelled', title: 'X' }).canMessage, false, 'cancelled task has no composer');
assert.equal(detailSections({ id: 'chat-plan:f', sourceKind: 'planned_chat', status: 'failed', title: 'PF' }).canMessage, false, 'planned chat failed -> Open chat, no composer');
assert.equal(detailSections({ id: 'p', status: 'paused', title: 'P' }).canMessage, true, 'paused task is messageable');
console.log('PASS failed-task recovery composer');

console.log('PASS detail sections + old record compatibility');
// ── Provider-logo avatar (shared desktop + mobile) ──
assert.deepEqual(taskAvatar({ modelRef: { providerId: 'anthropic', model: 'claude-opus-5-5', source: 'session' } }),
  { providerId: 'anthropic', model: 'claude-opus-5-5', logoKey: 'anthropic', modelSource: 'session' });
assert.equal(taskAvatar({ modelRef: { providerId: 'openai_codex', model: 'gpt-6.1-sol' } }).logoKey, 'openai', 'codex alias -> openai logo');
assert.equal(taskAvatar({ modelRef: { providerId: 'xai', model: 'grok-4.3' } }).logoKey, 'xai');
assert.equal(taskAvatar({ modelRef: { providerId: '', model: 'claude-haiku-5-5' } }).logoKey, 'anthropic', 'model-only ref still maps');
assert.equal(taskAvatar({}).logoKey, '', 'no modelRef -> unknown');
assert.equal(taskAvatar({ modelRef: { providerId: 'ollama', model: 'qwen3:4b' } }).logoKey, '', 'unbranded provider -> initials fallback');
const logoCard = buildTaskCard({ id: 'sch', scheduleId: 'j', title: 'Merge Steward', status: 'running', modelRef: { providerId: 'openai_codex', model: 'gpt-6.1-sol' } }, NOW);
assert.equal(logoCard.avatar.logoKey, 'openai');
assert.equal(logoCard.actor, 'Scheduled · Merge Steward', 'kind stays visible in the actor label');
assert.equal(logoCard.initials, 'S', 'initials kept as the unknown-provider fallback');
assert.equal(buildTaskCard({ id: 'bg', status: 'running' }, NOW).avatar.logoKey, '');
console.log('PASS provider-logo avatar');

console.log('All task-card view-model tests passed');
