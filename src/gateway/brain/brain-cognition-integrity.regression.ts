import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { inspectBrainCarryForwardArtifact, inspectBrainThoughtCapsuleArtifact } from './brain-artifact-integrity.js';
import { resolveThoughtCoverageCursor } from './brain-state.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prometheus-brain-integrity-'));
try {
  const now = Date.now();
  assert.equal(resolveThoughtCoverageCursor({ lastThoughtWindowEndAt: '2026-08-15T12:00:00.000Z', lastThoughtAt: '2026-08-15T12:08:00.000Z' })?.toISOString(), '2026-08-15T12:00:00.000Z');
  assert.equal(resolveThoughtCoverageCursor({ lastThoughtWindowEndAt: null, lastThoughtAt: '2026-08-15T12:08:00.000Z' })?.toISOString(), '2026-08-15T12:08:00.000Z');

  const capsules = path.join(root, 'capsules.json');
  assert.equal(inspectBrainThoughtCapsuleArtifact(capsules, now).status, 'missing');
  fs.writeFileSync(capsules, '{bad json', 'utf8');
  assert.equal(inspectBrainThoughtCapsuleArtifact(capsules, now).status, 'invalid');
  fs.writeFileSync(capsules, JSON.stringify([{ id: 'broken' }]), 'utf8');
  assert.equal(inspectBrainThoughtCapsuleArtifact(capsules, now).status, 'invalid');
  const validCapsule = { id: 'capsule-v1', threadKey: 'project:prometheus', kind: 'active_work', priority: 'high', status: 'in_progress', createdAt: new Date(now).toISOString(), expiresAt: new Date(now + 21600000).toISOString(), summary: 'Prometheus audit remains active.', facts: ['A fact.'], nextUsefulAction: 'Continue the audit.', relevance: { projects: ['Prometheus'], triggers: ['audit'], surfaces: ['main_chat'] }, evidence: ['fixture'], lastValidatedAt: new Date(now).toISOString(), verificationRequired: true, supersedes: [] };
  fs.writeFileSync(capsules, JSON.stringify([validCapsule]), 'utf8');
  assert.equal(inspectBrainThoughtCapsuleArtifact(capsules, now).status, 'valid');
  fs.utimesSync(capsules, new Date(now - 60000), new Date(now - 60000));
  assert.equal(inspectBrainThoughtCapsuleArtifact(capsules, now).status, 'stale');

  const carry = path.join(root, 'carry.json');
  assert.equal(inspectBrainCarryForwardArtifact(carry, now, '2026-08-16').status, 'missing');
  fs.writeFileSync(carry, '{bad json', 'utf8');
  assert.equal(inspectBrainCarryForwardArtifact(carry, now, '2026-08-16').status, 'invalid');
  const goodItem = { threadKey: 'project:prometheus', title: 'Audit', state: 'in_progress', verifiedFacts: ['fact'], looseEnds: ['test'], nextNaturalOpening: 'Continue', reviewBy: new Date(now + 86400000).toISOString(), evidence: ['fixture'], lastValidatedAt: new Date(now).toISOString(), verificationRequired: true };
  const decision = { targetDate: '2026-08-16', generatedAt: new Date(now).toISOString(), sourceDream: 'Brain/dreams/2026-08-15/23-30-dream.md', items: [goodItem] };
  fs.writeFileSync(carry, JSON.stringify(decision), 'utf8');
  assert.equal(inspectBrainCarryForwardArtifact(carry, now, '2026-08-17').status, 'invalid');
  assert.equal(inspectBrainCarryForwardArtifact(carry, now, '2026-08-16').status, 'valid');
  fs.writeFileSync(carry, JSON.stringify({ ...decision, items: [goodItem, { title: 'broken' }] }), 'utf8');
  assert.equal(inspectBrainCarryForwardArtifact(carry, now, '2026-08-16').status, 'invalid', 'partially malformed carry packets must not silently drop a thread');

  const runnerSource = fs.readFileSync(path.join(process.cwd(), 'src/gateway/brain/brain-runner.ts'), 'utf8');
  assert.match(runnerSource, /capsuleArtifact\.status === 'missing'/);
  assert.match(runnerSource, /carryArtifact\.status === 'missing'/);
  assert.match(runnerSource, /lastThoughtWindowEndAt = windowEnd\.toISOString\(\)/);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
console.log('brain cognition integrity regression: ok');
