import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PrometheusExtensionRuntimeRegistry } from './runtime-registry.js';
import { buildMcpServerEnv } from '../gateway/mcp-server-env.js';
import { assertPluginPermission, assertCurrentPluginPermission, validatePluginPermissions, withPluginPermissions } from './permission-manifest.js';
import { parseExtensionDescriptor } from './schema.js';
import { MCPManager } from '../gateway/mcp-manager.js';
import { executeConnectorApiRequest } from './bundled/connectors/_runtime/api-request.js';
let count = 0;
async function test(name: string, fn: () => unknown) { await fn(); count++; console.log(`ok ${count} - ${name}`); }
async function main() {
  const parent = { Path: 'bin', SystemRoot: 'windows', TEMP: 'tmp', OPENAI_API_KEY: 'secret', ANTHROPIC_API_KEY: 'secret', XAI_API_KEY: 'secret', GITHUB_TOKEN: 'secret', NODE_OPTIONS: '--require evil', EXTRA: 'yes' };
  await test('base environment strips every unlisted key', () => {
    assert.deepEqual({ ...buildMcpServerEnv({}, parent) }, { Path: 'bin', SystemRoot: 'windows', TEMP: 'tmp' });
  });
  await test('configured credentials and env win', () => {
    const env = buildMcpServerEnv({ env: { OPENAI_API_KEY: 'explicit', PATH: 'override' } }, parent);
    assert.equal(env.OPENAI_API_KEY, 'explicit'); assert.equal(env.PATH, 'override'); assert.equal(env.Path, undefined);
  });
  await test('passthrough is exact and opt-in', () => {
    const env = buildMcpServerEnv({ envPassthrough: ['GITHUB_TOKEN', 'EXTRA', 'MISSING'] }, parent);
    assert.equal(env.GITHUB_TOKEN, 'secret'); assert.equal(env.EXTRA, 'yes'); assert.equal(env.MISSING, undefined); assert.equal(env.OPENAI_API_KEY, undefined);
    assert.equal(parent.NODE_OPTIONS, '--require evil');
  });
  await test('config normalization retains passthrough', () => {
    assert.deepEqual(MCPManager.normalizeConfig({ id: 'demo', command: 'node', envPassthrough: ['GITHUB_TOKEN', 5, '*'] })?.envPassthrough, ['GITHUB_TOKEN']);
  });
  const manifest = { id: 'demo', permissions: validatePluginPermissions({ network: { hosts: ['api.example.com'] }, tools: ['demo_read'], secrets: ['token'], sideEffects: 'read' }) };
  await test('valid manifest and exact host allowed', () => assertPluginPermission(manifest, { kind: 'network', url: 'https://API.EXAMPLE.COM/v1' }));
  await test('undeclared and suffix hosts denied', () => {
    for (const url of ['https://evil.com', 'https://api.example.com.evil.com', 'file://api.example.com']) assert.throws(() => assertPluginPermission(manifest, { kind: 'network', url }));
  });
  await test('unknown fields and broad grants rejected', () => {
    for (const bad of [{ unknown: true }, { network: { hosts: ['*'] } }, { network: { hosts: ['*.example.com'] } }, { network: { hosts: ['https://example.com'] } }, { tools: ['*'] }, { filesystem: { read: ['/'] } }, { network: { hosts: [], extra: true } }]) assert.throws(() => validatePluginPermissions(bad));
    assert.doesNotThrow(() => validatePluginPermissions({ network: { hosts: ['*'], allowWildcardHosts: true } }));
  });
  await test('tool secret and side-effect grants enforced', () => {
    assertPluginPermission(manifest, { kind: 'tool', name: 'demo_read' });
    assertPluginPermission(manifest, { kind: 'secret', name: 'token' });
    assert.throws(() => assertPluginPermission(manifest, { kind: 'tool', name: 'other' }));
    assert.throws(() => assertPluginPermission(manifest, { kind: 'secret', name: 'other' }));
    assert.throws(() => assertPluginPermission(manifest, { kind: 'sideEffect', level: 'external' }));
  });
  await test('legacy allows and warns once per plugin', () => {
    const warn = console.warn; let warnings = 0; console.warn = () => { warnings++; };
    try { for (let i = 0; i < 2; i++) assertPluginPermission({ id: 'legacy-test' }, { kind: 'network', url: 'https://evil.com' }); assert.equal(warnings, 1); } finally { console.warn = warn; }
  });
  await test('parser preserves strict permissions and old advisory shape', () => {
    const base = { id: 'test', kind: 'connector', name: 'test', description: 'test', runtime: { binding: 'test' } };
    assert.deepEqual(parseExtensionDescriptor({ ...base, permissions: manifest.permissions }, 'test').permissions, manifest.permissions);
    assert.deepEqual(parseExtensionDescriptor({ ...base, permissions: { network: ['api.example.com'], process: false, credentials: ['token'] } }, 'test').permissions?.network?.hosts, ['api.example.com']);
    assert.throws(() => parseExtensionDescriptor({ ...base, permissions: { mystery: true } }, 'test'));
  });
  await test('async contexts remain isolated', async () => {
    await Promise.all([withPluginPermissions(manifest, async () => { await Promise.resolve(); assertCurrentPluginPermission({ kind: 'network', url: 'https://api.example.com' }); }), withPluginPermissions({ id: 'denied', permissions: {} }, async () => { await Promise.resolve(); assert.throws(() => assertCurrentPluginPermission({ kind: 'network', url: 'https://api.example.com' })); })]);
  });
  await test('API escape hatch denies before fetching credentials', async () => {
    let tokens = 0;
    const result = await withPluginPermissions(manifest, () => executeConnectorApiRequest({ connectorId: 'demo', displayName: 'Demo', bases: { api: 'https://evil.com' }, examplePath: '/v1', coverageHint: '', getToken: async () => { tokens++; return 'token'; } }, {}, { path: '/v1' }));
    assert.equal(result.error, true); assert.equal(tokens, 0); assert.match(result.result, /permission denied/);
  });
  await test('runtime dispatch enforces declared tools', async () => {
    const registry = new PrometheusExtensionRuntimeRegistry();
    registry.registerManifest({ id: 'demo', kind: 'integration', name: 'Demo', description: 'Demo', sourcePath: 'fixture', runtime: { binding: 'fixture' }, permissions: { tools: ['demo_read'] } });
    let executions = 0;
    for (const name of ['demo_read', 'demo_denied']) registry.registerTool('demo', { name, description: name, parameters: { type: 'object', properties: {} }, execute: async () => { executions++; return { result: 'ok', error: false }; } });
    assert.equal((await registry.executeTool('demo_read', {})).result, 'ok');
    await assert.rejects(() => registry.executeTool('demo_denied', {}), /permission denied/);
    assert.equal(executions, 1);
  });
  await test('every bundled descriptor still validates', () => {
    const walk = (dir: string) => { for (const entry of fs.readdirSync(dir, { withFileTypes: true })) { const file = path.join(dir, entry.name); if (entry.isDirectory()) walk(file); else if (entry.name === 'prometheus.extension.json') parseExtensionDescriptor(JSON.parse(fs.readFileSync(file, 'utf8')), file); } };
    walk(path.join(process.cwd(), 'src/extensions/bundled'));
  });
  console.log(`platform-wave5a: ${count} tests passed`);
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
