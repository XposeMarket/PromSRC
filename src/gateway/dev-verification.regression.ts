import assert from 'node:assert/strict';
import { canReuseFreshBackendVerification } from './dev-verification';

const now = Date.now();
const freshBackendBuild = {
  profileIds: ['backend_build'],
  changedFiles: ['src/gateway/example.ts'],
  success: true,
  completedAt: now - 1_000,
};

assert.equal(canReuseFreshBackendVerification({
  verification: freshBackendBuild,
  backendFiles: ['src/gateway/example.ts'],
  now,
}), true, 'a fresh backend build for the exact source file can be reused by a dev restart');

assert.equal(canReuseFreshBackendVerification({
  verification: freshBackendBuild,
  backendFiles: ['src/gateway/example.ts', 'src/gateway/other.ts'],
  now,
}), false, 'a partial verification must not be reused');

assert.equal(canReuseFreshBackendVerification({
  verification: { ...freshBackendBuild, completedAt: now - 11 * 60_000 },
  backendFiles: ['src/gateway/example.ts'],
  now,
}), false, 'a stale verification must not be reused');

assert.equal(canReuseFreshBackendVerification({
  verification: { ...freshBackendBuild, profileIds: ['webui_sync_check'] },
  backendFiles: ['src/gateway/example.ts'],
  now,
}), false, 'a non-backend verification must not be reused');

console.log('fresh verified backend restart regression passed');
