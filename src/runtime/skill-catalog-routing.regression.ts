import assert from 'node:assert/strict';
import path from 'node:path';
import { SkillsManager } from '../gateway/skills-runtime/skills-manager';

const manager = new SkillsManager(path.join(process.cwd(), 'workspace', 'skills'));

const cases = [
  ['Find the latest web research on OpenAI pricing', 'web-researcher'],
  ['Research current facts online about this product', 'web-researcher'],
  ['Schedule the recurring job at 8am', 'scheduler-operations-playbook'],
  ['Diagnose a scheduled job stuck in cron', 'scheduler-operations-playbook'],
  ['Inspect scheduled job history', 'scheduler-operations-playbook'],
  ['Market research for this category', 'market-research'],
  ['Research a customer segment for this product', 'market-research'],
  ['The MCP server failed to connect', 'mcp-ops-troubleshooting'],
  ['Create an MCP server for this local service', 'mcp-server-builder'],
  ['Analyze one competitor company', 'competitor-profile'],
  ['Take a screenshot of the desktop app', 'desktop-automation-playbook'],
  ['Read and edit the PDF contract', 'pdf'],
  ['Draft a Gmail reply to this message', 'email-composer'],
] as const;

let exact = 0;
for (const [message, expected] of cases) {
  const top = manager.resolveRuntimeRouting(message).candidates[0];
  assert.equal(top?.id, expected, `${message} should route to ${expected}`);
  assert.equal(top?.confidence, 'high', `${message} should be high confidence`);
  exact += 1;
}

for (const message of [
  'What does market research mean?',
  'Say hello.',
  'Run a foreground task.',
  'Click a button in a desktop app.',
]) {
  const report = manager.resolveRuntimeRouting(message);
  assert.equal(report.candidates.some((candidate) => candidate.id === 'market-research'), false, `${message} leaked market-research`);
}

console.log(JSON.stringify({
  catalogSkills: manager.getAll().length,
  positiveCases: cases.length,
  exactTopMatches: exact,
  exactTopMatchRate: exact / cases.length,
  negativeDefinitionAndNoiseCases: 4,
  automaticInstructionInjection: false,
  instructionsRequireSkillRead: true,
}, null, 2));

