import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ModelResponseRecovery } from './model-response-recovery';

const recovery = new ModelResponseRecovery();
assert.equal(recovery.outputBudget('anthropic', 'claude-fable-5-1'), 16384);
assert.equal(recovery.outputBudget('openai', 'gpt'), 4096);
const limited = recovery.inspect({ content: null }, 'max_tokens');
assert.equal(limited.action, 'retry');
if (limited.action === 'retry') {
  assert.match(limited.prompt, /output token limit/);
  assert.match(limited.prompt, /fewer than 250 lines/);
  assert.match(limited.prompt, /NOT executed/);
}
assert.equal(recovery.outputBudget('anthropic', 'claude-fable-5-1'), 32768);
assert.equal(recovery.inspect({ content: null }, 'end_turn').action, 'retry');
assert.deepEqual(recovery.inspect({ content: null }, 'end_turn'), { action: 'exhausted', reason: 'end_turn' });
assert.equal(recovery.inspect({ tool_calls: [{}] }, 'tool_use').action, 'accept');
assert.equal(recovery.inspect({ content: null }, 'end_turn').action, 'retry');
assert.equal(recovery.inspect({ content: 'OK' }, 'end_turn').action, 'accept');
assert.equal(recovery.inspect({ content: null }, 'refusal').action, 'accept');
assert.equal(recovery.inspect({ content: null }, undefined, true).action, 'accept');
assert.equal(recovery.inspect({ content: 'Partial answer' }, 'max_tokens').action, 'retry');
const interrupted = recovery.inspect({ content: 'Partial answer' }, 'incomplete_stream');
assert.equal(interrupted.action, 'retry');
if (interrupted.action === 'retry') assert.match(interrupted.prompt, /stream was interrupted/);
assert.equal(recovery.outputBudget('anthropic', 'claude-fable-5-1'), 32768);
recovery.inspect({ tool_calls: [{}] }, 'tool_use');
assert.equal(recovery.inspect({}, 'end_turn').action, 'retry');
recovery.inspect({ tool_calls: [{}] }, 'tool_use');
assert.equal(recovery.inspect({}, 'end_turn').action, 'exhausted', 'total recovery cap survives intervening tool work');

const exhaustedOutput = new ModelResponseRecovery();
exhaustedOutput.inspect({}, 'max_tokens');
exhaustedOutput.inspect({}, 'max_tokens');
assert.deepEqual(exhaustedOutput.inspect({}, 'max_tokens'), { action: 'exhausted', reason: 'max_tokens' });

// Wiring matters: the historical bug removed tools and dropped recovered calls.
const router = fs.readFileSync(path.join(__dirname, '../routes/chat.router.ts'), 'utf8');
assert.doesNotMatch(router, /salvageRound|Do not call any more tools|MAX_EMPTY_FINAL_SALVAGE/);
assert.match(router, /modelResponseRecovery\.inspect\(response, responseStopReason/);
assert.match(router, /num_predict:.*modelResponseRecovery\.outputBudget/);
assert.match(router, /stopReason: result\.stopReason/);
assert.match(router, /outputTokens: result\.usage\?\.outputTokens/);
assert.match(router, /recovery\.reason === 'max_tokens'/);
assert.equal((router.match(/responseStopReason = result.stopReason/g) || []).length, 2);
assert.doesNotMatch(router, /content: 'Understood\. I will steer/);
const shim = fs.readFileSync(path.join(__dirname, '../../agents/ollama-client.ts'), 'utf8');
assert.match(shim, /stopReason: result.stopReason/);
console.log('Model response recovery limits and chat-loop wiring passed.');
