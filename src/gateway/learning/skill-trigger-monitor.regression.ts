import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SkillsManager, rankSkillMatches } from '../skills-runtime/skills-manager';
import { skillsCapabilityExecutor } from '../agents-runtime/capabilities/skills-executor';
import { getSessionStorageDirectory } from '../session';
import { recordLearningTurn, sha, submitSkillRoutingFeedback, getSkillRoutingEvidence } from './turn-recorder';
import { sampleRoutingOffers } from '../skills-runtime/skill-curator';

async function main(legacyFullManifest = false) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'trigger-monitor-'));
  const sessionId = `monitor_${Date.now()}`;
  const sessionFile = path.join(getSessionStorageDirectory(), `${sessionId}.json`);
  try {
    const manager = new SkillsManager(path.join(root, 'skills'));
    manager.createBundle({ id: 'deploy', name: 'Software deployment', description: 'Build and deploy software applications.', instructions: '# Deployment\n\nBuild software applications and deploy them.', triggers: ['build application'], triggerPositivePrompts: ['build application software'], triggerNegativePrompts: ['build sand castle'] } as any);
    // Broad legacy metadata intentionally reproduces the false-positive problem.
    const skill = manager.get('deploy')!;
    skill.triggers = ['build application', 'build castle'];
    skill.manifest.triggers = [...skill.triggers];
    const requests = ['build application software', 'build application software release', 'build castle sand', 'build castle blocks', 'build castle stone'];
    const history: any[] = [{ role: 'assistant', content: [{ type: 'thinking', thinking: 'PRIVATE_REASONING' }, { type: 'tool_use', input: { password: 'PRIVATE_TOOL_PAYLOAD' } }, { type: 'text', text: 'Visible response api_key=sk-secretcredential1234567890' }] }, ...requests.map(content => ({ role: 'user', content }))];
    fs.writeFileSync(sessionFile, JSON.stringify({ history }));
    const records = requests.map((request, i) => recordLearningTurn({ workspacePath: root, sessionId, executionMode: 'interactive', request, finalResponse: '', toolResults: i === 0 ? [{ name: 'skill_read', args: { id: 'deploy' } }] : [], routing: { version: 2, mode: 'active', messageHash: sha(request), candidates: [{ id: 'deploy', reason: 'strong_trigger_match', score: 80, confidence: 'high', instructionChars: 0, estimatedTokens: 0, matchedTriggers: [i < 2 ? 'build application' : 'build castle'] }], excluded: [], discoveryRecommended: false, discoveryReason: '', autoInjectedInstructions: false, instructionsRequireSkillRead: true } })!);
    const samples = sampleRoutingOffers(root);
    assert.ok(samples.samples.length <= 3);
    assert.equal(samples.samples.length, 2, 'both read and unread trigger buckets eligible');
    const execute = (args: any) => skillsCapabilityExecutor.execute({ name: 'skill_curator', args, sessionId: 'brain_reviewer', workspacePath: root, deps: { skillsManager: manager } as any });
    const sampledNative = await execute({ action: 'sample_routing' });
    assert.equal(sampledNative.error, false);
    assert.ok(!String(sampledNative.result).includes('PRIVATE_REASONING'));
    assert.ok(!String(sampledNative.result).includes('PRIVATE_TOOL_PAYLOAD'));
    assert.ok(!String(sampledNative.result).includes('sk-secretcredential1234567890'));
    for (let i = 0; i < records.length; i++) {
      const r = records[i];
      const result = await execute({ action: 'review_routing', turn_id: r.turnId, request_hash: r.requestHash, skill_id: 'deploy', relevance: i < 2 ? 'relevant' : 'irrelevant', reason: i < 2 ? 'Software task in scope' : 'Physical castle is outside software scope', reviewed_evidence: 'Full authoritative request/context and deployment scope examined.' });
      assert.equal(result.error, false, String(result.result));
      assert.equal(getSkillRoutingEvidence(root, { turnId: r.turnId })[0].reviews[0].nativeReviewed, true);
    }
    assert.throws(() => submitSkillRoutingFeedback(root, { turnId: records[0].turnId, requestHash: records[0].requestHash, skillId: 'deploy', relevance: 'relevant', reason: 'spoof', nativeReviewed: true }), /Invalid feedback fields/);
    const args = { action: 'propose_routing', skill_id: 'deploy', trigger_manifest: { triggers: [], promptSignals: { allOf: [['build', 'software']] } }, positive_turn_ids: records.slice(0, 2).map(r => r.turnId), negative_turn_ids: records.slice(2).map(r => r.turnId) };
    const bad = await execute({ ...args, trigger_manifest: { triggers: [], promptSignals: { allOf: [['build', 'stone']] } } });
    assert.equal(bad.error, true, 'tightening must preserve valid positives');
    const result = await execute(args);
    assert.equal(result.error, false, String(result.result));
    const proposal = JSON.parse(String(result.result)).proposal;
    assert.equal(proposal.change.kind, 'manifest_overlay'); assert.equal(proposal.status, 'pending');
    assert.equal(proposal.triggerEvaluation.passed, true);
    assert.equal(proposal.triggerEvaluation.positive.length, 2); assert.equal(proposal.triggerEvaluation.negative.length, 3);
    assert.ok(proposal.evidence.every((e: string) => /requestHash=\w+ contextHash=\w+/.test(e)));
    assert.deepEqual(manager.get('deploy')!.triggers, ['build application', 'build castle'], 'proposal does not mutate');
    assert.ok(Object.keys(proposal.change.manifest).every(key => ['triggers', 'promptSignals'].includes(key)), 'new proposals store only trigger fields');
    assert.ok(Object.keys(proposal.previousManifest).every(key => ['triggers', 'promptSignals'].includes(key)), 'new rollback snapshots store only trigger fields');
    if (legacyFullManifest) {
      // Reproduce a persisted pre-fix proposal, including stale unrelated fields on both sides.
      const relative = (fs.readdirSync(root, { recursive: true }) as string[]).find(file => file.endsWith('suggestions.json'))!;
      const file = path.join(root, relative);
      const rows = JSON.parse(fs.readFileSync(file, 'utf8'));
      const stored = rows.find((row: any) => row.id === proposal.id);
      stored.change.manifest = { ...manager.get('deploy')!.manifest, ...stored.change.manifest, description: 'Obsolete proposal description', requiredTools: ['obsolete_tool'] };
      stored.previousManifest = { ...manager.get('deploy')!.manifest, ...stored.previousManifest, description: 'Obsolete rollback description', requiredTools: ['obsolete_rollback_tool'] };
      fs.writeFileSync(file, JSON.stringify(rows));
    }
    const originalTriggers = [...manager.get('deploy')!.triggers];
    manager.get('deploy')!.triggers = ['changed baseline'];
    const stale = await execute({ action: 'apply', id: proposal.id }); assert.equal(stale.error, true, 'stale proposals must not overwrite new metadata');
    manager.get('deploy')!.triggers = originalTriggers;
    const editMetadata = (description: string, requiredTools: string[]) => manager.writeManifestOverlay('deploy', { ...manager.get('deploy')!.manifest, description, requiredTools });
    const assertMetadata = (description: string, requiredTools: string[]) => {
      assert.equal(manager.get('deploy')!.description, description);
      assert.deepEqual(manager.get('deploy')!.requiredTools, requiredTools);
      assert.equal(manager.get('deploy')!.manifest.description, description);
      assert.deepEqual(manager.get('deploy')!.manifest.requiredTools, requiredTools);
    };
    editMetadata('Current deployment description before apply', ['current_apply_tool']);
    const applied = await execute({ action: 'apply', id: proposal.id });
    assert.equal(applied.error, false, String(applied.result));
    assertMetadata('Current deployment description before apply', ['current_apply_tool']);
    for (const request of requests.slice(0, 2)) assert.equal(rankSkillMatches(manager.getAll(), request, { limit: 1 })[0]?.id, 'deploy');
    for (const request of requests.slice(2)) assert.equal(rankSkillMatches(manager.getAll(), request, { limit: 100 }).some(s => s.id === 'deploy'), false);
    editMetadata('Newer deployment description before rollback', ['current_rollback_tool']);
    const appliedSignals = manager.get('deploy')!.promptSignals;
    manager.get('deploy')!.promptSignals = undefined;
    const staleRollback = await execute({ action: 'rollback', id: proposal.id, rollback_negative_prompts: ['Write a grocery list'] });
    assert.equal(staleRollback.error, true, 'rollback must still refuse stale trigger fields');
    assertMetadata('Newer deployment description before rollback', ['current_rollback_tool']);
    manager.get('deploy')!.promptSignals = appliedSignals;
    const rolledBack = await execute({ action: 'rollback', id: proposal.id, rollback_negative_prompts: ['Write a grocery list'] });
    assert.equal(rolledBack.error, false, String(rolledBack.result));
    assert.deepEqual(manager.get('deploy')!.triggers, ['build application', 'build castle']);
    assert.equal(manager.get('deploy')!.promptSignals, undefined, 'rollback clears newly introduced prompt signals');
    assertMetadata('Newer deployment description before rollback', ['current_rollback_tool']);
    const rejected = await execute({ action: 'reject', id: proposal.id }); assert.equal(rejected.error, false);
    console.log('skill-trigger-monitor regression: ok');
  } finally { fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(sessionFile, { force: true }); }
}
main().then(() => main(true)).catch(error => { console.error(error); process.exitCode = 1; });
