import assert from 'assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-approval-stale-'));
process.env.PROMETHEUS_DATA_DIR = root;
process.env.PROMETHEUS_APP_ROOT = root;

const flow = require('./verification-flow') as typeof import('./verification-flow');
const { getApprovalQueue, resolveApprovalMaxAgeMs } = flow;

const HOUR = 60 * 60 * 1000;
const now = Date.now();
const iso = (ms: number) => new Date(ms).toISOString();

function base(sessionId: string, toolName: string) {
  return {
    sessionId,
    toolName,
    toolArgs: {},
    action: `test ${toolName}`,
    policyTier: 'commit' as const,
    riskScore: 1,
    affectedSystems: [],
  };
}

const queue = getApprovalQueue();
const oldPending = queue.create(base('stale-session', 'run_command'));
const freshPending = queue.create(base('fresh-session', 'terminal'));
const oldResolved = queue.create(base('resolved-session', 'request_final_action_approval'));
const oldUnparsable = queue.create(base('unparsable-session', 'run_command'));

// Backdate records directly (create() stamps "now").
const storePath = path.join(root, '.prometheus', 'approvals.json');
queue.resolve(oldResolved.id, true, 'user');
const raw = (oldPending as any);
raw.createdAt = iso(now - 30 * HOUR);
(oldResolved as any).createdAt = iso(now - 30 * HOUR);
(oldResolved as any).resolvedAt = iso(now - 29 * HOUR);
(oldUnparsable as any).createdAt = 'not-a-date';
(freshPending as any).createdAt = iso(now - 1 * HOUR);
// Persist the backdated state so the on-disk file reflects it.
const persisted = JSON.parse(fs.readFileSync(storePath, 'utf-8'));
for (const rec of persisted.approvals) {
  if (rec.id === oldPending.id) rec.createdAt = iso(now - 30 * HOUR);
  if (rec.id === oldResolved.id) { rec.createdAt = iso(now - 30 * HOUR); rec.resolvedAt = iso(now - 29 * HOUR); }
  if (rec.id === oldUnparsable.id) rec.createdAt = 'not-a-date';
  if (rec.id === freshPending.id) rec.createdAt = iso(now - 1 * HOUR);
}
fs.writeFileSync(storePath, JSON.stringify(persisted, null, 2), 'utf-8');

// resolveApprovalMaxAgeMs
assert.equal(resolveApprovalMaxAgeMs({}), 24 * HOUR, 'default is 24h');
assert.equal(resolveApprovalMaxAgeMs({ PROMETHEUS_APPROVAL_MAX_AGE_HOURS: '2' }), 2 * HOUR, 'env override works');
assert.equal(resolveApprovalMaxAgeMs({ PROMETHEUS_APPROVAL_MAX_AGE_HOURS: 'garbage' }), 24 * HOUR, 'garbage env falls back');
assert.equal(resolveApprovalMaxAgeMs({ PROMETHEUS_APPROVAL_MAX_AGE_HOURS: '0' }), 24 * HOUR, 'zero env falls back');
assert.equal(resolveApprovalMaxAgeMs({ PROMETHEUS_APPROVAL_MAX_AGE_HOURS: '-5' }), 24 * HOUR, 'negative env falls back');

// expireStale: only old, pending, parsable records are touched.
const count = getApprovalQueue().expireStale({ maxAgeMs: 24 * HOUR, now });
assert.equal(count, 1, 'exactly one old pending record expired');

const pendingIds = getApprovalQueue().listPending().map((r) => r.id);
assert.ok(!pendingIds.includes(oldPending.id), 'old pending no longer pending');
assert.ok(pendingIds.includes(freshPending.id), 'fresh pending survives');
assert.ok(pendingIds.includes(oldUnparsable.id), 'unparsable timestamp is skipped');

const expired = getApprovalQueue().get(oldPending.id);
assert.equal(expired?.status, 'rejected', 'expired record is rejected');
assert.equal(expired?.resolvedBy, 'policy:stale-expired', 'default resolvedBy');
assert.equal(getApprovalQueue().get(oldResolved.id)?.status, 'approved', 'already-resolved old record untouched');
assert.equal(getApprovalQueue().get(oldResolved.id)?.resolvedBy, 'user', 'already-resolved resolvedBy untouched');

// Persisted to disk.
const onDisk = JSON.parse(fs.readFileSync(storePath, 'utf-8')).approvals as Array<any>;
const diskOld = onDisk.find((r) => r.id === oldPending.id);
assert.equal(diskOld?.status, 'rejected', 'expired record persisted as rejected');
assert.equal(diskOld?.resolvedBy, 'policy:stale-expired', 'persisted resolvedBy');
assert.equal(onDisk.find((r) => r.id === freshPending.id)?.status, 'pending', 'fresh stays pending on disk');

// Second sweep is a no-op.
assert.equal(getApprovalQueue().expireStale({ maxAgeMs: 24 * HOUR, now }), 0, 'second sweep expires nothing');

console.log('approval stale expiry regression passed');
