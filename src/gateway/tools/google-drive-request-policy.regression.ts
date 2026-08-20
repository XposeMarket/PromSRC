import assert from 'node:assert/strict';
import { validateGoogleDriveGetRequest } from './google-drive-request-policy.js';

assert.deepEqual(validateGoogleDriveGetRequest({ path: '/drive/v3/files', query: { pageSize: 10, spaces: 'drive' } }), {
  path: '/drive/v3/files',
  query: { pageSize: '10', spaces: 'drive' },
});
assert.throws(() => validateGoogleDriveGetRequest({ path: 'https://evil.example/steal' }), /relative|scheme|host/i);
assert.throws(() => validateGoogleDriveGetRequest({ path: '//evil.example/steal' }), /relative|host/i);
assert.throws(() => validateGoogleDriveGetRequest({ path: '/drive/v3\\files' }), /backslash/i);
assert.throws(() => validateGoogleDriveGetRequest({ path: '/drive/v2/files' }), /\/drive\/v3/i);
assert.throws(() => validateGoogleDriveGetRequest({ path: '/drive/v3/files?pageSize=10' }), /query parameters/i);

assert.throws(() => validateGoogleDriveGetRequest({ path: '/drive/v3/files', query: { bad: { nested: true } } }), /query values/i);
assert.throws(() => validateGoogleDriveGetRequest({ path: '/drive/v3/files', query: Object.fromEntries(Array.from({ length: 65 }, (_, i) => [`k${i}`, 'v'])) }), /too many/i);
console.log('[google-drive-request-policy.regression] path, host, prefix, query, and bounds passed');
