import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { skillsCapabilityExecutor } from '../agents-runtime/capabilities/skills-executor';
import { recordLearningTurn, getSkillRoutingEvidence, sha } from './turn-recorder';

async function main() {
 const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-judge-dispatch-'));
 try {
  const request = 'build a sand castle';
  const rec = recordLearningTurn({ workspacePath: root, sessionId: 'owner', executionMode: 'interactive', request, finalResponse: '', toolResults: [], routing: { version: 2, mode: 'active', messageHash: sha(request), candidates: [{ id: 'deploy', reason: 'strong_trigger_match', score: 80, confidence: 'high', instructionChars: 0, estimatedTokens: 0, matchedTriggers: ['build'] }], excluded: [], discoveryRecommended: false, discoveryReason: '', autoInjectedInstructions: false, instructionsRequireSkillRead: true } })!;
  const args = { action: 'review_routing', turn_id: rec.turnId, request_hash: rec.requestHash, skill_id: 'deploy', relevance: 'irrelevant', reason: 'Sand castle is not deployment', reviewed_evidence: 'Request: build a sand castle. Deploy skill scope: software deployment.' };
  const result = await skillsCapabilityExecutor.execute({ name: 'skill_curator', args, sessionId: 'brain_judge', workspacePath: root, deps: {} as any });
  assert.equal(result.error, false, String(result.result));
  assert.equal(JSON.parse(String(result.result)).skillFilesChanged, false);
  const review = getSkillRoutingEvidence(root, { turnId: rec.turnId })[0].reviews[0];
  assert.equal(review.reviewerSource, 'agent'); assert.equal(review.reviewerId, 'brain_judge');
  assert.equal(review.relevance, 'unknown', 'missing full authoritative original/scope stays unknown');
  assert.notEqual(review.nativeReviewed, true, 'caller evidence text cannot grant native trust');
  const invalid = await skillsCapabilityExecutor.execute({ name: 'skill_curator', args: { ...args, request_hash: '0'.repeat(64) }, sessionId: 'brain_judge', workspacePath: root, deps: {} as any });
  assert.equal(invalid.error, true);
  const brain = fs.readFileSync(path.join(__dirname, '../brain/brain-runner.ts'), 'utf8');
  assert.ok(brain.includes("'memory_browse',\n          'prometheus_audit_ops',\n          'skill_curator'"), 'cleanup allowlist includes evidence read and reviewer');
  assert.ok(brain.includes('maximum 3 offers per cleanup'));
  console.log('skill review native dispatch and scheduled access: PASS');
 } finally { fs.rmSync(root, { recursive: true, force: true }); }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
