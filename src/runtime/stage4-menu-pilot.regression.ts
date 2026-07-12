import assert from 'assert';
import crypto from 'crypto';
import { buildToolsContext } from '../gateway/prompt-context';
import {
  STAGE4_MENU_SEGMENT_IDS,
  detectStage4InstructionIntents,
  getStage4InstructionMode,
  type Stage4MenuSegmentId,
} from './instruction-intent-detector';

const hash = (value: string): string => crypto.createHash('sha256').update(value).digest('hex');
const anchors: Record<Stage4MenuSegmentId, string> = {
  'tools.file_edit_routing': '[FILE EDIT ROUTING]',
  'tools.run_command_routing': '[RUN COMMAND ROUTING]',
  'tools.proposal_lanes': '[PROPOSAL LANES]',
  'tools.search_strategy': '[SEARCH]',
  'tools.business_context': '[BUSINESS CONTEXT]',
};
const positiveMessages: Record<Stage4MenuSegmentId, string> = {
  'tools.file_edit_routing': 'Edit the README file.',
  'tools.run_command_routing': 'Run npm test.',
  'tools.proposal_lanes': 'Create a Prometheus code-change proposal.',
  'tools.search_strategy': 'Search the web for the latest OpenAI models.',
  'tools.business_context': 'Update the Acme client record.',
};

function withEnvironment<T>(mode: 'legacy' | 'shadow' | 'active', segments: string | undefined, fn: () => T): T {
  const oldMode = process.env.PROMETHEUS_STAGE4_INSTRUCTION_MODE;
  const oldSegments = process.env.PROMETHEUS_STAGE4_SEGMENTS;
  process.env.PROMETHEUS_STAGE4_INSTRUCTION_MODE = mode;
  if (segments === undefined) delete process.env.PROMETHEUS_STAGE4_SEGMENTS;
  else process.env.PROMETHEUS_STAGE4_SEGMENTS = segments;
  try {
    assert.equal(getStage4InstructionMode(), mode);
    return fn();
  } finally {
    if (oldMode === undefined) delete process.env.PROMETHEUS_STAGE4_INSTRUCTION_MODE;
    else process.env.PROMETHEUS_STAGE4_INSTRUCTION_MODE = oldMode;
    if (oldSegments === undefined) delete process.env.PROMETHEUS_STAGE4_SEGMENTS;
    else process.env.PROMETHEUS_STAGE4_SEGMENTS = oldSegments;
  }
}

function contextFor(message: string, categories: string[] = []): string {
  const active = new Set(categories);
  const intents = detectStage4InstructionIntents({ message, activeToolCategories: active });
  return buildToolsContext(active, { instructionIntents: intents });
}

function testDefaultAndRollbackModes(): void {
  const old = process.env.PROMETHEUS_STAGE4_INSTRUCTION_MODE;
  try {
    delete process.env.PROMETHEUS_STAGE4_INSTRUCTION_MODE;
    assert.equal(getStage4InstructionMode(), 'active');
  } finally {
    if (old !== undefined) process.env.PROMETHEUS_STAGE4_INSTRUCTION_MODE = old;
  }
  const allIntentMessage = 'Research the latest company announcement, update its client record, create a runtime proposal, edit the source code, and run the tests.';
  const legacy = withEnvironment('legacy', undefined, () => contextFor(allIntentMessage));
  const shadow = withEnvironment('shadow', undefined, () => contextFor(allIntentMessage));
  const active = withEnvironment('active', undefined, () => contextFor(allIntentMessage));
  assert.equal(hash(shadow), hash(legacy), 'shadow must preserve legacy prompt bytes');
  assert.equal(hash(active), hash(legacy), 'all-positive active prompt must preserve legacy prompt bytes');
}

function testSequentialSegmentActivation(): void {
  for (const id of STAGE4_MENU_SEGMENT_IDS) {
    const positive = withEnvironment('active', id, () => contextFor(positiveMessages[id]));
    assert.ok(positive.includes(anchors[id]), `${id}: positive trigger omitted segment`);
    const negative = withEnvironment('active', id, () => contextFor('Hello, how are you?'));
    assert.ok(!negative.includes(anchors[id]), `${id}: negative trigger leaked segment`);
    const rollback = withEnvironment('legacy', id, () => contextFor('Hello, how are you?'));
    assert.ok(rollback.includes(anchors[id]), `${id}: legacy rollback did not restore segment`);
  }
}

function testCollisionsAndSavings(): void {
  const proposalCopy = withEnvironment('active', 'tools.proposal_lanes', () => contextFor('Write a sales proposal for a landscaping customer.'));
  assert.ok(!proposalCopy.includes('[PROPOSAL LANES]'));
  const localSearch = withEnvironment('active', 'tools.search_strategy', () => contextFor('Search the repository for auth references.'));
  assert.ok(!localSearch.includes('[SEARCH]'));
  const discussion = withEnvironment('active', 'tools.file_edit_routing', () => contextFor('Should we build a website for the shop?'));
  assert.ok(!discussion.includes('[FILE EDIT ROUTING]'));

  const legacy = withEnvironment('legacy', undefined, () => contextFor('Hello, how are you?'));
  const active = withEnvironment('active', undefined, () => contextFor('Hello, how are you?'));
  for (const id of STAGE4_MENU_SEGMENT_IDS) assert.ok(!active.includes(anchors[id]), `${id}: inactive default leaked`);
  assert.ok(active.length < legacy.length);
  assert.ok((legacy.length - active.length) > 2500, 'ordinary-turn menu savings unexpectedly small');
}

testDefaultAndRollbackModes();
testSequentialSegmentActivation();
testCollisionsAndSavings();
console.log('Stage 4 sequential menu activation and rollback regression checks passed');
