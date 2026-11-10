import assert from 'node:assert/strict';
import { ApiKeyConnectionAdapter } from './adapters/api-key.js';

const tools = ['connector_demo_list_items', 'connector_demo_get_item', 'connector_demo_api_request'];

function context(registeredTools?: string[]): any {
  return {
    attempt: {
      id: 'attempt_1', serviceId: 'demo', pluginId: 'demo', serviceName: 'Demo',
      plan: { pluginId: 'demo', strategy: { id: 'demo-manifest-key', adapter: 'api-key', configuration: { registeredTools, credentialFields: [{ key: 'apiKey', label: 'API Key', secret: true, required: true }] } } },
    },
    credentialRef: 'vault:ref_1',
  };
}

async function main(): Promise<void> {
  const verifyCalls: any[] = [];
  const adapter = new ApiKeyConnectionAdapter({
    createCredentialSession: async () => ({ id: 'session_1' }),
    declaredTools: (pluginId) => (pluginId === 'demo' ? tools : []),
    verifyCredential: async (_ref, _ctx, connection) => { verifyCalls.push(connection); return { ok: true, message: 'probe ok' }; },
  });

  // Saved key: connection is usable, declared tools registered, reads auto-exposed, api_request approval-gated.
  const stored = await adapter.connect(context(tools));
  assert.equal(stored.state, 'registering');
  const conn = stored.connection!;
  assert.equal(conn.authenticated, true);
  assert.equal(conn.authState, 'healthy');
  assert.equal(conn.registered, true);
  assert.equal(conn.credentialRef, 'vault:ref_1');
  assert.deepEqual([...conn.registeredTools!].sort(), [...tools].sort());
  assert.deepEqual(conn.availableTools, conn.registeredTools);
  assert.ok(!conn.exposedTools!.includes('connector_demo_api_request'), 'api_request must stay approval-gated');
  assert.equal(conn.verified, undefined, 'storing a key must not claim verification');

  // Older plan snapshots without registeredTools fall back to the installed manifest.
  const fallback = await adapter.connect(context(undefined));
  assert.deepEqual([...fallback.connection!.registeredTools!].sort(), [...tools].sort());

  // No key yet: still asks for secure input, registers nothing.
  const pending = await adapter.connect({ ...context(tools), credentialRef: undefined });
  assert.equal(pending.state, 'awaiting_secure_input');
  assert.equal(pending.connection, undefined);

  // Verify passes the stored record to the probe.
  const checks = await adapter.verify(context(tools), { id: 'c1', credentialRef: 'vault:ref_1', ...conn } as any);
  assert.equal(checks[0].passed, true);
  assert.equal(verifyCalls.length, 1);

  // Repair re-registers tools for a record saved before this fix.
  const repaired = await adapter.repair(context(tools), { id: 'c1', credentialRef: 'vault:ref_1', registeredTools: [], tools: [] } as any);
  assert.equal(repaired.state, 'verifying');
  assert.equal(repaired.connection!.registered, true);

  // Without a verifier, verify stays honest.
  const bare = new ApiKeyConnectionAdapter({ createCredentialSession: async () => ({ id: 's' }) });
  const bareChecks = await bare.verify(context(tools), { id: 'c2', credentialRef: 'vault:ref_1' } as any);
  assert.equal(bareChecks[0].passed, false);

  console.log('api-key adapter regression passed');
}

main().catch((error) => { console.error(error); process.exit(1); });
