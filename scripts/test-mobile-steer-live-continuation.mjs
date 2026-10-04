// Regression: after a steer, server merges strip the continuation's request id
// and `streaming`, so request-id lookups missed it and a new "Working for 2s"
// row was spliced ABOVE the frozen pre-steer stream while "Response after
// steer" sat on "..." (IMG_0211, 2026-10-04).
import assert from 'node:assert/strict';
import { findLiveSteerContinuation, dropOrphanLiveRows } from '../web-ui/src/mobile/mobile-restart-continuity.js';

const cid = 'req-1';
const g1 = 'chat_steer_a';
const g2 = 'chat_steer_b';
const base = () => [
  { role: 'user', content: 'do the thing', _clientRequestId: cid },
  { role: 'ai', workflowGroupId: g1, workflowPart: 'before_interruption', content: '' },
  { role: 'user', workflowGroupId: g1, workflowPart: 'interruption', content: 'steer 1' },
];

// 1. Steer row with no continuation yet: create one directly after it.
let t = base();
let row = findLiveSteerContinuation(t, cid, { create: true });
assert.ok(row, 'creates the continuation');
assert.equal(t[3], row, 'continuation sits right after the steer row');
assert.equal(row.workflowPart, 'interruption_response');
assert.equal(row.messageId, `${g1}:continuation`);
assert.equal(row._clientRequestId, cid);

// 2. Continuation without request id or streaming (server merge): still found.
t = base();
t.push({ role: 'ai', workflowGroupId: g1, workflowPart: 'interruption_response', messageId: `${g1}:continuation`, content: '' });
row = findLiveSteerContinuation(t, cid);
assert.equal(row, t[3], 'stripped continuation is reused');
assert.equal(row._clientRequestId, cid, 'request id re-adopted');

// 3. Stray empty live row after it (the old duplicate) is skipped and dropped.
t.push({ role: 'ai', streaming: true, content: '', processEntries: [] });
row = findLiveSteerContinuation(t, cid);
assert.equal(row, t[3]);
assert.equal(dropOrphanLiveRows(t, row), 1);
assert.equal(t.length, 4);

// 4. Second steer: the first continuation becomes a before-row, the newest wins.
t = base();
t.push({ role: 'ai', workflowGroupId: g2, workflowPart: 'before_interruption', messageId: `${g1}:continuation` });
t.push({ role: 'user', workflowGroupId: g2, workflowPart: 'interruption', content: 'steer 2' });
row = findLiveSteerContinuation(t, cid, { create: true });
assert.equal(row.messageId, `${g2}:continuation`, 'targets the newest steer');
assert.equal(t[t.length - 1], row);

// 5. Never claims rows across a normal user turn, a finished reply, or another request.
assert.equal(findLiveSteerContinuation([{ role: 'user', content: 'hi' }, { role: 'ai', content: 'done' }], cid), null);
t = base();
t.push({ role: 'ai', workflowGroupId: g1, workflowPart: 'interruption_response', _pmFinalReceived: true, content: 'final' });
assert.equal(findLiveSteerContinuation(t, cid), null, 'finished continuation is not revived');
t = base();
t.push({ role: 'ai', workflowGroupId: g1, workflowPart: 'interruption_response', _clientRequestId: 'other' });
assert.equal(findLiveSteerContinuation(t, cid), null, 'other request is not claimed');
assert.equal(findLiveSteerContinuation(base(), cid), null, 'no create without the flag');

console.log('mobile steer live continuation: ok');
