import assert from 'node:assert/strict';
import { validateXApiRequest } from './x-api-request-policy.js';

assert.deepEqual(validateXApiRequest({ method: 'GET', path: '/tweets/search/recent' }), {
  method: 'GET',
  path: '/tweets/search/recent',
});
assert.throws(() => validateXApiRequest({ method: 'POST', path: '/tweets', body: { text: 'hello' } }), /operation_intent/);
assert.deepEqual(validateXApiRequest({ method: 'PATCH', path: '/users/1', operationIntent: 'Update profile' }).method, 'PATCH');
assert.throws(() => validateXApiRequest({ method: 'GET', path: 'https://evil.example/steal' }), /relative|scheme|host/i);
assert.throws(() => validateXApiRequest({ method: 'GET', path: '//evil.example/steal' }), /relative|host/i);
assert.throws(() => validateXApiRequest({ method: 'GET', path: '/tweets', body: { x: 1 } }), /body/);
console.log('[x-api-request-policy.regression] path, method, mutation-intent, and body boundaries passed');
