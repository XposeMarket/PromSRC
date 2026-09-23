import assert from 'node:assert/strict';
import { isDefinitiveXaiRefreshRejection } from './xai-oauth';

// A failed refresh used to wipe the saved xAI login on ANY 400/401, so one
// transient failure forced a manual reconnect. Only a definitive OAuth
// rejection may clear it.
assert.equal(isDefinitiveXaiRefreshRejection('{"error":"invalid_grant","error_description":"expired"}'), true);
assert.equal(isDefinitiveXaiRefreshRejection('{"error":"invalid_client"}'), true);
assert.equal(isDefinitiveXaiRefreshRejection('The refresh token has expired'), true);
assert.equal(isDefinitiveXaiRefreshRejection(''), false, 'empty body must not clear tokens');
assert.equal(isDefinitiveXaiRefreshRejection('{"error":"invalid_request"}'), false);
assert.equal(isDefinitiveXaiRefreshRejection('<html>Bad Gateway</html>'), false);
assert.equal(isDefinitiveXaiRefreshRejection('{"error":"temporarily_unavailable"}'), false);
console.log('xai-refresh-rejection regression: ok');
