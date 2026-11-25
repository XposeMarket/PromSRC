import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Regression: provider_accounts(action:"list") called getVault() without a
// directory. In a process where no earlier caller had opened the vault with a
// directory, that threw "[Vault] configDir required for first initialisation".
// This fixture runs the list path first thing in a fresh process.

async function main(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-provider-accounts-vault-'));
  process.env.PROMETHEUS_DATA_DIR = root;
  process.env.PROMETHEUS_APP_DATA_DIR = root;
  process.env.PROMETHEUS_RUNTIME_DIR = path.join(root, 'runtime');
  process.env.PROMETHEUS_WORKSPACE_DIR = path.join(root, 'workspace');
  const workspace = process.env.PROMETHEUS_WORKSPACE_DIR;
  fs.mkdirSync(workspace, { recursive: true });
  const configDir = path.join(root, 'runtime', 'config');
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({
    llm: { provider: 'anthropic', providers: { anthropic: { model: 'claude-test' } } },
  }), 'utf8');
  const deadline = setTimeout(() => { console.error('provider accounts vault fixture timed out'); process.exit(1); }, 30_000);
  try {
    const { executeTool } = require('../subagent-executor') as typeof import('../subagent-executor');
    type Deps = import('../subagent-executor').ExecuteToolDeps;
    const executionPolicy: NonNullable<Deps['executionPolicy']> = { mode: 'goal_autonomous', approvalMode: 'never' };
    // The provider_accounts list path reads only the execution policy from deps.
    const deps = { executionPolicy } as Deps;
    const run = (args: Record<string, unknown>) => executeTool('provider_accounts', args, workspace, deps, 'provider-accounts-vault-fixture');

    const first = await run({ action: 'list' });
    assert.equal(first.error, false, first.result);
    assert.doesNotMatch(String(first.result), /configDir required/i);
    const parsed = JSON.parse(String(first.result));
    assert.ok(parsed.providers && typeof parsed.providers === 'object', 'list returns a providers map');

    // The list must read the same vault the rest of the process writes to.
    const { getConfig } = require('../../../config/config') as typeof import('../../../config/config');
    const { getVault } = require('../../../security/vault') as typeof import('../../../security/vault');
    const secretValue = 'fixture-token-value-should-never-appear';
    getVault(getConfig().getConfigDir()).set('anthropic.oauth_tokens', JSON.stringify({ access_token: secretValue }), 'provider-accounts-vault-fixture');
    const second = await run({ action: 'list' });
    assert.equal(second.error, false, second.result);
    assert.ok(JSON.parse(String(second.result)).providers.anthropic, 'saved OAuth credentials in the canonical vault are listed');
    assert.ok(!String(second.result).includes(secretValue), 'list never returns secret values');

    // Config loading may open the vault before this handler runs, which hides the
    // call-order bug at runtime. Guard the source too: no caller may use the
    // argument-less form, whose directory depended on which caller ran first.
    const srcRoot = path.resolve(__dirname, '../../..');
    const bare: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) { if (entry.name !== 'node_modules') walk(full); continue; }
        if (!/\.(ts|js|mjs|cjs)$/.test(entry.name)) continue;
        if (/\bgetVault\(\s*\)/.test(fs.readFileSync(full, 'utf8'))) bare.push(path.relative(srcRoot, full));
      }
    };
    walk(srcRoot);
    assert.deepEqual(bare.filter((file) => !file.endsWith('provider-accounts-vault.regression.ts')), [], 'getVault must always receive the config directory');
    assert.throws(() => (getVault as (dir?: string) => unknown)(), /configDir is required/);
    console.log('provider-accounts-vault regression passed');
  } finally {
    clearTimeout(deadline);
    try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* best effort */ }
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
