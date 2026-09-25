import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readPluginBundle, parseHooksJson, findPluginDirs } from './formats';
import { convertMcpServer, installBundle, listImportedPlugins, uninstallPlugin, readMarketplace } from './import-service';
import { dispatchPluginHooks, invalidatePluginHookCache } from './plugin-hooks';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-plugin-import-'));
const w = (rel: string, text: string) => { const p = path.join(tmp, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); };

// Claude plugin: skill + command + agent + http MCP with secret header + hook
w('claude-p/.claude-plugin/plugin.json', JSON.stringify({ name: 'demo-claude', version: '1.2.0', description: 'Claude demo' }));
w('claude-p/skills/review/SKILL.md', '---\nname: review\ndescription: Review code\n---\n\nReview it.');
w('claude-p/commands/ship.md', '---\ndescription: Ship the change\nargument-hint: [branch]\n---\n\nShip $ARGUMENTS.');
w('claude-p/agents/checker.md', '---\nname: checker\ndescription: Checks things\nmodel: sonnet\n---\n\nYou check things.');
w('claude-p/.mcp.json', JSON.stringify({ mcpServers: { ctx: { type: 'http', url: 'https://mcp.example.com/mcp', headers: { Authorization: 'Bearer ${DEMO_TOKEN}' } } } }));
w('claude-p/hooks/hooks.json', JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'node -e "process.stderr.write(\'nope\');process.exit(2)"' }] }], Notification: [{ hooks: [{ type: 'command', command: 'echo hi' }] }] } }));
// Codex plugin with bearer env var + hosted app
w('codex-p/.codex-plugin/plugin.json', JSON.stringify({ name: 'github', skills: './skills/', apps: './.app.json', mcpServers: './.mcp.json', interface: { displayName: 'GitHub' } }));
w('codex-p/skills/gh-fix-ci/SKILL.md', '---\nname: gh-fix-ci\ndescription: Fix CI\n---\n\nFix it.');
w('codex-p/.mcp.json', JSON.stringify({ mcpServers: { github: { type: 'http', url: 'https://api.githubcopilot.com/mcp/', bearer_token_env_var: 'GITHUB_PAT_TOKEN' } } }));
w('codex-p/.app.json', JSON.stringify({ apps: { github: { id: 'connector_1' } } }));
// Hermes plugin: plugin.yaml + python + SKILL.md
w('hermes-p/plugin.yaml', 'name: google-meet\nversion: 1.0.0\ndescription: Meet notes\nrequires_env:\n  - MEET_KEY\nprovides_tools:\n  - meet_join\n');
w('hermes-p/__init__.py', 'def register(ctx): pass\n');
w('hermes-p/SKILL.md', '---\nname: google-meet\ndescription: Join meetings\n---\n\nJoin.');
// OpenClaw plugin: manifest with skills dir + runtime
w('openclaw-p/openclaw.plugin.json', JSON.stringify({ id: 'canvas', name: 'Canvas', description: 'Canvas tools', skills: './skills', activation: {}, configSchema: {} }));
w('openclaw-p/skills/canvas-draw/SKILL.md', '---\nname: canvas-draw\ndescription: Draw\n---\n\nDraw.');
w('openclaw-p/index.ts', 'export default {}');
// Claude marketplace
w('mk/.claude-plugin/marketplace.json', JSON.stringify({ name: 'mk', plugins: [
  { name: 'local-one', source: './plugins/local-one', description: 'L' },
  { name: 'sub', source: { source: 'git-subdir', url: 'https://github.com/o/r.git', path: 'plugins/x', ref: 'main' } },
] }));

const claude = readPluginBundle(path.join(tmp, 'claude-p'))!;
assert.equal(claude.format, 'claude');
assert.deepEqual(claude.skillDirs.map((d) => path.basename(d)), ['review']);
assert.equal(claude.commands[0].name, 'ship');
assert.equal(claude.agents[0].name, 'checker');
assert.equal(claude.mcpServers[0].id, 'ctx');
assert.ok(claude.requiredEnv.includes('DEMO_TOKEN'));
assert.equal(claude.hooks.filter((h) => h.type === 'command').length, 1, 'PreToolUse command hook kept');
assert.equal(claude.hooks.find((h) => h.sourceEvent === 'Notification')?.type, 'unsupported', 'unmapped event reported, not dropped');

const codex = readPluginBundle(path.join(tmp, 'codex-p'))!;
assert.equal(codex.format, 'codex');
assert.equal(codex.name, 'GitHub');
assert.ok(codex.unsupported.some((u) => u.part.startsWith('apps')), 'hosted apps reported unsupported');
assert.ok(codex.requiredEnv.includes('GITHUB_PAT_TOKEN'));

const hermes = readPluginBundle(path.join(tmp, 'hermes-p'))!;
assert.equal(hermes.format, 'hermes');
assert.equal(hermes.skillDirs.length, 1);
assert.ok(hermes.requiredEnv.includes('MEET_KEY'));
assert.ok(hermes.unsupported.some((u) => u.part.includes('python runtime') && u.part.includes('meet_join')));

const openclaw = readPluginBundle(path.join(tmp, 'openclaw-p'))!;
assert.equal(openclaw.format, 'openclaw');
assert.deepEqual(openclaw.skillDirs.map((d) => path.basename(d)), ['canvas-draw']);
assert.ok(openclaw.unsupported.some((u) => u.part.startsWith('typescript runtime')));

assert.equal(findPluginDirs(tmp).length, 4);

// MCP conversion: secret -> vault ref, disabled until present; env-provided -> enabled.
const conv = convertMcpServer('github', codex.mcpServers[0], codex.root);
assert.equal(conv.config.headers.Authorization, 'vault:plugins.github.GITHUB_PAT_TOKEN');
assert.equal(conv.enabled, false);
assert.equal(convertMcpServer('github', codex.mcpServers[0], codex.root, { has: () => true }).enabled, true);
const opt = convertMcpServer('c7', { id: 'c7', config: { type: 'http', url: 'https://x/mcp', headers: { Authorization: '${KEY:-}' } } }, tmp);
assert.equal(opt.enabled, true, 'optional ${VAR:-} secret does not block enablement');
assert.equal(opt.config.headers, undefined);

assert.equal(parseHooksJson({ hooks: { pre_tool_call: [{ type: 'command', command: 'x' }] } })[0].event, 'PreToolUse');

const market = readMarketplace(path.join(tmp, 'mk'));
assert.equal(market.length, 2);
assert.ok(market[1].source.startsWith('https://github.com/o/r/tree/main/plugins/x'));

// Install/uninstall with fake skill + MCP stores; hooks gated on approval.
(async () => {
  const skills = new Map<string, string>();
  const mcp = new Map<string, any>();
  const deps = {
    userPluginsDir: path.join(tmp, 'user-plugins'),
    skipReload: true,
    skills: {
      async importBundles(src: string, o?: any) { assert.ok(fs.existsSync(path.join(src, 'SKILL.md')), `staged skill at ${src}`); skills.set(o.id, src); return [{ id: o.id }]; },
      deleteSkill(id: string) { return skills.delete(id); },
      scanSkills() {},
    },
    mcp: { getConfigs: () => [...mcp.values()], upsertConfig: (c: any) => mcp.set(c.id, c), deleteConfig: (id: string) => mcp.delete(id) },
  };
  const res = await installBundle(claude, claude.root, deps);
  assert.deepEqual(res.skills.sort(), ['demo-claude-agent-checker', 'demo-claude-cmd-ship', 'demo-claude-review']);
  assert.equal(res.mcpServers[0].id, 'demo-claude-ctx');
  assert.equal(res.mcpServers[0].enabled, false);
  assert.equal(res.hooks, 1);
  assert.equal(listImportedPlugins(deps.userPluginsDir).length, 1);
  await assert.rejects(() => installBundle(claude, claude.root, deps), /already imported/);

  invalidatePluginHookCache();
  let d = await dispatchPluginHooks({ event: 'PreToolUse', toolName: 'run_command', toolInput: {} }, deps.userPluginsDir);
  assert.equal(d.results.length, 0, 'unapproved hooks never run');
  const ledgerPath = path.join(deps.userPluginsDir, 'demo-claude', 'imported-plugin.json');
  const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  ledger.hooksApproved = true;
  fs.writeFileSync(ledgerPath, JSON.stringify(ledger));
  invalidatePluginHookCache();
  d = await dispatchPluginHooks({ event: 'PreToolUse', toolName: 'run_command', toolInput: { command: 'ls' } }, deps.userPluginsDir);
  assert.equal(d.blocked, 'nope', 'exit 2 blocks with stderr reason (Bash matcher maps run_command)');
  invalidatePluginHookCache();
  d = await dispatchPluginHooks({ event: 'PreToolUse', toolName: 'web_search', toolInput: {} }, deps.userPluginsDir);
  assert.equal(d.results.length, 0, 'matcher filters other tools');

  const un = await uninstallPlugin('demo-claude', deps);
  assert.equal(un.removedSkills.length, 3);
  assert.deepEqual(un.removedMcp, ['demo-claude-ctx']);
  assert.equal(skills.size, 0);
  assert.equal(listImportedPlugins(deps.userPluginsDir).length, 0);
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('plugin-import regression passed');
})().catch((err) => { console.error(err); process.exit(1); });
