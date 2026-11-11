import assert from 'node:assert/strict';
import { overlayConnectionOnConnectorState, pickCatalogConnectionRecord } from './catalog-connector-state.js';

const stub: any = {
  id: 'connection_github_stub',
  serviceId: 'github',
  serviceName: 'github',
  strategyId: 'legacy-compatibility',
  adapterId: 'legacy',
  contractVersion: 1,
  enabled: true,
  configured: true,
  authenticated: true,
  registered: false,
  exposed: false,
  verified: false,
  authState: 'healthy',
  health: 'unknown',
  registeredTools: [],
  availableTools: [],
  exposedTools: [],
};

const canonical: any = {
  id: 'connection_github_v2',
  serviceId: 'github',
  serviceName: 'GitHub',
  strategyId: 'oauth',
  adapterId: 'connector-oauth',
  contractVersion: 2,
  enabled: true,
  configured: true,
  authenticated: true,
  registered: true,
  exposed: true,
  verified: true,
  authState: 'healthy',
  health: 'healthy',
  registeredTools: ['gh_list', 'gh_create'],
  availableTools: ['gh_list'],
  exposedTools: ['gh_list'],
};

const descriptorTools = ['connector_github_list_prs', 'connector_github_create_pr'];
const base = { connected: true, hasCredentials: true, authType: 'oauth' };

// Record choice: canonical beats a newer stub; a lone stub is still used.
assert.equal(pickCatalogConnectionRecord([stub, canonical])?.id, 'connection_github_v2');
assert.equal(pickCatalogConnectionRecord([stub])?.id, 'connection_github_stub');
assert.equal(pickCatalogConnectionRecord([]), undefined);

// Legacy stub + live runtime connected: must read as connected, verified, tools on.
const legacyLive = overlayConnectionOnConnectorState(base, stub, { connected: true }, descriptorTools);
assert.equal(legacyLive.connected, true);
assert.equal(legacyLive.verified, true, 'a live legacy connector must not show "Needs verification"');
assert.equal(legacyLive.registered, true);
assert.equal(legacyLive.authState, 'healthy');
assert.equal(legacyLive.health, 'healthy');
assert.deepEqual(legacyLive.registeredTools, descriptorTools);
assert.deepEqual(legacyLive.availableTools, descriptorTools, 'a live legacy connector must not show "No tools enabled"');
assert.equal(legacyLive.legacyRuntime, true);
assert.equal(legacyLive.connectionId, 'connection_github_stub');

// Legacy stub + live runtime says disconnected: must NOT read as connected.
const legacyDown = overlayConnectionOnConnectorState(base, stub, { connected: false }, descriptorTools);
assert.equal(legacyDown.connected, false);
assert.equal(legacyDown.verified, false);
assert.equal(legacyDown.authState, 'reauth_required');
assert.deepEqual(legacyDown.availableTools, []);

// Legacy stub with no live status (Vercel-style credential check) follows the base state.
const legacyFromBase = overlayConnectionOnConnectorState(base, stub, undefined, descriptorTools);
assert.equal(legacyFromBase.connected, true);
assert.equal(legacyFromBase.verified, false, 'no live signal must not be promoted to verified from saved state alone');
assert.equal(legacyFromBase.registered, false);
assert.deepEqual(legacyFromBase.availableTools, [], 'no live signal must not list tools as available');
const legacyNoCreds = overlayConnectionOnConnectorState({ connected: false, hasCredentials: false }, stub, undefined, descriptorTools);
assert.equal(legacyNoCreds.connected, false);
assert.equal(legacyNoCreds.authState, 'none');
assert.deepEqual(legacyNoCreds.registeredTools, []);

// Canonical records keep their stored lifecycle fields and tool allowlist.
const canonicalLive = overlayConnectionOnConnectorState(base, canonical, { connected: true }, descriptorTools);
assert.equal(canonicalLive.verified, true);
assert.deepEqual(canonicalLive.registeredTools, ['gh_list', 'gh_create']);
assert.deepEqual(canonicalLive.availableTools, ['gh_list']);
assert.equal(canonicalLive.legacyRuntime, undefined);

const canonicalUnverified = overlayConnectionOnConnectorState(base, { ...canonical, verified: false }, { connected: true }, descriptorTools);
assert.equal(canonicalUnverified.verified, false, 'an unverified canonical connection must still ask for verification');

const canonicalRevoked = overlayConnectionOnConnectorState(base, canonical, { connected: false }, descriptorTools);
assert.equal(canonicalRevoked.connected, false);
assert.equal(canonicalRevoked.authState, 'reauth_required');
assert.deepEqual(canonicalRevoked.exposedTools, []);

console.log('[catalog-connector-state.regression] record choice, legacy live overlay, and canonical passthrough passed');
