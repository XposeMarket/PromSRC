import assert from 'node:assert/strict';
import express from 'express';
import { requireProtectedOwner, type OwnerProof } from '../src/gateway/routes/secure-access.router';
import { payloadContainsRecognizableSecret } from '../src/security/secret-format-guard';
import { mintConsent, verifyConsent, sha256Hex, OWNER_CONSENT_HEADER, setConsentKeySourceForTests } from '../src/security/secure-access-consent';
const OWNER = 'c'.repeat(64);
async function main() {
 setConsentKeySourceForTests(() => OWNER);
 const proof: OwnerProof = { ownerToken: () => OWNER, deviceTrusted: () => true, verifyDevice: value => value === 'fixture-phone', verifyConsent: (req: any) => verifyConsent(req.headers[OWNER_CONSENT_HEADER], req.method, req.originalUrl, req.rawBody).ok };
 const app = express(); let hits = 0;
 app.use(express.json({ limit: '32kb', verify: (req: any, _res, buf) => { req.rawBody = Buffer.from(buf); } }));
 const paths = ['/api/connection-secure-input/dummy', '/api/auth/x-api/credentials', '/api/connections/credentials', '/api/protected-plugins/x/delete'];
 for (const path of paths) app.post(path, (req, res, next) => requireProtectedOwner(req, res, next, proof, () => true), (_req, res) => { hits++; res.json({ success: true }); });
 app.post('/api/chat', (req, res) => { if (payloadContainsRecognizableSecret(req.body)) { res.status(400).json({ error: 'PROTECTED_ENTRY_REQUIRED' }); return; } res.json({ success: true }); });
 const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
 const origin = `http://127.0.0.1:${(server.address() as any).port}`;
 const body = JSON.stringify({ clientSecret: 'SYNTHETIC_CANARY' });
 const call = (route: string, headers: Record<string,string> = {}, value = body) => fetch(origin + route, { method: 'POST', headers: { origin, 'content-type': 'application/json', ...headers }, body: value });
 try {
  for (const route of paths) {
   assert.equal((await call(route)).status, 403);
   assert.equal((await call(route, { cookie: `prom_sa_owner=${OWNER}` })).status, 403);
   const header = mintConsent(OWNER, 'POST', route, sha256Hex(body));
   const allowed = { cookie: `prom_sa_owner=${OWNER}`, [OWNER_CONSENT_HEADER]: header };
   assert.equal((await call(route, allowed)).status, 200);
   assert.equal((await call(route, allowed)).status, 403);
   const mismatch = mintConsent(OWNER, 'POST', route, sha256Hex('different'));
   assert.equal((await call(route, { ...allowed, [OWNER_CONSENT_HEADER]: mismatch })).status, 403);
   assert.equal((await call(route, { 'x-pairing-token': 'fixture-phone' })).status, 200);
  }
  assert.equal(hits, paths.length * 2);
  const secret = 'sk-proj-' + 't'.repeat(32);
  const rejected = await call('/api/chat', {}, JSON.stringify({ message: secret }));
  assert.equal(rejected.status, 400); assert(!(await rejected.text()).includes(secret));
  console.log('PASS protected owner HTTP: forged Origin, cookie-only, body mismatch and replay blocked; approved desktop/trusted phone accepted; chat no echo.');
 } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
}
main().catch(error => { console.error('FAIL protected HTTP', error?.name, String(error?.stack || '').split('\n').filter((line: string) => /^\s+at /.test(line)).slice(0,2).join('\n')); process.exitCode = 1; });
