// Regression: repeated reconnects during a gateway restart stacked empty
// "Working for 3s / 7s / 10s" assistant bubbles (IMG_0509 / IMG_0510,
// mobile_mv756r24_ubnpah 2026-10-14). Recovery must reuse the trailing empty
// live row of the current request instead of pushing a new one each time.
import assert from 'node:assert/strict';
import { reuseEmptyLiveRow } from '../web-ui/src/mobile/mobile-restart-continuity.js';

const cid = 'mobile_req_1';
const user = { role: 'user', content: 'merge and deploy', _clientRequestId: cid };
const empty = (startedAt, extra = {}) => ({
  role: 'ai', streaming: false, timestamp: startedAt, workStartedAt: startedAt, workEndedAt: startedAt + 3000,
  body: { sender: '', text: '' }, content: '', processEntries: [], liveTraceEntries: [], ...extra,
});

// 1. Three frozen empty placeholders from three reconnects collapse to one.
{
  const first = empty(1000);
  const thread = [user, first, empty(5000), empty(9000)];
  const kept = reuseEmptyLiveRow(thread, cid);
  assert.equal(kept, first, 'keeps the oldest placeholder so the work timer stays truthful');
  assert.equal(thread.length, 2, 'extra empty placeholders are removed');
  assert.equal(kept.streaming, true);
  assert.equal(kept.workEndedAt, undefined);
  assert.equal(kept._clientRequestId, cid, 'request id is stamped so the next lookup finds it');
}

// 2. Never adopts an answered reply or a row behind the last user message.
{
  const answered = { role: 'ai', streaming: false, body: { text: 'Deployed.' }, content: 'Deployed.', _clientRequestId: cid };
  assert.equal(reuseEmptyLiveRow([user, answered], cid), null);
  const oldEmpty = empty(1000);
  const thread = [oldEmpty, { role: 'user', content: 'next question' }];
  assert.equal(reuseEmptyLiveRow(thread, cid), null, 'does not cross a newer user message');
  assert.equal(thread.length, 2);
}

// 3. A row that already has a trace or belongs to another request is left alone.
{
  const traced = empty(1000, { liveTraceEntries: [{ type: 'tool', text: 'workspace_run' }] });
  assert.equal(reuseEmptyLiveRow([user, traced], cid), null);
  const other = empty(1000, { _clientRequestId: 'other_req' });
  assert.equal(reuseEmptyLiveRow([user, other], cid), null);
  const final = empty(1000, { _pmFinalReceived: true });
  assert.equal(reuseEmptyLiveRow([user, final], cid), null);
}

// 4. No request id (snapshot path before run state is known) still dedupes.
{
  const thread = [user, empty(1000), empty(2000)];
  const kept = reuseEmptyLiveRow(thread, '');
  assert.ok(kept);
  assert.equal(thread.length, 2);
}

console.log('mobile reconnect empty-row reuse: 4 groups passed');
