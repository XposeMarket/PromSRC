// Regression: OpenAI Dots (one ongoing chat per dot). Fake chatgpt.com backend,
// fixture sign-in, isolated data dir. Never contacts OpenAI or reads a real token.
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-dots-'));
process.env.PROMETHEUS_DATA_DIR = path.join(root, 'data');
process.env.PROMETHEUS_APP_DATA_DIR = path.join(root, 'data');
process.env.PROMETHEUS_WORKSPACE_DIR = path.join(root, 'workspace');
process.env.PROMETHEUS_DISABLE_DOTS_POLL = '1';
fs.mkdirSync(process.env.PROMETHEUS_DATA_DIR, { recursive: true });
fs.mkdirSync(process.env.PROMETHEUS_WORKSPACE_DIR, { recursive: true });

const ROOM = '6ac838f1ad10819ba014c9bfa9e2a0d5';
const DOT_AUTHOR = 'calpico-member-35613763';
let seq = 0;
const room: any[] = [];
const sends: any[] = [];
function msg(author: string, text: string, extra: any = {}) {
  seq += 1;
  return { id: `${ROOM}~CalpicoMessage~Sentinel_${String(seq).padStart(4, '0')}`, created_at: new Date(Date.UTC(2026, 10, 18, 12, 0, seq)).toISOString(), role: 'user', account_user_id: author, content: { text, attachments: [] }, deleted_at: null, ...extra };
}
room.push(msg(DOT_AUTHOR, 'Update: #894 is green.', { message_metadata: { turn_trigger: 'parent_notification' } }));
room.push(msg('user-raul', 'thanks'));

(globalThis as any).fetch = async (url: string, init: any = {}) => {
  const u = new URL(url);
  assert.equal(u.origin, 'https://chatgpt.com');
  assert.match(String(init.headers?.authorization || init.headers?.Authorization || ''), /Bearer fixture-token/);
  const json = (body: any, status = 200) => ({ ok: status < 400, status, text: async () => JSON.stringify(body) });
  if (u.pathname === '/backend-api/tbo') {
    return json({ items: [{ id: 'dot-1', display_name: 'tbo', messaging_room_id: ROOM, is_primary: true, status: 'active' }, { id: 'gone', display_name: 'old', messaging_room_id: 'abcdefgh1234', status: 'deleted' }] });
  }
  if (u.pathname === `/backend-api/messaging/rooms/${ROOM}/messages` && (init.method || 'GET') === 'GET') {
    const limit = Number(u.searchParams.get('limit') || 30);
    if (limit > 32) return json({ detail: [{ type: 'less_than_equal', ctx: { le: 32 } }] }, 422);
    return json({ items: room.slice(-limit), next_cursor: null });
  }
  if (u.pathname === `/backend-api/messaging/rooms/${ROOM}/messages` && init.method === 'POST') {
    const body = JSON.parse(init.body);
    sends.push(body);
    assert.equal(body.request_id, body.idempotency_token);
    const mine = msg('user-raul', body.content.text, { request_id: body.request_id });
    room.push(mine);
    // The dot answers in two messages a moment later.
    setTimeout(() => { room.push(msg(DOT_AUTHOR, 'On it.', { message_metadata: { turn_trigger: 'chatgpt_messaging' } })); }, 30);
    setTimeout(() => { room.push(msg(DOT_AUTHOR, 'Done: PR #899 rebased.', { message_metadata: { turn_trigger: 'chatgpt_messaging' } })); }, 60);
    return json({ message: mine });
  }
  return json({ detail: 'not found' }, 404);
};

(async () => {
  const api = require('./dots-api') as typeof import('./dots-api');
  const sync = require('./dots-sync') as typeof import('./dots-sync');
  const store = require('../external-agents/store') as typeof import('../external-agents/store');
  const registry = require('../external-agents/registry') as typeof import('../external-agents/registry');
  const runner = require('../external-agents/turn-runner') as typeof import('../external-agents/turn-runner');
  const session = require('../session') as typeof import('../session');
  const { OpenAIDotsAdapter, DOT_PENDING_TEXT } = require('../external-agents/adapters/openai-dots') as typeof import('../external-agents/adapters/openai-dots');

  // Parsing.
  assert.equal(api.parseDot({ id: 'x', messaging_room_id: 'bad room!' }), null);
  const parsed = api.parseDotMessage({ id: 'm', created_at: '2026-11-18T03:12:34Z', account_user_id: 'calpico-member-1', content: { text: '', attachments: [{}] } });
  assert.equal(parsed?.fromDot, true);
  assert.match(parsed?.text || '', /1 attachment, open ChatGPT to view/);
  assert.equal(api.parseDotMessage({ id: 'm', deleted_at: 'x', content: { text: 'hi' } }), null);

  // Signed out: detect is false, verify says sign in. Sync is a no-op while off.
  const adapter = new OpenAIDotsAdapter({ pollMs: 20, quietMs: 120, replyWaitMs: 3_000 });
  assert.equal((await adapter.detect()).found, false);
  assert.equal((await adapter.verify()).status, 'signed_out');
  assert.deepEqual(await sync.syncAllDots(true), { dots: 0, added: 0, sessions: [] });

  api.setDotsAuthForTests(async () => ({ accessToken: 'fixture-token', accountId: 'acct-fixture' }));
  registry.setExternalAgentAdapterForTests(adapter, 'openai-dots');
  const snap = await registry.enableExternalAgent('openai-dots');
  assert.equal(snap?.status, 'ready');
  assert.equal(snap?.kind, 'contact');
  assert.match(snap?.statusText || '', /tbo/);

  // First sync: one chat per dot (deleted dots skipped), history imported, left read.
  const first = await sync.syncAllDots(true);
  const sid = sync.dotSessionId(ROOM);
  assert.deepEqual(first, { dots: 1, added: 2, sessions: [sid] });
  let s = session.getSession(sid);
  assert.equal(s.title, 'Tbo');
  assert.equal(sync.dotTitle('dot'), 'Dot');
  assert.equal(sync.dotTitle('Your dot'), 'Dot');
  assert.equal(sync.dotTitle(''), 'Dot');
  assert.equal(s.history.length, 2);
  assert.equal(s.history[0].role, 'assistant');
  assert.equal((s.history[0] as any).dotInitiated, true);
  assert.equal(s.history[1].role, 'user');
  assert.equal(session.getSessionExternalAgent(sid)?.agentId, 'openai-dots');
  assert.equal(session.getSessionExternalAgent(sid)?.upstreamSessionId, ROOM);

  // Nothing new: nothing added. Older history showing up in a wider page is never appended out of order.
  assert.equal((await sync.syncAllDots(true)).added, 0);
  room.unshift({ ...msg(DOT_AUTHOR, 'ancient history'), created_at: '2026-11-01T00:00:00.000Z' });
  assert.equal((await sync.syncAllDots(true)).added, 0);
  // The dot posts on its own: mirrored once.
  room.push(msg(DOT_AUTHOR, 'Heads up: Topstep email.', { message_metadata: { turn_trigger: 'parent_notification' } }));
  assert.equal((await sync.syncAllDots(true)).added, 1);
  assert.equal(session.getSession(sid).history.length, 3);

  // A dot can't be picked for a NEW chat.
  const refused = runner.bindExternalAgentForRequest('web_new_chat_fixture', { id: 'openai-dots' });
  assert.equal(refused.ok, false);
  assert.equal((refused as any).code, 'agent_unavailable');

  // A turn: sends once as the user, collects BOTH reply messages, no duplicates on the next sync.
  const sse: Array<[string, any]> = [];
  const out = await runner.runExternalAgentTurn({ sessionId: sid, message: 'rebase 899 pls', sendSSE: (e, d) => { sse.push([e, d]); } }, session.getSessionExternalAgent(sid)!);
  assert.equal(out.externalAgent.status, 'completed');
  assert.equal(sends.length, 1);
  assert.equal(sends[0].content.text, 'rebase 899 pls');
  assert.equal(out.text, 'On it.\n\nDone: PR #899 rebased.');
  assert.ok(sse.some(([e, d]) => e === 'token' && /Done/.test(d.text)));
  s = session.getSession(sid);
  assert.equal(s.history.length, 5);
  assert.equal(s.history[3].content, 'rebase 899 pls');
  assert.equal((await sync.syncAllDots(true)).added, 0);
  assert.equal(session.getSession(sid).history.length, 5);

  // No reply within the wait: honest pending text, the late reply arrives via sync.
  const quiet = new OpenAIDotsAdapter({ pollMs: 5, quietMs: 50, replyWaitMs: 1 });
  registry.setExternalAgentAdapterForTests(quiet, 'openai-dots');
  const late = await runner.runExternalAgentTurn({ sessionId: sid, message: 'ping', sendSSE: () => undefined }, session.getSessionExternalAgent(sid)!);
  assert.equal(late.text, DOT_PENDING_TEXT);
  await new Promise((r) => setTimeout(r, 120));
  assert.equal((await sync.syncAllDots(true)).added, 2);

  // Off: sync stops; the chat stays.
  await registry.disableExternalAgent('openai-dots');
  assert.deepEqual(await sync.syncAllDots(true), { dots: 0, added: 0, sessions: [] });
  assert.ok(session.getSession(sid).history.length >= 7);
  void store;

  console.log('dots regression: ok (fake chatgpt.com backend, fixture sign-in)');
  process.exit(0);
})().catch((error) => { console.error(error); process.exit(1); });
