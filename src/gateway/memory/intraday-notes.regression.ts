import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { appendIntradayNote, noteFileForDate, parseNotes, renderNotesForPrompt } from './intraday-notes';

const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-reg-'));
fs.mkdirSync(path.join(ws, 'memory'), { recursive: true });
const src = '_Source: test_';
const today = new Date().toISOString().split('T')[0];
const yesterday = new Date(Date.now() - 86_400_000).toISOString().split('T')[0];

// Legacy entries without id/status still parse as info.
fs.writeFileSync(noteFileForDate(ws, yesterday), [
  '### [DEBUG] 2026-01-01T00:00:00.000Z',
  src,
  'legacy context note',
  '',
  `### [TASK] ${new Date(Date.now() - 86_400_000).toISOString()} #n_carry1 (open)`,
  src,
  'CARRIED open bug from yesterday: browser click false success',
  '',
].join('\n'));
assert.equal(parseNotes(fs.readFileSync(noteFileForDate(ws, yesterday), 'utf-8'))[0].status, 'info');

// Full text: a long note is not cut to a preview.
const long = `LONG ${'x'.repeat(900)} END_MARKER`;
const a = appendIntradayNote(ws, { tag: 'task', content: long, sourceLine: src, status: 'info' });
const b = appendIntradayNote(ws, { tag: 'debug', content: 'switch_model ignores fast tier', sourceLine: src, status: 'open' });
assert.match(a.id, /^n_/);
assert.equal(b.status, 'open');

// Dedupe: an identical body within the window is not rewritten.
const dup = appendIntradayNote(ws, { tag: 'debug', content: 'switch_model   ignores fast tier', sourceLine: src, status: 'open' });
assert.equal(dup.deduped, true);
assert.equal(dup.id, b.id);
assert.equal(parseNotes(fs.readFileSync(noteFileForDate(ws, today), 'utf-8')).length, 2);

let prompt = renderNotesForPrompt(ws, fs.readFileSync(noteFileForDate(ws, today), 'utf-8'));
assert.ok(prompt.includes('END_MARKER'), 'full note body must be injected, not a 250-char preview');
assert.ok(prompt.includes('CARRIED open bug'), 'open items from earlier days carry forward');
assert.ok(!prompt.includes('legacy context note'), 'only open items carry from earlier days');
assert.ok(prompt.indexOf('OPEN ITEMS') < prompt.indexOf('NOTES (newest first)'));

// Resolving: done note flips both today's and yesterday's open items.
const fix = appendIntradayNote(ws, { tag: 'task', content: 'Fixed both in PR #999', sourceLine: src, status: 'done', resolves: [b.id, '#n_carry1'.replace('#', ''), 'n_missing'] });
assert.deepEqual(fix.resolved.sort(), [b.id, 'n_carry1'].sort());
assert.deepEqual(fix.unresolved, ['n_missing']);
prompt = renderNotesForPrompt(ws, fs.readFileSync(noteFileForDate(ws, today), 'utf-8'));
assert.ok(!prompt.includes('CARRIED open bug'), 'resolved carried item leaves the prompt');
assert.ok(!/OPEN ITEMS/.test(prompt));
assert.ok(prompt.includes('DONE TODAY'));

// Budget: never exceeds the cap by more than one header line.
for (let i = 0; i < 40; i += 1) appendIntradayNote(ws, { tag: 'task', content: `bulk ${i} ${'y'.repeat(600)}`, sourceLine: src });
prompt = renderNotesForPrompt(ws, fs.readFileSync(noteFileForDate(ws, today), 'utf-8'), { budgetChars: 5_000 });
assert.ok(prompt.length < 5_600, `budget respected (${prompt.length})`);
assert.ok(prompt.includes('omitted for budget'));
assert.ok(prompt.includes('bulk 39'), 'newest first');

fs.rmSync(ws, { recursive: true, force: true });
console.log('intraday notes regression passed');
