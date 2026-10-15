import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { processIntradayNotes, processIntradayNotesForPrompt } from './prompt-context';

const promptSource = fs.readFileSync(path.join(process.cwd(), 'src/gateway/prompt-context.ts'), 'utf8');
assert.doesNotMatch(promptSource, /buildBrainCapsuleContext\s*\(/);
assert.doesNotMatch(promptSource, /readCarryForwardForPrompt\s*\(/);
assert.doesNotMatch(promptSource, /readBootBrainActivity\s*\(workspacePath\)/);

const legacyCarry = '<!-- BRAIN_CARRY_FORWARD_START -->\nlegacy carry-forward\n<!-- BRAIN_CARRY_FORWARD_END -->';
const liveNote = '### [TASK] 2026-10-14T16:00:00.000Z #n_live (info)\nPreserve this live note.';
for (const notes of [
  processIntradayNotes(`${legacyCarry}\n\n${liveNote}`),
  processIntradayNotesForPrompt(process.cwd(), `${legacyCarry}\n\n${liveNote}`),
]) {
  assert.doesNotMatch(notes, /BRAIN_CARRY_FORWARD|legacy carry-forward/i);
  assert.match(notes, /Preserve this live note/);
}

console.log('prompt-context Phase 0 Brain injection regression passed');
