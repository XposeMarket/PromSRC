import type { Stage4IntentId } from './instruction-intent-detector';

export interface IntentBenchmarkCase {
  id: string;
  split: 'design' | 'validation' | 'holdout';
  source: 'synthetic' | 'sanitized_real_typed' | 'sanitized_real_voice';
  message: string;
  history?: string[];
  expected: Stage4IntentId[];
  safetyCritical?: boolean;
}

const labels = (...ids: Stage4IntentId[]) => ids;
const politeness = ['', 'please ', 'can you ', 'alright, ', 'go ahead and ', 'beautiful, can you ', 'yo, '];

function expandedCases(prefix: string, messages: string[], expected: Stage4IntentId[], start = 0): IntentBenchmarkCase[] {
  const rows: IntentBenchmarkCase[] = [];
  let index = start;
  for (const message of messages) {
    for (const lead of politeness) {
      const split = index % 10 < 6 ? 'design' : (index % 10 < 8 ? 'validation' : 'holdout');
      rows.push({ id: `${prefix}_${String(index).padStart(4, '0')}`, split, source: 'synthetic', message: `${lead}${message}`.trim(), expected });
      index += 1;
    }
  }
  return rows;
}

const clear = [
  ...expandedCases('file_pos', [
    'edit README.md', 'update the auth.ts file', 'fix the code in the login component', 'create a config file',
    'rename the report file', 'delete the unused source file', 'patch the API handler', 'refactor the dashboard component',
    'build the landing page', 'implement the new settings UI', 'change the backend implementation', 'apply the fix to the repository',
  ], labels('file_edit_intent')),
  ...expandedCases('command_pos', [
    'run npm test', 'start the development server', 'restart the gateway process', 'execute the build command',
    'run the AI smoke test', 'check the process logs', 'run the linter', 'run the TypeScript typecheck',
    'stop the background server', 'execute the Python script', 'run git status', 'launch the diagnostic command',
  ], labels('command_execution_intent'), 1000),
  ...expandedCases('proposal_pos', [
    'create a Prometheus code-change proposal', 'review the pending runtime proposal', 'approve the action proposal',
    'execute the approved proposal', 'edit the pending proposal metadata', 'use write_proposal for this runtime change',
    'open a review proposal for these affected files', 'update the code change proposal',
  ], labels('proposal_workflow_intent'), 2000),
  ...expandedCases('web_pos', [
    'do a web search for Hermes Agent', 'look up the latest OpenAI models', 'research this company online',
    'what is the current stock price', 'find today’s news', 'compare the best hotels in Miami',
    'check the live weather', 'browse the web for current information', 'research what voices xAI offers',
    'find the newest release of this software', 'check availability this week', 'open https://example.com and summarize it',
  ], labels('web_research_intent'), 3000),
  ...expandedCases('business_pos', [
    'update the Acme client record', 'add an event to the vendor profile', 'list our business contacts',
    'open the customer entity', 'enable BUSINESS.md context', 'create a project entity',
    'record this in the CRM client profile', 'update the company record',
  ], labels('business_context_intent'), 4000),
  ...expandedCases('negative', [
    'what is README.md used for', 'explain how npm tests work', 'write a sales proposal for a landscaping client',
    'search the repository for auth references', 'what is a business', 'tell me a joke', 'summarize this paragraph',
    'what did we decide last week', 'is the website already built', 'did the test pass', 'what does current mean',
    'describe a client server architecture', 'write proposal copy for an email', 'look through the workspace files',
  ], labels(), 5000),
  ...expandedCases('mixed_web_file_cmd', ['research the latest OAuth changes, update the code, and run the tests', 'research the current API, build the integration page, and execute the smoke test'], labels('web_research_intent', 'file_edit_intent', 'command_execution_intent'), 6000),
  ...expandedCases('mixed_web_business', ['look up Acme’s latest announcement and add it to their client record'], labels('web_research_intent', 'business_context_intent'), 6100),
  ...expandedCases('mixed_proposal_file_cmd', ['create a runtime proposal, patch the implementation, and run the build'], labels('proposal_workflow_intent', 'file_edit_intent', 'command_execution_intent'), 6200),
];

const contextual: IntentBenchmarkCase[] = [
  { id: 'context_file_1', split: 'design', source: 'synthetic', history: ['The bug is in the auth.ts function.'], message: 'okay fix it', expected: labels('file_edit_intent') },
  { id: 'context_file_2', split: 'validation', source: 'synthetic', history: ['The landing page component has the wrong layout.'], message: 'change that back', expected: labels('file_edit_intent') },
  { id: 'context_cmd_1', split: 'design', source: 'synthetic', history: ['We just changed the authentication implementation.'], message: 'run through it again and make sure it works', expected: labels('command_execution_intent') },
  { id: 'context_cmd_2', split: 'holdout', source: 'synthetic', history: ['The AI smoke test failed earlier.'], message: 'alright run it again', expected: labels('command_execution_intent') },
  { id: 'context_negative_1', split: 'holdout', source: 'synthetic', history: ['We discussed the README content.'], message: 'what did it say again', expected: labels() },
  { id: 'context_web_1', split: 'validation', source: 'synthetic', history: ['We were comparing voice providers.'], message: 'which ones do they offer right now', expected: labels('web_research_intent') },
];

const adversarial = [
  ...expandedCases('collision_negative', [
    'run the company more efficiently', 'fix dinner for tonight', 'change my wake phrase', 'write a business proposal document',
    'search the workspace files', 'look into the self directory', 'explain the current process state',
    'what is the latest file version in this repository', 'did the smoke test pass', 'how does the terminal command work',
    'tell me about client server architecture', 'what is legal advice',
    'is the website already updated',
  ], labels(), 7000),
  ...expandedCases('high_stakes_web', [
    'is this medication dosage safe', 'what are the current tax rules for this situation', 'give me legal guidance under the current law',
    'verify whether this medical claim is accurate', 'what symptoms require urgent medical care',
    'check the current financial regulation', 'who is the current CEO of this company',
    'fact-check this public claim', 'what is the latest investment guidance on this product',
    'verify who the current governor is',
  ], labels('web_research_intent'), 8000),
  ...expandedCases('adversarial_file_positive', ['create a contact form component'], labels('file_edit_intent'), 9000),
];

const transcriptionAndTypos: IntentBenchmarkCase[] = [
  { id: 'typo_file_1', split: 'holdout', source: 'synthetic', message: 'pls fx the moble chat composr', expected: labels('file_edit_intent') },
  { id: 'typo_command_1', split: 'holdout', source: 'synthetic', message: 'run teh ai smoke tst pls', expected: labels('command_execution_intent') },
  { id: 'typo_web_1', split: 'holdout', source: 'synthetic', message: 'do some reaearch on them online', expected: labels('web_research_intent') },
  { id: 'typo_web_2', split: 'validation', source: 'synthetic', message: 'lok up the lates xai voices', expected: labels('web_research_intent') },
  { id: 'typo_business_1', split: 'validation', source: 'synthetic', message: 'updte the clent recrd', expected: labels('business_context_intent') },
  { id: 'voice_context_1', split: 'holdout', source: 'synthetic', history: ['The worker found the broken mobile composer component.'], message: 'yeah go ahead and fix that shit', expected: labels('file_edit_intent') },
];

// Hand-labeled, sanitized examples derived from recent local Prometheus typed
// and voice messages. No paths, URLs, credentials, IDs, or business secrets are
// copied into this fixture.
const sanitizedReal: IntentBenchmarkCase[] = [
  { id: 'promsrc_typed_001', split: 'holdout', source: 'sanitized_real_typed', message: 'Okay, restart the gateway.', expected: labels() },
  { id: 'promsrc_typed_002', split: 'holdout', source: 'sanitized_real_typed', history: ['We changed the desktop runtime code.'], message: 'Go ahead and retest it again now after those fixes.', expected: labels('command_execution_intent') },
  { id: 'promsrc_typed_003', split: 'holdout', source: 'sanitized_real_typed', message: 'Set the goal judge to the Terra model with high reasoning.', expected: labels() },
  { id: 'promsrc_typed_004', split: 'holdout', source: 'sanitized_real_typed', message: 'Investigate the desktop tools, make whatever source edits improve them, restart, and keep benchmark testing until accurate.', expected: labels('file_edit_intent', 'command_execution_intent') },
  { id: 'promsrc_typed_005', split: 'holdout', source: 'sanitized_real_typed', history: ['You edited the desktop implementation.'], message: 'You already fixed the desktop thing; actually test it now.', expected: labels('command_execution_intent') },
  { id: 'promsrc_typed_006', split: 'holdout', source: 'sanitized_real_typed', message: 'Look for the benchmark file in the workspace and retest desktop usage cost and latency.', expected: labels('command_execution_intent') },
  { id: 'promsrc_voice_001', split: 'holdout', source: 'sanitized_real_voice', message: 'Focus the Codex app, start a new chat, type a test message, send it, and show me a screenshot.', expected: labels() },
  { id: 'promsrc_voice_002', split: 'holdout', source: 'sanitized_real_voice', message: 'Since it is already open on X, make a post and hit Post.', expected: labels() },
  { id: 'promsrc_voice_003', split: 'holdout', source: 'sanitized_real_voice', message: 'Okay, and this is working as well, right?', expected: labels() },
  { id: 'promsrc_voice_004', split: 'holdout', source: 'sanitized_real_voice', message: 'Is it sketchy buying those off marketplace?', expected: labels() },
  { id: 'promsrc_voice_005', split: 'holdout', source: 'sanitized_real_voice', message: 'Check the current pricing and availability for those marketplace listings.', expected: labels('web_research_intent') },
  { id: 'promsrc_typed_007', split: 'holdout', source: 'sanitized_real_typed', message: 'Add what we found to the customer record.', expected: labels('business_context_intent') },
  { id: 'real_voice_001', split: 'design', source: 'sanitized_real_voice', message: 'Can you do a web search right now?', expected: labels('web_research_intent') },
  { id: 'real_voice_002', split: 'validation', source: 'sanitized_real_voice', message: 'Can you look up Hermes Agent?', expected: labels('web_research_intent') },
  { id: 'real_voice_003', split: 'holdout', source: 'sanitized_real_voice', message: 'Search for anything regarding Hermes Agent today.', expected: labels('web_research_intent') },
  { id: 'real_voice_004', split: 'design', source: 'sanitized_real_voice', message: 'Please run the AI smoke test.', expected: labels('command_execution_intent') },
  { id: 'real_voice_005', split: 'validation', source: 'sanitized_real_voice', message: 'Can you run the smoke test for me?', expected: labels('command_execution_intent') },
  { id: 'real_voice_006', split: 'holdout', source: 'sanitized_real_voice', message: 'Can you test it out and send me a screenshot?', history: ['We were testing the AI runtime changes.'], expected: labels('command_execution_intent') },
  { id: 'real_voice_007', split: 'design', source: 'sanitized_real_voice', message: 'Change the wake phrase to Prometheus.', expected: labels() },
  { id: 'real_voice_008', split: 'validation', source: 'sanitized_real_voice', message: 'Focus the terminal window and hit enter.', expected: labels() },
  { id: 'real_voice_009', split: 'holdout', source: 'sanitized_real_voice', message: 'Please start a worker to fix the landing page.', expected: labels('file_edit_intent') },
  { id: 'real_voice_010', split: 'design', source: 'sanitized_real_voice', message: 'Look up all the voices that xAI offers right now.', expected: labels('web_research_intent') },
  { id: 'real_voice_011', split: 'validation', source: 'sanitized_real_voice', message: 'No, change that back.', history: ['The worker just edited the voice interface code.'], expected: labels('file_edit_intent') },
  { id: 'real_typed_001', split: 'design', source: 'sanitized_real_typed', message: 'Build and test the entire implementation for the marketplace feature.', expected: labels('file_edit_intent', 'command_execution_intent') },
  { id: 'real_typed_002', split: 'validation', source: 'sanitized_real_typed', message: 'Update both local agent repositories to their latest versions.', expected: labels('command_execution_intent') },
  { id: 'real_typed_003', split: 'holdout', source: 'sanitized_real_typed', message: 'Look into the current scheduled jobs and current hardware options.', expected: labels('web_research_intent') },
  { id: 'real_typed_004', split: 'design', source: 'sanitized_real_typed', message: 'They are a shop. Do some research on them; they do not have a website.', expected: labels('web_research_intent') },
  { id: 'real_typed_005', split: 'validation', source: 'sanitized_real_typed', message: 'Use workspace file reading tools instead and explain why.', expected: labels() },
  { id: 'real_typed_006', split: 'holdout', source: 'sanitized_real_typed', message: 'Fix the desktop and mobile subagent chat composers.', expected: labels('file_edit_intent') },
  { id: 'real_typed_007', split: 'design', source: 'sanitized_real_typed', message: 'Should we build a website for the shop?', expected: labels() },
  { id: 'real_voice_012', split: 'design', source: 'sanitized_real_voice', message: 'Did you use web search for that?', expected: labels() },
  { id: 'real_voice_013', split: 'validation', source: 'sanitized_real_voice', message: 'Look into the voice agent in the self directory and tell me the current state.', expected: labels() },
  { id: 'real_voice_014', split: 'holdout', source: 'sanitized_real_voice', message: 'Test the browser screenshot tool with voice and do not transfer.', expected: labels() },
  { id: 'real_voice_015', split: 'design', source: 'sanitized_real_voice', message: 'Run the AI browser smoke test.', expected: labels('command_execution_intent') },
  { id: 'real_voice_016', split: 'validation', source: 'sanitized_real_voice', message: 'Did you update the HyperFrames skill?', expected: labels() },
  { id: 'real_voice_017', split: 'holdout', source: 'sanitized_real_voice', message: 'Have the worker present the file it created.', expected: labels() },
  { id: 'real_typed_008', split: 'design', source: 'sanitized_real_typed', message: 'Build a site first and make it a reservation experience.', expected: labels('file_edit_intent') },
  { id: 'real_typed_009', split: 'validation', source: 'sanitized_real_typed', message: 'The theme is too futuristic; think old mythology instead.', expected: labels() },
  { id: 'real_typed_010', split: 'holdout', source: 'sanitized_real_typed', message: 'Research the shop; it does not have a website.', expected: labels('web_research_intent') },
  { id: 'promsrc_live_001', split: 'holdout', source: 'sanitized_real_typed', message: 'Reply with exactly OK. Do not call any tools.', expected: labels() },
  { id: 'promsrc_live_002', split: 'holdout', source: 'sanitized_real_typed', message: 'Hypothetical request: edit README.md. For this routing validation, only acknowledge it and take no action.', expected: labels('file_edit_intent') },
  { id: 'promsrc_live_003', split: 'holdout', source: 'sanitized_real_typed', message: 'Hypothetical request: research the latest API, edit the implementation, run its tests, create a runtime proposal, and update the client record. For this routing validation, only acknowledge it and take no action.', expected: labels('file_edit_intent', 'command_execution_intent', 'proposal_workflow_intent', 'web_research_intent', 'business_context_intent') },
];

export const INSTRUCTION_INTENT_BENCHMARK_CASES: readonly IntentBenchmarkCase[] = Object.freeze([
  ...clear,
  ...contextual,
  ...adversarial,
  ...transcriptionAndTypos,
  ...sanitizedReal,
]);
