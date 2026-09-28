import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { encodeFormBody, validateConnectorApiPath } from './api-request.js';
import { resolveToolCapabilityMetadata } from '../../../../gateway/tool-capabilities.js';

// Completeness contract: every native connector that ships runtime tools must
// also ship a `connector_<id>_api_request` escape hatch, so nothing the
// provider API supports is ever out of reach just because nobody hand-wrote a
// first-class tool for it. Tools must also be in sync with both manifest
// allowlists or the connection layer reports "not enabled for this connection".
const root = join(process.cwd(), 'src', 'extensions', 'bundled', 'connectors');
// Connectors whose runtime is not a REST provider wrapper.
const EXEMPT = new Set(['obsidian']); // local vault files, no remote API

async function main() {
let checked = 0;
for (const dir of readdirSync(root)) {
  const runtimePath = join(root, dir, 'runtime.ts');
  const manifestPath = join(root, dir, 'prometheus.extension.json');
  if (dir.startsWith('_') || !existsSync(runtimePath) || EXEMPT.has(dir)) continue;
  const mod = await import(`../${dir}/runtime.js`);
  const ext = mod.default;
  const registered = new Map<string, any>();
  let toolNames: string[] = [];
  ext.register({
    registerConnector: (c: any) => { toolNames = c.toolNames || []; },
    registerTool: (t: any) => registered.set(t.name, t),
  } as any);
  if (!registered.size) continue;
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const id = manifest.id;
  const apiTool = [...registered.keys()].find((n) => n.endsWith('_api_request')) || `connector_${id}_api_request`;
  assert.ok(registered.has(apiTool), `${dir}: missing ${apiTool} escape hatch`);
  const owned = new Set<string>(manifest.ownership?.tools || []);
  const strategyTools = manifest.connection?.strategies?.[0]?.config?.registeredTools as string[] | undefined;
  for (const name of registered.keys()) {
    assert.ok(toolNames.includes(name), `${dir}: ${name} missing from runtime toolNames`);
    assert.ok(owned.has(name), `${dir}: ${name} missing from manifest ownership.tools`);
    if (strategyTools) assert.ok(strategyTools.includes(name), `${dir}: ${name} missing from strategy registeredTools`);
  }
  // Drive's escape hatch is GET-only by construction and declared read-only.
  if (apiTool === 'connector_gdrive_api_request') { assert.equal(registered.get(apiTool).parameters?.properties?.method, undefined, 'gdrive api_request must stay GET-only'); checked++; continue; }
  assert.equal(resolveToolCapabilityMetadata(apiTool, undefined, { method: 'GET' }).externalWrite, false, `${apiTool} GET is a read`);
  assert.equal(resolveToolCapabilityMetadata(apiTool, undefined, { method: 'DELETE' }).externalWrite, true, `${apiTool} DELETE is gated`);
  assert.equal(resolveToolCapabilityMetadata(apiTool, undefined, {}).externalWrite, true, `${apiTool} missing method fails toward write`);
  checked++;
}
assert.ok(checked >= 10, `expected at least 10 connectors checked, got ${checked}`);
return checked;
}

assert.equal(validateConnectorApiPath('/v1/customers?limit=3'), null);
assert.equal(validateConnectorApiPath('/v1beta/properties/123:runReport'), null);
for (const bad of ['', 'v1/x', '//evil.com/x', 'https://evil.com', '/a/../b', '/a/%2e%2e/b', '/a b', '/x\\y', '/@evil.com']) {
  assert.ok(validateConnectorApiPath(bad), `path should be rejected: ${JSON.stringify(bad)}`);
}
assert.equal(encodeFormBody({ amount: 500, metadata: { a: 'b' }, expand: ['x', 'y'] }), 'amount=500&metadata%5Ba%5D=b&expand%5B0%5D=x&expand%5B1%5D=y');

main().then((checked) => console.log(`connector api_request regression: ${checked} connectors have api_request, manifests in sync, write gates + path validation OK`)).catch((err) => { console.error(err); process.exit(1); });
