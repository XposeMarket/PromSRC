import assert from 'node:assert/strict';
import {
  inferConnectorToolCapabilities,
  resolveToolCapabilityMetadata,
} from './tool-capabilities.js';

const read = inferConnectorToolCapabilities('connector_future_list_records');
assert.equal(read?.readOnly, true);
assert.equal(read?.credentialUse, true);
assert.equal(read?.externalWrite, false);

const write = inferConnectorToolCapabilities('connector_future_update_record');
assert.equal(write?.externalWrite, true);
assert.equal(write?.readOnly, false);

const apiRead = inferConnectorToolCapabilities('connector_future_api_request', { method: 'GET' });
assert.equal(apiRead?.readOnly, true);
assert.equal(apiRead?.externalWrite, false);

const apiWrite = inferConnectorToolCapabilities('connector_future_api_request', { method: 'POST' });
assert.equal(apiWrite?.externalWrite, true);
assert.equal(apiWrite?.readOnly, false);

const ambiguous = resolveToolCapabilityMetadata('connector_future_custom_action', undefined, {});
assert.equal(ambiguous.known, false, 'ambiguous future connector tools must fail closed');
assert.equal(ambiguous.destructive, true);

const declaredReadOnlyApi = resolveToolCapabilityMetadata('connector_gdrive_api_request', undefined, {});
assert.equal(declaredReadOnlyApi.known, true, 'connector-specific API boundaries may declare safe methods explicitly');
assert.equal(declaredReadOnlyApi.readOnly, true);

console.log('[connector-tool-capabilities.regression] provider-neutral read/write inference, API method boundaries, explicit declarations, and fail-closed unknowns passed');
