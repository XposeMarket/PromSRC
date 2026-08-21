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

const implicitRegistry = new PrometheusExtensionRuntimeRegistry();
let implicitConnected = false;
implicitRegistry.registerManifest({
  id: 'manifest-extension',
  kind: 'connector',
  name: 'Manifest Connector',
  sourcePath: 'fixture/prometheus.extension.json',
  trustLevel: 'bundled',
  contracts: { connectors: ['manifest-connector'], tools: ['manifest_list_records'] },
  runtime: {},
} as any);
implicitRegistry.registerConnector('manifest-extension', {
  id: 'manifest-connector',
  name: 'Manifest Connector',
  isConnected: () => implicitConnected,
});
implicitRegistry.registerTool('manifest-extension', {
  name: 'manifest_list_records',
  description: 'List records without an explicit connectorId.',
  parameters: { type: 'object', properties: {} },
  execute: async () => ({ result: 'ok', error: false }),
});
assert.equal(implicitRegistry.listConnectedConnectorToolDefinitions().length, 0, 'manifest-owned tools must honor connector status without connectorId');
assert.equal(implicitRegistry.isToolAvailable('manifest_list_records'), false, 'execution must honor manifest-owned connector status without connectorId');
implicitConnected = true;
implicitRegistry.invalidateConnectorState('manifest-connector');
assert.equal(implicitRegistry.listConnectedConnectorToolDefinitions().length, 1, 'manifest-owned tools should appear once the connector is connected');
assert.equal(implicitRegistry.isToolAvailable('manifest_list_records'), true, 'execution should allow manifest-owned tools once connected');

console.log('extension runtime registry performance regression passed');
