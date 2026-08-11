import assert from 'node:assert/strict';
import { resolveConnectionToolExposure } from './tool-surface.js';
import type { ConnectionRecord } from './types.js';

function record(overrides: Partial<ConnectionRecord> = {}): ConnectionRecord {
  return {
    id: 'connection_fixture',
    schemaVersion: 1,
    serviceId: 'fixture',
    serviceName: 'Fixture',
    pluginId: 'fixture',
    strategyId: 'fixture-oauth',
    adapterId: 'connector-oauth',
    installed: true,
    enabled: true,
    configured: true,
    authenticated: true,
    registered: true,
    exposed: true,
    verified: true,
    authState: 'healthy',
    health: 'healthy',
    contractVersion: 2,
    grantedCapabilities: ['read'],
    registeredTools: ['fixture_list', 'fixture_update'],
    availableTools: ['fixture_list', 'fixture_update'],
    exposedTools: ['fixture_list'],
    tools: [
      { name: 'fixture_list', risk: 'read-only', approved: true },
      { name: 'fixture_update', risk: 'write', approved: false },
    ],
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    ...overrides,
  };
}

const read = resolveConnectionToolExposure([record()], 'fixture', 'fixture_list');
assert.equal(read.managed, true);
assert.equal(read.available, true);
assert.equal(read.exposed, true);

const write = resolveConnectionToolExposure([record()], 'fixture', 'fixture_update');
assert.equal(write.managed, true);
assert.equal(write.available, true, 'available action tools must reach the normal approval gate');
assert.equal(write.exposed, false, 'write tools must not be auto-approved');

const disabled = resolveConnectionToolExposure([record({ availableTools: ['fixture_list'] })], 'fixture', 'fixture_update');
assert.equal(disabled.available, false, 'an explicit allowlist must disable omitted tools');

const disconnected = resolveConnectionToolExposure([record({ authenticated: false, authState: 'none' })], 'fixture', 'fixture_list');
assert.equal(disconnected.managed, true);
assert.equal(disconnected.available, false, 'authenticated state is required before exposing a canonical tool');

const legacy = resolveConnectionToolExposure([record({ adapterId: 'legacy', contractVersion: 1, strategyId: 'legacy-compatibility' })], 'fixture', 'fixture_list');
assert.equal(legacy.managed, false);
assert.equal(legacy.available, true, 'legacy runtime connections keep compatibility until migrated');

const mcp = resolveConnectionToolExposure([record({ serviceId: 'remote-mcp', pluginId: 'remote-mcp', configuration: { mcpServerId: 'remote-mcp' } })], 'remote-mcp', 'fixture_list');
assert.equal(mcp.managed, true, 'MCP targets match the canonical mcpServerId');

console.log('[tool-surface.regression] canonical availability, automatic exposure, explicit allowlists, and legacy fallback passed');
