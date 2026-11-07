// Stage D sharing UI browser harness (part 1: infra + static checks).
// Serves the REAL web-ui/src/pages/MemoryReferenceSharing.js over a local http server.
// Only ../api.js and ../utils.js are stubbed: api = in-memory fixture backend (no gateway, no user data).
// Run: node scripts/test-connected-memory-sharing-ui.mjs
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..');
const modulePath = path.join(repo, 'web-ui', 'src', 'pages', 'MemoryReferenceSharing.js');
const refsPath = path.join(repo, 'web-ui', 'src', 'pages', 'MemoryReferences.js');
const shotDir = process.env.PROM_TEST_SCREENSHOT_DIR || path.join(os.tmpdir(), 'prom-connected-memory-stage-d-shots');
const API = '/api/memory/reference-sharing';

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:0;font:14px system-ui,sans-serif;background:#101010;color:#eee}#host{padding:12px;max-width:760px}
</style></head><body><div id="host"></div><script type="module">
try { window.M = await import('/src/pages/MemoryReferenceSharing.js'); window.__modReady = true; }
catch (e) { window.__modError = String((e && e.stack) || e); }
</script></body></html>`;

// Stub of web-ui/src/api.js. Records every call in window.__calls and answers from window.__db.
// Responses are computed at call time (a parked GET carries the snapshot it was issued with).
// If window.__hold(rec) returns true, the response is parked in window.__held until released.
const API_STUB = `
const BASE = '/api/memory/reference-sharing';
const clone = v => JSON.parse(JSON.stringify(v));
const fail = error => ({ success: false, error });
function route(db, path, method, body) {
  const p = path.slice(BASE.length);
  const parts = p.split('/').map(s => decodeURIComponent(s));
  const head = parts[1]; const id = parts[2]; const sub = parts[3];
  if (method === 'GET' && p === '') return { success: true, writable: db.writable, teams: clone(db.teams), collections: clone(db.collections), grants: clone(db.grants) };
  if (!db.writable) return fail('Read-only gateway');
  if (head === 'grants' && method === 'POST') {
    if (!db.teams.some(t => t.id === body.teamId)) return fail('Unknown team');
    const gid = 'g' + (++db.seq);
    if (body.required !== undefined && typeof body.required !== 'boolean') return fail('required must be boolean');
    const grant = { id: gid, teamId: body.teamId, targetKind: body.targetKind, targetId: body.targetId, required: body.required === true, purpose: String(body.purpose || '') };
    db.grants.push(grant);
    return { success: true, grant: clone(grant) };
  }
  if (head === 'grants' && method === 'DELETE') { db.grants = db.grants.filter(g => g.id !== id); return { success: true }; }
  if (head === 'collections' && !id && method === 'POST') {
    const cid = 'c' + (++db.seq);
    db.collections.push({ id: cid, title: body.title, purpose: body.purpose || '', members: [] });
    return { success: true, id: cid };
  }
  const c = head === 'collections' && id ? db.collections.find(x => x.id === id) : null;
  if (head === 'collections' && id && method === 'PATCH') {
    if (!c) return fail('Not found');
    c.title = body.title; c.purpose = body.purpose; return { success: true };
  }
  if (head === 'collections' && id && method === 'DELETE') {
    db.collections = db.collections.filter(x => x.id !== id);
    db.grants = db.grants.filter(g => !(g.targetKind === 'collection' && g.targetId === id));
    return { success: true };
  }
  if (head === 'collections' && sub === 'members' && method === 'POST') {
    if (!c) return fail('Not found');
    const shared = db.grants.some(g => g.targetKind === 'collection' && g.targetId === c.id);
    if (body.add && shared && body.acknowledgeSharedAudience !== true) return fail('Shared collection requires acknowledgement');
    c.members = body.add ? [...new Set([...c.members, body.referenceId])] : c.members.filter(x => x !== body.referenceId);
    return { success: true };
  }
  return fail('Unhandled ' + method + ' ' + p);
}
export function api(path, opts = {}) {
  const method = String(opts.method || 'GET').toUpperCase();
  const body = opts.body ? JSON.parse(opts.body) : undefined;
  const rec = { path, method, body };
  window.__calls.push(rec);
  const result = route(window.__db, path, method, body);
  window.__inflight = (window.__inflight || 0) + 1;
  const finish = () => { window.__inflight -= 1; return result; };
  if (window.__hold && window.__hold(rec)) return new Promise(resolve => window.__held.push(() => resolve(finish())));
  return new Promise(resolve => setTimeout(() => resolve(finish()), 5));
}
`;

const UTILS_STUB = `export function escHtml(str) { return String(str ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }`;

function startServer() {
  const routes = {
    '/': ['text/html; charset=utf-8', () => PAGE],
    '/src/pages/MemoryReferenceSharing.js': ['text/javascript; charset=utf-8', () => fs.readFileSync(modulePath, 'utf8')],
    '/src/api.js': ['text/javascript; charset=utf-8', () => API_STUB],
    '/src/utils.js': ['text/javascript; charset=utf-8', () => UTILS_STUB],
  };
  const server = http.createServer((req, res) => {
    const hit = routes[new URL(req.url, 'http://127.0.0.1').pathname];
    if (!hit) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'content-type': hit[0], 'cache-control': 'no-store' });
    res.end(hit[1]());
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

const results = [];
const fixture = (over = {}) => ({
  writable: true, seq: 10,
  teams: [{ id: 't1', name: 'Alpha team' }, { id: 't2', name: 'Beta team' }],
  collections: [
    { id: 'c1', title: 'Shared pack', purpose: 'Team pack', members: ['r1'] },
    { id: 'c2', title: 'Private pack', purpose: '', members: [] },
  ],
  grants: [{ id: 'g1', teamId: 't1', targetKind: 'collection', targetId: 'c1' }],
  ...over,
});

// Harness helpers: each test mounts the real module into #host with a fresh fixture.
async function settle(page) {
  await page.waitForFunction(() => (window.__inflight || 0) === 0, null, { timeout: 5000 });
}
async function mount(page, db, opts = {}) {
  await page.evaluate(({ db, opts }) => {
    window.__db = db; window.__calls = []; window.__hold = null; window.__held = []; window.__inflight = 0; window.__notified = 0;
    const host = document.getElementById('host');
    host.replaceChildren();
    const fn = opts.referenceId ? window.M.mountReferenceSharing : window.M.mountCollectionOverview;
    window.__inst = fn(host, { ...opts, resolveTitle: id => ({ r1: 'Note one', r2: 'Note two' }[id] || ''), onChange: () => { window.__notified += 1; } });
  }, { db, opts });
  await page.waitForFunction(() => document.querySelector('#host .mrs') && !document.getElementById('host').innerText.includes('Loading sharing'));
  await settle(page);
}
const mutCalls = page => page.evaluate(() => window.__calls.filter(c => c.method !== 'GET'));
const allCalls = page => page.evaluate(() => window.__calls);
const hostText = page => page.evaluate(() => document.getElementById('host').innerText);
const dbState = page => page.evaluate(() => JSON.parse(JSON.stringify(window.__db)));

async function withPage(browser, base, viewport, fn) {
  const page = await browser.newPage({ viewport: viewport || { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e.message)));
  page.setDefaultTimeout(5000);
  try {
    await page.goto(base);
    await page.waitForFunction(() => window.__modReady || window.__modError);
    assert.equal(await page.evaluate(() => window.__modError || null), null, 'module must load in browser');
    await fn(page);
    assert.deepStrictEqual(errors, [], 'no uncaught page errors');
  } finally {
    await page.close();
  }
}

async function check(name, fn) {
  try {
    await fn();
    results.push({ name, status: 'PASS' });
    console.log('PASS', name);
  } catch (err) {
    const msg = String((err && err.message) || err).split('\n').slice(0, 4).join(' | ').slice(0, 500);
    results.push({ name, status: 'FAIL', error: msg });
    console.log('FAIL', name, '-', msg);
  }
}

// Static checks kept from the earlier lane (cheap, run first).
function staticChecks() {
  const src = fs.readFileSync(modulePath, 'utf8');
  const refs = fs.readFileSync(refsPath, 'utf8');
  for (const s of ['seq !== generation', 'Choose an existing team first', "pending = { kind: 'add'", 'acknowledgeSharedAudience: true',
    'Read-only: another gateway owns', 'if (busy || !writable || destroyed) return;', 'cannot be unsent']) {
    assert.ok(src.includes(s), 'missing: ' + s);
  }
  assert.ok(!/createTeam|new Team|team_create/i.test(src), 'no team creation in sharing UI');
  for (const n of ['mountReferenceSharing', 'mountCollectionOverview', 'summarizeReferenceAudience', 'summarizeCollectionAudience']) {
    assert.match(src, new RegExp(`export function ${n}\\(`));
  }
  assert.ok(refs.includes("from './MemoryReferenceSharing.js'"), 'References imports module');
  assert.ok(refs.includes('Private unless you share it with a team'), 'library private copy');
  assert.ok(refs.includes('Save new shared attachments') && refs.includes('Suggest relevant references'), 'B+C controls preserved');
}
const D = { width: 1280, height: 900 };
const M = { width: 390, height: 844 };
const mv = (muts, method, p, body) => {
  const x = muts.at(-1);
  assert.ok(x, 'expected a mutation request');
  assert.equal(x.method, method);
  assert.equal(x.path, API + p);
  if (body !== undefined) assert.deepStrictEqual(x.body, body);
};
const noMut = muts => assert.equal(muts.length, 0, 'expected no mutation, got ' + JSON.stringify(muts));
const overflow = page => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const shot = (page, name) => page.screenshot({ path: path.join(shotDir, name), fullPage: true });

async function testsOverview(browser, base) {
  await check('overview: create collection sends POST and clears draft', () => withPage(browser, base, D, async page => {
    await mount(page, fixture());
    await page.fill('[data-draft="title"]', 'Fresh pack');
    await page.fill('[data-draft="purpose"]', 'For testing');
    await page.click('button[data-act="create"]');
    await settle(page);
    mv(await mutCalls(page), 'POST', '/collections', { title: 'Fresh pack', purpose: 'For testing' });
    assert.ok((await hostText(page)).includes('Fresh pack'), 'new collection rendered');
    assert.equal(await page.inputValue('[data-draft="title"]'), '', 'draft cleared');
  }));
  await check('overview: empty title rejected without POST', () => withPage(browser, base, D, async page => {
    await mount(page, fixture());
    await page.click('button[data-act="create"]');
    await settle(page);
    noMut(await mutCalls(page));
    assert.ok((await hostText(page)).includes('Enter a collection title.'), 'error note shown');
  }));
  await check('overview: edit title/purpose sends PATCH', () => withPage(browser, base, D, async page => {
    await mount(page, fixture());
    await page.fill('[data-edit-title="c2"]', 'Renamed pack');
    await page.click('button[data-act="save"][data-collection="c2"]');
    await settle(page);
    mv(await mutCalls(page), 'PATCH', '/collections/c2', { title: 'Renamed pack', purpose: '' });
  }));
  await check('overview: delete asks, cancel sends nothing, confirm sends DELETE', () => withPage(browser, base, D, async page => {
    await mount(page, fixture());
    await page.click('button[data-act="ask-delete"][data-collection="c2"]');
    assert.ok(await page.isVisible('.mrs-confirm'), 'confirm card shown');
    assert.ok((await hostText(page)).includes('References are not deleted'), 'delete copy');
    await page.click('.mrs-confirm button[data-act="cancel"]');
    await settle(page);
    noMut(await mutCalls(page));
    await page.click('button[data-act="ask-delete"][data-collection="c2"]');
    await page.click('button[data-act="confirm-delete"][data-collection="c2"]');
    await settle(page);
    mv(await mutCalls(page), 'DELETE', '/collections/c2');
    const db = await dbState(page);
    assert.ok(!db.collections.some(c => c.id === 'c2'), 'collection removed server-side');
    assert.ok(db.grants.some(g => g.id === 'g1'), 'unrelated grant kept');
  }));
  await check('overview: remove member sends add:false ack:false', () => withPage(browser, base, D, async page => {
    await mount(page, fixture());
    await page.click('button[data-act="remove-member"][data-collection="c1"][data-ref="r1"]');
    await settle(page);
    mv(await mutCalls(page), 'POST', '/collections/c1/members', { referenceId: 'r1', add: false, acknowledgeSharedAudience: false });
    assert.deepEqual((await dbState(page)).collections.find(c => c.id === 'c1').members, []);
  }));
  await check('overview: team picker lists only existing teams, no team creation', () => withPage(browser, base, D, async page => {
    await mount(page, fixture());
    // One picker per collection card; every picker must offer exactly the existing teams.
    const pickers = await page.$$eval('select[data-team-for]', ss => ss.map(s => [...s.options].map(o => o.textContent)));
    assert.ok(pickers.length >= 1, 'at least one picker');
    for (const opts of pickers) assert.deepEqual(opts, ['Alpha team', 'Beta team']);
    assert.equal(await page.$$eval('input,button', els => els.filter(e => /team name|new team/i.test(e.textContent + (e.placeholder || ''))).length), 0);
  }));
  await check('overview: collection share with existing team sends POST grant', () => withPage(browser, base, D, async page => {
    await mount(page, fixture());
    await page.selectOption('select[data-team-for="collection:c2"]', 't2');
    await page.click('button[data-act="share"][data-kind="collection"][data-target="c2"]');
    await settle(page);
    mv(await mutCalls(page), 'POST', '/grants', { teamId: 't2', targetKind: 'collection', targetId: 'c2', required: false, purpose: '' });
  }));
  await check('overview: revoke collection grant sends DELETE', () => withPage(browser, base, D, async page => {
    await mount(page, fixture());
    await page.click('button[data-act="revoke"][data-grant="g1"]');
    await settle(page);
    mv(await mutCalls(page), 'DELETE', '/grants/g1');
    assert.ok(!(await dbState(page)).grants.some(g => g.id === 'g1'), 'grant removed');
  }));
  await check('overview: no teams disables share controls', () => withPage(browser, base, D, async page => {
    await mount(page, fixture({ teams: [], grants: [] }));
    assert.ok((await hostText(page)).includes('No teams yet'), 'empty-team copy');
    assert.equal(await page.$eval('button[data-act="share"][data-kind="collection"][data-target="c2"]', b => b.disabled), true);
  }));
}
const refFx = () => fixture({ grants: [...fixture().grants, { id: 'g2', teamId: 't2', targetKind: 'reference', targetId: 'r1' }] });

async function testsReference(browser, base) {
  await check('reference: audience shows direct and via-collection teams', () => withPage(browser, base, D, async page => {
    await mount(page, refFx(), { referenceId: 'r1' });
    const t = await hostText(page);
    assert.ok(t.includes('Shared with:'), 'shared label');
    assert.ok(t.includes('Beta team') && t.includes('Alpha team (via “Shared pack”)'), 'both audiences listed');
  }));
  await check('reference: share with picked existing team sends reference grant', () => withPage(browser, base, D, async page => {
    await mount(page, refFx(), { referenceId: 'r1' });
    await page.selectOption('select[data-team-for="reference:r1"]', 't1');
    await page.click('button[data-act="share"][data-kind="reference"][data-target="r1"]');
    await settle(page);
    mv(await mutCalls(page), 'POST', '/grants', { teamId: 't1', targetKind: 'reference', targetId: 'r1', required: false, purpose: '' });
  }));
  await check('required: checkbox and purpose default off/empty; ordinary share with purpose sends required:false', () => withPage(browser, base, D, async page => {
    await mount(page, refFx(), { referenceId: 'r1' });
    const box = 'input[data-required-for="reference:r1"]';
    assert.equal(await page.isChecked(box), false, 'required checkbox default off');
    assert.equal(await page.inputValue('input[data-purpose-for="reference:r1"]'), '', 'purpose empty');
    assert.ok((await hostText(page)).includes('Required for every task in this team'), 'checkbox label copy');
    assert.ok((await hostText(page)).includes('Ordinary sharing is optional'), 'optional copy');
    await page.selectOption('select[data-team-for="reference:r1"]', 't1');
    await page.fill('input[data-purpose-for="reference:r1"]', 'Style guide');
    await page.click('button[data-act="share"][data-kind="reference"][data-target="r1"]');
    await settle(page);
    assert.equal(await page.isVisible('.mrs-confirm'), false, 'no confirm for ordinary share');
    mv(await mutCalls(page), 'POST', '/grants', { teamId: 't1', targetKind: 'reference', targetId: 'r1', required: false, purpose: 'Style guide' });
    assert.ok(!(await hostText(page)).includes('Stop sharing (removes requirement)'), 'no required label for ordinary grant');
  }));
  await check('required: checked -> confirmation with audience + every-task wording, 0 POST; cancel -> 0 POST', () => withPage(browser, base, D, async page => {
    await mount(page, refFx(), { referenceId: 'r1' });
    await page.selectOption('select[data-team-for="reference:r1"]', 't1');
    await page.check('input[data-required-for="reference:r1"]');
    await page.click('button[data-act="share"][data-kind="reference"][data-target="r1"]');
    await settle(page);
    noMut(await mutCalls(page));
    const t = await page.innerText('.mrs-confirm');
    assert.ok(t.includes('Require for every task in this team?'), 'confirm title');
    assert.ok(t.includes('Every task that Alpha team runs will receive this reference'), 'every-task wording');
    assert.ok(t.includes('Audience: Alpha team'), 'audience named');
    await page.click('.mrs-confirm button[data-act="cancel"]');
    await settle(page);
    assert.equal(await page.isVisible('.mrs-confirm'), false, 'confirm dismissed');
    noMut(await mutCalls(page));
    assert.equal((await dbState(page)).grants.filter(g => g.required).length, 0, 'no required grant created');
  }));
  await check('required: confirmed -> POST required:true + purpose, label shown, revoke reverses', () => withPage(browser, base, D, async page => {
    await mount(page, fixture(), {});
    await page.selectOption('select[data-team-for="collection:c2"]', 't2');
    await page.fill('input[data-purpose-for="collection:c2"]', 'Onboarding');
    await page.check('input[data-required-for="collection:c2"]');
    await page.click('button[data-act="share"][data-kind="collection"][data-target="c2"]');
    const t = await page.innerText('.mrs-confirm');
    assert.ok(t.includes('Every task that Beta team runs will receive this collection and every reference in it') && t.includes('Purpose: Onboarding'), 'collection confirm copy');
    noMut(await mutCalls(page));
    await page.click('.mrs-confirm button[data-act="confirm-required"]');
    await settle(page);
    mv(await mutCalls(page), 'POST', '/grants', { teamId: 't2', targetKind: 'collection', targetId: 'c2', required: true, purpose: 'Onboarding' });
    const g = (await dbState(page)).grants.find(x => x.targetId === 'c2');
    assert.ok(g && g.required === true, 'grant stored required');
    assert.ok(await page.isVisible(`[data-required-grant="${g.id}"]`), 'required label on current grant');
    assert.ok((await hostText(page)).includes('Purpose: Onboarding'), 'purpose shown');
    await shot(page, 'required-grant-desktop.png');
    await page.click(`button[data-act="revoke"][data-grant="${g.id}"]`);
    await settle(page);
    mv(await mutCalls(page), 'DELETE', '/grants/' + g.id);
    assert.equal(await page.$(`[data-required-grant="${g.id}"]`), null, 'label gone after revoke');
  }));
  await check('required: confirmation screenshot (desktop + mobile, no overflow)', () => withPage(browser, base, M, async page => {
    await mount(page, fixture({ grants: [...fixture().grants, { id: 'g9', teamId: 't2', targetKind: 'reference', targetId: 'r1', required: true, purpose: 'Brand rules' }] }), { referenceId: 'r1' });
    assert.ok(await page.isVisible('[data-required-grant="g9"]'), 'existing required grant labelled');
    await page.check('input[data-required-for="reference:r1"]');
    await page.click('button[data-act="share"][data-kind="reference"][data-target="r1"]');
    assert.ok(await page.isVisible('.mrs-confirm'), 'confirm visible');
    assert.ok((await overflow(page)) <= 1, 'mobile overflow');
    await shot(page, 'required-confirm-mobile.png');
    await page.setViewportSize(D);
    await shot(page, 'required-confirm-desktop.png');
    noMut(await mutCalls(page));
  }));
  await check('reference: stop sharing direct grant sends DELETE', () => withPage(browser, base, D, async page => {
    await mount(page, refFx(), { referenceId: 'r1' });
    await page.click('button[data-act="revoke"][data-grant="g2"]');
    await settle(page);
    mv(await mutCalls(page), 'DELETE', '/grants/g2');
    assert.ok(!(await dbState(page)).grants.some(g => g.id === 'g2'), 'direct grant removed');
  }));
  await check('reference: add to private collection POSTs ack=false (no confirm)', () => withPage(browser, base, D, async page => {
    await mount(page, refFx(), { referenceId: 'r1' });
    await page.click('input[data-member="c2"][data-ref="r1"]');
    await settle(page);
    mv(await mutCalls(page), 'POST', '/collections/c2/members', { referenceId: 'r1', add: true, acknowledgeSharedAudience: false });
  }));
  await check('reference: shared add -> cancel sends nothing', () => withPage(browser, base, D, async page => {
    await mount(page, refFx(), { referenceId: 'r2' });
    await page.click('input[data-member="c1"][data-ref="r2"]');
    assert.ok(await page.isVisible('.mrs-confirm'), 'confirm card shown');
    assert.ok((await hostText(page)).includes('Adding this reference to “Shared pack” shares it with: Alpha team'), 'recipient audience shown');
    noMut(await mutCalls(page));
    await page.click('.mrs-confirm button[data-act="cancel"]');
    await settle(page);
    assert.equal(await page.isVisible('.mrs-confirm'), false, 'confirm dismissed');
    noMut(await mutCalls(page));
    assert.ok(!(await dbState(page)).collections.find(c => c.id === 'c1').members.includes('r2'), 'r2 not added');
  }));
  await check('reference: shared add -> confirm POSTs ack=true and updates audience', () => withPage(browser, base, D, async page => {
    await mount(page, refFx(), { referenceId: 'r2' });
    await page.click('input[data-member="c1"][data-ref="r2"]');
    await page.click('.mrs-confirm button[data-act="confirm-add"]');
    await settle(page);
    mv(await mutCalls(page), 'POST', '/collections/c1/members', { referenceId: 'r2', add: true, acknowledgeSharedAudience: true });
    assert.ok((await dbState(page)).collections.find(c => c.id === 'c1').members.includes('r2'), 'r2 added server-side');
    assert.ok((await hostText(page)).includes('Alpha team (via “Shared pack”)'), 'audience now shows collection team');
  }));
  await check('reference: read-only disables all mutating controls', () => withPage(browser, base, D, async page => {
    await mount(page, fixture({ writable: false, grants: [...fixture().grants, { id: 'g2', teamId: 't2', targetKind: 'reference', targetId: 'r1' }] }), { referenceId: 'r1' });
    assert.ok((await hostText(page)).includes('Read-only: another gateway owns'), 'read-only notice');
    const enabled = await page.$$eval('#host button, #host select, #host input', els => els.filter(e => !e.disabled).length);
    assert.equal(enabled, 0, 'no enabled controls in read-only mode');
    await page.click('button[data-act="share"][data-kind="reference"][data-target="r1"]', { force: true }).catch(() => {});
    await settle(page);
    noMut(await mutCalls(page));
  }));
  await check('stale GET response is dropped (newest wins)', () => withPage(browser, base, D, async page => {
    await page.evaluate(() => {
      window.__db = { writable: true, seq: 1, teams: [], collections: [{ id: 'c1', title: 'Shared pack', members: ['r1'] }], grants: [{ id: 'g1', teamId: 't1', targetKind: 'collection', targetId: 'c1' }] };
      window.__calls = []; window.__held = []; window.__inflight = 0; window.__notified = 0;
      let first = true;
      window.__hold = rec => { if (first && rec.method === 'GET') { first = false; return true; } return false; };
      const host = document.getElementById('host'); host.replaceChildren();
      window.__inst = window.M.mountReferenceSharing(host, { referenceId: 'r1', resolveTitle: () => '' });
    });
    await page.waitForFunction(() => window.__held.length === 1);
    await page.evaluate(async () => { window.__hold = null; window.__db.collections[0].title = 'Fresh title'; await window.__inst.refresh(); });
    await page.waitForFunction(() => document.getElementById('host').innerText.includes('Fresh title'));
    await page.evaluate(() => window.__held[0]());
    await page.waitForTimeout(80);
    const t = await hostText(page);
    assert.ok(t.includes('Fresh title') && !t.includes('“Shared pack”'), 'stale snapshot must not replace newer view');
  }));
  await check('destroy blocks callbacks: in-flight mutation resolves after destroy', () => withPage(browser, base, D, async page => {
    // Root cause of the earlier timeout: the fixture was never passed to evaluate (db undefined -> GET threw,
    // the module never loaded a writable state, so the create click was a no-op). Pass the fixture explicitly.
    await page.evaluate(db => {
      window.__db = db; window.__calls = []; window.__held = []; window.__inflight = 0; window.__notified = 0;
      window.__hold = rec => rec.method === 'POST';
      const host = document.getElementById('host'); host.replaceChildren();
      window.__inst = window.M.mountCollectionOverview(host, { onChange() { window.__notified += 1; } });
    }, fixture());
    await page.waitForFunction(() => window.__inst.isWritable() === true);
    await page.waitForFunction(() => document.querySelector('[data-draft="title"]'));
    await settle(page);
    await page.fill('[data-draft="title"]', 'Late pack');
    await page.click('button[data-act="create"]');
    await page.waitForFunction(() => window.__held.length === 1);
    const held = await mutCalls(page);
    mv(held, 'POST', '/collections', { title: 'Late pack', purpose: '' });
    await page.evaluate(() => { window.__inst.destroy(); window.__hold = null; window.__held[0](); });
    await page.waitForTimeout(80);
    assert.equal(await page.evaluate(() => window.__notified), 0, 'onChange suppressed after destroy');
    assert.equal(await page.evaluate(() => document.getElementById('host').children.length), 0, 'no re-render after destroy');
    assert.equal(await page.evaluate(() => window.__inst.isWritable()), true, 'isWritable still answers');
  }));
}

async function testsLayout(browser, base) {
  for (const [label, vp] of [['desktop', D], ['mobile', M]]) {
    await check(`layout ${label}: overview has no horizontal overflow + screenshot`, () => withPage(browser, base, vp, async page => {
      await mount(page, fixture());
      assert.ok((await overflow(page)) <= 1, 'overview overflow ' + (await overflow(page)));
      await shot(page, `overview-${label}.png`);
    }));
    await check(`layout ${label}: reference panel has no horizontal overflow + screenshot`, () => withPage(browser, base, vp, async page => {
      await mount(page, refFx(), { referenceId: 'r1' });
      assert.ok((await overflow(page)) <= 1, 'reference overflow ' + (await overflow(page)));
      await shot(page, `reference-${label}.png`);
    }));
  }
}

async function main() {
  fs.mkdirSync(shotDir, { recursive: true });
  const server = await startServer();
  const base = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    await check('static: exports, routes, copy, B+C preserved', async () => staticChecks());
    await testsOverview(browser, base);
    await testsReference(browser, base);
    await testsLayout(browser, base);
  } finally {
    await browser.close();
    server.close();
  }
  const failed = results.filter(r => r.status === 'FAIL');
  fs.writeFileSync(path.join(shotDir, 'results.json'), JSON.stringify({ at: new Date().toISOString(), total: results.length, failed: failed.length, results }, null, 2));
  console.log(`SHARING_UI_BROWSER ${results.length - failed.length}/${results.length} PASS`);
  if (failed.length) process.exitCode = 1;
}

main().catch(err => { console.error('HARNESS_ERROR', err); process.exitCode = 1; });
