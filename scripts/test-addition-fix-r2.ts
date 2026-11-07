// PR821 fix round 2: N1 (mount-scoped redaction + JSON-first serializer), N2 (X disconnect alias gates),
// N4 (pending record revert after bind failure). Synthetic fixtures only: no real config, vault or runtime.
import assert from 'node:assert/strict';
import express from 'express';
import fs from 'fs';
import path from 'path';
import { router as connectionsV2Router } from '../src/gateway/routes/connections-v2.router';
import { publicConnectionValue } from '../src/connections/serialize-public';
import { ConnectionOrchestrator } from '../src/connections/orchestrator';

const root = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');
const clone = (value: any) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));

// N1: real express mount order. Connections router at '/', then dummy routers that must stay unchanged.
async function n1MountOrder(): Promise<void> {
  const app = express();
  app.use('/', connectionsV2Router);
  const payload = () => ({ at: new Date(0), text: 'connection.credentials.x.y', nested: { v: 'RAW', toJSON: () => 'SAFE_FIXTURE' } });
  app.get('/api/chat-fixture', (_req, res) => { res.json(payload()); });
  app.get('/api/connections-v2/fixture-dummy', (_req, res) => { res.json(payload()); });
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  try {
    const unrelated = await (await fetch(`${base}/api/chat-fixture`)).json();
    assert.deepEqual(unrelated, { at: '1970-01-01T00:00:00.000Z', text: 'connection.credentials.x.y', nested: 'SAFE_FIXTURE' });
    const scoped = await (await fetch(`${base}/api/connections-v2/fixture-dummy`)).json();
    assert.deepEqual(scoped, { at: '1970-01-01T00:00:00.000Z', text: '[protected credential]', nested: 'SAFE_FIXTURE' });
  } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
  console.log('PASS N1 mount order: connections router at / leaves unrelated dummy JSON unchanged; connection prefix redacted');
}

// N1: serializer honours JSON semantics (toJSON, Date, Map) before redacting.
function n1Serializer(): void {
  assert.deepEqual(publicConnectionValue({ at: new Date(0) } as any), { at: '1970-01-01T00:00:00.000Z' });
  assert.equal(publicConnectionValue({ v: 'RAW', toJSON: () => 'SAFE' } as any), 'SAFE');
  assert.deepEqual(publicConnectionValue({ m: new Map([['a', 1]]) } as any), { m: {} });
  assert.deepEqual(publicConnectionValue({ credentialRef: 'vault:connection.credentials.s.k', name: 'ok' } as any), { name: 'ok' });
  assert.equal(publicConnectionValue('x connection.credentials.s.k y'), 'x [protected credential] y');
  console.log('PASS N1 serializer: Date/toJSON/Map JSON semantics kept; protected refs redacted');
}

// N2: source alias gates for /api/auth/x-api/disconnect (owner gate, tombstone first, fixed 503, raw body, consent lists, UI caller).
function n2Sources(): void {
  const settings = read('src/gateway/routes/settings.router.ts');
  const start = settings.indexOf("router.post('/api/auth/x-api/disconnect'");
  assert(start > 0, 'x-api disconnect route exists');
  const block = settings.slice(start, start + 700);
  assert(/router\.post\('\/api\/auth\/x-api\/disconnect', \(req, res, next\) => requireProtectedOwner\(req, res, next\)/.test(block), 'owner gate on x-api disconnect');
  const tomb = block.indexOf("setPluginCredentialState(CONFIG_DIR_PATH, 'x', true, 'disconnect')");
  const clear = block.indexOf('clearXApiTokens(CONFIG_DIR_PATH)');
  assert(tomb > 0 && clear > tomb, 'tombstone precedes token mutation');
  const guarded = block.slice(tomb, clear);
  assert(guarded.includes("res.status(503).json({ error: 'CONNECTOR_STOP_FAILED' })") && guarded.includes('return;'), 'fixed 503 returns before mutation');
  const app = read('src/gateway/core/app.ts');
  assert(app.includes("'/api/auth/x-api/disconnect'], express.json({ limit: '32kb', verify: keepRawBody })"), 'raw-body parser covers x-api disconnect');
  const consent = read('electron/owner-consent.js');
  assert(consent.includes('/^\\/api\\/auth\\/x-api\\/disconnect$/'), 'Electron consent allowlist');
  const core = read('web-ui/src/features/secure-access/secure-access-core.js');
  assert(core.includes('auth\\/x-api\\/disconnect'), 'web needsOwnerConsent allowlist');
  const ui = read('web-ui/src/pages/SettingsPage.js');
  assert(ui.includes("postJsonConsent(api, '/api/auth/x-api/disconnect'"), 'SettingsPage uses consent-aware postJson');
  assert(!ui.includes("api('/api/auth/x-api/disconnect'"), 'no raw api() caller remains');
  console.log('PASS N2 sources: owner gate, tombstone-before-mutation, fixed 503, raw body, Electron+web consent, SettingsPage caller');
}

// N4: bind-failure cleanup restores the prior pending record (replacement) or removes the record it created.
function n4Revert(): void {
  const rows = new Map<string, any>();
  let seq = 0;
  const find = (input: any) => [...rows.values()].find((r) => r.serviceId === input.serviceId && r.pluginId === input.pluginId && r.strategyId === input.strategyId);
  const connections: any = {
    findByService: (serviceId: string) => [...rows.values()].filter((r) => r.serviceId === serviceId).map(clone),
    upsert: (input: any) => {
      const existing = find(input);
      const id = existing ? existing.id : `conn-${++seq}`;
      const next = { ...(existing || {}), ...input, id };
      rows.set(id, next); return clone(next);
    },
    update: (id: string, patch: any) => { const next = { ...rows.get(id), ...patch, id }; rows.set(id, next); return clone(next); },
    delete: (id: string) => rows.delete(id),
  };
  const attemptRows = new Map<string, any>([['att-1', { id: 'att-1', serviceId: 'fixture', serviceName: 'Fixture', requestedCapabilities: [], pluginId: 'fixture-plugin', plan: { pluginId: 'fixture-plugin', strategy: { id: 'fixture-key', adapter: 'api-key' } } }]]);
  const attempts: any = {
    get: (id: string) => clone(attemptRows.get(id)),
    update: (id: string, patch: any) => { const next = { ...attemptRows.get(id), ...patch }; attemptRows.set(id, next); return clone(next); },
  };
  const orch = new ConnectionOrchestrator({ attempts, connections, adapters: {} as any, activity: { append() {} } as any, plans: {} as any, validateCredentialReference: () => true } as any);
  const OLD = 'vault:connection.credentials.fixture.OLD';
  const NEW = 'vault:connection.credentials.fixture.NEW';

  // Replacement: an existing pending/authenticated record must be restored exactly, old ref intact.
  rows.set('conn-0', { id: 'conn-0', pluginId: 'fixture-plugin', serviceId: 'fixture', serviceName: 'Fixture', strategyId: 'fixture-key', adapterId: 'api-key', credentialRef: OLD, authState: 'authenticated', authenticated: true, grantedCapabilities: [] });
  seq = 0;
  const replaced = orch.recordStoredCredential('att-1', NEW);
  assert.equal(rows.get('conn-0').credentialRef, NEW, 'pending record points at new ref before bind');
  orch.revertStoredCredential('att-1', replaced);
  assert.equal(rows.get('conn-0').credentialRef, OLD, 'replacement revert restores old ref');
  assert.equal(rows.get('conn-0').authState, 'authenticated', 'replacement revert restores prior auth state');
  assert.equal(rows.size, 1, 'replacement does not create or delete rows');

  // Fresh store: a record created by the failed request is removed, nothing else touched.
  rows.clear(); seq = 0; attemptRows.set('att-1', { ...attemptRows.get('att-1'), connectionId: undefined });
  const created = orch.recordStoredCredential('att-1', NEW);
  assert.equal(rows.size, 1, 'pending record created');
  orch.revertStoredCredential('att-1', created);
  assert.equal(rows.size, 0, 'created pending record removed on bind failure');
  console.log('PASS N4 revert: replacement restores prior ref/state; created record removed; no vault key touched');
}

async function main(): Promise<void> {
  await n1MountOrder();
  n1Serializer();
  n2Sources();
  n4Revert();
  console.log('PASS addition fix R2: N1 + N2 + N4 (N3/N5 documented follow-ups)');
}
main().catch((error) => { console.error('FAIL addition fix R2', error?.message || error); process.exitCode = 1; });
