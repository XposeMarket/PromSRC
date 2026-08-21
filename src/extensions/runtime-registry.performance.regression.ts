import assert from 'node:assert/strict';
import { PrometheusExtensionRuntimeRegistry } from './runtime-registry.js';

async function run() {
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
  let implicitExecutions = 0;
  let implicitAuthFailure = false;
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
    execute: async () => {
      implicitExecutions++;
      return implicitAuthFailure
        ? { result: '401 Unauthorized', error: true }
        : { result: 'ok', error: false };
    },
  });
  assert.equal(implicitRegistry.listConnectedConnectorToolDefinitions().length, 0, 'manifest-owned tools must honor connector status without connectorId');
  assert.equal(implicitRegistry.isToolAvailable('manifest_list_records'), false, 'execution must honor manifest-owned connector status without connectorId');
  assert.equal(implicitRegistry.isConnectorAvailable('manifest-connector'), false, 'connector availability must include the live connection state');

  const blockedExecution = await implicitRegistry.executeTool('manifest_list_records', {});
  assert.equal(blockedExecution.error, true, 'the central runtime executor must reject disconnected connector tools');
  assert.equal(implicitExecutions, 0, 'a disconnected connector tool must not reach its implementation');

  implicitConnected = true;
  implicitRegistry.invalidateConnectorState('manifest-connector');
  assert.equal(implicitRegistry.listConnectedConnectorToolDefinitions().length, 1, 'manifest-owned tools should appear once the connector is connected');
  assert.equal(implicitRegistry.isToolAvailable('manifest_list_records'), true, 'execution should allow manifest-owned tools once connected');
  assert.equal(implicitRegistry.isConnectorAvailable('manifest-connector'), true);

  const allowedExecution = await implicitRegistry.executeTool('manifest_list_records', {});
  assert.equal(allowedExecution.error, false, 'connected manifest-owned connector tools should execute');
  assert.equal(implicitExecutions, 1);

  implicitAuthFailure = true;
  const authFailure = await implicitRegistry.executeTool('manifest_list_records', {});
  assert.equal(authFailure.error, true);
  assert.match(
    implicitRegistry.buildConnectorStatus(),
    /manifest-connector[\s\S]*Auth health: expired_or_invalid/,
    'manifest-owned tools must record auth health against the resolved connector id, not the extension id',
  );

  console.log('extension runtime registry performance regression passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
