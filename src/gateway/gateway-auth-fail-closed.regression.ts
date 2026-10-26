import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import ts from 'typescript';

// Execute the production module with isolated config/pairing dependencies: no
// gateway, vault, filesystem persistence, sockets, or live credentials are used.
const gateway: any = { host: '127.0.0.1', port: 18789, auth: { enabled: true, token: '' }, https: { enabled: false, port: 19443 } };
let resolution: string | undefined;
let resolutionThrows = false;
const env: Record<string, string> = {};
const moduleObject = { exports: {} as any };
const source = fs.readFileSync(path.join(__dirname, 'gateway-auth.ts'), 'utf8');
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
const config = { getConfig: () => ({ gateway }), resolveSecret: (value: string) => {
  if (resolutionThrows) throw new Error('sensitive vault backend details');
  return /^(env|vault):/.test(value) ? resolution : value;
} };
vm.runInNewContext(js, {
  exports: moduleObject.exports, module: moduleObject, Buffer, URL, process: { env },
  require: (name: string) => {
    if (name === 'crypto') return crypto;
    if (name === '../config/config') return { getConfig: () => config };
    if (name === '../config/gateway-port') return { resolveGatewayPort: () => gateway.port, parseGatewayPort: (value: unknown) => Number.isInteger(Number(value)) && Number(value) >= 1 && Number(value) <= 65535 ? Number(value) : undefined };
    if (name === './security/scoped-render-auth') return { evaluateCreativeRenderGrant: () => ({ present: false }) };
    if (name === './pairing/pairing-store') return { verifyDeviceToken: (value: string) => value === 'paired-test-capability' ? { id: 'test' } : null };
    throw new Error(`Unexpected dependency: ${name}`);
  },
}, { filename: 'gateway-auth.ts' });
const auth = moduleObject.exports;
const remote = '198.51.100.7';
const local = '127.0.0.1';
const request = (headers: Record<string, string> = {}, ip = local, url = '/api/tasks') => ({ method: 'GET', headers, socket: { remoteAddress: ip }, url });
function status(headers: Record<string, string> = {}, ip = local, url = '/api/tasks'): number {
  let result = 200;
  const response = { status(code: number) { result = code; return this; }, json() {} };
  auth.requireGatewayAuth(request(headers, ip, url), response, () => {});
  return result;
}
function cors(origin: string, headers: Record<string, string> = {}, url = '/api/tasks'): boolean {
  let allowed: unknown;
  auth.buildGatewayCorsOptions({ headers, url, method: 'OPTIONS' }).origin(origin, (error: unknown, value: unknown) => {
    assert.equal(error, null); allowed = value;
  });
  return allowed === true;
}
function reset() {
  gateway.auth = { enabled: true, token: '' }; gateway.auth_token = '';
  gateway.host = '127.0.0.1'; gateway.port = 18789; gateway.https.enabled = false;
  resolution = undefined; resolutionThrows = false;
  for (const key of Object.keys(env)) delete env[key];
}
let passed = 0;
let failed = 0;
function check(name: string, run: () => void) {
  reset();
  try { run(); passed++; console.log(`PASS ${name}`); }
  catch (error) { failed++; console.error(`FAIL ${name}: ${(error as Error).message}`); }
}
let unresolvedAccepted = 0;
for (const ref of ['env:ABSENT_GATEWAY_AUTH_TEST', 'vault:absent-gateway-auth-test']) {
  check(`unresolved ${ref.split(':')[0]} literal is rejected remotely`, () => {
    gateway.auth.token = ref;
    const actual = status({ authorization: `Bearer ${ref}` }, remote);
    if (actual === 200) unresolvedAccepted++;
    assert.equal(actual, 401);
  });
  check(`unresolved ${ref.split(':')[0]} cannot downgrade to ambient local trust`, () => {
    gateway.auth.token = ref;
    assert.equal(status({ origin: 'http://127.0.0.1:18789' }), 401);
  });
  check(`resolved ${ref.split(':')[0]} authorizes the real secret, not reference`, () => {
    gateway.auth.token = ref; resolution = 'resolved-test-secret';
    assert.equal(status({ authorization: 'Bearer resolved-test-secret' }, remote), 200);
    assert.equal(status({ authorization: `Bearer ${ref}` }, remote), 401);
  });
}
check('unresolved secret reports sanitized configuration failure', () => {
  gateway.auth.token = 'vault:private-reference-name';
  const evaluation = auth.evaluateGatewayRequest(request({}, remote));
  assert.equal(evaluation.status, 401);
  assert.match(evaluation.message, /configuration.*secret.*resolved/i);
  assert.doesNotMatch(evaluation.message, /private-reference-name/);
  assert.throws(() => auth.resolveGatewayAuthToken(), /configuration.*secret.*resolved/i);
});
check('whitespace and thrown secret resolution fail closed without details', () => {
  gateway.auth.token = 'env:WHITESPACE'; resolution = '   ';
  assert.equal(status(), 401);
  resolutionThrows = true;
  const evaluation = auth.evaluateGatewayRequest(request());
  assert.equal(evaluation.status, 401);
  assert.doesNotMatch(evaluation.message, /sensitive|backend/);
});
check('literal and legacy gateway credentials still work', () => {
  gateway.auth_token = 'literal-test-secret';
  assert.equal(status({ 'x-gateway-token': 'literal-test-secret' }, remote), 200);
  assert.equal(status({ authorization: 'Bearer wrong' }, remote), 401);
});
let nullStatus = 0;
check('opaque null origin has no ambient loopback authority', () => {
  nullStatus = status({ origin: 'null' }); assert.equal(nullStatus, 403);
});
for (const origin of ['file:///tmp/untrusted.html', 'custom://localhost:18789', 'http://localhost:19999', 'http://localhost.evil:18789', 'http://localhost:18789/path']) {
  check(`untrusted origin ${origin} rejected`, () => assert.equal(status({ origin }), 403));
}
for (const origin of ['http://localhost:18789', 'http://127.0.0.1:18789', 'http://[::1]:18789']) {
  check(`desktop/Electron exact loopback ${origin} works`, () => {
    assert.equal(status({ origin }), 200); assert.equal(cors(origin), true);
  });
}
check('Electron stable relay public port is trusted, unrelated port is not', () => {
  env.PROMETHEUS_GATEWAY_PUBLIC_PORT = '27890';
  assert.equal(status({ origin: 'http://127.0.0.1:27890' }), 200);
  assert.equal(status({ origin: 'http://127.0.0.1:18789' }), 403);
});
check('configured gateway and optional HTTPS listener use exact origins', () => {
  gateway.host = 'gateway.example'; gateway.https.enabled = true;
  assert.equal(cors('https://gateway.example:19443'), true);
  assert.equal(cors('http://gateway.example:18789'), true);
  assert.equal(cors('https://gateway.example:18789'), false);
});
let opaqueCorsAccepted = 0;
check('opaque CORS blocked even for pairing preflight and media grants', () => {
  const variants: Array<Record<string, string>> = [{}, { 'x-pairing-token': 'paired-test-capability' }, { 'access-control-request-headers': 'X-Pairing-Token' }];
  for (const headers of variants) {
    if (cors('null', headers)) opaqueCorsAccepted++;
  }
  assert.equal(opaqueCorsAccepted, 0);
  assert.equal(cors('null', {}, '/api/canvas/inline?pt=paired-test-capability'), false);
  assert.equal(cors('file:///tmp/test', { 'x-pairing-token': 'paired-test-capability' }), false);
});
check('remote HTTPS paired PWA works through Funnel; revoked/missing fails', () => {
  const headers = { origin: 'https://phone.example', 'tailscale-funnel-request': '1', 'x-pairing-token': 'paired-test-capability' };
  assert.equal(status(headers), 200);
  assert.equal(status({ ...headers, 'x-pairing-token': 'revoked' }), 401);
  assert.equal(status({ origin: headers.origin, 'tailscale-funnel-request': '1' }), 401);
  assert.equal(cors(headers.origin, { 'access-control-request-headers': 'X-Pairing-Token' }), true);
  assert.equal(cors(headers.origin, {}, '/api/pairing/claim'), true);
  assert.equal(auth.evaluateGatewayRequest(request({ 'tailscale-funnel-request': '1' }, local, '/ws?pt=paired-test-capability'), { allowQueryToken: true }).ok, true);
});
check('explicit capabilities work independently of unresolved gateway credential', () => {
  gateway.auth.token = 'env:ABSENT';
  assert.equal(status({ 'x-pairing-token': 'paired-test-capability' }, remote), 200);
});
check('native channels retain credentialed remote and originless local access', () => {
  assert.equal(status(), 200);
  assert.equal(status({}, remote), 401);
  gateway.auth.token = 'channel-test-secret';
  assert.equal(status({ authorization: 'Bearer channel-test-secret' }, remote), 200);
});
check('explicit capability can authorize non-browser file client, CORS never trusts null', () => {
  gateway.auth.token = 'explicit-capability';
  assert.equal(status({ origin: 'null', authorization: 'Bearer explicit-capability' }), 200);
  assert.equal(cors('null'), false);
});
console.log(`METRICS unresolved-reference accepted ${unresolvedAccepted}/2; null-origin status ${nullStatus}; opaque CORS accepted ${opaqueCorsAccepted}/3`);
console.log(`gateway-auth-fail-closed: ${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failed) process.exitCode = 1;
