import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync('electron/main.js', 'utf8');

const legacyDirect = source.match(/path\.join\(USER_DATA_DIR, ['"]\.prometheus['"]\)/g) || [];
assert.equal(
  legacyDirect.length,
  1,
  `electron/main.js should have exactly one explicit legacy .prometheus root, found ${legacyDirect.length}`,
);
assert.ok(source.includes("const LEGACY_RUNTIME_STATE_DIR = path.join(USER_DATA_DIR, '.prometheus');"));
assert.ok(source.includes("const STORAGE_LAYOUT_V2_RUNTIME_DIR = path.join(USER_DATA_DIR, 'runtime');"));
assert.ok(source.includes("const STORAGE_LAYOUT_V2_READY_FILE = path.join(STORAGE_LAYOUT_V2_RUNTIME_DIR, 'migrations', 'storage-layout-v2-ready.json');"));
assert.ok(source.includes('runStorageLayoutV2Migration();'));
assert.ok(source.includes('refreshStorageLayoutState();'));
assert.ok(source.includes("PROMETHEUS_STORAGE_LAYOUT:  'canonical'"));
assert.ok(source.includes('PROMETHEUS_RUNTIME_DIR:     RUNTIME_STATE_DIR'));
assert.ok(source.includes("const vaultDir = path.join(RUNTIME_STATE_DIR, 'vault');"));
assert.ok(source.includes("const statusPath = path.join(RUNTIME_STATE_DIR, 'gateway-runtime-status.json');"));
assert.ok(source.includes('return readSharedGatewayProgressLease(RUNTIME_STATE_DIR);'));
assert.equal(source.includes("path.join(CANONICAL_UPDATE_CONFIG_DIR, 'config.json')"), false);
assert.equal(source.includes("path.join(USER_DATA_DIR, '.prometheus', 'vault')"), false);
assert.equal(source.includes("path.join(USER_DATA_DIR, '.prometheus', 'gateway-runtime-status.json')"), false);

const migrationIndex = source.indexOf('runStorageLayoutV2Migration();');
const gatewayEnvIndex = source.indexOf('const gatewayEnv = {');
assert.ok(migrationIndex >= 0 && gatewayEnvIndex > migrationIndex, 'verified migration must run before canonical gateway environment is constructed');

console.log('electron storage layout contract passed');
