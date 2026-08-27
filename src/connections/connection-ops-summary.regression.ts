import assert from 'node:assert/strict';
import { liveOverlayForConnection, summarizeConnectionOps } from './connection-ops-summary.js';

const canonical = {
  id: 'connection_robinhood',
  serviceId: 'robinhood',
  serviceName: 'Robinhood',
  strategyId: 'oauth',
  adapterId: 'connector-oauth',
  contractVersion: 2,
  enabled: true,
  authenticated: true,
  registered: true,
  verified: true,
  authState: 'healthy',
  health: 'healthy',
  registeredTools: ['rh_quote'],
  availableTools: ['rh_quote'],
  exposedTools: ['rh_quote'],
};

const canonicalOk = summarizeConnectionOps(canonical);
assert.equal(canonicalOk.connected, true);
assert.equal(canonicalOk.verified, true);
assert.equal(canonicalOk.toolCount, 1);
assert.equal(canonicalOk.source, undefined);

const canonicalUnregistered = summarizeConnectionOps({ ...canonical, registered: false });
assert.equal(canonicalUnregistered.connected, false, 'canonical v2 still requires registered');

const vercelStub = {
  id: 'connection_vercel',
  serviceId: 'vercel',
  serviceName: 'vercel',
  strategyId: 'legacy-compatibility',
  adapterId: 'legacy',
  contractVersion: 1,
  enabled: true,
  authenticated: true,
  registered: false,
  verified: false,
  authState: 'healthy',
  health: 'unknown',
  registeredTools: [],
  availableTools: [],
  exposedTools: [],
};

const stubWithoutLive = summarizeConnectionOps(vercelStub);
assert.equal(stubWithoutLive.connected, true, 'authenticated legacy stubs are connected when live overlay is unavailable');
assert.equal(stubWithoutLive.source, 'legacy-compatibility');
assert.equal(stubWithoutLive.liveRuntime, false);
assert.equal(stubWithoutLive.toolCount, 0);

const liveConnected = summarizeConnectionOps(vercelStub, {
  live: { connected: true, toolCount: 8 },
});
assert.equal(liveConnected.connected, true);
assert.equal(liveConnected.verified, true);
assert.equal(liveConnected.health, 'healthy');
assert.equal(liveConnected.toolCount, 8);
assert.equal(liveConnected.liveRuntime, true);

const liveDisconnected = summarizeConnectionOps(vercelStub, {
  live: { connected: false, toolCount: 0 },
});
assert.equal(liveDisconnected.connected, false, 'live overlay can still report a disconnected legacy connector');
assert.equal(liveDisconnected.verified, false);
assert.equal(liveDisconnected.health, 'unavailable');

const mcpInvalid = summarizeConnectionOps(canonical, {
  mcpStatus: { status: 'error', error: '401 unauthorized' },
});
assert.equal(mcpInvalid.connected, false);
assert.equal(mcpInvalid.verified, false);
assert.equal(mcpInvalid.action, 'reauthenticate');

const overlay = liveOverlayForConnection(vercelStub, {
  getConnector(id) {
    if (id !== 'vercel') return undefined;
    return { isConnected: () => true, toolNames: ['connector_vercel_status', 'connector_vercel_list_projects'] };
  },
  getTool(name) {
    return name.startsWith('connector_vercel_') ? {} : undefined;
  },
});
assert.equal(overlay?.connected, true);
assert.equal(overlay?.toolCount, 2);

const overlayWithNoRegisteredTools = liveOverlayForConnection(vercelStub, {
  getConnector(id) {
    if (id !== 'vercel') return undefined;
    return { isConnected: () => true, toolNames: ['connector_vercel_status', 'connector_vercel_list_projects'] };
  },
  getTool() {
    return undefined;
  },
});
assert.equal(overlayWithNoRegisteredTools?.connected, true);
assert.equal(overlayWithNoRegisteredTools?.toolCount, 0, 'registry-confirmed zero registered tools must not fall back to advertised tool names');

console.log('[connection-ops-summary.regression] canonical registered gate, legacy live overlay, zero registered tools, and MCP invalidation passed');
