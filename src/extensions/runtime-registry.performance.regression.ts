import assert from 'node:assert/strict';
import { PrometheusExtensionRuntimeRegistry } from './runtime-registry.js';

const registry = new PrometheusExtensionRuntimeRegistry();
let connectionChecks = 0;

registry.registerConnector('test-extension', {
  id: 'test-connector',
  name: 'Test Connector',
  isConnected: () => {
    connectionChecks++;
    return true;
  },
});

for (let index = 0; index < 100; index++) {
  registry.registerTool('test-extension', {
    name: `test_tool_${index}`,
    description: `Test tool ${index}`,
    parameters: { type: 'object', properties: {} },
    connectorId: 'test-connector',
    execute: async () => ({ result: 'ok', error: false }),
  });
}

assert.equal(registry.listConnectedConnectorToolDefinitions().length, 100);
assert.equal(connectionChecks, 1, 'connection status must be evaluated once per connector, not once per tool');

assert.equal(registry.listConnectedConnectorToolDefinitions().length, 100);
assert.equal(connectionChecks, 1, 'connection status should be reused during the bounded snapshot TTL');

const revisionBeforeInvalidation = registry.getRevision();
registry.invalidateConnectorState('test-connector');
assert.ok(registry.getRevision() > revisionBeforeInvalidation);
assert.equal(registry.listConnectedConnectorToolDefinitions().length, 100);
assert.equal(connectionChecks, 2, 'explicit invalidation must force a fresh connection check');

console.log('extension runtime registry performance regression passed');
