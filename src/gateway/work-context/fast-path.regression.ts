import assert from 'assert';
import type { WorkContextConfig, WorkContextPacket } from './contracts';
import { preflightWorkContextFastPath } from './fast-path';
import { capabilityPolicyTier, resolveToolCapabilityMetadata } from '../tool-capabilities';

const now = Date.now();
const config: WorkContextConfig = {
  enabled: true,
  shadowMode: false,
  maxPacketBytes: 96_000,
  maxAgeHours: 336,
  fastPaths: { coding: true, browser: true, desktop: true, creative: true, generic: false },
};

function packet(domain: WorkContextPacket['activeDomain']): WorkContextPacket {
  return {
    version: 1,
    id: 'work_test',
    sessionId: 'test',
    revision: 7,
    status: 'active',
    activeDomain: domain,
    objective: 'test objective',
    objectiveFingerprint: 'test',
    createdAt: now,
    updatedAt: now,
    freshness: 'fresh',
    completedSteps: [],
    pendingSteps: [],
    evidenceRefs: [],
    artifacts: [],
    metrics: { startedAt: now, totalToolCalls: 0, discoveryToolCalls: 0, mutationToolCalls: 0, verificationToolCalls: 0, accumulatedToolMs: 0 },
    generic: { relevantPaths: [], decisions: [], updatedAt: now },
  };
}

const coding = packet('coding');
coding.coding = { root: '.', dirtyFilesBefore: [], dirtyFilesNow: [], targets: [] };
const accepted = preflightWorkContextFastPath('test', {
  domain: 'coding',
  expected_context_revision: 7,
  steps: [{ tool: 'apply_workspace_patchset', args: { edits: [{ filename: 'a.ts', op: 'find_replace', find: '40', replace: '50', expected_hash: 'abc' }] } }],
}, { config, packet: coding });
assert.equal(accepted.ok, true, accepted.error);

const unguarded = preflightWorkContextFastPath('test', {
  domain: 'coding',
  expected_context_revision: 7,
  steps: [{ tool: 'apply_workspace_patchset', args: { edits: [{ filename: 'a.ts', op: 'find_replace', find: '40', replace: '50' }] } }],
}, { config, packet: coding });
assert.equal(unguarded.ok, false);
assert.match(String(unguarded.error), /expected_hash or expected_before/);

const staleRevision = preflightWorkContextFastPath('test', {
  domain: 'coding',
  expected_context_revision: 6,
  steps: [{ tool: 'validate_file', args: { filename: 'a.ts' } }],
}, { config, packet: coding });
assert.equal(staleRevision.ok, false);
assert.match(String(staleRevision.error), /revision mismatch/);

const browser = packet('browser');
browser.browser = { url: 'https://example.test', contentHash: 'abcdef', namedTargets: [], updatedAt: now };
const browserCommit = preflightWorkContextFastPath('test', {
  domain: 'browser',
  expected_context_revision: 7,
  expected_url: 'https://example.test',
  expected_content_hash: 'abc',
  steps: [{ tool: 'browser_open', args: { url: 'https://example.test/checkout?confirm=purchase' } }],
}, { config, packet: browser });
assert.equal(browserCommit.ok, false);
assert.match(String(browserCommit.error), /commit boundary/);

const creative = packet('creative');
creative.creative = { sceneVersion: 4, sceneHash: '123456', activeLayers: [], sourceAssets: [], updatedAt: now };
const creativeMismatch = preflightWorkContextFastPath('test', {
  domain: 'creative',
  expected_context_revision: 7,
  expected_scene_version: 3,
  steps: [{ tool: 'creative_get_state', args: {} }],
}, { config, packet: creative });
assert.equal(creativeMismatch.ok, false);
assert.match(String(creativeMismatch.error), /scene version/);

assert.equal(capabilityPolicyTier(resolveToolCapabilityMetadata('work_context_execute', undefined, {
  steps: [{ tool: 'browser_snapshot', args: {} }, { tool: 'browser_get_page_text', args: {} }],
})), 'read');
assert.equal(capabilityPolicyTier(resolveToolCapabilityMetadata('work_context_execute', undefined, {
  steps: [{ tool: 'apply_workspace_patchset', args: { edits: [] } }],
})), 'propose');

console.log('work context fast-path regression: PASS');
