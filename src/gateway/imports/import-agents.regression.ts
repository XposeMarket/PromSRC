import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Fixture-only regression for the Agents & imports page. Never touches a real
// user's agent folders: every path is under a temp root.
async function main(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prometheus-import-agents-'));
  const data = path.join(root, 'data');
  const workspace = path.join(data, 'workspace');
  fs.mkdirSync(workspace, { recursive: true });
  process.env.PROMETHEUS_DATA_DIR = data;
  process.env.PROMETHEUS_WORKSPACE_DIR = workspace;
  const home = path.join(root, 'home');
  const localAppData = path.join(root, 'local');
  const appData = path.join(root, 'roaming');
  const opts = { homeDir: home, localAppData, appData };

  const write = (relative: string, value: string): string => {
    const file = path.join(root, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, value, 'utf8');
    return file;
  };
  const SECRET_TEXT = 'PREVIEW-ONLY-SENTINEL';
  const ts = '2026-08-09T12:00:00.000Z';
  const codex = (id: string, cwd: string, first: string, last: string): string => [
    JSON.stringify({ timestamp: ts, type: 'session_meta', payload: { id, cwd } }),
    JSON.stringify({ timestamp: ts, type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: first }] } }),
    JSON.stringify({ timestamp: ts, type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: last }] } }),
  ].join('\n') + '\n';

  const alpha = process.platform === 'win32' ? 'C:\\work\\alpha' : '/work/alpha';
  const beta = process.platform === 'win32' ? 'C:\\work\\beta' : '/work/beta';
  for (let index = 0; index < 5; index += 1) {
    write(`home/.codex/sessions/2026/08/0${index + 1}/rollout-a${index}.jsonl`, codex(`sess-a${index}`, alpha, `Alpha task ${index}`, `${SECRET_TEXT} alpha ${index}`));
  }
  write('home/.codex/sessions/2026/08/09/rollout-b0.jsonl', codex('sess-b0', beta, 'Beta task', `${SECRET_TEXT} beta`));
  write('home/.codex/sessions/2026/08/09/rollout-loose.jsonl', [
    JSON.stringify({ timestamp: ts, type: 'session_meta', payload: { id: 'sess-loose' } }),
    JSON.stringify({ timestamp: ts, type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Loose chat' }] } }),
  ].join('\n') + '\n');
  write('home/.codex/config.toml', '[mcp_servers.node]\ncommand = "node"\n');
  // A credential-looking file inside the agent folder must never be opened.
  const authFile = write('home/.codex/sessions/2026/08/09/rollout-auth-token.jsonl', '{"token":"nope"}\n');
  write('home/.claude/projects/-work-gamma/c1.jsonl', JSON.stringify({ type: 'user', sessionId: 'claude-1', cwd: '/work/gamma', message: { role: 'user', content: 'Gamma hello' } }) + '\n');

  const agents = await import('./import-agents');
  const service = await import('./import-service');

  // --- 1. Discovery and the agent list read no file contents at all. -------
  const opened: string[] = [];
  const realOpen = fs.openSync;
  const realReadFile = fs.readFileSync;
  (fs as any).openSync = (file: any, ...rest: any[]) => { opened.push(String(file)); return (realOpen as any)(file, ...rest); };
  (fs as any).readFileSync = (file: any, ...rest: any[]) => { opened.push(String(file)); return (realReadFile as any)(file, ...rest); };
  const underRoot = () => opened.filter((file) => path.resolve(file).startsWith(path.resolve(home)));
  try {
    const listed = agents.listImportAgents(opts);
    assert.equal(underRoot().length, 0, `discovery opened files: ${underRoot().join(', ')}`);
    const codexRow = listed.agents.find((agent) => agent.id === 'codex');
    assert.ok(codexRow, 'codex row present');
    assert.equal(codexRow!.state, 'found');
    assert.ok(codexRow!.setupSources.some((source) => source.id === 'codex-mcp-integrations'), 'MCP config merged into the agent row');
    assert.equal(listed.agents.filter((agent) => agent.id === 'codex').length, 1, 'one row per agent');
    assert.ok(listed.agents.find((agent) => agent.id === 'claude'), 'claude row present');
    assert.ok(!JSON.stringify(listed).includes(SECRET_TEXT));

    // --- 2. Opening a row: titles without preview do not read the tail. ----
    opened.length = 0;
    const page = agents.listAgentChats('codex', { ...opts, limit: 50 });
    assert.ok(!JSON.stringify(page).includes(SECRET_TEXT), 'no preview text unless requested');
    assert.ok(!underRoot().includes(authFile), 'credential-named file never opened');
    assert.equal(page.total, 7, 'auth-named file excluded from listing');
    // --- 3. Preview only on explicit request. ------------------------------
    const withPreview = agents.listAgentChats('codex', { ...opts, limit: 50, preview: true });
    assert.ok(withPreview.chats.some((chat) => String(chat.preview || '').includes(SECRET_TEXT)), 'preview read on request');
    assert.ok(!underRoot().includes(authFile));
  } finally {
    (fs as any).openSync = realOpen;
    (fs as any).readFileSync = realReadFile;
  }

  // Paging is stable and bounded.
  const first = agents.listAgentChats('codex', { ...opts, limit: 3 });
  const second = agents.listAgentChats('codex', { ...opts, limit: 3, offset: 3 });
  assert.equal(first.chats.length, 3);
  assert.equal(first.hasMore, true);
  assert.equal(new Set([...first.chats, ...second.chats].map((chat) => chat.id)).size, 6);

  // --- 4. Grouping: Codex cwd is a folder guess; Claude projects are projects.
  const groups = agents.listAgentGroups('codex', opts);
  const alphaGroup = groups.groups.find((group) => group.chatCount === 5)!;
  assert.equal(alphaGroup.kind, 'folder');
  assert.ok(alphaGroup.label.startsWith('Folder: '));
  assert.equal(groups.looseChats, 1);
  const claudeGroups = agents.listAgentGroups('claude', opts);
  assert.equal(claudeGroups.groups[0].kind, 'project');
  assert.ok(!claudeGroups.groups[0].label.startsWith('Folder:'));

  // --- 5. Selection to request mapping: whole, partial, loose. -------------
  const all = agents.listAgentChats('codex', { ...opts, limit: 100 }).chats;
  const alphaChats = all.filter((chat) => chat.groupKey === alphaGroup.key);
  const betaGroup = groups.groups.find((group) => group.chatCount === 1)!;
  const loose = all.find((chat) => !chat.groupKey)!;
  const selection = { groups: [betaGroup.key], chats: [alphaChats[0].id, alphaChats[1].id, loose.id] };
  const preflight = agents.preflightAgentSelection('codex', selection, () => false, opts);
  assert.equal(preflight.totalChats, 4);
  assert.equal(preflight.looseChats, 1);
  const partial = preflight.groups.find((group) => group.key === alphaGroup.key)!;
  assert.deepEqual([partial.selected, partial.total, partial.all], [2, 5, false], 'partial project: 2 of 5');
  const whole = preflight.groups.find((group) => group.key === betaGroup.key)!;
  assert.deepEqual([whole.selected, whole.total, whole.all], [1, 1, true], 'whole project: all');
  const requested = preflight.requests.flatMap((request) => request.sourceFiles).map((file) => path.basename(file)).sort();
  const expected = [alphaChats[0].id, alphaChats[1].id, loose.id, all.find((chat) => chat.groupKey === betaGroup.key)!.id].map((id) => path.basename(id)).sort();
  assert.deepEqual(requested, expected, 'requests contain exactly the selected files');
  assert.ok(preflight.requests.every((request) => request.kind === 'conversation' && request.adapter === 'codex-local' && request.conversationMode === 'projects'));
  assert.equal(preflight.requests.reduce((sum, request) => sum + request.chatCount, 0), 4);

  // Exact count: whole group counts unlisted chats too (no "select everything on agent").
  const wholeAlpha = agents.preflightAgentSelection('codex', { groups: [alphaGroup.key] }, () => false, opts);
  assert.equal(wholeAlpha.totalChats, 5);
  assert.equal(wholeAlpha.groups[0].all, true);
  const empty = agents.preflightAgentSelection('codex', {}, () => false, opts);
  assert.equal(empty.totalChats, 0);
  assert.equal(empty.requests.length, 0);
  const unknown = agents.preflightAgentSelection('codex', { chats: ['../../etc/passwd'] }, () => false, opts);
  assert.equal(unknown.totalChats, 0, 'unknown chat ids never become file paths');
  assert.equal(unknown.unknownChats, 1);

  // Batching keeps each request bounded.
  const big = agents.buildAgentImportRequests('/r', 'codex-local', 'Codex', Array.from({ length: 3 }, (_, i) => ({ absolutePath: `/r/${i}`, bytes: agents.MAX_AGENT_BATCH_BYTES / 2 + 1 })));
  assert.equal(big.length, 3);

  // --- 6. Duplicate skip count, against the real stable key. ---------------
  const fake = agents.preflightAgentSelection('codex', { groups: [alphaGroup.key] }, (input) => input.sourceConversationId === 'sess-a0', opts);
  assert.equal(fake.alreadyImported, 1);
  assert.equal(fake.toImport, 4);
  const ownerId = 'local';
  const request = agents.preflightAgentSelection('codex', { groups: [betaGroup.key] }, () => false, opts).requests[0];
  const created = await service.createImportJob({
    ownerId, workspacePath: workspace, kind: 'conversation', sourcePath: request.sourcePath, requestedAdapter: request.adapter,
    sourceLabel: request.sourceLabel, conversationMode: 'projects', sourceFiles: request.sourceFiles, overwrite: false,
  });
  assert.equal(created.job.status, 'preview_ready', `fixture preview: ${created.job.error || ''}`);
  const ids = (created.job.preview?.conversationSummaries || []).map((item: any) => item.id);
  const committed = await service.confirmImportJob(created.job.id, ownerId, ids);
  assert.equal(committed.status, 'completed');
  const isDup = (input: any) => service.isConversationAlreadyImported({ ...input, ownerId, workspacePath: workspace });
  const after = agents.preflightAgentSelection('codex', { groups: [betaGroup.key, alphaGroup.key] }, isDup, opts);
  assert.equal(after.totalChats, 6);
  assert.equal(after.alreadyImported, 1, 'the imported fixture chat is counted as already imported');
  assert.equal(after.toImport, 5);
  assert.throws(() => service.requestCancelImportJob(committed.id, ownerId), /running import/);

  // --- 7. Empty state: a fresh install with no agents. ---------------------
  const bare = path.join(root, 'bare');
  fs.mkdirSync(bare, { recursive: true });
  assert.deepEqual(agents.listImportAgents({ homeDir: bare, localAppData: path.join(bare, 'l'), appData: path.join(bare, 'r') }).agents, []);

  fs.rmSync(root, { recursive: true, force: true });
  console.log('import-agents regression passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
