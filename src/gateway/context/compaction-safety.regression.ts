import assert from 'node:assert/strict';
import {
  compactionInputBudgetTokens,
  compactionPromptFits,
  isUsableCompactionSummary,
  runCompactionTransaction,
  selectCompactionBatch,
} from './compaction-safety';

const headings = [
  'Primary Request and Intent',
  'Key Technical Concepts',
  'Files and Code Sections',
  'Errors, Fixes, and Test Results',
  'Problem Solving and Decisions',
  'Recent User Messages',
  'Pending Tasks',
  'Current Work',
  'Recovery Artifacts',
  'Continue From Here',
];
const summary = headings.map((heading, index) => `${index + 1}. ${heading}:\n- ${heading} retained.`).join('\n');
assert.equal(isUsableCompactionSummary(summary, 100), true);
assert.equal(isUsableCompactionSummary('', 100), false, 'a blank response must not reuse the previous checkpoint');
assert.equal(isUsableCompactionSummary(summary.replace('10. Continue From Here:', ''), 100), false);
assert.equal(isUsableCompactionSummary(summary.replace('Current Work retained.', 'Unknown'), 100), false);
assert.equal(isUsableCompactionSummary(`${summary}\n[...truncated to compaction word limit]`, 100), false);
assert.equal(isUsableCompactionSummary(summary, 20), false, 'word limits must reject rather than truncate');
assert.equal(isUsableCompactionSummary(`${summary}\n${'x'.repeat(12_000)}`, 20_000), false);

const budget = compactionInputBudgetTokens(8_192, 1_500);
assert.ok(budget > 0 && budget < 8_192 - 1_500);
assert.equal(compactionPromptFits('Short prompt', budget), true);
assert.equal(compactionPromptFits('x'.repeat(40_000), budget), false);

// The final message plus metadata does not fit, so include every message in
// an earlier pass and send metadata in a separate final pass.
const batches: Array<{ start: number; end: number; metadata: boolean }> = [];
let start = 0;
while (start < 5) {
  const selected = selectCompactionBatch(start, 5, (end, metadata) =>
    (end - start) * 1_000 + (metadata ? 4_000 : 0) <= 2_000);
  assert.ok(selected);
  batches.push({ start, end: selected.end, metadata: selected.includeFinalMetadata });
  start = selected.end;
}
assert.deepEqual(batches.map((batch) => [batch.start, batch.end]), [[0, 2], [2, 4], [4, 5]]);
assert.ok(batches.every((batch) => !batch.metadata));
assert.equal(selectCompactionBatch(0, 1, () => false), null, 'an oversized single message must leave context intact');

async function testTransaction(): Promise<void> {
  const messages = ['oldest user request', 'assistant work', 'newest user request'];
  const updatedSummary = summary.replace('Primary Request and Intent retained.', 'Primary Request and Intent updated.');
  const prompts: string[] = [];
  const committed: string[] = [];
  const input = {
    messages,
    previousSummary: '',
    maxWords: 100,
    numCtx: 2_048,
    numPredict: 500,
    renderPrompt: (batch: string[], previous: string, metadata: boolean) =>
      `${previous}\n${batch.map((message) => `${message}:${'x'.repeat(2_000)}`).join('\n')}${metadata ? 'm'.repeat(1_200) : ''}`,
    summarize: async (prompt: string) => {
      prompts.push(prompt);
      return prompts.length === 1 ? summary : updatedSummary;
    },
    commit: (value: string) => { committed.push(value); },
  };
  const completed = await runCompactionTransaction(input);
  assert.equal(completed.compacted, true);
  assert.ok(prompts.length > 1, 'oversized source must be split into multiple passes');
  assert.ok(prompts[0].includes('oldest user request'));
  assert.ok(prompts.at(-1)?.includes('newest user request'));
  assert.ok(prompts.at(-1)?.includes('m'.repeat(1_200)), 'final metadata must be included before commit');
  assert.ok(prompts[1].includes(summary), 'the earlier pass must feed the later pass');
  assert.deepEqual(committed, [updatedSummary], 'only the completed transaction may advance the checkpoint');

  let failedCommits = 0;
  let calls = 0;
  const failed = await runCompactionTransaction({
    ...input,
    summarize: async () => ++calls === 1 ? summary : '',
    commit: () => { failedCommits++; },
  });
  assert.deepEqual(failed, { compacted: false, reason: 'invalid_summary' });
  assert.equal(failedCommits, 0, 'a failed later pass must keep all active messages');

  calls = 0;
  await assert.rejects(runCompactionTransaction({
    ...input,
    summarize: async () => {
      if (++calls === 1) return summary;
      throw new Error('provider failed');
    },
    commit: () => { failedCommits++; },
  }), /provider failed/);
  assert.equal(failedCommits, 0, 'provider failure must not commit a partial summary');
}

testTransaction().then(() => console.log('compaction-safety regression: ok')).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
