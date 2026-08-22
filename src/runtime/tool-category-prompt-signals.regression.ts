import assert from 'node:assert/strict';
import { detectKeywordToolCategories } from './tool-category-keyword-router.js';

const MIGRATED_CATEGORIES = new Set([
  'automation_scheduling', 'automation_tasks', 'automation_recovery', 'automation_sessions',
  'runtime_admin', 'integration_admin', 'mcp_server_tools', 'agents_and_teams',
  'proposal_admin', 'composite_tools', 'model_management',
]);

function operational(message: string): string[] {
  return [...detectKeywordToolCategories(message)]
    .filter((category) => MIGRATED_CATEGORIES.has(category))
    .sort();
}

const exactCases: Array<{ message: string; expected: string[] }> = [
  { message: 'Schedule the report to run every weekday at 8am.', expected: ['automation_scheduling'] },
  { message: 'Start the report at 5:30 PM.', expected: ['automation_scheduling'] },
  { message: 'Remind me tomorrow to send the report.', expected: ['automation_scheduling'] },
  { message: 'Schedule a reminder for the renewal.', expected: ['automation_scheduling'] },
  { message: 'What tasks are currently running? Show their outputs.', expected: ['automation_tasks'] },
  { message: 'Run this background task now and watch its status.', expected: ['automation_tasks'] },
  { message: 'My request got cut off. Recover the existing run without duplicating it.', expected: ['automation_recovery'] },
  { message: 'Recover the failed approval and resume the original request.', expected: ['automation_recovery'] },
  { message: 'Retry the failed run without starting duplicate work.', expected: ['automation_recovery'] },
  { message: 'Resume the interrupted run from where it stopped.', expected: ['automation_recovery'] },
  { message: 'Create a new Prometheus chat thread and send it this objective.', expected: ['automation_sessions'] },
  { message: 'Send this summary to the other chat.', expected: ['automation_sessions'] },
  { message: 'Find our discussion about the iMessage plugin.', expected: ['automation_sessions'] },
  { message: 'Use Prometheus Thread Ops to list active sessions.', expected: ['automation_sessions'] },
  { message: 'Run system diagnostics and build a diagnostic packet.', expected: ['runtime_admin'] },
  { message: 'Restart the gateway after checking its health.', expected: ['runtime_admin'] },
  { message: 'Connect Gmail with OAuth and verify the integration.', expected: ['integration_admin'] },
  { message: 'Configure the webhook endpoint for this service.', expected: ['integration_admin'] },
  { message: 'Call the connected mcp__github__search tool.', expected: ['mcp_server_tools'] },
  { message: 'Ask an agent to investigate the failing test in parallel.', expected: ['agents_and_teams'] },
  { message: 'Ask the team coordinator to create a research team.', expected: ['agents_and_teams'] },
  { message: 'Write a pending proposal for this change.', expected: ['proposal_admin'] },
  { message: 'Approve proposal 123 and start its executor.', expected: ['proposal_admin'] },
  { message: 'Submit the proposal after the review passes.', expected: ['proposal_admin'] },
  { message: 'Create a saved multi-step composite tool for this workflow.', expected: ['composite_tools'] },
  { message: 'Set the agent model and save a reusable model template.', expected: ['model_management'] },
];

for (const item of exactCases) {
  assert.deepEqual(
    operational(item.message),
    [...item.expected].sort(),
    `unexpected migrated category set for: ${item.message}`,
  );
}

const negativeCases = [
  'Tell me a joke about automation.',
  'What is a schedule in general?',
  'What is a task in general?',
  'Explain what crash recovery means.',
  'What is a browser session?',
  'What is a gateway?',
  'Explain what an MCP server is.',
  'What is an agent?',
  'Draft a sales proposal for ACME.',
  'What is a model template?',
];

for (const message of negativeCases) {
  assert.deepEqual(operational(message), [], `conceptual/noise prompt activated a migrated category: ${message}`);
}

for (const message of exactCases.slice(0, 14).map((item) => item.message)) {
  assert.equal(
    detectKeywordToolCategories(message).has('automations'),
    false,
    `automatic routing must never activate the broad automations umbrella: ${message}`,
  );
}

console.log('[tool-category-prompt-signals.regression] declarative native activation, preserved operational phrasings, exact migrated packs, and negative routing passed');
