import assert from 'node:assert/strict';
import { detectKeywordToolCategories } from './tool-category-keyword-router';
import { detectLegacyToolCategories, buildToolsContext, TOOL_BLOCKS, CATEGORY_POLICIES } from '../gateway/prompt-context';
import { buildTools } from '../gateway/tool-builder';
import { estimateTextTokens, estimateToolSchemaTokens } from '../providers/model-usage';
import { getCisSystemTools } from '../gateway/tools/defs/cis-system';

type Case = {
  id: string;
  message: string;
  expected?: string[];
  negative?: boolean;
};

const CASES: Case[] = [
  { id: 'negative-joke-automation', message: 'Tell me a joke about automation.', negative: true },
  { id: 'negative-definition-schedule', message: 'What is a schedule in general?', negative: true },
  { id: 'negative-beautiful-website', message: 'The website looks beautiful today.', negative: true },
  { id: 'negative-window-of-time', message: 'I have a window of time tomorrow.', negative: true },
  { id: 'negative-video-plan', message: 'I want to make a video plan, not create anything yet.', negative: true },
  { id: 'negative-browser-definition', message: 'What does browser automation mean?', negative: true },
  { id: 'negative-desktop-definition', message: 'Tell me about a desktop app.', negative: true },
  { id: 'negative-skill-definition', message: 'What is a skill trigger?', negative: true },
  { id: 'negative-github-concept', message: 'What is GitHub used for?', negative: true },
  { id: 'negative-pr-concept', message: 'Explain what a pull request is.', negative: true },
  { id: 'negative-inbox-feeling', message: 'My inbox is overwhelming today.', negative: true },
  { id: 'negative-conversation-history', message: 'I had another conversation yesterday.', negative: true },

  { id: 'workspace-readme', message: 'Read the README and tell me what this project does.', expected: ['workspace_write'] },
  { id: 'workspace-npm-test', message: 'Run npm test and report the failures.', expected: ['workspace_write'] },
  { id: 'workspace-git-status', message: 'Check git status and show the changed files.', expected: ['workspace_write'] },
  { id: 'prom-source-read', message: 'Inspect src/gateway/routes/chat.router.ts and explain the admission flow.', expected: ['workspace_write', 'prometheus_source_read'] },
  { id: 'prom-source-write', message: 'Fix src/runtime/tool-category-manifest.ts after you identify the bug.', expected: ['workspace_write', 'prometheus_source_read', 'prometheus_source_write'] },
  { id: 'browser-click', message: 'Open the browser, navigate to the dashboard, and click the export button.', expected: ['browser_automation'] },
  { id: 'browser-url', message: 'Open https://example.com and inspect the page.', expected: ['browser_automation'] },
  { id: 'browser-download', message: 'Download the file from the browser page after I point you to it.', expected: ['browser_automation'] },
  { id: 'desktop-screenshot', message: 'Take a screenshot of the desktop app and focus its window.', expected: ['desktop_automation'] },
  { id: 'desktop-clipboard', message: 'Copy the selected text from the native app clipboard.', expected: ['desktop_automation'] },
  { id: 'media-download', message: 'Download the raw image URL into the workspace.', expected: ['media_assets'] },
  { id: 'media-analyze', message: 'Analyze this uploaded video for scene changes.', expected: ['media_assets'] },
  { id: 'media-generate-image', message: 'Generate a cinematic logo image with a transparent background.', expected: ['media_generation'] },
  { id: 'media-generate-video', message: 'Make a short AI video from this reference image.', expected: ['media_generation'] },
  { id: 'creative-video', message: 'Create an editable video timeline with shots, captions, and a voiceover.', expected: ['creative_video'] },
  { id: 'creative-image', message: 'Edit the image layers and remove the background from the product photo.', expected: ['creative_image'] },
  { id: 'creative-basic', message: 'Open the Creative project and inspect the current scene state.', expected: ['creative_basic'] },
  { id: 'creative-hyperframes', message: 'Use HyperFrames to build the HTML motion clip.', expected: ['creative_hyperframes'] },
  { id: 'creative-quality', message: 'Check the render for text overflow, contrast, and caption timing.', expected: ['creative_quality'] },
  { id: 'schedule-recurring', message: 'Schedule the report to run every weekday at 8am.', expected: ['automation_scheduling'] },
  { id: 'schedule-clock', message: 'Start the report at 5:30 PM.', expected: ['automation_scheduling'] },
  { id: 'task-status', message: 'What tasks are currently running? Show their outputs.', expected: ['automation_tasks'] },
  { id: 'task-run-now', message: 'Run this background task now and watch its status.', expected: ['automation_tasks'] },
  { id: 'recovery-cutoff', message: 'My request got cut off. Recover the existing run without duplicating it.', expected: ['automation_recovery'] },
  { id: 'recovery-failed', message: 'Recover the failed approval and resume the original request.', expected: ['automation_recovery'] },
  { id: 'session-thread', message: 'Create a new Prometheus chat thread and send it this objective.', expected: ['automation_sessions'] },
  { id: 'session-steer', message: 'Steer the existing Prometheus session with the new constraint.', expected: ['automation_sessions'] },
  { id: 'session-other-chat', message: 'Send this summary to the other chat.', expected: ['automation_sessions'] },
  { id: 'session-previous-conversation', message: 'Continue the previous conversation with this constraint.', expected: ['automation_sessions'] },
  { id: 'session-discussion-about', message: 'Find our discussion about the iMessage plugin.', expected: ['automation_sessions'] },
  { id: 'session-natural-thread-ops', message: 'Talk with me about the other chat and where we left off.', expected: ['automation_sessions'] },
  { id: 'session-natural-thread-topic', message: 'I want to look into the thread history.', expected: ['automation_sessions'] },
  { id: 'session-explicit-thread-ops', message: 'Use Prometheus Thread Ops to list active sessions.', expected: ['automation_sessions'] },
  // Provider-specific names are resolved by the connected-only extension
  // planner; the pure keyword router must not expose a provider by name.
  { id: 'external-my-github-without-planner', message: 'Check my GitHub notifications.', negative: true },
  { id: 'external-the-pr', message: 'Review the PR and summarize the open comments.', expected: ['external_apps'] },
  { id: 'external-my-inbox', message: 'Read my inbox and flag urgent messages.', expected: ['external_apps'] },
  { id: 'external-apple-messages-without-planner', message: 'Read Apple Messages for the latest reply.', negative: true },
  { id: 'external-connector-alias', message: 'Use the connector to check the account.', expected: ['external_apps'] },

  { id: 'runtime-diagnostics', message: 'Run system diagnostics and build a diagnostic packet.', expected: ['runtime_admin'] },
  { id: 'runtime-restart', message: 'Restart the gateway after checking its health.', expected: ['runtime_admin'] },
  { id: 'integration-oauth', message: 'Connect Gmail with OAuth and verify the integration.', expected: ['integration_admin'] },
  { id: 'integration-webhook', message: 'Configure the webhook endpoint for this service.', expected: ['integration_admin'] },
  { id: 'external-gmail-without-planner', message: 'Search my connected Gmail for the latest invoice.', negative: true },
  { id: 'external-connectors', message: 'List my connected apps and their status.', expected: ['external_apps'] },
  { id: 'mcp-call', message: 'Call the connected mcp__github__search tool.', expected: ['mcp_server_tools'] },
  { id: 'agent-delegate', message: 'Ask an agent to investigate the failing test in parallel.', expected: ['agents_and_teams'] },
  { id: 'team-coordinate', message: 'Ask the team coordinator to create a research team.', expected: ['agents_and_teams'] },
  { id: 'proposal-write', message: 'Write a pending proposal for this workspace change.', expected: ['proposal_admin'] },
  { id: 'composite-create', message: 'Create a saved multi-step composite tool for this workflow.', expected: ['composite_tools'] },
  { id: 'skill-audit', message: 'Audit the skill triggers and repair the skill metadata.', expected: ['skills'] },
  { id: 'model-template', message: 'Set the agent model and save a reusable model template.', expected: ['model_management'] },
  { id: 'business-entity', message: 'Update the client record and append an entity event.', expected: ['business'] },
  { id: 'social-profile', message: 'Analyze the social profile engagement and recommend content.', expected: ['social_intelligence'] },
  { id: 'web-research', message: 'Research the latest competitors and summarize the strongest sources.', negative: true },
  { id: 'general-chat', message: 'Give me three ideas for a birthday dinner.', negative: true },
  { id: 'general-code-explanation', message: 'How does a JavaScript promise work?', negative: true },
];

const LEGACY_ALIAS: Record<string, string> = {
  browser: 'browser_automation', desktop: 'desktop_automation', files: 'workspace_write', shell: 'workspace_write',
  commands: 'workspace_write', source_read: 'prometheus_source_read', source_write: 'prometheus_source_write',
  memory: 'advanced_memory', media: 'media_assets', media_generation: 'media_generation',
  schedule: 'automations', task: 'automation_tasks', automations: 'automations',
  integrations: 'integration_admin', external_apps: 'external_apps', agents: 'agents_and_teams',
  agents_and_teams: 'agents_and_teams', teams: 'agents_and_teams',
};

function canonicalize(values: Set<string>): Set<string> {
  return new Set(Array.from(values, (value) => LEGACY_ALIAS[value] || value));
}

function operational(values: Set<string>): string[] {
  return Array.from(canonicalize(values)).filter((value) => !['web', 'debug', 'routing'].includes(value)).sort();
}

function measureRouter(fn: (message: string) => Set<string>): { totalMs: number; perCaseMs: number } {
  const rounds = 200;
  const started = performance.now();
  for (let round = 0; round < rounds; round += 1) {
    for (const item of CASES) fn(item.message);
  }
  const totalMs = performance.now() - started;
  return { totalMs, perCaseMs: totalMs / (rounds * CASES.length) };
}

function schemaSnapshot(categories?: Set<string>): { tools: number; chars: number; tokens: number } {
  const tools = buildTools({ getMCPManager: () => ({ getAllTools: () => [] }), skipDynamicExtensionTools: true }, categories);
  const json = JSON.stringify(tools);
  return { tools: tools.length, chars: json.length, tokens: estimateToolSchemaTokens(tools) };
}

function promptSnapshot(categories: Set<string>): { chars: number; tokens: number } {
  const text = buildToolsContext(categories);
  return { chars: text.length, tokens: estimateTextTokens(text) };
}

const failures: Array<{ id: string; expected: string[]; actual: string[] }> = [];
let positiveRequired = 0;
let positiveExact = 0;
let negativeClean = 0;
for (const item of CASES) {
  const actual = operational(detectKeywordToolCategories(item.message));
  if (item.negative) {
    if (actual.length === 0) negativeClean += 1;
    else failures.push({ id: item.id, expected: [], actual });
    continue;
  }
  const expected = [...(item.expected || [])].sort();
  const required = expected.every((value) => actual.includes(value));
  if (required) positiveRequired += 1;
  if (required && JSON.stringify(actual) === JSON.stringify(expected)) positiveExact += 1;
  if (!required) failures.push({ id: item.id, expected, actual });
}

const positiveCases = CASES.filter((item) => !item.negative).length;
const negativeCases = CASES.filter((item) => item.negative).length;
const beforeRequired = CASES.filter((item) => !item.negative).filter((item) => {
  const actual = operational(detectLegacyToolCategories(item.message));
  return (item.expected || []).every((value) => actual.includes(value) || value.startsWith('automation_') && actual.includes('automations'));
}).length;
const beforeNegativeClean = CASES.filter((item) => item.negative).filter((item) => operational(detectLegacyToolCategories(item.message)).length === 0).length;

const schemaCases: Record<string, Set<string> | undefined> = {
  core: new Set(),
  workspace_write: new Set(['workspace_write']),
  browser_automation: new Set(['browser_automation']),
  desktop_automation: new Set(['desktop_automation']),
  automations_legacy_all: new Set(['automations']),
  automation_scheduling: new Set(['automation_scheduling']),
  automation_tasks: new Set(['automation_tasks']),
  automation_recovery: new Set(['automation_recovery']),
  automation_sessions: new Set(['automation_sessions']),
};
const schemas = Object.fromEntries(Object.entries(schemaCases).map(([name, categories]) => [name, schemaSnapshot(categories)]));
const prompts = Object.fromEntries(Object.entries(schemaCases).map(([name, categories]) => [name, promptSnapshot(categories || new Set())]));
const requestTool = getCisSystemTools().find((tool) => tool?.function?.name === 'request_tool_category');
const requestDescription = String(requestTool?.function?.description || '');

const report = {
  cases: CASES.length,
  positiveCases,
  negativeCases,
  before: {
    requiredPositiveHits: beforeRequired,
    positiveRequiredRate: beforeRequired / positiveCases,
    negativeClean: beforeNegativeClean,
    negativeCleanRate: beforeNegativeClean / negativeCases,
    routerLatency: measureRouter(detectLegacyToolCategories),
  },
  after: {
    requiredPositiveHits: positiveRequired,
    positiveRequiredRate: positiveRequired / positiveCases,
    exactPositiveHits: positiveExact,
    exactPositiveRate: positiveExact / positiveCases,
    negativeClean,
    negativeCleanRate: negativeClean / negativeCases,
    routerLatency: measureRouter(detectKeywordToolCategories),
  },
  schemas,
  prompts,
  requestToolCategoryDescription: {
    chars: requestDescription.length,
    estimatedTokens: estimateTextTokens(requestDescription),
  },
  policyBlocks: Object.fromEntries([
    'automations', 'automation_scheduling', 'automation_tasks', 'automation_recovery', 'automation_sessions',
  ].map((id) => [id, {
    toolBlockChars: String(TOOL_BLOCKS[id] || '').length,
    policyChars: String(CATEGORY_POLICIES[id] || '').length,
    estimatedTokens: estimateTextTokens(CATEGORY_POLICIES[id] || ''),
  }])),
  notes: {
    schemaTokensAreEstimated: true,
    costIsProportionalToInputTokens: true,
    automaticMemoryOrSkillLookupIsNotPerformedByThisRouter: true,
    requestToolCategoryFallbackPreserved: true,
  },
};

assert.equal(failures.length, 0, `category routing failures: ${JSON.stringify(failures.slice(0, 12))}`);
console.log(JSON.stringify(report, null, 2));
