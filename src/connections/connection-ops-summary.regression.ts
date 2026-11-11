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

// A canonical record whose live connector reports "not connected" must not read as connected.
const canonicalLiveRevoked = summarizeConnectionOps(canonical, { live: { connected: false, toolCount: 1 } });
assert.equal(canonicalLiveRevoked.connected, false, 'live runtime outranks a stored canonical "connected"');
assert.equal(canonicalLiveRevoked.authState, 'reauth_required');
assert.equal(canonicalLiveRevoked.action, 'reauthenticate');

const canonicalLiveOk = summarizeConnectionOps(canonical, { live: { connected: true, toolCount: 1 } });
assert.equal(canonicalLiveOk.connected, true);
assert.equal(canonicalLiveOk.action, undefined);

// A canonical record that never passed verify must not read as verified just because it is live.
const canonicalNeverVerified = summarizeConnectionOps({ ...canonical, verified: false }, { live: { connected: true, toolCount: 1 } });
assert.equal(canonicalNeverVerified.connected, true);
assert.equal(canonicalNeverVerified.verified, false, 'live status must not stand in for a canonical verification that never ran');
const canonicalVerifiedLive = summarizeConnectionOps({ ...canonical, verified: true }, { live: { connected: true, toolCount: 1 } });
assert.equal(canonicalVerifiedLive.verified, true);

// A healthy MCP-backed canonical record must not be flagged because a built-in
// connector that happens to share its service id is disconnected.
const mcpBackedHealthy = summarizeConnectionOps({ ...canonical, verified: true }, {
  mcpStatus: { status: 'connected' },
  live: { connected: false, toolCount: 0 },
});
assert.equal(mcpBackedHealthy.connected, true, 'a same-id disconnected connector must not revoke a healthy MCP connection');
assert.notEqual(mcpBackedHealthy.authState, 'reauth_required');
assert.equal(mcpBackedHealthy.action, undefined);
assert.equal(mcpBackedHealthy.verified, true);


console.log('[connection-ops-summary.regression] canonical registered gate, legacy live overlay, zero registered tools, and MCP invalidation passed');
