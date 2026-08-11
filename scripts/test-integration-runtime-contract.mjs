import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const { platformCapabilityExecutor } = await import('../dist/gateway/agents-runtime/capabilities/platform-executor.js');
const { getCisSystemTools } = await import('../dist/gateway/tools/defs/cis-system.js');
const { buildAuthMetadataCandidates } = await import('../dist/gateway/mcp-oauth.js');
const { readJsonRpcResponse } = await import('../dist/gateway/mcp-manager.js');

assert(platformCapabilityExecutor.canHandle('webhook_manage'), 'webhook_manage must be registered');
assert(platformCapabilityExecutor.canHandle('integration_quick_setup'), 'integration_quick_setup must be registered');
assert(platformCapabilityExecutor.canHandle('mcp_server_manage'), 'mcp_server_manage must remain registered');
assert(platformCapabilityExecutor.canHandle('connection_ops'), 'connection_ops must be registered');

const defs = getCisSystemTools();
assert(defs.some((def) => def.function?.name === 'connection_ops'), 'connection_ops schema missing');
const connectionDef = defs.find((def) => def.function?.name === 'connection_ops');
assert(connectionDef.function.parameters.properties.action.enum.includes('set_tool_availability'), 'connection_ops schema missing set_tool_availability');
assert(connectionDef.function.parameters.properties.available_tools, 'connection_ops schema missing available_tools');
const webhookDef = defs.find((def) => def.function?.name === 'webhook_manage');
assert(webhookDef, 'webhook_manage schema missing');
assert.match(webhookDef.function.parameters.properties.action.description, /set_provider/);
assert.deepEqual(webhookDef.function.parameters.properties.provider.enum, ['github', 'stripe', 'slack']);
assert(webhookDef.function.parameters.properties.events, 'webhook provider event map schema missing');
const mcp = defs.find((def) => def.function?.name === 'mcp_server_manage');
assert(mcp, 'mcp_server_manage schema missing');
const actionDescription = mcp.function.parameters.properties.action.description;
for (const action of ['oauth_start', 'oauth_status', 'oauth_clear']) {
  assert(actionDescription.includes(action), `MCP schema missing ${action}`);
}
assert(actionDescription.includes('refresh_tools'), 'MCP schema missing refresh_tools');
assert(mcp.function.parameters.properties.scope, 'MCP OAuth scope schema missing');

const metadataCandidates = buildAuthMetadataCandidates('https://agent.robinhood.com/mcp/trading', 'https://agent.robinhood.com');
assert(metadataCandidates.includes('https://agent.robinhood.com/.well-known/oauth-authorization-server/mcp/trading'), 'RFC 8414 path-bearing issuer candidate missing');
assert(metadataCandidates.includes('https://agent.robinhood.com/.well-known/oauth-authorization-server'), 'origin authorization metadata fallback missing');
assert(!metadataCandidates.some((url) => url.endsWith('/mcp/trading/authorize')), 'OAuth discovery must never guess an authorize endpoint');

const largeDescription = `portfolio ${'data '.repeat(5000)}complete`;
const ssePayload = `data: ${JSON.stringify({ jsonrpc: '2.0', id: 2, result: { tools: [{ name: 'portfolio_read', description: largeDescription }] } })}\r\n\r\n`;
const splitInsideString = ssePayload.indexOf('data data data') + 7;
const stream = new ReadableStream({
  start(controller) {
    const encoder = new TextEncoder();
    controller.enqueue(encoder.encode(ssePayload.slice(0, splitInsideString)));
    controller.enqueue(encoder.encode(ssePayload.slice(splitInsideString)));
    controller.close();
  },
});
const parsedSse = await readJsonRpcResponse(new Response(stream, { headers: { 'content-type': 'text/event-stream' } }), 1000);
assert.equal(parsedSse.result.tools[0].description, largeDescription, 'chunked SSE JSON must remain intact');

const toolBuilderSource = fs.readFileSync(path.join(root, 'src', 'gateway', 'tool-builder.ts'), 'utf8');
assert(!toolBuilderSource.includes('PROMETHEUS_DIRECT_CONNECTOR_TOOL_SCHEMAS'), 'connected connector schemas must not require an environment opt-in');
assert.match(toolBuilderSource, /categoryIsActive\('external_apps'\)/, 'external_apps must expose connected connector schemas');
const toolSurfaceSource = fs.readFileSync(path.join(root, 'src', 'connections', 'tool-surface.ts'), 'utf8');
assert.match(toolSurfaceSource, /availableTools/, 'canonical connection tool surface must support explicit availability');
assert.match(toolSurfaceSource, /isManagedConnectorToolAvailable/, 'native connector execution must have a host-owned guard');
assert.match(toolSurfaceSource, /isManagedMcpToolAvailable/, 'MCP execution must have a host-owned guard');
const runtimeRegistrySource = fs.readFileSync(path.join(root, 'src', 'extensions', 'runtime-registry.ts'), 'utf8');
assert.match(runtimeRegistrySource, /getConnectionToolExposure/, 'connected connector definitions must consult canonical connection state');
const mcpManagerSource = fs.readFileSync(path.join(root, 'src', 'gateway', 'mcp-manager.ts'), 'utf8');
assert.match(mcpManagerSource, /notifications\/tools\/list_changed/, 'MCP list changes must trigger refresh');
assert.match(mcpManagerSource, /refreshTools\(id:/, 'MCP tools must have an explicit refresh path');
assert.match(mcpManagerSource, /buildHttpHeaders/, 'live MCP HTTP requests must rebuild vault/OAuth headers');
const mcpRouteSource = fs.readFileSync(path.join(root, 'src', 'gateway', 'routes', 'goals.router.ts'), 'utf8');
assert.match(mcpRouteSource, /toolMetadata: connection\?\.tools/, 'MCP status must expose canonical tool grant metadata');
const consistencySource = fs.readFileSync(path.join(root, 'src', 'extensions', 'consistency.ts'), 'utf8');
assert.match(consistencySource, /Native runtime connector declarations must be exact/, 'manifest/runtime connector parity must be checked');

const webhook = await platformCapabilityExecutor.execute({
  name: 'webhook_manage', args: { action: 'get' }, workspacePath: root, sessionId: 'integration-contract', deps: {},
});
assert.equal(webhook.error, false);
const webhookStatus = JSON.parse(webhook.result);
assert.equal(typeof webhookStatus.tokenConfigured, 'boolean');
assert(!('token' in webhookStatus), 'webhook get must never expose the token');
assert(Array.isArray(webhookStatus.providers), 'webhook get must report redacted provider readiness');
assert(!JSON.stringify(webhookStatus).includes('secret"'), 'webhook get must never expose provider secret values');

const presets = await platformCapabilityExecutor.execute({
  name: 'integration_quick_setup', args: { action: 'list_presets' }, workspacePath: root, sessionId: 'integration-contract', deps: {},
});
assert.equal(presets.error, false);
assert(Array.isArray(JSON.parse(presets.result).presets));

console.log('PASS: connector exposure, integration-admin registration, redaction, presets, and MCP OAuth schema contract');
