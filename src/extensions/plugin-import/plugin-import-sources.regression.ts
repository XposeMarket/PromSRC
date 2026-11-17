/**
 * Regression for plugin import sources (PR: OpenAI portable Agent Plugins format,
 * live Claude/OpenAI official catalogs, no-git GitHub zips, local skill folders,
 * safer installs and the MCP activation gate). No network: every fetch is faked.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readPluginBundle, validateAgentPluginsManifest, readAgentPluginsMcp, AGENT_PLUGINS_SCHEMA, AGENT_PLUGINS_MCP_SCHEMA } from './formats';
import { OFFICIAL_CATALOG_URLS, CATALOGS, loadCatalog, parseCatalog, resolveCatalogEntry } from './catalogs';
import { extractGithubZip, materializeGithub, safeSubpath } from './source';
import {
  activateMcpServers, convertMcpServer, deactivateMcpServers, enableReadyMcpServers, getImportedPlugin,
  installBundle, scanSkillFolders, uninstallPlugin,
} from './import-service';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const JSZip = require('jszip');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-plugin-sources-'));
const w = (rel: string, text: string) => { const p = path.join(tmp, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); return p; };
const json = (v: unknown) => JSON.stringify(v);
// Placeholder expansion writes forward slashes (portable for spawn args); compare normalized.
const under = (p: unknown, root: string) => path.resolve(String(p)).toLowerCase().startsWith(path.resolve(root).toLowerCase());
const SHA = 'a'.repeat(40);

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

async function zipOf(files: Record<string, string>): Promise<Buffer> {
  const z = new JSZip();
  for (const [name, text] of Object.entries(files)) z.file(name, text);
  return Buffer.from(await z.generateAsync({ type: 'uint8array' }));
}

(async () => {
  // ── 1. Portable Agent Plugins 1.0.0 (root plugin.json + mcp.json) ────────────
  w('ap/plugin.json', json({ $schema: AGENT_PLUGINS_SCHEMA, name: 'demo-portable', version: '1.0.0', description: 'Portable demo' }));
  w('ap/mcp.json', json({ $schema: AGENT_PLUGINS_MCP_SCHEMA, mcpServers: {
    local: { type: 'stdio', command: 'node', args: ['${PLUGIN_ROOT}/server.js'], cwd: '${PLUGIN_DATA}' },
    remote: { type: 'streamable-http', url: 'https://mcp.example.com/mcp', headers: { Authorization: 'Bearer ${DEMO_KEY}' } },
  } }));
  w('ap/skills/hello/SKILL.md', '---\nname: hello\ndescription: Say hello\n---\n\nHello.');
  w('ap/server.js', 'process.stdin.resume();');
  const ap = readPluginBundle(path.join(tmp, 'ap'))!;
  assert.equal(ap.format, 'agent-plugins', 'root plugin.json with the 1.0.0 schema is detected');
  assert.deepEqual(ap.mcpServers.map((s) => s.id).sort(), ['local', 'remote']);
  assert.ok(ap.skillDirs.some((d) => path.basename(d) === 'hello'));

  // A root plugin.json without the Agent Plugins schema is NOT treated as a plugin.
  w('not-ap/plugin.json', json({ name: 'random-package' }));
  assert.equal(readPluginBundle(path.join(tmp, 'not-ap')), null, 'plain plugin.json is ignored');
  // Other schema versions and bad fields are rejected with a reason.
  assert.match(validateAgentPluginsManifest({ $schema: 'https://agent-plugins.org/schemas/2.0.0/plugin.schema.json', name: 'x' })[0], /unsupported Agent Plugins version/);
  assert.ok(validateAgentPluginsManifest({ $schema: AGENT_PLUGINS_SCHEMA, name: 'Bad--Name' }).length > 0, 'name pattern enforced');
  assert.ok(validateAgentPluginsManifest({ $schema: AGENT_PLUGINS_SCHEMA, name: 'ok', surprise: 1 }).some((p) => p.includes('surprise')), 'unknown fields reported');
  const badMcp = readAgentPluginsMcp({ $schema: AGENT_PLUGINS_MCP_SCHEMA, mcpServers: {
    a: { type: 'stdio', command: 'x', env: { PLUGIN_ROOT: '/etc' } },
    b: { type: 'stdio', command: 'x', cwd: '/etc' },
    c: { type: 'websocket', url: 'wss://x' },
  } });
  assert.equal(badMcp.servers.length, 0, 'reserved env, absolute cwd and unknown transport are all rejected');
  assert.equal(badMcp.problems.length, 3);
  // .codex-plugin stays a fallback.
  w('legacy/.codex-plugin/plugin.json', json({ name: 'legacy' }));
  w('legacy/skills/s1/SKILL.md', '---\nname: s1\ndescription: d\n---\n\nx');
  assert.equal(readPluginBundle(path.join(tmp, 'legacy'))!.format, 'codex');

  // ── 2. MCP conversion: cwd, PLUGIN_DATA, no env secret values persisted ───────
  const pkg = path.join(tmp, 'ap');
  const dataDir = path.join(tmp, 'ap-data');
  fs.mkdirSync(dataDir, { recursive: true });
  const local = convertMcpServer('demo-portable', ap.mcpServers.find((s) => s.id === 'local')!, pkg, undefined, { dataDir });
  assert.deepEqual(local.problems, []);
  assert.equal(local.config.transport, 'stdio');
  assert.equal(path.resolve(local.config.cwd), path.resolve(dataDir), 'cwd ${PLUGIN_DATA} resolves to the data dir');
  assert.ok(under(local.config.args[0], pkg), 'PLUGIN_ROOT resolves to the package dir');
  process.env.DEMO_KEY = 'super-secret-env-value';
  const remote = convertMcpServer('demo-portable', ap.mcpServers.find((s) => s.id === 'remote')!, pkg, undefined, { dataDir });
  assert.ok(!JSON.stringify(remote.config).includes('super-secret-env-value'), 'process.env secret values are never baked into saved config');
  assert.equal(remote.config.headers.Authorization, 'Bearer ${vault:plugins.demo-portable.DEMO_KEY}');
  delete process.env.DEMO_KEY;
  const escape = convertMcpServer('p', { id: 'e', config: { type: 'stdio', command: 'node', cwd: '../../outside' } }, pkg, undefined, { dataDir });
  assert.ok(escape.problems.some((p) => /outside the plugin/.test(p)), 'cwd escaping the plugin is a problem, not silently used');

  // Catalogs: exactly two remote URLs and one local-only personal catalog.
  assert.deepEqual([...OFFICIAL_CATALOG_URLS].sort(), [
    'https://raw.githubusercontent.com/anthropics/claude-plugins-official/main/.claude-plugin/marketplace.json',
    'https://raw.githubusercontent.com/openai/plugins/main/.agents/plugins/marketplace.json',
  ].sort());
  assert.deepEqual(CATALOGS.map(({ id, url }) => [id, url]), [
    ['claude-official', OFFICIAL_CATALOG_URLS[0]], ['openai-official', OFFICIAL_CATALOG_URLS[1]], ['codex-personal', undefined],
  ]);
  const parsed = parseCatalog({ plugins: [
    { name: 'in-repo', source: './plugins/in-repo', description: 'A' },
    { name: 'pinned', source: { source: 'github', repo: 'o/r', sha: SHA } },
    { name: 'shell', source: { source: 'command', command: 'curl x | sh' } },
    { name: 'hosted', source: './plugins/hosted', policy: { authentication: 'OAUTH' } },
    { name: 'blocked', source: './plugins/b', policy: { installation: 'NOT_AVAILABLE' } },
  ], renames: { 'old-name': 'in-repo' } }, { id: 'claude-official', label: 'Claude official' }, { kind: 'github', repo: 'anthropics/claude-plugins-official', ref: 'main' });
  const byName = Object.fromEntries(parsed.entries.map((e) => [e.name, e]));
  assert.equal(byName['in-repo'].id, 'claude-official:in-repo', 'stable entry ids');
  assert.deepEqual(byName['in-repo'].source, { kind: 'github', repo: 'anthropics/claude-plugins-official', path: 'plugins/in-repo', ref: 'main' });
  assert.equal((byName.pinned.source as any).sha, SHA, 'catalog sha pin kept');
  assert.equal(byName.shell.installable, false, 'shell-command installs are never run');
  assert.ok(byName.hosted.note, 'hosted-app entries are labelled');
  assert.equal(byName.blocked.installable, false);

  // Live -> cache -> stale fallback, with a fake fetcher.
  const cacheDir = path.join(tmp, 'catalog-cache');
  let calls = 0;
  let online = true;
  const fetcher = async (url: string) => {
    calls++;
    assert.ok(OFFICIAL_CATALOG_URLS.includes(url), `only allowlisted URLs are fetched (${url})`);
    if (!online) throw new Error('offline');
    return jsonResponse({ plugins: [{ name: 'in-repo', source: './plugins/in-repo', description: 'A' }], renames: { 'old-name': 'in-repo' } });
  };
  const opts = { cacheDir, fetcher, home: path.join(tmp, 'home-empty') };
  const live = await loadCatalog('claude-official', opts);
  assert.equal(live.origin, 'live');
  assert.equal(live.entries.length, 1);
  assert.equal((await loadCatalog('claude-official', opts)).origin, 'cache', 'second load within TTL uses the cache');
  assert.equal(calls, 1);
  online = false;
  const stale = await loadCatalog('claude-official', { ...opts, refresh: true });
  assert.equal(stale.origin, 'stale', 'failed refresh never wipes a good cache');
  assert.equal(stale.entries.length, 1);
  const none = await loadCatalog('openai-official', { ...opts, cacheDir: path.join(tmp, 'empty-cache') });
  assert.equal(none.origin, 'none', 'no cache + offline = honest unavailable state');
  assert.equal((await resolveCatalogEntry('claude-official:old-name', opts)).name, 'in-repo', 'renames honoured');

  // ── 4. GitHub zips without git: limits, traversal, sha pinning ───────────────
  assert.throws(() => safeSubpath('../etc'), /Unsafe/);
  assert.throws(() => safeSubpath('C:/Windows'), /Unsafe/);
  const good = await zipOf({ [`r-${SHA}/plugins/p/.claude-plugin/plugin.json`]: json({ name: 'zipped' }), [`r-${SHA}/plugins/p/skills/z/SKILL.md`]: '---\nname: z\ndescription: d\n---\n\nz', [`r-${SHA}/README.md`]: 'x' });
  const dest1 = fs.mkdtempSync(path.join(tmp, 'x1-'));
  const ex = await extractGithubZip(good, 'plugins/p', dest1);
  assert.equal(ex.files, 2, 'only the requested subpath is extracted');
  assert.ok(fs.existsSync(path.join(dest1, '.claude-plugin', 'plugin.json')));
  const evil = await zipOf({ 'r-main/ok.txt': 'x' });
  const z2 = await JSZip.loadAsync(evil);
  z2.file('r-main/../../escape.txt', 'pwned');
  const evilBuf = Buffer.from(await z2.generateAsync({ type: 'uint8array' }));
  await assert.rejects(() => extractGithubZip(evilBuf, '', fs.mkdtempSync(path.join(tmp, 'x2-'))), /Unsafe|outside/);
  assert.ok(!fs.existsSync(path.join(tmp, 'escape.txt')), 'traversal entry never written');
  await assert.rejects(() => extractGithubZip(good, '', fs.mkdtempSync(path.join(tmp, 'x3-')), { downloadBytes: 1e9, extractedBytes: 1e9, files: 1, depth: 24 } as any), /files|limit|too many/i, 'file-count limit enforced');

  const ghFetcher = (archive: Buffer) => async (url: string) => {
    if (url.startsWith('https://codeload.github.com/')) return new Response(new Uint8Array(archive), { status: 200 });
    if (url.startsWith('https://api.github.com/')) return new Response(SHA, { status: 200 });
    throw new Error(`unexpected ${url}`);
  };
  const staging = path.join(tmp, 'staging');
  const m = await materializeGithub({ repo: 'o/r', path: 'plugins/p', sha: SHA }, staging, { fetcher: ghFetcher(good) });
  assert.equal(m.commit, SHA);
  assert.equal(readPluginBundle(m.dir)!.format, 'claude', 'downloaded plugin is readable with no git');
  m.cleanup();
  const wrongSha = await zipOf({ [`r-${'b'.repeat(40)}/plugins/p/.claude-plugin/plugin.json`]: json({ name: 'x' }) });
  await assert.rejects(() => materializeGithub({ repo: 'o/r', path: 'plugins/p', sha: SHA }, staging, { fetcher: ghFetcher(wrongSha) }), /does not match/, 'sha mismatch fails, no fallback to a branch');

  // ── 5. Local skill folders (Hermes / OpenClaw / Agent Skills) ─────────────────
  const home = path.join(tmp, 'home');
  w('home/.hermes/skills/devops/deploy-k8s/SKILL.md', '---\nname: deploy-k8s\ndescription: Deploy to k8s\n---\n\nDeploy.');
  w('home/.openclaw/skills/notes/SKILL.md', '---\nname: notes\ndescription: Take notes\n---\n\nNotes.');
  const skillRows = scanSkillFolders({
    roots: [
      { harness: 'hermes', prefix: 'hermes', label: 'Hermes skills', dir: path.join(home, '.hermes', 'skills') },
      { harness: 'openclaw', prefix: 'openclaw', label: 'OpenClaw skills', dir: path.join(home, '.openclaw', 'skills') },
    ],
    userPluginsDir: path.join(tmp, 'user-plugins-skills'),
  });
  assert.equal(skillRows.length, 2);
  assert.ok(skillRows.some((r) => /deploy-k8s/.test(String(r.id)) && /devops/.test(String(r.id))), 'nested skill ids keep their relative path');

  // ── 6. Install: durable package copy, conflict refusal, activation gate ──────
  const skills = new Map<string, string>();
  const mcp = new Map<string, any>();
  const vault = new Set<string>();
  const connected: string[] = [];
  const deps: any = {
    userPluginsDir: path.join(tmp, 'user-plugins'),
    skipReload: true,
    skills: {
      async importBundles(src: string, o?: any) { skills.set(o.id, src); return [{ id: o.id }]; },
      deleteSkill(id: string) { return skills.delete(id); },
      scanSkills() {},
      get(id: string) { return skills.get(id); },
    },
    mcp: {
      getConfigs: () => [...mcp.values()],
      upsertConfig: (c: any) => mcp.set(c.id, c),
      deleteConfig: (id: string) => mcp.delete(id),
      connect: async (id: string) => { connected.push(id); },
      disconnect: async () => {},
    },
    vault: { has: (k: string) => vault.has(k) },
  };

  // A user's own skill with the id this import would create is never replaced.
  skills.set('demo-portable-hello', 'user-owned');
  await assert.rejects(() => installBundle(ap, pkg, deps), /does not own/);
  assert.equal(skills.get('demo-portable-hello'), 'user-owned');
  skills.delete('demo-portable-hello');

  const res = await installBundle(ap, pkg, deps);
  assert.ok(res.skills.includes('demo-portable-hello'));
  assert.equal(res.mcpServers.length, 2);
  assert.ok(res.mcpServers.every((s) => !s.enabled && s.activation === 'pending'), 'every imported MCP server starts OFF');
  assert.ok([...mcp.values()].every((c) => c.enabled === false));
  const ledger = getImportedPlugin('demo-portable', deps.userPluginsDir)!;
  assert.ok(ledger.packageDir && fs.existsSync(path.join(ledger.packageDir, 'server.js')), 'package files are copied into Prometheus storage');
  const localCfg = mcp.get('demo-portable-local');
  assert.ok(under(localCfg.args[0], ledger.packageDir!), 'MCP paths point at the durable copy, not the source');

  // Saving a secret never turns a pending server on.
  vault.add('plugins.demo-portable.DEMO_KEY');
  enableReadyMcpServers('demo-portable', deps);
  assert.ok([...mcp.values()].every((c) => c.enabled === false), 'secret save does not activate');
  assert.equal(connected.length, 0);

  // Explicit activation turns them on; deactivation turns them off again.
  const on = await activateMcpServers('demo-portable', deps);
  assert.ok(on.every((r) => r.enabled && r.activation === 'active'));
  assert.equal(connected.length, 2);
  // A changed config after approval drops back to pending.
  mcp.set('demo-portable-remote', { ...mcp.get('demo-portable-remote'), url: 'https://evil.example.com/mcp' });
  const recheck = enableReadyMcpServers('demo-portable', deps);
  assert.equal(recheck.find((r) => r.id === 'demo-portable-remote')!.activation, 'pending', 'config change resets approval');
  assert.equal(mcp.get('demo-portable-remote').enabled, false);
  const off = await deactivateMcpServers('demo-portable', deps);
  assert.ok(off.every((r) => !r.enabled && r.activation === 'pending'));

  // Reinstall keeps the data folder; uninstall keeps it unless purged.
  fs.writeFileSync(path.join(ledger.dataDir!, 'state.json'), '{"keep":true}');
  await installBundle(ap, pkg, deps, { overwrite: true });
  assert.ok(fs.existsSync(path.join(ledger.dataDir!, 'state.json')), 'reinstall keeps plugin data');
  const un = await uninstallPlugin('demo-portable', deps);
  assert.ok(un.dataKept && fs.existsSync(path.join(ledger.dataDir!, 'state.json')), 'uninstall keeps data by default');
  assert.equal(mcp.size, 0);
  assert.equal(skills.size, 0);

  // Nothing importable is an error, not a fake success.
  w('empty-ap/plugin.json', json({ $schema: AGENT_PLUGINS_SCHEMA, name: 'empty-one' }));
  const empty = readPluginBundle(path.join(tmp, 'empty-ap'));
  if (empty) await assert.rejects(() => installBundle(empty, empty.root, deps), /Nothing usable/);

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('plugin-import-sources regression passed');
})().catch((err) => { console.error(err); process.exit(1); });
