import assert from 'node:assert/strict';
import path from 'node:path';
import { resolveGatewayDataDir } from './gateway-instance-mode';

const installRoot = path.join('C:', 'workspace', 'PromSRC');

assert.equal(
  resolveGatewayDataDir({ installRoot, primaryInstance: true }),
  path.resolve(installRoot),
  'primary mode must use the install workspace',
);
assert.equal(
  resolveGatewayDataDir({ installRoot, primaryInstance: true, requestedDataDir: path.join('D:', 'Prometheus') }),
  path.resolve('D:', 'Prometheus'),
  'an explicit data directory must win in primary mode',
);
assert.equal(
  resolveGatewayDataDir({ installRoot, canonicalDevInstance: true, selectedPort: 18791 }),
  path.join(path.resolve(installRoot), '.prometheus-instances', 'port-18791'),
  'canonical instances remain isolated',
);
assert.equal(
  resolveGatewayDataDir({ installRoot, selectedPort: 8898, preferredPort: 8898 }),
  undefined,
  'the normal configured instance must keep the primary data root',
);
assert.equal(
  resolveGatewayDataDir({ installRoot, autoInstance: true, selectedPort: 8899, preferredPort: 8898 }),
  path.join(path.resolve(installRoot), '.prometheus-instances', 'port-8899'),
  'auto-selected fallback ports remain isolated',
);

console.log('gateway-instance-mode regression passed');
