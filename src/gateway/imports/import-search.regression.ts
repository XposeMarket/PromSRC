import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Fixture-only regression for stage 2 search on the Agents & imports page.
// Every path is under a temp root; the real ~/.codex and ~/.claude are never read.
async function main(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prometheus-import-search-'));
  const data = path.join(root, 'data');
  const workspace = path.join(data, 'workspace');
  fs.mkdirSync(workspace, { recursive: true });
  process.env.PROMETHEUS_DATA_DIR = data;
  process.env.PROMETHEUS_WORKSPACE_DIR = workspace;
  const home = path.join(root, 'home');
  const opts = { homeDir: home, localAppData: path.join(root, 'local'), appData: path.join(root, 'roaming') };

  const write = (relative: string, value: string, mtime?: number): string => {
    const file = path.join(root, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, value, 'utf8');
    if (mtime) fs.utimesSync(file, new Date(mtime), new Date(mtime));
    return file;
  };
  const ts = '2026-08-09T12:00:00.000Z';
  const line = (value: unknown) => JSON.stringify(value);
  const user = (text: string) => line({ timestamp: ts, type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] } });
  const assistant = (text: string) => line({ timestamp: ts, type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] } });
  const meta = (id: string) => line({ timestamp: ts, type: 'session_meta', payload: { id, cwd: process.platform === 'win32' ? 'C:\\work\\alpha' : '/work/alpha' } });
  const chat = (id: string, lines: string[]) => [meta(id), ...lines].join('\n') + '\n';
  const dir = 'home/.codex/sessions/2026/08';
  const base = Date.parse('2026-08-01T00:00:00Z');

  // 60 filler chats (newest), so the needle chat is beyond the first page of 50.
  for (let i = 0; i < 60; i += 1) {
    write(`${dir}/20/rollout-filler-${String(i).padStart(2, '0')}.jsonl`, chat(`f${i}`, [user(`Filler chat ${i}`), assistant('ok')]), base + 100_000 + i * 1000);
  }
  // Oldest chat: title only reachable through search, not the first page.
  write(`${dir}/01/rollout-needle.jsonl`, chat('needle', [user('Zebracorn migration plan'), assistant('Sure.')]), base);
  // Body-only term far beyond the 96 KB head read used for titles.
  const pad = assistant('x '.repeat(70_000));
  const bodyFile = write(`${dir}/02/rollout-body.jsonl`, chat('body', [user('Body chat'), pad, assistant('padding done'), pad, assistant('The quasarwidget lives here <script>alert(1)</script> after the match')]), base + 1000);
  // Tool output, system/developer text and reasoning carry unique markers that must never be indexed.
  write(`${dir}/03/rollout-mixed.jsonl`, chat('mixed', [
    user('<environment_context>SYSMARKERONE</environment_context>'),
    line({ timestamp: ts, type: 'response_item', payload: { type: 'message', role: 'developer', content: [{ type: 'input_text', text: 'DEVMARKERTWO' }] } }),
    line({ timestamp: ts, type: 'response_item', payload: { type: 'function_call_output', call_id: 'c1', output: 'TOOLMARKERTHREE' } }),
    line({ timestamp: ts, type: 'response_item', payload: { type: 'function_call', name: 'shell', arguments: '{"cmd":"CMDMARKERFOUR"}' } }),
    line({ timestamp: ts, type: 'response_item', payload: { type: 'reasoning', summary: [{ type: 'summary_text', text: 'REASONMARKERFIVE' }] } }),
    user('Mixed chat about pelicanroute'),
  ]), base + 2000);
  // Per-chat cap: 60 messages of 8,000 chars = 480,000 chars > 400,000; the tail marker is past the cap.
  const big: string[] = [user('Big chat')];
  for (let i = 0; i < 60; i += 1) big.push(assistant(`${'word '.repeat(1_600)}`));
  big.push(assistant('CAPTAILMARKER beyond the cap'));
  write(`${dir}/04/rollout-big.jsonl`, chat('big', big), base + 3000);
  // Will be deleted later (incremental drop).
  const doomed = write(`${dir}/05/rollout-doomed.jsonl`, chat('doomed', [user('Doomed chat'), assistant('ostrichvanish appears here')]), base + 4000);
  // Credential-like file name: listing and search must never open it.
  const authFile = write(`${dir}/06/rollout-auth-token.jsonl`, chat('auth', [user('authsecretterm')]), base + 5000);

  const agents = await import('./import-agents');
  const search = await import('./import-search');

  // Track every open under the fixture root (sync and async).
  const opened: string[] = [];
  const realOpen = fs.openSync;
  const realPromisesOpen = fs.promises.open;
  (fs as any).openSync = (file: any, ...rest: any[]) => { opened.push(path.resolve(String(file))); return (realOpen as any)(file, ...rest); };
  (fs.promises as any).open = (file: any, ...rest: any[]) => { opened.push(path.resolve(String(file))); return (realPromisesOpen as any)(file, ...rest); };
  const s = async (q: string, scope: 'title' | 'all' = 'title', offset = 0, limit = 50) => await search.searchAgentChats('codex', { ...opts, q, scope, offset, limit });

  try {
    // --- 1. Title search across unloaded pages; exact count; paging. -------
    const firstPage = agents.listAgentChats('codex', { ...opts, limit: 50 });
    assert.ok(!firstPage.chats.some((c) => c.title?.includes('Zebracorn')), 'needle is not on the first loaded page');
    const needle = await s('zebraCORN');
    assert.equal(needle.total, 1, 'case-insensitive title hit across all chats');
    assert.equal(needle.results[0].match, 'title');
    assert.ok(needle.results[0].groupLabel, 'result keeps its group label');
    const filler = await s('filler', 'title', 0, 50);
    assert.equal(filler.total, 60, 'exact result count');
    assert.equal(filler.results.length, 50);
    assert.equal(filler.hasMore, true);
    const filler2 = await s('filler', 'title', 50, 50);
    assert.equal(filler2.results.length, 10, 'second page');
    assert.equal(filler2.hasMore, false);

    // --- 1b. Cold title cache: the search must yield between uncached chats. ---
    search.clearTitleCache();
    const pending = search.searchAgentChats('codex', { ...opts, q: 'filler', scope: 'title', offset: 0, limit: 50 });
    let ticked = false;
    setImmediate(() => { ticked = true; });
    await pending;
    assert.equal(ticked, true, 'title search yields to the event loop on a cold cache');


    // --- 2. Switch off by default: zero body reads, body term unfindable, nothing stored.
    assert.equal(search.indexReadCounter.files, 0);
    const offStatus = search.searchIndexStatus('codex', opts);
    assert.equal(offStatus.enabled, false, 'off by default');
    assert.equal(offStatus.messageSearch, 'off');
    const bodyOff = await s('quasarwidget', 'all');
    assert.equal(bodyOff.total, 0, 'body-only term not findable while the switch is off');
    assert.equal(bodyOff.messageSearch.state, 'off');
    assert.equal(search.indexReadCounter.files, 0, 'no transcript body reads while off');
    assert.equal(fs.existsSync(search.importSearchDbPath()), false, 'no index file exists until the switch is turned on');
    assert.ok(!opened.includes(path.resolve(authFile)), 'credential-like file never opened by title search');

    // --- 3. Build, join, then query. ---------------------------------------
    const started = search.startSearchIndex('codex', opts);
    assert.equal(started.enabled, true);
    assert.equal(started.building, true);
    const joined = search.startSearchIndex('codex', opts);
    assert.equal(joined.building, true, 'second request joins the running build');
    await search.waitForSearchIndex('codex');
    const ready = search.searchIndexStatus('codex', opts);
    assert.equal(ready.messageSearch, 'ready');
    assert.equal(ready.indexedChats, ready.totalChats);
    assert.ok(ready.indexBytes > 0, 'index size reported');
    assert.ok(search.importSearchDbPath().startsWith(path.resolve(data)), 'index lives under the redirected data dir');
    assert.equal(path.basename(search.importSearchDbPath()), 'import-search.sqlite');
    assert.ok(!opened.includes(path.resolve(authFile)), 'credential-like file never opened by the index builder');
    assert.equal((await s('authsecretterm', 'all')).total, 0);

    // Message hit and snippet.
    const hit = await s('quasarwid', 'all');
    assert.equal(hit.total, 1, 'prefix match on the last term');
    assert.equal(hit.results[0].match, 'message');
    const snippet = hit.results[0].snippetHtml || '';
    assert.ok(snippet.includes('<b>quasarwidget</b>'), `match bolded: ${snippet}`);
    assert.ok(snippet.includes('&lt;script&gt;'), 'snippet HTML-escaped');
    assert.ok(!/<(?!\/?b>)/.test(snippet), 'only <b> tags in snippet');
    assert.ok(snippet.replace(/<\/?b>/g, '').replace(/&(lt|gt|amp|quot|#39);/g, '_').length <= 160, 'snippet max 160 chars');
    assert.equal((await s('quasarwidget', 'title')).total, 0, 'title scope never uses message text');
    // Two-word query: both terms required.
    assert.equal((await s('pelicanroute mixed', 'all')).total, 1);
    assert.equal((await s('pelicanroute zebracorn', 'all')).total, 0);

    // --- 4. Tool output, system text, reasoning not indexed. -------------------
    for (const marker of ['SYSMARKERONE', 'DEVMARKERTWO', 'TOOLMARKERTHREE', 'CMDMARKERFOUR', 'REASONMARKERFIVE']) {
      assert.equal((await s(marker, 'all')).total, 0, `${marker} must not be indexed`);
    }

    // --- 5. Per-chat cap. ------------------------------------------------------
    assert.equal((await s('CAPTAILMARKER', 'all')).total, 0, 'text beyond the per-chat cap is not indexed');
    assert.ok(ready.truncatedChats >= 1, 'truncated chat noted');

    // --- 6. Hostile queries return safely. ---------------------------------------
    for (const q of ['"', '*', 'NEAR(', '; DROP TABLE messages; --', "' OR 1=1 --", 'quasar"widget', 'a AND OR NOT', ')(', '\u0000', 'x'.repeat(5000)]) {
      const result = await s(q, 'all');
      assert.ok(Array.isArray(result.results), `hostile query ${JSON.stringify(q.slice(0, 20))} returned results array`);
    }
    assert.equal(search.buildFtsQuery('NEAR( foo" bar'), '"NEAR" "foo" "bar"*');
    assert.equal(search.buildFtsQuery('";*'), '');
    assert.equal((await s('quasarwidget', 'all')).total, 1, 'index intact after hostile queries');

    // --- 7. Incremental: changed file re-read, deleted file dropped, others skipped.
    const readsBefore = search.indexReadCounter.files;
    fs.appendFileSync(bodyFile, assistant('newly added giraffeword') + '\n');
    fs.utimesSync(bodyFile, new Date(base + 9000), new Date(base + 9000));
    fs.rmSync(doomed);
    assert.equal((await s('ostrichvanish', 'all')).total, 0, 'vanished chat never returned, even before re-index');
    search.startSearchIndex('codex', opts);
    await search.waitForSearchIndex('codex');
    assert.equal(search.indexReadCounter.files - readsBefore, 1, 'only the changed file was re-read');
    assert.equal((await s('giraffeword', 'all')).total, 1, 'changed file picked up');
    const after = search.searchIndexStatus('codex', opts);
    assert.equal(after.indexedChats, after.totalChats, 'deleted file removed from the index');

    // --- 8. Cancel stops the build; partial index stays usable. ------------------
    search.deleteAgentSearchIndex('codex');
    search.startSearchIndex('codex', opts);
    search.cancelSearchIndex('codex');
    await search.waitForSearchIndex('codex');
    const partial = search.searchIndexStatus('codex', opts);
    assert.equal(partial.building, false);
    assert.ok(partial.indexedChats < partial.totalChats, 'cancel stopped before finishing');
    assert.equal(partial.messageSearch, 'partial');
    search.startSearchIndex('codex', opts);
    await search.waitForSearchIndex('codex');
    assert.equal(search.searchIndexStatus('codex', opts).messageSearch, 'ready', 'resumes to ready');

    // --- 9. Delete removes rows; count goes to zero; file removed. ---------------
    const deleted = search.deleteAgentSearchIndex('codex');
    assert.ok(deleted.removedChats > 0);
    const gone = search.searchIndexStatus('codex', opts);
    assert.equal(gone.indexedChats, 0);
    assert.equal(gone.enabled, false);
    assert.equal((await s('quasarwidget', 'all')).total, 0, 'no message hits after delete');
    assert.equal(fs.existsSync(search.importSearchDbPath()), false, 'last agent deleted removes the database file');

    // Delete-all and an agent that vanished from detection stay reachable.
    search.startSearchIndex('codex', opts);
    await search.waitForSearchIndex('codex');
    assert.equal(search.listIndexedAgents().agents.length, 1);
    const ghost = search.searchIndexStatus('ghost-agent', opts);
    assert.equal(ghost.indexedChats, 0, 'status works for an agent that is not detected');
    search.deleteAllSearchIndexes();
    assert.equal(fs.existsSync(search.importSearchDbPath()), false, 'delete all removes the file');
    assert.equal(search.listIndexedAgents().agents.length, 0);

    // --- 10. FTS5 unavailable: title search still works. ------------------------
    search.closeImportSearchDb();
    search.setFtsProbeForTest(() => ({ ok: false, reason: 'simulated: no FTS5' }));
    const fallback = await s('zebracorn', 'all');
    assert.equal(fallback.total, 1, 'title search works without FTS5');
    assert.equal(fallback.messageSearch.state, 'unavailable');
    assert.equal(fallback.messageSearch.reason, 'simulated: no FTS5');
    assert.equal(search.searchIndexStatus('codex', opts).messageSearch, 'unavailable');
    assert.throws(() => search.startSearchIndex('codex', opts), /no FTS5/);
    search.setFtsProbeForTest(null);
    assert.equal(search.messageSearchAvailability().ok, true, 'real probe finds FTS5 in this build');
  } finally {
    (fs as any).openSync = realOpen;
    (fs.promises as any).open = realPromisesOpen;
    search.closeImportSearchDb();
    try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* temp */ }
  }
  console.log('import-search regression: ok');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
