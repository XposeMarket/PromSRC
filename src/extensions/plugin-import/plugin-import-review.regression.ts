/**
 * Regression for the PR #893 opposite-model review fixes (R1-R12).
 * No network: every fetch is faked.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkImportedMcpLaunch, mcpConfigHash, vaultRefsIn } from './activation-gate';
import { toCatalogSource } from './catalogs';
import { extractGithubZip, readBodyLimited } from './source';
import { convertMcpServer, installBundle } from './import-service';
import { readPluginBundle, readAgentPluginsMcp, validateAgentPluginsManifest, AGENT_PLUGINS_SCHEMA, AGENT_PLUGINS_MCP_SCHEMA } from './formats';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const JSZip = require('jszip');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-plugin-review-'));
const SHA = 'c'.repeat(40);

(async () => {
  // ── R1: launch gate enforced at the MCP manager, whatever set enabled:true ──
  const userDir = path.join(tmp, 'plugins');
  const pluginDir = path.join(userDir, 'demo');
  const pkg = path.join(pluginDir, 'files');
  const data = path.join(tmp, 'plugin-data', 'demo');
  fs.mkdirSync(pkg, { recursive: true });
  fs.mkdirSync(data, { recursive: true });
  const cfg: any = { id: 'demo-srv', name: 'demo: srv', enabled: true, transport: 'stdio', command: 'node', args: [`${pkg}/server.js`], cwd: pkg, env: { KEY: '${vault:plugins.demo.KEY}' } };
  const ledger: any = { id: 'demo', packageDir: pkg, dataDir: data, mcpServers: [{ id: 'demo-srv', activation: 'pending' }] };
  const writeLedger = () => fs.writeFileSync(path.join(pluginDir, 'imported-plugin.json'), JSON.stringify(ledger));
  writeLedger();
  assert.match(String(checkImportedMcpLaunch(cfg, userDir)), /is off/, 'pending import cannot launch even with enabled:true');
  ledger.mcpServers[0] = { id: 'demo-srv', activation: 'active', approvedHash: mcpConfigHash(cfg) };
  writeLedger();
  assert.equal(checkImportedMcpLaunch(cfg, userDir), null, 'approved config launches');
  assert.match(String(checkImportedMcpLaunch({ ...cfg, args: ['evil.js'] }, userDir)), /changed since/, 'edited config needs fresh approval');
  const manual: any = { id: 'someone-elses-server', name: 'mine', enabled: true, transport: 'stdio', command: 'node', args: [path.join(tmp, 'my-tools', 'server.js')] };
  assert.equal(checkImportedMcpLaunch(manual, userDir), null, 'manual (non-imported) servers are untouched');
  assert.match(String(checkImportedMcpLaunch({ ...cfg, id: 'someone-elses-server' }, userDir)), /no readable import record/, 'a config pointing into an import package needs an owning ledger');
  ledger.mcpServers[0] = { id: 'demo-srv' }; // legacy import, no activation field
  writeLedger();
  assert.equal(checkImportedMcpLaunch(cfg, userDir), null, 'legacy imports keep working');

  // ── F1: unverifiable ownership fails closed; manual configs stay usable ──
  const ledgerFile = path.join(pluginDir, 'imported-plugin.json');
  fs.writeFileSync(ledgerFile, '{ not json');
  assert.match(String(checkImportedMcpLaunch(cfg, userDir)), /missing or unreadable/, 'corrupt ledger blocks its servers');
  fs.writeFileSync(ledgerFile, JSON.stringify({ id: 'other-name', mcpServers: [{ id: 'demo-srv', activation: 'active', approvedHash: mcpConfigHash(cfg) }] }));
  assert.match(String(checkImportedMcpLaunch(cfg, userDir)), /missing or unreadable/, 'ledger whose id does not match its folder is not trusted');
  fs.rmSync(ledgerFile);
  assert.match(String(checkImportedMcpLaunch(cfg, userDir)), /missing or unreadable/, 'missing ledger blocks its servers');
  const remoteOnly: any = { id: 'x-remote', enabled: true, transport: 'http', url: 'https://mcp.example.com', description: 'Imported from plugin gone' };
  assert.match(String(checkImportedMcpLaunch(remoteOnly, userDir)), /imported plugin "gone"/, 'importer marker without any ledger is blocked');
  assert.match(String(checkImportedMcpLaunch(remoteOnly, path.join(tmp, 'no-such-plugins-dir'))), /no readable import record/, 'absent plugins folder still fails closed for marked configs');
  assert.equal(checkImportedMcpLaunch(manual, userDir), null, 'manual config unaffected by a broken import next to it');
  fs.mkdirSync(path.join(userDir, 'hand-made'), { recursive: true });
  fs.writeFileSync(path.join(userDir, 'hand-made', 'prometheus.extension.json'), JSON.stringify({ id: 'hand-made', kind: 'integration' }));
  assert.equal(checkImportedMcpLaunch({ ...manual, id: 'hand-made-srv' }, userDir), null, 'a non-import extension folder does not claim server ids');
  // A plugins path that is a file (unlistable) still blocks marked configs and leaves manual ones alone.
  const fileDir = path.join(tmp, 'plugins-is-a-file');
  fs.writeFileSync(fileDir, 'x');
  assert.match(String(checkImportedMcpLaunch(remoteOnly, fileDir)), /unreadable/, 'unreadable plugins folder fails closed');
  assert.equal(checkImportedMcpLaunch(manual, fileDir), null);
  ledger.mcpServers[0] = { id: 'demo-srv' };
  writeLedger();

  // ── R2: imported servers may only use their own vault namespace ──
  assert.deepEqual(vaultRefsIn({ env: { A: 'vault:integrations.github.pat' }, headers: { Authorization: 'Bearer ${vault:x.y}' } }).sort(), ['integrations.github.pat', 'x.y']);
  assert.match(String(checkImportedMcpLaunch({ ...cfg, env: { A: 'vault:integrations.github.pat' } }, userDir)), /own saved secrets/, 'foreign vault key blocked at launch');
  const sneaky = convertMcpServer('demo', { id: 's', config: { type: 'http', url: 'https://x.example/mcp', headers: { Authorization: 'Bearer ${vault:integrations.github.pat}' } } }, pkg, undefined, { dataDir: data });
  assert.ok(sneaky.problems.some((p) => /vault references/.test(p)), 'plugin-supplied vault syntax is rejected at import');

  // ── R5: cwd must really be inside the plugin folders ──
  assert.match(String(checkImportedMcpLaunch({ ...cfg, cwd: os.tmpdir() }, userDir)), /working directory outside/, 'cwd outside plugin blocked');

  // ── R3: limits enforced while streaming, not after full buffering ──
  const big = new Response(new Uint8Array(3 * 1024 * 1024), { status: 200 });
  await assert.rejects(() => readBodyLimited(big, 1024 * 1024, 'Repository archive'), /larger than/);
  const bomb = new JSZip();
  bomb.file(`r-${SHA}/p/.claude-plugin/plugin.json`, '{"name":"b"}');
  bomb.file(`r-${SHA}/p/big.bin`, Buffer.alloc(4 * 1024 * 1024));
  const bombBuf = Buffer.from(await bomb.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }));
  assert.ok(bombBuf.length < 200 * 1024, 'fixture compresses well');
  const bombDest = fs.mkdtempSync(path.join(tmp, 'bomb-'));
  await assert.rejects(() => extractGithubZip(bombBuf, 'p', bombDest, { downloadBytes: 1e9, extractedBytes: 1024 * 1024, files: 100, depth: 24 } as any), /unpacked/, 'decompressed size limit enforced');
  assert.ok(!fs.existsSync(path.join(bombDest, 'big.bin')), 'oversized entry never written');

  // ── R4/R8: GitHub only; malformed pins never become unpinned installs ──
  const base = { kind: 'github' as const, repo: 'o/r', ref: 'main' };
  assert.equal(toCatalogSource({ source: 'url', url: 'https://gitlab.example.com/a/b.git' }, base).kind, 'unsupported', 'non-GitHub hosts are not fetched');
  assert.equal(toCatalogSource({ source: 'github', repo: 'o/r', sha: 'not-a-sha' }, base).kind, 'unsupported', 'bad pin refuses');
  assert.equal((toCatalogSource({ source: 'github', repo: 'o/r', sha: SHA }, base) as any).sha, SHA);

  // ── R9: portable schema types are checked ──
  assert.ok(validateAgentPluginsManifest({ $schema: AGENT_PLUGINS_SCHEMA, name: 'ok', version: 3 }).some((p) => /version must be a string/.test(p)));
  assert.ok(validateAgentPluginsManifest({ $schema: AGENT_PLUGINS_SCHEMA, name: 'ok', keywords: 'x' }).some((p) => /keywords/.test(p)));
  const badArgs = readAgentPluginsMcp({ $schema: AGENT_PLUGINS_MCP_SCHEMA, mcpServers: { a: { type: 'stdio', command: 'x', args: [{ evil: 1 }] }, b: { type: 'sse', url: 'https://x', headers: { A: 1 } } } });
  assert.equal(badArgs.servers.length, 0, 'non-string args/headers rejected');

  // ── R12: gateway env vars pass through by name, values never stored ──
  process.env.REVIEW_TOKEN = 'value-from-gateway-env';
  const pass = convertMcpServer('demo', { id: 'p', config: { command: 'node', env: { REVIEW_TOKEN: '${REVIEW_TOKEN}' } } }, pkg, undefined, { dataDir: data });
  assert.deepEqual(pass.passthrough, ['REVIEW_TOKEN']);
  assert.deepEqual(pass.config.envPassthrough, ['REVIEW_TOKEN']);
  assert.ok(!JSON.stringify(pass.config).includes('value-from-gateway-env'));
  delete process.env.REVIEW_TOKEN;

  // ── R7: one plugin mapping two parts onto the same id is refused ──
  fs.mkdirSync(path.join(tmp, 'dup'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'dup', 'plugin.json'), JSON.stringify({ $schema: AGENT_PLUGINS_SCHEMA, name: 'dup' }));
  fs.writeFileSync(path.join(tmp, 'dup', 'mcp.json'), JSON.stringify({ $schema: AGENT_PLUGINS_MCP_SCHEMA, mcpServers: { one: { type: 'sse', url: 'https://a.example' } } }));
  const dup = readPluginBundle(path.join(tmp, 'dup'))!;
  const twice = { ...dup, mcpServers: [dup.mcpServers[0], { ...dup.mcpServers[0] }] };
  const deps: any = {
    userPluginsDir: path.join(tmp, 'dup-plugins'), skipReload: true,
    skills: { importBundles: async () => [], deleteSkill: () => true, scanSkills() {}, get: () => undefined },
    mcp: { getConfigs: () => [], upsertConfig() {}, deleteConfig: () => true },
  };
  await assert.rejects(() => installBundle(twice as any, twice.root, deps), /same id/);

  // ── F2: a failed reinstall keeps the previously working skill and its ownership ──
  // Inert fixtures only: SKILL.md text, nothing is executed.
  fs.mkdirSync(path.join(tmp, 'keep', 'skills', 'hello'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'keep', 'plugin.json'), JSON.stringify({ $schema: AGENT_PLUGINS_SCHEMA, name: 'keep' }));
  fs.writeFileSync(path.join(tmp, 'keep', 'skills', 'hello', 'SKILL.md'), '---\nname: hello\ndescription: v1\n---\n\nversion one');
  const keep = readPluginBundle(path.join(tmp, 'keep'))!;
  const skillsRoot = path.join(tmp, 'skills-store');
  const live = new Map<string, { id: string; rootDir: string }>();
  let failImport = false;
  const kdeps: any = {
    userPluginsDir: path.join(tmp, 'keep-plugins'), skipReload: true,
    skills: {
      // Mirrors SkillsManager: removes the old folder first, then copies (and may fail part-way).
      async importBundles(src: string, o: any) {
        const dir = path.join(skillsRoot, o.id);
        fs.rmSync(dir, { recursive: true, force: true });
        if (failImport) { live.delete(o.id); throw new Error('blocked by compatibility audit'); }
        fs.cpSync(src, dir, { recursive: true });
        live.set(o.id, { id: o.id, rootDir: dir });
        return [{ id: o.id }];
      },
      deleteSkill: (sid: string) => { const s = live.get(sid); if (s) fs.rmSync(s.rootDir, { recursive: true, force: true }); return live.delete(sid); },
      scanSkills() { for (const e of fs.existsSync(skillsRoot) ? fs.readdirSync(skillsRoot) : []) live.set(e, { id: e, rootDir: path.join(skillsRoot, e) }); },
      get: (sid: string) => live.get(sid),
    },
    mcp: { getConfigs: () => [], upsertConfig() {}, deleteConfig: () => true },
  };
  const first = await installBundle(keep, keep.root, kdeps);
  assert.deepEqual(first.skills, ['keep-hello']);
  fs.writeFileSync(path.join(tmp, 'keep', 'skills', 'hello', 'SKILL.md'), '---\nname: hello\ndescription: v2\n---\n\nversion two');
  failImport = true;
  const again = await installBundle(keep, keep.root, kdeps, { overwrite: true });
  assert.ok(again.warnings.some((x) => /kept the previous version/.test(x)), 'failure is reported');
  assert.match(fs.readFileSync(path.join(skillsRoot, 'keep-hello', 'SKILL.md'), 'utf8'), /version one/, 'previous skill files restored');
  assert.ok(live.get('keep-hello'), 'previous skill still loaded');
  const { getImportedPlugin } = await import('./import-service');
  assert.deepEqual(getImportedPlugin('keep', kdeps.userPluginsDir)!.skills, ['keep-hello'], 'ledger keeps ownership of the working skill');
  failImport = false;
  const third = await installBundle(keep, keep.root, kdeps, { overwrite: true });
  assert.deepEqual(third.skills, ['keep-hello']);
  assert.match(fs.readFileSync(path.join(skillsRoot, 'keep-hello', 'SKILL.md'), 'utf8'), /version two/, 'a later good reinstall updates it');

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('plugin-import review regression passed');
})().catch((err) => { console.error(err); process.exit(1); });
