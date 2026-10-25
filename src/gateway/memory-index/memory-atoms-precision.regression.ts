import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { clearHybridMemoryAtomCache, retrieveHybridMemoryAtoms } from './memory-atoms-hybrid.js';

// Synthetic MEMORY.md, paraphrased, no personal data.
const fixture = `# MEMORY.md - precision fixture

## project_memory
- Seedance image-to-video calls returned a 422 likeness error, so the likeness reference must be a generated subject, not a real person.
- The fal video pipeline lessons: Kling and MiniMax were tried for motion transfer, and Seedance worked best on the Edna project.
- Voice mode is realtime only; speech-to-text is used for dictation, not for the live conversation.
- Daytrading quiet hours run from 5 PM to 5 AM, so reminders must not fire inside that window.
- A skill is living memory: update the skill text when a workflow changes instead of leaving stale instructions.
- A PR must be built in its own worktree, never in the live checkout.
- The car payment is due on the first of each month.
`;

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-precision-'));
fs.writeFileSync(path.join(root, 'MEMORY.md'), fixture, 'utf-8');

const SEEDANCE = /seedance/i;
const FAL = /fal video pipeline|kling|minimax/i;
const VOICE = /voice mode|realtime only/i;
const DAYTRADING = /daytrading|quiet hours/i;
const CAR = /car payment/i;

async function selectedTexts(query: string): Promise<string[]> {
  clearHybridMemoryAtomCache(root);
  const result = await retrieveHybridMemoryAtoms(root, query, { embeddingProvider: null, maxAtoms: 6 });
  return result.selected.map((entry) => entry.atom.rawText);
}

async function main(): Promise<void> {
  // Negatives: generic words in a PR/skill task must not pull unrelated memories.
  const generic = await selectedTexts('Fix memory and skill matching in the same PR');
  assert.equal(generic.some((text) => SEEDANCE.test(text)), false, 'generic query must not select the Seedance lesson');
  assert.equal(generic.some((text) => FAL.test(text)), false, 'generic query must not select the fal video pipeline lesson');
  assert.equal(generic.some((text) => VOICE.test(text)), false, 'generic query must not select the voice-mode direction');
  assert.equal(generic.some((text) => DAYTRADING.test(text)), false, 'generic query must not select the daytrading reminder');

  // Negative: a bullet ID with a generic word must not select more than one atom.
  const tierTwo = await selectedTexts('Tier 2 for bullet IDs');
  assert.ok(tierTwo.length <= 1, 'tier 2 bullet-ID query must select at most one atom');

  // Negative: a generic phrase selects nothing.
  const dayToDay = await selectedTexts('day to day workflows');
  assert.equal(dayToDay.length, 0, '"day to day workflows" must select nothing');

  // Positives must still hit their atom.
  const seedance = await selectedTexts('seedance image to video keeps failing with a 422 likeness error');
  assert.ok(seedance.some((text) => SEEDANCE.test(text)), 'Seedance query must select the Seedance atom');

  const falModels = await selectedTexts('which fal models worked for Edna motion transfer');
  assert.ok(falModels.some((text) => FAL.test(text)), 'fal model query must select the video pipeline atom');

  const daytrading = await selectedTexts('remind me what the daytrading hours rule is');
  assert.ok(daytrading.some((text) => DAYTRADING.test(text)), 'daytrading query must select the quiet-hours atom');

  const car = await selectedTexts('how much is the car payment');
  assert.ok(car.some((text) => CAR.test(text)), 'car payment query must select the car atom');

  fs.rmSync(root, { recursive: true, force: true });
  console.log('memory-atoms-precision: all assertions passed');
}

void main();
