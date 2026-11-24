// Regression: OpenAI Dots (one ongoing chat per dot). Fake chatgpt.com backend,
// fixture sign-in, isolated data dir. Never contacts OpenAI or reads a real token.
import assert from 'node:assert/strict';
import crypto from 'crypto';
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
/** Fault switches for the fake backend. */
const flags = { dropPostAnswer: false, getStatus: 0, postStatus: 0, rejectOnce: 0, edgeBlock: false, htmlRejectStatus: 0, htmlRejectCount: 0 };
let forcedRefreshes = 0;
/** Fake message times sit in the recent past of the real clock, as real ones do. */
const T0 = Date.now() - 6 * 60 * 60_000;
function msg(author: string, text: string, extra: any = {}) {
  seq += 1;
  return { id: `${ROOM}~CalpicoMessage~Sentinel_${String(seq).padStart(4, '0')}`, created_at: new Date(T0 + seq * 1000).toISOString(), role: 'user', account_user_id: author, content: { text, attachments: [] }, deleted_at: null, ...extra };
}
room.push(msg(DOT_AUTHOR, 'Update: #894 is green.', { message_metadata: { turn_trigger: 'parent_notification' } }));
room.push(msg('user-raul', 'thanks'));

(globalThis as any).fetch = async (url: string, init: any = {}) => {
  const u = new URL(url);
  assert.equal(u.origin, 'https://chatgpt.com');
  assert.match(String(init.headers?.authorization || init.headers?.Authorization || ''), /Bearer fixture-token/);
  const json = (body: any, status = 200) => ({ ok: status < 400, status, text: async () => JSON.stringify(body) });
  if (flags.getStatus && (init.method || 'GET') === 'GET') return json({ detail: 'fault' }, flags.getStatus);
  // ChatGPT rejects a token before its stated expiry, once.
  if (flags.rejectOnce > 0 && (init.method || 'GET') === 'GET') { flags.rejectOnce -= 1; return json({ detail: 'token expired' }, 401); }
  // A rejection that happens to come back as an HTML page, with no Cloudflare challenge in it.
  if (flags.htmlRejectCount > 0 && (init.method || 'GET') === 'GET') { flags.htmlRejectCount -= 1; return { ok: false, status: flags.htmlRejectStatus, headers: { get: (name: string) => (name === 'content-type' ? 'text/html' : null) }, text: async () => '<html><body>Unauthorized</body></html>' }; }
  // Cloudflare's bot check: 403 with an HTML page.
  if (flags.edgeBlock) return { ok: false, status: 403, headers: { get: (name: string) => (name === 'content-type' ? 'text/html; charset=UTF-8' : name === 'cf-mitigated' ? 'challenge' : null) }, text: async () => '<!DOCTYPE html><html><title>Just a moment...</title></html>' };
  if (u.pathname === '/backend-api/tbo') {
    return json({ items: [{ id: 'dot-1', display_name: 'tbo', messaging_room_id: ROOM, is_primary: true, status: 'active' }, { id: 'gone', display_name: 'old', messaging_room_id: 'abcdefgh1234', status: 'deleted' }] });
  }
  if (u.pathname === `/backend-api/messaging/rooms/${ROOM}/messages` && (init.method || 'GET') === 'GET') {
    const limit = Number(u.searchParams.get('limit') || 30);
    if (limit > 32) return json({ detail: [{ type: 'less_than_equal', ctx: { le: 32 } }] }, 422);
    return json({ items: room.slice(-limit), next_cursor: null });
  }
  if (u.pathname === `/backend-api/messaging/rooms/${ROOM}/messages` && init.method === 'POST') {
    if (flags.postStatus) return json({ detail: 'refused' }, flags.postStatus);
    const body = JSON.parse(init.body);
    sends.push(body);
    assert.equal(body.request_id, body.idempotency_token);
    const mine = msg('user-raul', body.content.text, { request_id: body.request_id });
    room.push(mine);
    // The dot answers in two messages a moment later.
    setTimeout(() => { room.push(msg(DOT_AUTHOR, 'On it.', { message_metadata: { turn_trigger: 'chatgpt_messaging' } })); }, 30);
    setTimeout(() => { room.push(msg(DOT_AUTHOR, 'Done: PR #899 rebased.', { message_metadata: { turn_trigger: 'chatgpt_messaging' } })); }, 60);
    // The message was accepted, but the answer never reaches Prometheus.
    if (flags.dropPostAnswer) { flags.dropPostAnswer = false; throw new Error('socket hang up'); }
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
  const { OpenAIDotsAdapter, DOT_PENDING_TEXT, DOT_ALREADY_TEXT, DOT_UNCHECKED_TEXT } = require('../external-agents/adapters/openai-dots') as typeof import('../external-agents/adapters/openai-dots');

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

  const fixtureAuth = async ({ force }: { force: boolean }) => { if (force) forcedRefreshes += 1; return { accessToken: 'fixture-token', accountId: 'acct-fixture' }; };
  api.setDotsAuthForTests(fixtureAuth);
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

  // A dot post that arrived before a turn is still mirrored afterwards (matched by id, not by time).
  registry.setExternalAgentAdapterForTests(adapter, 'openai-dots');
  room.push(msg(DOT_AUTHOR, 'FYI: build finished.', { message_metadata: { turn_trigger: 'parent_notification' } }));
  await runner.runExternalAgentTurn({ sessionId: sid, message: 'ok thanks', sendSSE: () => undefined }, session.getSessionExternalAgent(sid)!);
  assert.equal((await sync.syncAllDots(true)).added, 1, 'the earlier dot post is not skipped');
  assert.ok(session.getSession(sid).history.some((m: any) => m.content === 'FYI: build finished.'));

  // A dot is someone else's agent: a dot chat filed in a project still sends only the user's words.
  const projects = require('../projects/project-store') as typeof import('../projects/project-store');
  const dotProject = projects.createProject('Dot project');
  projects.updateProject(dotProject.id, { instructions: 'Always use pnpm.' } as any);
  projects.attachSessionToProject(dotProject.id, sid);
  assert.ok(projects.buildHarnessProjectContext(sid), 'the project has context a harness chat would get');
  await runner.runExternalAgentTurn({ sessionId: sid, message: 'plain words', sendSSE: () => undefined }, session.getSessionExternalAgent(sid)!);
  assert.match(JSON.stringify(sends[sends.length - 1]), /plain words/);
  assert.doesNotMatch(JSON.stringify(sends[sends.length - 1]), /Project context from Prometheus|pnpm/);
  await sync.syncAllDots(true);

  // A send whose answer was lost is not posted twice when the same message is sent again.
  flags.dropPostAnswer = true;
  const dropped = await runner.runExternalAgentTurn({ sessionId: sid, message: 'dup check', sendSSE: () => undefined }, session.getSessionExternalAgent(sid)!);
  assert.equal(dropped.externalAgent.status, 'failed');
  const retried = await runner.runExternalAgentTurn({ sessionId: sid, message: 'dup check', sendSSE: () => undefined }, session.getSessionExternalAgent(sid)!);
  assert.equal(retried.externalAgent.status, 'completed');
  assert.equal(sends.filter((body) => body.content.text === 'dup check').length, 1, 'the retry reuses the first send');
  assert.equal(room.filter((m) => m.content.text === 'dup check').length, 1);
  assert.match(retried.text, /Done: PR #899 rebased\./);
  // The user's own message never comes back as a ChatGPT message.
  assert.equal((await sync.syncAllDots(true)).added, 0);
  assert.equal(session.getSession(sid).history.filter((m: any) => m.content === 'dup check' && m.channelLabel === 'ChatGPT').length, 0);

  // Replies the sync mirrored while a send was unanswered are not shown a second time by the retry.
  flags.dropPostAnswer = true;
  const dropped2 = await runner.runExternalAgentTurn({ sessionId: sid, message: 'dup check two', sendSSE: () => undefined }, session.getSessionExternalAgent(sid)!);
  assert.equal(dropped2.externalAgent.status, 'failed');
  await new Promise((r) => setTimeout(r, 150));
  assert.equal((await sync.syncAllDots(true)).added, 2, 'the sync shows the reply while the send is still unanswered');
  const retried2 = await runner.runExternalAgentTurn({ sessionId: sid, message: 'dup check two', sendSSE: () => undefined }, session.getSessionExternalAgent(sid)!);
  assert.equal(sends.filter((body) => body.content.text === 'dup check two').length, 1);
  assert.equal(retried2.text, DOT_ALREADY_TEXT);
  assert.equal((await sync.syncAllDots(true)).added, 0);

  const run = (message: string) => runner.runExternalAgentTurn({ sessionId: sid, message, sendSSE: () => undefined }, session.getSessionExternalAgent(sid)!);
  const posted = (text: string) => sends.filter((body) => body.content.text === text).length;
  const settle = async () => { await new Promise((r) => setTimeout(r, 150)); await sync.syncAllDots(true); };

  // A retry long after the lost answer is still not posted twice: an unanswered send has no time limit.
  flags.dropPostAnswer = true;
  assert.equal((await run('late retry')).externalAgent.status, 'failed');
  const stale = sync.getUncertainSends(ROOM).find((entry) => !entry.landedAt)!;
  sync.addUncertainSend(ROOM, { ...stale, at: Date.now() - 3 * 60 * 60_000 });
  assert.equal((await run('late retry')).externalAgent.status, 'completed');
  assert.equal(posted('late retry'), 1, 'a retry hours later reuses the first send');
  assert.equal(sync.getUncertainSends(ROOM).length, 0);
  await settle();

  // Something else sent in between does not forget the unanswered send.
  flags.dropPostAnswer = true;
  assert.equal((await run('first words')).externalAgent.status, 'failed');
  assert.equal((await run('other words')).externalAgent.status, 'completed');
  assert.equal(sync.getUncertainSends(ROOM).length, 1, 'the unanswered send is still remembered');
  assert.equal((await run('first words')).externalAgent.status, 'completed');
  assert.equal(posted('first words'), 1, 'sending something else in between does not make the retry post again');
  assert.equal(posted('other words'), 1);
  await settle();

  // The sync finds that an unanswered send did arrive and says so once. The same words sent again are
  // answered without posting; sent once more they are a deliberate repeat and go out.
  flags.dropPostAnswer = true;
  assert.equal((await run('noted words')).externalAgent.status, 'failed');
  await settle();
  assert.ok(session.getSession(sid).history.some((m: any) => m.content === sync.dotLandedText('noted words')), 'the chat says the message did arrive');
  assert.equal((await sync.syncAllDots(true)).added, 0, 'said once');
  assert.equal(session.getSession(sid).history.filter((m: any) => m.content === sync.dotLandedText('noted words')).length, 1);
  const noted = await run('noted words');
  assert.equal(noted.text, DOT_ALREADY_TEXT);
  assert.equal(posted('noted words'), 1);
  await run('noted words');
  assert.equal(posted('noted words'), 2, 'the same words sent once more are a new message');
  await settle();

  // An unanswered send that never arrived is forgotten once the history shows it is not there; the retry posts once.
  const hash = (text: string) => crypto.createHash('sha256').update(text).digest('hex');
  sync.addUncertainSend(ROOM, { token: 'never-arrived-token', textHash: hash('ghost words'), at: Date.now() - 30 * 60_000 });
  // One sent five minutes ago could still be on its way: absence from the history is not enough yet.
  sync.addUncertainSend(ROOM, { token: 'too-young-token', textHash: hash('young words'), at: Date.now() - 5 * 60_000 });
  // One sent before the history begins cannot be judged from it at all.
  sync.addUncertainSend(ROOM, { token: 'before-history-token', textHash: hash('old words'), at: T0 - 24 * 60 * 60_000 });
  await sync.syncAllDots(true);
  assert.deepEqual(sync.getUncertainSends(ROOM).map((entry) => entry.token), ['too-young-token', 'before-history-token']);
  await run('ghost words');
  assert.equal(posted('ghost words'), 1);
  await settle();

  // A retry that ChatGPT refuses says nothing about the first attempt: it stays remembered, with its token.
  flags.postStatus = 429;
  assert.equal((await run('young words')).externalAgent.status, 'failed');
  flags.postStatus = 0;
  assert.ok(sync.getUncertainSends(ROOM).some((entry) => entry.token === 'too-young-token'), 'a refused retry keeps the first attempt');
  assert.equal((await run('young words')).externalAgent.status, 'completed');
  assert.equal(sends[sends.length - 1].idempotency_token, 'too-young-token', 'the retry goes out with the first attempt\'s token');
  // A first attempt that is clearly refused leaves nothing behind.
  flags.postStatus = 400;
  assert.equal((await run('refused words')).externalAgent.status, 'failed');
  flags.postStatus = 0;
  assert.ok(!sync.getUncertainSends(ROOM).some((entry) => entry.textHash === hash('refused words')));
  await settle();

  // Unanswered sends are never pushed out by newer ones: past the limit a new send is refused instead.
  for (let i = 0; i < 49; i += 1) sync.addUncertainSend(ROOM, { token: `filler-${i}`, textHash: hash(`filler ${i}`), at: Date.now() });
  const full = await run('one too many');
  assert.equal(full.externalAgent.status, 'failed');
  assert.ok(full.text.includes(sync.DOT_TOO_MANY_TEXT));
  assert.equal(posted('one too many'), 0);
  assert.ok(sync.getUncertainSends(ROOM).some((entry) => entry.token === 'before-history-token'), 'the oldest unanswered send is still there');
  for (let i = 0; i < 49; i += 1) sync.clearUncertainSend(ROOM, `filler-${i}`);
  sync.clearUncertainSend(ROOM, 'before-history-token');
  assert.equal(sync.getUncertainSends(ROOM).length, 0);

  // ChatGPT can't be read to check an unanswered send: the message is not sent blind.
  flags.dropPostAnswer = true;
  assert.equal((await run('blind words')).externalAgent.status, 'failed');
  flags.getStatus = 503;
  const blind = await run('blind words');
  assert.equal(blind.externalAgent.status, 'failed');
  assert.ok(blind.text.includes(DOT_UNCHECKED_TEXT), 'the chat says why it was not sent');
  assert.equal(posted('blind words'), 1, 'nothing is posted while the earlier send cannot be checked');
  flags.getStatus = 0;
  assert.equal((await run('blind words')).externalAgent.status, 'completed');
  assert.equal(posted('blind words'), 1);
  await settle();

  // A room saved before several unanswered sends could be kept still reads its single entry.
  {
    const { getConfig } = require('../../config/config') as typeof import('../../config/config');
    const stateFile = path.join(getConfig().getConfigDir(), 'dots', 'state.json');
    const saved = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    saved.rooms[ROOM].uncertain = { token: 'legacy-token', textHash: 'x', at: Date.now() };
    fs.writeFileSync(stateFile, JSON.stringify(saved));
    assert.deepEqual(sync.getUncertainSends(ROOM).map((entry) => entry.token), ['legacy-token']);
    sync.clearUncertainSend(ROOM, 'legacy-token');
    assert.equal(sync.getUncertainSends(ROOM).length, 0);
  }

  // A whole page of new messages means older ones may be missing: the chat says so.
  for (let i = 0; i < 40; i += 1) room.push(msg(DOT_AUTHOR, `burst ${i}`, { message_metadata: { turn_trigger: 'parent_notification' } }));
  assert.equal((await sync.syncAllDots(true)).added, 32);
  assert.ok(session.getSession(sid).history.some((m: any) => m.content === sync.DOT_GAP_TEXT));

  // A token ChatGPT rejects early is retried once with a fresh sign-in: the sync carries on, Dots stays ready.
  const forcedBefore = forcedRefreshes;
  flags.rejectOnce = 1;
  room.push(msg(DOT_AUTHOR, 'after a token refresh', { message_metadata: { turn_trigger: 'parent_notification' } }));
  assert.equal((await sync.syncAllDots(true)).added, 1);
  assert.equal(forcedRefreshes, forcedBefore + 1, 'one forced refresh');
  assert.equal(store.getExternalAgentEntry('openai-dots').lastStatus, 'ready');

  // Two requests rejected at the same moment: one refresh, both retried with the new token, neither says signed out.
  api.setDotsAuthForTests(fixtureAuth);
  flags.rejectOnce = 2;
  const both = await Promise.all([api.listRoomMessages(ROOM, 5), api.listRoomMessages(ROOM, 5)]);
  assert.equal(both.length, 2);
  assert.equal(forcedRefreshes, forcedBefore + 2, 'one shared refresh for both');
  // A rejection is still a rejection when its body is HTML: a 401 page, or a 403 page without a Cloudflare challenge.
  for (const status of [401, 403]) {
    api.setDotsAuthForTests(fixtureAuth);
    flags.htmlRejectStatus = status;
    flags.htmlRejectCount = 1;
    const refreshesBefore = forcedRefreshes;
    assert.ok((await api.listRoomMessages(ROOM, 5)).length > 0, `HTML ${status} is retried with a fresh token`);
    assert.equal(forcedRefreshes, refreshesBefore + 1);
    flags.htmlRejectCount = 2;
    await assert.rejects(api.listRoomMessages(ROOM, 5), (error: any) => api.isDotsAuthError(error), `a repeated HTML ${status} is a rejected sign-in`);
    flags.htmlRejectCount = 0;
  }
  api.setDotsAuthForTests(fixtureAuth);
  const forcedBeforeEdge = forcedRefreshes;

  // Cloudflare's bot check is temporary: no sign-out and no token refresh.
  flags.edgeBlock = true;
  const blocked = await sync.syncAllDots(true).catch((error: any) => ({ failed: String(error?.message || error) }));
  assert.match(String((blocked as any).failed || ''), /Cloudflare/);
  assert.equal(store.getExternalAgentEntry('openai-dots').lastStatus, 'ready', 'a Cloudflare block is not a sign-out');
  assert.equal(forcedRefreshes, forcedBeforeEdge);
  assert.equal(api.isDotsAuthError(new api.DotsApiError('x', 403)), false);
  flags.edgeBlock = false;

  // A sign-in that stays rejected (even after a fresh token) pauses the sync...
  api.setDotsAuthForTests(fixtureAuth); // forget the refresh throttle
  flags.getStatus = 401;
  const rejected = await sync.syncAllDots(true).catch((error: any) => ({ failed: String(error?.message || error) }));
  assert.ok((rejected as any).failed || (rejected as any).errors?.length, 'the failure is reported');
  assert.equal(store.getExternalAgentEntry('openai-dots').lastStatus, 'signed_out');
  assert.equal(store.getExternalAgentEntry('openai-dots').enabled, true, 'the user\'s on/off choice is untouched');
  assert.equal(sync.dotsEnabled(), false);
  // ...and the poller re-checks on its own with backoff, instead of waiting for the user to toggle it.
  const heal = () => registry.verifyExternalAgent('openai-dots');
  sync.resetDotsHealForTests();
  assert.equal(await sync.runDotsPollTick(heal), 'still_down');
  assert.equal(await sync.runDotsPollTick(heal), 'waiting', 'backs off after a failed check');
  flags.getStatus = 0;
  sync.resetDotsHealForTests();
  assert.equal(await sync.runDotsPollTick(heal), 'healed');
  assert.equal(sync.dotsEnabled(), true, 'reconnected without a toggle');
  assert.equal(await sync.runDotsPollTick(heal), 'synced');

  // A temporary failure at the last check (ChatGPT down) is also re-checked when the user sends.
  store.updateExternalAgentEntry('openai-dots', { lastStatus: 'error', lastStatusText: 'ChatGPT returned 503.' });
  const resumed = await run('after a hiccup');
  assert.equal(resumed.externalAgent.status, 'completed', 'the send re-checks instead of refusing');
  assert.equal(posted('after a hiccup'), 1);
  assert.equal(store.getExternalAgentEntry('openai-dots').lastStatus, 'ready');
  await settle();

  // Turned off, the poller does nothing.
  store.updateExternalAgentEntry('openai-dots', { enabled: false });
  assert.equal(await sync.runDotsPollTick(heal), 'off');
  store.updateExternalAgentEntry('openai-dots', { enabled: true });

  // Off: sync stops; the chat stays.
  session.flushSession(sid);
  const listed = () => session.listSessionSummaries({ scope: 'all', limit: 500 }).sessions.some((row: any) => row.id === sid);
  store.updateExternalAgentEntry('openai-dots', { enabled: true });
  assert.equal(listed(), true, 'a dot chat is listed while OpenAI Dots is on');
  await registry.disableExternalAgent('openai-dots');
  assert.deepEqual(await sync.syncAllDots(true), { dots: 0, added: 0, sessions: [] });
  assert.ok(session.getSession(sid).history.length >= 7);
  // ...but not listed in the sidebar/drawer while it is off, and listed again once it is back on.
  assert.equal(listed(), false, 'a dot chat is hidden from chat lists while OpenAI Dots is off');
  store.updateExternalAgentEntry('openai-dots', { enabled: true });
  assert.equal(listed(), true, 'turning OpenAI Dots back on lists the same chat again');
  store.updateExternalAgentEntry('openai-dots', { enabled: false });

  console.log('dots regression: ok (fake chatgpt.com backend, fixture sign-in)');
  process.exit(0);
})().catch((error) => { console.error(error); process.exit(1); });
