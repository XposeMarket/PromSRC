// Integration regression: real config.resolveSecret and real platform executor channel gate.
// Synthetic canaries only. Temp runtime dir; no live config, no network, no provider calls.
import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'secure-access-resolve-'));
process.env.PROMETHEUS_RUNTIME_DIR = path.join(dir, 'runtime');

const CANARY = 'CANARY_RESOLVE_SECRET_0001';
const RESERVED = 'secure.access.owner.cred_resolve.v1';

async function main() {
  const { getPrometheusLayout } = await import('../src/runtime/storage-layout');
  const { getVault } = await import('../src/security/vault');
  const { getConfig } = await import('../src/config/config');
  const root = getPrometheusLayout().runtime.root;
  const vault = getVault(root);
  vault.set(RESERVED, CANARY, 'secure-access');
  vault.set('integrations.resolve_test.token', 'ORDINARY_RESOLVE_0001', 'test');

  const cfg = getConfig();
  // Reserved key: real config.resolveSecret must not return the broker-owned value.
  assert.equal(cfg.resolveSecret(`vault:${RESERVED}`), undefined, 'config.resolveSecret must refuse reserved secure.access key');
  // Ordinary refs still resolve through the same real path.
  assert.equal(cfg.resolveSecret('vault:integrations.resolve_test.token'), 'ORDINARY_RESOLVE_0001', 'ordinary vault ref must resolve');
  assert.equal(cfg.resolveSecret('plain-literal'), 'plain-literal', 'literal values pass through');

  const audit = fs.readdirSync(root, { recursive: true }) as string[];
  for (const rel of audit) {
    if (!String(rel).endsWith('vault-audit.log')) continue;
    const text = fs.readFileSync(path.join(root, String(rel)), 'utf8');
    assert.ok(!text.includes(CANARY), 'audit must not contain the canary');
  }

  // Channel gate: real platform executor must reject Telegram/Discord/WhatsApp create and prepare.
  const { platformCapabilityExecutor } = await import('../src/gateway/agents-runtime/capabilities/platform-executor');
  for (const sessionId of ['telegram_100', 'discord_200', 'whatsapp_300']) {
    for (const action of ['request', 'fill']) {
      const r: any = await platformCapabilityExecutor.execute({
        name: 'secure_access', args: { action, origin: 'https://example.test', url: 'https://example.test/login', label: 'x', purpose: 'x' },
        workspacePath: dir, deps: {} as any, sessionId,
      });
      assert.equal(r.error, true, `${action} from ${sessionId} must be refused`);
      assert.match(String(r.result), /chat channels/, `${action} from ${sessionId} must use the channel refusal`);
      assert.ok(!String(r.result).includes(CANARY), 'refusal must not leak values');
    }
  }
  console.log('PASS secure-access resolveSecret + channel gate: reserved key unresolvable via config.resolveSecret, ordinary refs resolve, audit has no canary, Telegram/Discord/WhatsApp request+fill refused.');
}

main().then(() => fs.rmSync(dir, { recursive: true, force: true }), (error) => {
  fs.rmSync(dir, { recursive: true, force: true });
  console.error('FAIL secure-access resolveSecret + channel gate:', error?.message || error);
  process.exit(1);
});
