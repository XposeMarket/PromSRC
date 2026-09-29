import assert from 'node:assert/strict';
import { reconcileNativeConnectorRecord, reconcileNativeConnectorToolSnapshots } from './native-tool-reconcile';

const oldTools = ['connector_gmail_get_email', 'connector_gmail_list_emails', 'connector_gmail_send_email'];
const newTools = [...oldTools, 'connector_gmail_api_request'];
const base: any = {
  id: 'c1', adapterId: 'connector-oauth', pluginId: 'gmail', serviceId: 'gmail',
  registeredTools: oldTools, availableTools: oldTools,
  exposedTools: ['connector_gmail_get_email', 'connector_gmail_list_emails'], tools: [],
};

// Un-narrowed connection picks up the new tool as available.
const patch = reconcileNativeConnectorRecord(base, newTools)!;
assert.ok(patch, 'expected a patch');
assert.ok(patch.registeredTools!.includes('connector_gmail_api_request'));
assert.ok(patch.availableTools!.includes('connector_gmail_api_request'));
// api_request is method-gated (not auto read-only), so it must not be auto-exposed.
assert.ok(!patch.exposedTools!.includes('connector_gmail_api_request'));

// Narrowed allowlist is preserved (no silent grant), removed tools pruned.
const narrowed = { ...base, availableTools: ['connector_gmail_list_emails'] };
const p2 = reconcileNativeConnectorRecord(narrowed, newTools)!;
assert.deepEqual(p2.availableTools, ['connector_gmail_list_emails']);
const p3 = reconcileNativeConnectorRecord(base, ['connector_gmail_list_emails'])!;
assert.deepEqual(p3.availableTools, ['connector_gmail_list_emails']);
assert.deepEqual(p3.exposedTools, ['connector_gmail_list_emails']);

// Idempotent.
assert.equal(reconcileNativeConnectorRecord({ ...base, ...patch }, newTools), null);

// Store pass only touches connector-oauth records.
const records: any[] = [base, { ...base, id: 'c2', adapterId: 'legacy' }];
const updated: string[] = [];
const changed = reconcileNativeConnectorToolSnapshots(
  { list: () => records, update: (id: string) => { updated.push(id); } },
  () => newTools,
);
assert.deepEqual(changed, ['c1']);
assert.deepEqual(updated, ['c1']);

// Real manifest lookup resolves Gmail's current tools (incl. api_request).
const live = reconcileNativeConnectorToolSnapshots(
  { list: () => [{ ...base, id: 'c3' }], update: () => {} },
);
assert.deepEqual(live, ['c3'], 'default manifest lookup should find gmail and add api_request');

console.log('native connector tool reconcile regression passed');
