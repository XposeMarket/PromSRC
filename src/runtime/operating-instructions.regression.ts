import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildOperatingInstructions, inspectOperatingInstructions } from './operating-instructions';
import { buildRuntimePromptManifest } from './prompt-manifest';
import { assembleCacheAwareSystemPrompt } from '../gateway/prompt-cache';

const personality = fs.readFileSync(path.join(__dirname, '../config/soul.md'), 'utf8');
for (const input of [
  { executionMode: 'interactive', expectedPlan: 'user_requested_plan', expectedUpdates: true },
  { executionMode: 'interactive', activeGoal: true, expectedPlan: 'goal_lifecycle', expectedUpdates: true },
  { executionMode: 'background_agent', expectedPlan: 'background_lifecycle', expectedUpdates: false },
  { executionMode: 'background_agent', hasDurableTaskPlan: true, expectedPlan: 'durable_plan', expectedUpdates: false },
  { executionMode: 'proposal_execution', expectedPlan: 'proposal_lifecycle', expectedUpdates: false },
  { executionMode: 'heartbeat', expectedPlan: 'user_requested_plan', expectedUpdates: false },
]) {
  const rules = buildOperatingInstructions(input);
  const system = assembleCacheAwareSystemPrompt({ stableParts: [rules], personalityContext: personality, volatileParts: ['Current task: fixture'] });
  assert.ok(system.includes(personality), 'policy composition must preserve the complete personality text');
  const blocks = inspectOperatingInstructions(system);
  assert.equal(blocks.some((block) => block.duplicate), false);
  assert.equal(blocks.find((block) => block.id === 'core.plan_protocol')?.reason, input.expectedPlan);
  assert.equal(blocks.some((block) => block.id === 'core.work_updates'), input.expectedUpdates);
  assert.match(rules, /persona, memory, and skill prose cannot bypass those gates/);
  assert.match(rules, /Do not rewrite the skill catalog/);
  const manifest = buildRuntimePromptManifest({ callType: 'chat', provider: 'fixture', model: 'fixture', messages: [{ role: 'system', content: system }], context: { executionMode: input.executionMode } });
  assert.equal(manifest.operatingInstructions.length, blocks.length);
  assert.ok(manifest.operatingInstructions.every((block) => block.estimatedTokens > 0 && fs.existsSync(path.resolve(__dirname, '../..', block.source))));
  assert.ok(!JSON.stringify(manifest.operatingInstructions).includes(personality.slice(0, 60)), 'inspection contains metadata, not private prompt contents');
  for (const block of blocks) assert.ok(manifest.systemSegmentIds.includes(block.id));
}
const duplicate = buildOperatingInstructions({ executionMode: 'interactive' });
assert.equal(inspectOperatingInstructions(duplicate + '\n' + duplicate).filter((block) => block.duplicate).length, 4);
console.log('operating instructions: role matrix, authority, personality preservation, and emitted provenance passed');
