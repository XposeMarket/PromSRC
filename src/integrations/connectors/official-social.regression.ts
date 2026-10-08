// Regression: official social connectors (Instagram / TikTok / LinkedIn / Notion).
// Mocks fetch + the vault so the real connector classes, publish flow,
// public-media share and gateway OAuth callback run end to end offline.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setGatewayPublicOriginOverride, completeGatewayOAuthCallback, hasPendingGatewayOAuth } from '../gateway-oauth-callback.js';
import { resolvePublicMedia } from '../public-media-share.js';
import { InstagramConnector } from './instagram.js';
import { publishInstagram } from './instagram-publish.js';
import { TikTokConnector } from './tiktok.js';
import { LinkedInConnector } from './linkedin.js';
import { markdownToBlocks } from './notion.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-social-'));

type Call = { method: string; url: URL; body: any; headers: Record<string, string> };
const calls: Call[] = [];
let route: (c: Call) => { status?: number; json?: any; headers?: Record<string, string> } = () => ({ json: {} });
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init: any = {}) => {
  const url = new URL(String(input));
  let body: any = init.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = Object.fromEntries(new URLSearchParams(body)); } }
  const call: Call = { method: String(init.method || 'GET'), url, body, headers: init.headers || {} };
  calls.push(call);
  const r = route(call);
  return new Response(JSON.stringify(r.json ?? {}), { status: r.status ?? 200, headers: r.headers });
}) as typeof fetch;

const ORIGIN = 'https://box.tail.ts.net';
setGatewayPublicOriginOverride(ORIGIN);
let passed = 0;
const ok = (msg: string) => { passed++; console.log(`  ok ${msg}`); };

async function main() {
try {
  // ── Instagram: manual token, profile binding, redirect URI ────────────────
  const ig = new InstagramConnector(tmp);
  route = (c) => c.url.pathname.endsWith('/me') ? { json: { user_id: '1789', username: 'edna', account_type: 'MEDIA_CREATOR' } } : { json: {} };
  const saved = await ig.saveManualAccessToken('IGAAtoken');
  assert.equal(saved.account, '@edna');
  assert.equal(ig.isConnected(), true);
  assert.equal(ig.igUserId(), '1789');
  assert.equal(ig.redirectUri(), `${ORIGIN}/oauth/connector/callback/instagram`);
  ok('instagram manual token -> connected, ig id bound, https gateway redirect');

  // ── Instagram: reel publish via local file share, polling, publish ───────
  const video = path.join(tmp, 'reel.mp4');
  fs.writeFileSync(video, Buffer.alloc(64));
  let polls = 0;
  let sharedUrl = '';
  calls.length = 0;
  route = (c) => {
    const p = c.url.pathname;
    if (c.method === 'POST' && p.endsWith('/1789/media')) {
      sharedUrl = c.body.video_url;
      const token = sharedUrl.split('/public-media/')[1].split('/')[0];
      assert.ok(resolvePublicMedia(token), 'media must be shared while Meta fetches it');
      return { json: { id: 'C1' } };
    }
    if (c.method === 'GET' && p.endsWith('/C1')) return { json: { status_code: ++polls < 2 ? 'IN_PROGRESS' : 'FINISHED' } };
    if (c.method === 'POST' && p.endsWith('/1789/media_publish')) return { json: { id: 'M1' } };
    if (c.method === 'GET' && p.endsWith('/M1')) return { json: { permalink: 'https://www.instagram.com/reel/abc/' } };
    return { status: 404, json: { error: { message: `unexpected ${c.method} ${p}` } } };
  };
  const res = await publishInstagram(ig, { type: 'reel', media: [{ path: video }], caption: 'GRWM #fashion', pollIntervalMs: 1 });
  assert.equal(res.media_id, 'M1');
  assert.equal(res.permalink, 'https://www.instagram.com/reel/abc/');
  const create = calls.find((c) => c.method === 'POST' && c.url.pathname.endsWith('/media'))!;
  assert.equal(create.body.media_type, 'REELS');
  assert.equal(create.body.caption, 'GRWM #fashion');
  assert.equal(create.body.share_to_feed, true);
  assert.equal(create.headers.Authorization, 'Bearer IGAAtoken');
  assert.ok(sharedUrl.startsWith(`${ORIGIN}/public-media/`));
  assert.equal(resolvePublicMedia(sharedUrl.split('/public-media/')[1].split('/')[0]), null, 'share revoked after publish');
  ok('instagram reel: container -> poll FINISHED -> media_publish, share revoked');

  // ── Instagram: validation never hits the network ─────────────────────────
  calls.length = 0;
  await assert.rejects(publishInstagram(ig, { type: 'carousel', media: [{ path: video }] }), /2-10/);
  await assert.rejects(publishInstagram(ig, { type: 'reel', media: [{ url: 'http://insecure/x.mp4' }] }), /https/);
  await assert.rejects(publishInstagram(ig, { type: 'image', media: [{ path: video }] }), /reel/);
  assert.equal(calls.filter((c) => c.method === 'POST').length, 0);
  ok('instagram input validation rejects bad carousels, http media, video-as-image');

  // ── Instagram: processing error surfaces Meta status ─────────────────────
  route = (c) => c.method === 'POST' ? { json: { id: 'C2' } } : { json: { status_code: 'ERROR', status: 'Error: 2207026 unsupported format' } };
  await assert.rejects(publishInstagram(ig, { type: 'reel', media: [{ url: 'https://cdn.example/x.mp4' }], pollIntervalMs: 1 }), /2207026/);
  ok('instagram container ERROR is reported with Meta detail');

  // ── Gateway OAuth callback: pending-only, state-bound ────────────────────
  ig.saveCredentials('APPID', 'APPSECRET');
  const start = ig.startFlow();
  const auth = new URL(start.authUrl);
  assert.equal(auth.origin + auth.pathname, 'https://www.instagram.com/oauth/authorize');
  assert.equal(auth.searchParams.get('redirect_uri'), `${ORIGIN}/oauth/connector/callback/instagram`);
  assert.match(auth.searchParams.get('scope') || '', /instagram_business_content_publish,/);
  const state = auth.searchParams.get('state')!;
  assert.equal(await completeGatewayOAuthCallback('instagram', { code: 'x', state }), null, 'no listener yet -> 404');
  const pending = ig.listenForCallback();
  assert.equal(hasPendingGatewayOAuth('instagram'), true);
  const forged = await completeGatewayOAuthCallback('instagram', { code: 'x', state: 'wrong' });
  assert.match(forged!.error || '', /State mismatch/);
  assert.equal(hasPendingGatewayOAuth('instagram'), true, 'forged state must not consume the flow');
  route = (c) => {
    if (c.url.hostname === 'api.instagram.com') { assert.equal(c.body.redirect_uri, `${ORIGIN}/oauth/connector/callback/instagram`); return { json: { access_token: 'SHORT', user_id: 1789, permissions: 'instagram_business_basic' } }; }
    if (c.url.pathname === '/access_token') return { json: { access_token: 'LONG', expires_in: 5183944 } };
    return { json: { user_id: '1789', username: 'edna' } };
  };
  const done = await completeGatewayOAuthCallback('instagram', { code: 'AUTHCODE#_', state });
  assert.equal(done!.success, true);
  assert.equal((await pending).success, true);
  assert.equal(await ig.getValidAccessToken(), 'LONG');
  ok('instagram OAuth: https gateway callback, forged state ignored, short->long-lived exchange');

  // ── TikTok: client_key + hex PKCE ────────────────────────────────────────
  const tt = new TikTokConnector(tmp);
  tt.saveCredentials('awKEY', 'SECRET');
  const ttUrl = new URL(tt.startFlow().authUrl);
  assert.equal(ttUrl.searchParams.get('client_key'), 'awKEY');
  assert.equal(ttUrl.searchParams.has('client_id'), false);
  assert.match(ttUrl.searchParams.get('code_challenge') || '', /^[0-9a-f]{64}$/);
  assert.equal(ttUrl.searchParams.get('scope'), 'user.info.basic,user.info.profile,user.info.stats,video.list,video.upload,video.publish');
  ok('tiktok authorize uses client_key, comma scopes, hex SHA256 PKCE');

  // ── TikTok: draft upload with chunk PUT ──────────────────────────────────
  route = (c) => c.url.pathname.endsWith('/user/info/') ? { json: { data: { user: { open_id: 'o1', username: 'edna' } }, error: { code: 'ok' } } } : { json: {} };
  await tt.saveManualAccessToken('act.tok');
  calls.length = 0;
  route = (c) => {
    if (c.url.pathname === '/v2/post/publish/inbox/video/init/') return { json: { data: { publish_id: 'P1', upload_url: 'https://open-upload.tiktokapis.com/video/?upload_id=1' }, error: { code: 'ok' } } };
    if (c.url.hostname === 'open-upload.tiktokapis.com') return { status: 201 };
    return { status: 400, json: { error: { code: 'invalid_param', message: c.url.pathname } } };
  };
  const up = await tt.uploadVideo(video, { mode: 'draft' });
  assert.equal(up.publish_id, 'P1');
  const put = calls.find((c) => c.method === 'PUT')!;
  assert.equal(put.headers['Content-Range'], 'bytes 0-63/64');
  assert.deepEqual(calls[0].body.source_info, { source: 'FILE_UPLOAD', video_size: 64, chunk_size: 64, total_chunk_count: 1 });
  ok('tiktok draft upload: inbox init + single-chunk PUT with Content-Range');

  // ── TikTok: direct post respects creator privacy options ─────────────────
  route = (c) => c.url.pathname.endsWith('/creator_info/query/') ? { json: { data: { privacy_level_options: ['SELF_ONLY'] }, error: { code: 'ok' } } } : { json: {} };
  await assert.rejects(tt.uploadVideo(video, { mode: 'direct', privacy_level: 'PUBLIC_TO_EVERYONE' }), /SELF_ONLY/);
  ok('tiktok direct post refuses privacy levels the account is not allowed');

  // ── LinkedIn: post body + versioned headers ──────────────────────────────
  const li = new LinkedInConnector(tmp);
  route = () => ({ json: { sub: 'abc123', name: 'Raul' } });
  await li.saveManualAccessToken('AQ.token');
  calls.length = 0;
  route = () => ({ status: 201, json: {}, headers: { 'x-restli-id': 'urn:li:share:42' } });
  const urn = await li.createPost({ text: 'Shipping official connectors' });
  assert.equal(urn, 'urn:li:share:42');
  assert.equal(calls[0].url.pathname, '/rest/posts');
  assert.equal(calls[0].body.author, 'urn:li:person:abc123');
  assert.equal(calls[0].body.lifecycleState, 'PUBLISHED');
  assert.match(calls[0].headers['LinkedIn-Version'], /^\d{6}$/);
  ok('linkedin create post: member urn author, PUBLISHED, LinkedIn-Version header');

  // ── Notion markdown -> blocks ─────────────────────────────────────────────
  const blocks = markdownToBlocks('# Plan\n- item\n- [x] done\n1. first\n> quote\n```ts\nconst a = 1;\n```\nplain');
  assert.deepEqual(blocks.map((b: any) => b.type), ['heading_1', 'bulleted_list_item', 'to_do', 'numbered_list_item', 'quote', 'code', 'paragraph']);
  assert.equal(blocks[2].to_do.checked, true);
  ok('notion markdown converts to typed blocks');

  // ── Public media without a public origin fails loudly ────────────────────
  setGatewayPublicOriginOverride(null);
  await assert.rejects(publishInstagram(ig, { type: 'reel', media: [{ path: video }] }), /Remote Access/);
  assert.equal(ig.redirectUri(), 'http://localhost:19430/auth/callback/instagram');
  ok('no public origin: local media refused with guidance, redirect falls back to localhost');

  console.log(`PASS official social connectors (${passed} checks)`);
} finally {
  globalThis.fetch = realFetch;
  setGatewayPublicOriginOverride(undefined);
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* best effort */ }
}
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
