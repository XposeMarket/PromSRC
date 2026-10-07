import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildLearningTurnRecord, recordLearningTurn, computeSkillRoutingStats, sha } from './turn-recorder';
import { appendIntradayNote, parseNotes, renderNotesForPrompt, noteFileForDate, resolveNotes } from '../memory/intraday-notes';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'learning-loop-'));

// ── Recorder: offered vs read labels ──
const request = 'fix the vita bridge reconnect bug';
const routing: any = {
  version: 2, mode: 'active', messageHash: sha(request), excluded: [], discoveryRecommended: false,
  discoveryReason: '', autoInjectedInstructions: false, instructionsRequireSkillRead: true,
  candidates: [
    { id: 'vita-dev', reason: 'strong_trigger_match', score: 80, confidence: 'high', instructionChars: 1, estimatedTokens: 1, matchedTriggers: ['vita'] },
    { id: 'capability-finder', reason: 'plausible_trigger_match', score: 46, confidence: 'medium', instructionChars: 1, estimatedTokens: 1, matchedTriggers: ['fix', 'bug'] },
  ],
};
const tools = [
  { name: 'skill_read', args: { id: 'vita-dev' } },
  { name: 'skill_list', args: { query: 'debug coding loop' } },
  { name: 'skill_read', args: { id: 'fast-coding-loop' } },
  { name: 'workspace_run', args: {}, error: true },
];
const { record } = buildLearningTurnRecord({ workspacePath: root, sessionId: 's1', executionMode: 'interactive', request, finalResponse: 'ok', toolResults: tools, routing });
assert.equal(record.routingMatched, true);
const byId = Object.fromEntries(record.labels.map((l) => [l.skillId, l.label]));
assert.equal(byId['vita-dev'], 'hit');
assert.equal(byId['capability-finder'], 'false_positive');
assert.equal(byId['fast-coding-loop'], 'miss');
assert.deepEqual(record.listedQueries, ['debug coding loop']);
assert.ok(record.signals.includes('tool_errors'));

// A stale routing report from another message must not be attributed.
const stale = buildLearningTurnRecord({ workspacePath: root, sessionId: 's1', executionMode: 'interactive', request: 'something else', finalResponse: '', toolResults: [], routing });
assert.equal(stale.record.routingMatched, false);
assert.equal(stale.record.offered.length, 0);

// Corrections become deduped candidates; plain requests do not.
const corr = 'no, I told you NebulaX is the full ecosystem. From now on check the repo first.';
recordLearningTurn({ workspacePath: root, sessionId: 's2', executionMode: 'interactive', request: corr, finalResponse: '', toolResults: [] });
recordLearningTurn({ workspacePath: root, sessionId: 's2', executionMode: 'interactive', request: corr, finalResponse: '', toolResults: [] });
recordLearningTurn({ workspacePath: root, sessionId: 's1', executionMode: 'interactive', request, finalResponse: '', toolResults: tools, routing });
const cands = fs.readFileSync(path.join(root, 'Brain', 'learning', 'candidates.jsonl'), 'utf-8').trim().split('\n');
assert.equal(cands.length, 2, 'correction + explicit instruction, deduped across repeats');
assert.equal(recordLearningTurn({ workspacePath: root, sessionId: 'brain_x', executionMode: 'x', request: 'hi', finalResponse: '', toolResults: [] }), null);

const stats = computeSkillRoutingStats(root, 7);
assert.equal(stats.turns, 3);
const cf = stats.skills.find((s) => s.skillId === 'capability-finder')!;
assert.equal(cf.falsePositives, 1);
assert.equal(cf.precision, 0);
assert.ok(stats.terms.some((t) => t.skillId === 'capability-finder' && t.term === 'bug' && t.hits === 0));

// ── Note threads: newer note supersedes older open notes on the same thread ──
const a = appendIntradayNote(root, { tag: 'task', content: 'Last Ward combat art v1', sourceLine: '_Source: test_', status: 'open', thread: 'Last Ward Combat' });
const b = appendIntradayNote(root, { tag: 'task', content: 'Last Ward combat art v2', sourceLine: '_Source: test_', status: 'open', thread: 'last-ward-combat' });
const other = appendIntradayNote(root, { tag: 'task', content: 'unrelated open item', sourceLine: '_Source: test_', status: 'open' });
assert.equal(a.thread, 'last-ward-combat');
assert.deepEqual(b.superseded, [a.id]);
const today = new Date().toISOString().slice(0, 10);
const raw = fs.readFileSync(noteFileForDate(root, today), 'utf-8');
const notes = parseNotes(raw);
assert.equal(notes.find((n) => n.id === a.id)!.status, 'done');
assert.equal(notes.find((n) => n.id === b.id)!.status, 'open');
assert.equal(notes.find((n) => n.id === other.id)!.status, 'open');
const rendered = renderNotesForPrompt(root, raw);
assert.match(rendered, /combat art v2/);
assert.match(rendered, /unrelated open item/);
assert.doesNotMatch(rendered.split('DONE TODAY')[0], /combat art v1/);

// ── Explicit resolves close notes of any age (older than the 7-day carry window) ──
const oldFile = noteFileForDate(root, '2026-01-02');
fs.writeFileSync(oldFile, '### [TASK] 2026-01-02T00:00:00.000Z #n_oldstale1 (open)\nancient open item\n', 'utf-8');
const res = resolveNotes(root, ['n_oldstale1', 'n_missing99']);
assert.deepEqual(res.resolved, ['n_oldstale1']);
assert.deepEqual(res.unresolved, ['n_missing99']);
assert.match(fs.readFileSync(oldFile, 'utf-8'), /#n_oldstale1 \(done\)/);

fs.rmSync(root, { recursive: true, force: true });
console.log('learning-loop regression: ok');
