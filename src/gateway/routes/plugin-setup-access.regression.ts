/**
 * npm run test:plugin-setup-access
 *
 * Drives the real plugin-setup guards over HTTP (real Express request, real transport check,
 * real owner gate) with synthetic pairing/owner proof. No real credentials, accounts or storage.
 *
 * Covers the two gaps left by the paired-phone setup change:
 *   1. A paired phone could post to the legacy credentials route with no pending attempt.
 *   2. A paired phone could approve a model-endpoint (base URL) connection.
 */
import assert from 'node:assert/strict';
import express from 'express';
import { SECURE_ACCESS_OWNER_COOKIE } from '../../security/secure-access-owner';
import { requireProtectedOwner, type OwnerProof } from './secure-access.router';
import { PAIRED_PLUGIN_SETUP_ADAPTERS, requireAttemptBoundPluginSetup, requirePluginDisconnect, requirePluginSetupAdapter, type PluginSetupGates } from './plugin-setup-access';

const PAIRED = 'synthetic-paired';
const OWNER = 'synthetic-owner';
let storage = true;
let consent = true;

// Owner = desktop cookie plus per-request consent. A paired phone carries no owner provenance here.
const proof: OwnerProof = { ownerToken: () => OWNER, deviceTrusted: () => false, verifyDevice: () => false, verifyConsent: () => consent };
const gates: PluginSetupGates = {
  storageAvailable: () => storage,
  pairedDevice: (req) => req.headers['x-pairing-token'] === PAIRED,
  ownerGate: (req, res, next) => requireProtectedOwner(req, res, next, proof, () => storage),
};

async function main(): Promise<void> {
  const app = express();
  app.use(express.json());
  let saves = 0;
  app.post('/api/connections/credentials', (req, res, next) => requireAttemptBoundPluginSetup(req, res, next, gates), (_req, res) => { saves += 1; res.json({ saved: true }); });
  app.post('/adapter/:adapter', (req, res, next) => requirePluginSetupAdapter(req, res, next, req.params.adapter, gates), (_req, res) => { res.json({ approved: true }); });
  let disconnects = 0;
  app.post('/api/connections-v2/:id/disconnect', (req, res, next) => requirePluginDisconnect(req, res, next, gates), (_req, res) => { disconnects += 1; res.json({ success: true }); });
  app.post('/owner-only-disconnect', (req, res, next) => requirePluginDisconnect(req, res, next, gates, false), (_req, res) => { disconnects += 1; res.json({ success: true }); });
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const origin = `http://127.0.0.1:${(server.address() as any).port}`;
  const post = async (route: string, body: unknown, headers: Record<string, string> = {}) => {
    const response = await fetch(origin + route, { method: 'POST', headers: { origin, 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() as any };
  };
  const paired = { 'x-pairing-token': PAIRED };
  const owner = { cookie: `${SECURE_ACCESS_OWNER_COOKIE}=${OWNER}` };
  try {
    // 1. Legacy credentials route: a paired phone needs a pending attempt id.
    const bound = await post('/api/connections/credentials', { id: 'github', clientId: 'x', attemptId: 'attempt_1' }, paired);
    assert.equal(bound.status, 200, 'paired phone completing a pending attempt is allowed');
    for (const body of [
      { id: 'github', apiKey: 'x' },
      { id: 'github', accessToken: 'x' },
      { id: 'github', apiKey: 'x', attemptId: '' },
      { id: 'github', apiKey: 'x', attemptId: 42 },
      { id: 'github', apiKey: 'x', attemptId: ['attempt_1'] },
      { id: 'github', apiKey: 'x', attemptId: { id: 'attempt_1' } },
    ]) {
      const denied = await post('/api/connections/credentials', body, paired);
      assert.equal(denied.status, 403, `paired phone without a string attempt id is refused: ${JSON.stringify(body)}`);
      assert.equal(denied.body.error, 'OWNER_SURFACE_REQUIRED');
    }
    assert.equal(saves, 1, 'refused requests never reach the save handler');

    // Unpaired callers gain nothing from sending an attempt id.
    assert.equal((await post('/api/connections/credentials', { id: 'github', clientId: 'x', attemptId: 'attempt_1' })).status, 403);
    assert.equal((await post('/api/connections/credentials', { id: 'github', clientId: 'x', attemptId: 'attempt_1' }, { 'x-pairing-token': 'unknown' })).status, 403);

    // The desktop owner path (cookie + consent) still saves without an attempt id.
    assert.equal((await post('/api/connections/credentials', { id: 'github', apiKey: 'x' }, owner)).status, 200);
    consent = false;
    assert.equal((await post('/api/connections/credentials', { id: 'github', apiKey: 'x' }, owner)).body.error, 'OWNER_CONSENT_REQUIRED');
    consent = true;

    // Transport and storage checks still run first on the paired path.
    assert.equal((await post('/api/connections/credentials', { id: 'github', clientId: 'x', attemptId: 'attempt_1' }, { ...paired, origin: 'https://evil.example' })).status, 403);
    storage = false;
    assert.equal((await post('/api/connections/credentials', { id: 'github', clientId: 'x', attemptId: 'attempt_1' }, paired)).status, 409);
    storage = true;

    // 2. Adapter allow-list: credential/sign-in adapters only. Model endpoints need the owner.
    assert.deepEqual([...PAIRED_PLUGIN_SETUP_ADAPTERS].sort(), ['api-key', 'connector-oauth', 'mcp-oauth', 'setup-token']);
    for (const adapter of PAIRED_PLUGIN_SETUP_ADAPTERS) assert.equal((await post(`/adapter/${adapter}`, {}, paired)).status, 200, adapter);
    for (const adapter of ['openai-compatible-model', 'mcp-stdio', 'local-resource', 'browser-session', 'unknown']) {
      assert.equal((await post(`/adapter/${adapter}`, {}, paired)).status, 403, `${adapter} must not be approvable from a paired phone`);
    }
    assert.equal((await post('/adapter/openai-compatible-model', {}, owner)).status, 200, 'owner can still approve a model endpoint');

    // 3. Disconnect is the reverse of setup: a paired phone that can connect must be able to disconnect.
    assert.equal((await post('/api/connections-v2/conn_1/disconnect', {}, paired)).status, 200, 'paired phone can disconnect');
    storage = false;
    assert.equal((await post('/api/connections-v2/conn_1/disconnect', {}, paired)).status, 200, 'removing access never needs protected storage');
    storage = true;
    const anon = await post('/api/connections-v2/conn_1/disconnect', {});
    assert.equal(anon.status, 403); assert.equal(anon.body.error, 'OWNER_SURFACE_REQUIRED');
    assert.equal((await post('/api/connections-v2/conn_1/disconnect', {}, { 'x-pairing-token': 'unknown' })).status, 403, 'unknown pairing token refused');
    assert.equal((await post('/api/connections-v2/conn_1/disconnect', {}, { ...paired, origin: 'https://evil.example' })).status, 403, 'cross-origin refused even when paired');
    assert.equal((await post('/api/connections-v2/conn_1/disconnect', {}, owner)).status, 200, 'desktop owner path unchanged');
    consent = false;
    assert.equal((await post('/api/connections-v2/conn_1/disconnect', {}, owner)).body.error, 'OWNER_CONSENT_REQUIRED');
    consent = true;
    // Teardown outside phone-settable plugin types (model endpoints, Obsidian index removal) stays owner-only.
    const ownerOnly = await post('/owner-only-disconnect', {}, paired);
    assert.equal(ownerOnly.status, 403); assert.equal(ownerOnly.body.error, 'OWNER_SURFACE_REQUIRED');
    assert.equal((await post('/owner-only-disconnect', {}, owner)).status, 200, 'owner can still tear it down');
    assert.equal(disconnects, 4);

    process.stdout.write('PASS plugin setup access: attempt-bound credentials route, owner path, transport/storage order, model endpoint excluded from paired adapters, paired disconnect\n');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

main().then(() => process.exit(0)).catch((error) => {
  process.stdout.write(`FAIL plugin setup access: ${error?.stack || error}\n`);
  process.exit(1);
});
