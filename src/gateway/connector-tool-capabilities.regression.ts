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

const unrelatedReadish = resolveToolCapabilityMetadata('future_list_records', undefined, {});
assert.equal(unrelatedReadish.known, false, 'unregistered non-connector tools must not inherit connector read inference from their names');
assert.equal(unrelatedReadish.destructive, true);
assert.equal(unrelatedReadish.externalWrite, true);

const unrelatedStatus = resolveToolCapabilityMetadata('future_status_snapshot', undefined, {});
assert.equal(unrelatedStatus.known, false, 'unregistered status-like tools outside the connector namespace must fail closed');

const declaredReadOnlyApi = resolveToolCapabilityMetadata('connector_gdrive_api_request', undefined, {});
assert.equal(declaredReadOnlyApi.known, true, 'connector-specific API boundaries may declare safe methods explicitly');
assert.equal(declaredReadOnlyApi.readOnly, true);

const vercelEnv = resolveToolCapabilityMetadata('connector_vercel_env', undefined, { action: 'list' });
assert.equal(vercelEnv.known, true);
assert.equal(vercelEnv.externalWrite, true, 'combined Vercel env tool must fail closed as an external write');

const vercelDeleteProject = resolveToolCapabilityMetadata('connector_vercel_delete_project');
assert.equal(vercelDeleteProject.known, true);
assert.equal(vercelDeleteProject.externalWrite, true);
assert.equal(vercelDeleteProject.destructive, true);

const vercelApiRead = resolveToolCapabilityMetadata('connector_vercel_api_request', undefined, { method: 'GET' });
assert.equal(vercelApiRead.known, true);
assert.equal(vercelApiRead.readOnly, true);
assert.equal(vercelApiRead.externalWrite, false);

const vercelApiWrite = resolveToolCapabilityMetadata('connector_vercel_api_request', undefined, { method: 'PATCH' });
assert.equal(vercelApiWrite.known, true);
assert.equal(vercelApiWrite.readOnly, false);
assert.equal(vercelApiWrite.externalWrite, true);


console.log('[connector-tool-capabilities.regression] provider-neutral read/write inference, connector namespace boundaries, API method boundaries, explicit declarations, and fail-closed unknowns passed');
