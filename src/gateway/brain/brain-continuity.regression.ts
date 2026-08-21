import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  applyCarryForwardToIntradayFile,
  buildBrainCapsuleContext,
  buildBrainCapsuleContextDetails,
  loadActiveBrainThoughtCapsules,
  parseBrainCarryForwardDecision,
  parseBrainThoughtCapsules,
} from './brain-continuity.js';
import { processIntradayNotes } from '../prompt-context.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-continuity-'));
const capsuleDir = path.join(root, 'Brain', 'context-capsules', '2026-07-18');
fs.mkdirSync(capsuleDir, { recursive: true });

const make = (overrides: Record<string, unknown> = {}) => ({
  id: 'game-old',
  threadKey: 'project:galaxy-drift',
  kind: 'active_work',
  priority: 'normal',
  status: 'in_progress',
  createdAt: '2026-07-18T01:00:00.000Z',
  expiresAt: '2026-07-19T01:00:00.000Z',
  summary: 'Galaxy Drift touch controls are still being verified.',
  facts: ['The playable shell exists.'],
  nextUsefulAction: 'Inspect touch controls before changing them.',
  relevance: { projects: ['Galaxy Drift'], triggers: ['game', 'touch controls'], surfaces: ['main_chat'] },
  evidence: ['games/mobile-space-explorer/'],
  lastValidatedAt: '2026-07-18T01:00:00.000Z',
  verificationRequired: true,
  supersedes: [],
  ...overrides,
});

const many = Array.from({ length: 18 }, (_, index) => make({
  id: `thread-${index}`,
  threadKey: `project:thread-${index}`,
  summary: `Thread ${index} is active.`,
  relevance: { projects: [`Thread ${index}`], triggers: [`thread-${index}`], surfaces: ['main_chat'] },
}));
assert.equal(parseBrainThoughtCapsules(JSON.stringify(many)).length, 18, 'capture must not impose an item-count cap');
assert.deepEqual(parseBrainThoughtCapsules('{bad json'), []);
assert.deepEqual(parseBrainThoughtCapsules(JSON.stringify([make({ kind: 'guess' })])), [], 'unknown capsule kinds must be rejected');
assert.deepEqual(parseBrainThoughtCapsules(JSON.stringify([make({ priority: 'urgent' })])), [], 'unknown priorities must be rejected');
assert.deepEqual(parseBrainThoughtCapsules(JSON.stringify([make({ status: 'pending' })])), [], 'unknown statuses must be rejected');
assert.deepEqual(parseBrainThoughtCapsules(JSON.stringify([make({ relevance: { projects: 'Galaxy Drift', triggers: [], surfaces: [] } })])), [], 'malformed relevance arrays must be rejected');
assert.deepEqual(parseBrainThoughtCapsules(JSON.stringify([make({ verificationRequired: 'yes' })])), [], 'verificationRequired must remain boolean');

fs.writeFileSync(path.join(capsuleDir, '01-00-capsules.json'), JSON.stringify([
  make(),
  make({
    id: 'game-new',
    createdAt: '2026-07-18T02:00:00.000Z',
    summary: 'Galaxy Drift touch controls changed and now need device verification.',
    supersedes: ['game-old'],
  }),
  make({
    id: 'expired',
    threadKey: 'project:expired',
    createdAt: '2026-07-17T01:00:00.000Z',
    expiresAt: '2026-07-17T02:00:00.000Z',
    summary: 'Expired work.',
  }),
  make({
    id: 'nebulax',
    threadKey: 'project:nebulax',
    summary: 'NebulaX audit is complete and implementation has not started.',
    relevance: { projects: ['NebulaX'], triggers: ['nebulax', 'trading platform'], surfaces: ['main_chat'] },
  }),
]), 'utf-8');

const active = loadActiveBrainThoughtCapsules(root, new Date('2026-07-18T03:00:00.000Z'));
assert.equal(active.length, 2);
assert.equal(active.find((row) => row.threadKey === 'project:galaxy-drift')?.id, 'game-new');

const gameContext = buildBrainCapsuleContext(root, 'lets continue the Galaxy Drift game', {
  now: new Date('2026-07-18T03:00:00.000Z'),
  maxChars: 1200,
});
assert.match(gameContext, /Galaxy Drift touch controls changed/);
assert.doesNotMatch(gameContext, /NebulaX audit/);
assert.match(gameContext, /Verify live state/);
const gameDetails = buildBrainCapsuleContextDetails(root, 'lets continue the Galaxy Drift game', {
  now: new Date('2026-07-18T03:00:00.000Z'),
  maxChars: 1200,
});
assert.equal(gameDetails.relatedCount, 1, 'context telemetry should count the selected related Thought capsule');
assert.equal(gameDetails.fallbackCount, 0);
assert.equal(gameDetails.text, gameContext, 'telemetry and prompt builders must share the exact rendered packet');

const unrelatedContext = buildBrainCapsuleContextDetails(root, 'can you check this and tell me about dinner?', {
  now: new Date('2026-07-18T03:00:00.000Z'),
  maxChars: 1200,
});
assert.equal(unrelatedContext.text, '', 'common stop words must not trigger unrelated Thought capsules');
assert.equal(unrelatedContext.relatedCount, 0);

const tinyBudget = buildBrainCapsuleContext(root, 'Galaxy Drift NebulaX', {
  now: new Date('2026-07-18T03:00:00.000Z'),
  maxChars: 500,
});
assert.ok(tinyBudget.length <= 500, 'maxChars must bound the entire rendered Brain context packet, including its header');

fs.writeFileSync(path.join(capsuleDir, '02-30-oversized-capsules.json'), JSON.stringify([
  make({
    id: 'oversized-context',
    threadKey: 'project:oversized-context',
    priority: 'critical',
    createdAt: '2026-07-18T02:30:00.000Z',
    summary: `Oversized context ${'detail '.repeat(1200)}`,
    relevance: { projects: ['Oversized Context'], triggers: ['oversized-context'], surfaces: ['main_chat'] },
  }),
]), 'utf8');
const oversizedBudget = buildBrainCapsuleContextDetails(root, 'oversized-context', {
  now: new Date('2026-07-18T03:00:00.000Z'),
  maxChars: 500,
});
assert.ok(oversizedBudget.text.length > 0, 'one oversized top-ranked capsule must not suppress the entire Brain context packet');
assert.ok(oversizedBudget.text.length <= 500, 'oversized capsules must still respect the total packet budget');
assert.equal(oversizedBudget.selected[0]?.capsule.id, 'oversized-context');
assert.match(oversizedBudget.text, /project:oversized-context/);

const decision = parseBrainCarryForwardDecision(JSON.stringify({
  targetDate: '2026-07-19',
  generatedAt: '2026-07-18T23:40:00.000Z',
  sourceDream: 'Brain/dreams/2026-07-18/23-30-dream.md',
  items: [{
    threadKey: 'project:galaxy-drift',
    title: 'Galaxy Drift controls',
    state: 'in_progress',
    verifiedFacts: ['The playable shell exists.'],
    looseEnds: ['Touch controls need device verification.'],
    nextNaturalOpening: 'Surface this when Raul returns to the game.',
    reviewBy: '2026-07-22T23:59:00.000Z',
    evidence: ['games/mobile-space-explorer/'],
    lastValidatedAt: '2026-07-18T23:00:00.000Z',
    verificationRequired: true,
  }],
}));
assert.ok(decision);
const notePath = path.join(root, 'memory', '2026-07-19-intraday-notes.md');
fs.mkdirSync(path.dirname(notePath), { recursive: true });
fs.writeFileSync(notePath, '### [TASK] 2026-07-19T00:05:00.000Z\nA live note that must survive.\n', 'utf-8');
applyCarryForwardToIntradayFile(root, decision!);
let note = fs.readFileSync(notePath, 'utf-8');
assert.match(note, /note when\/if any item below changes/);
assert.match(note, /Galaxy Drift controls/);
assert.match(note, /A live note that must survive/);
assert.equal((note.match(/BRAIN_CARRY_FORWARD_START/g) || []).length, 1);
const injectedNotes = processIntradayNotes(note, 12, 250, 10_000);
assert.match(injectedNotes, /Galaxy Drift controls/);
assert.match(injectedNotes, /A live note that must survive/);

const updated = { ...decision!, generatedAt: '2026-07-19T00:10:00.000Z', items: [] };
applyCarryForwardToIntradayFile(root, updated);
note = fs.readFileSync(notePath, 'utf-8');
assert.match(note, /No temporary threads were carried forward/);
assert.doesNotMatch(note, /Galaxy Drift controls/);
assert.match(note, /A live note that must survive/);
assert.equal((note.match(/BRAIN_CARRY_FORWARD_START/g) || []).length, 1);

fs.rmSync(root, { recursive: true, force: true });
console.log('brain-continuity regression: ok');
