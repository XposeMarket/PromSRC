import assert from 'node:assert/strict';
import { getDeclaredExtensionTools } from './tool-contracts.js';

assert.deepEqual(
  getDeclaredExtensionTools({ contracts: { tools: ['connector_modern_read', 'connector_modern_write'] } }),
  ['connector_modern_read', 'connector_modern_write'],
  'modern contracts.tools must be the canonical connector tool surface',
);

assert.deepEqual(
  getDeclaredExtensionTools({ ownership: { tools: ['connector_legacy_read', 'connector_legacy_write'] } }),
  ['connector_legacy_read', 'connector_legacy_write'],
  'legacy ownership.tools must remain supported',
);

assert.deepEqual(
  getDeclaredExtensionTools({
    contracts: { tools: ['connector_modern_read'] },
    ownership: { tools: ['connector_stale_legacy_tool'] },
  }),
  ['connector_modern_read'],
  'contracts.tools must win when both declaration styles are present',
);

assert.deepEqual(
  getDeclaredExtensionTools({ contracts: { tools: [] }, ownership: { tools: ['connector_should_not_leak'] } }),
  [],
  'an explicit empty contracts.tools list must not fall back to stale ownership metadata',
);

assert.deepEqual(
  getDeclaredExtensionTools({ ownership: { tools: [' connector_a ', 'connector_a', '', 'connector_b'] } }),
  ['connector_a', 'connector_b'],
  'tool declarations must be normalized and de-duplicated',
);

console.log('[tool-contracts.regression] modern contracts, legacy fallback, explicit empty contracts, and normalization passed');
