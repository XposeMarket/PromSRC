import assert from 'node:assert/strict';
import { bootReplayHarness } from './harness';
import { toolMessagesIn } from './scripted-provider';

async function main() {
  // The fixture fits the active model, but crosses every old elision threshold.
  process.env.PROMETHEUS_CHAT_NUM_CTX = '800000';
  const harness = await bootReplayHarness();
  try {
    const outputs = Array.from({ length: 64 }, (_, index) =>
      'result ' + index + ': ' + 'x'.repeat(index === 0 ? 90000 : 4000) + ' middle ' + index + ' ' + 'z'.repeat(4000));
    const rounds = Array.from({ length: 32 }, (_, round) => ({
      toolCalls: [2 * round, 2 * round + 1].map(index => ({
        id: 'lookup_' + index, name: 'skill_list', args: { query: 'lookup_' + index },
      })),
    }));
    const run = await harness.runTurn({
      sessionId: 'subagent_tool_history_fixture',
      message: 'Look up the requested skills.',
      tools: { skill_list: args => ({ result: outputs[Number(args.query.slice(7))] }) },
      script: [...rounds, { text: 'Verified.' }],
    });
    assert.equal(run.error, null);
    assert.equal(run.result.text, 'Verified.');
    const sent = toolMessagesIn(run.provider.requests.at(-1)!);
    assert.equal(sent.length, outputs.length);
    sent.forEach((message, index) => {
      assert.equal(message.tool_call_id, 'lookup_' + index);
      assert.ok(String(message.content).includes(outputs[index]), 'missing full output for ' + message.tool_call_id);
    });
    console.log('PASS: 64 complete tool results remain paired and readable after 32 rounds');
  } finally {
    harness.shutdown();
  }
}
main().then(() => process.exit(0), error => { console.error(error); process.exit(1); });
