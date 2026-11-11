import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ConnectionOrchestrator } from './orchestrator.js';
import { ConnectionStore } from './connection-store.js';
import { ConnectionAttemptStore } from './attempt-store.js';
import { ConnectionActivityStore } from './activity-store.js';

// Disconnecting a credential-backed plugin must return it to "not set up": no stored-key
// claim, no dangling reference, tools still registered so reconnect only asks for credentials.
async function main(): Promise<void> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'disconnect-reset-'));
  const connections = new ConnectionStore(dir);
  const cleared: string[] = [];
  const adapter = { id: 'api-key', disconnect: async (_c: any, conn: any) => { cleared.push(conn.credentialRef); } };
  const orchestrator = new ConnectionOrchestrator({
    attempts: new ConnectionAttemptStore(dir), connections, activity: new ConnectionActivityStore(dir),
    adapters: { resolve: () => adapter } as any, plans: { resolve: async () => ({}) as any },
  });
  const base = {
    installed: true, enabled: true, configured: true, authenticated: true, registered: true, exposed: true, verified: true,
    grantedCapabilities: [], registeredTools: ['connector_demo_list'], exposedTools: ['connector_demo_list'], availableTools: ['connector_demo_list'],
    authState: 'healthy', health: 'healthy', pluginId: 'demo', serviceName: 'Demo',
  } as any;
  const key = connections.create({ ...base, serviceId: 'demo', strategyId: 'demo-key', adapterId: 'api-key', credentialRef: 'vault:connection.credentials.x' } as any);
  const oauth = connections.create({ ...base, serviceId: 'other', strategyId: 'other-oauth', adapterId: 'connector-oauth' } as any);

  await orchestrator.disconnect(key.id);
  const k = connections.get(key.id)!;
  assert.equal(k.configured, false, 'api-key record no longer claims stored credentials');
  assert.equal(k.verified, false);
  assert.equal(k.authenticated, false);
  assert.equal(k.credentialRef, undefined, 'deleted credential reference is dropped');
  assert.deepEqual(k.registeredTools, ['connector_demo_list'], 'tools stay registered for reconnect');
  assert.deepEqual(k.availableTools, []);

  await orchestrator.disconnect(oauth.id);
  const o = connections.get(oauth.id)!;
  assert.equal(o.authenticated, false);
  assert.equal(o.configured, true, 'non-credential adapters keep their configured flag');
  console.log('PASS disconnect resets credential-backed plugins to not set up');
}

main().catch((error) => { console.error(error); process.exit(1); });
