import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ModelResponseRecovery } from './model-response-recovery';

const recovery = new ModelResponseRecovery();
assert.equal(recovery.outputBudget('anthropic', 'claude-fable-5-1'), 16384);
assert.equal(recovery.outputBudget('openai', 'gpt'), 4096);
assert.equal(recovery.inspect({ content: null }, 'max_tokens').action, 'retry');
assert.equal(recovery.outputBudget('anthropic', 'claude-fable-5-1'), 32768);
assert.equal(recovery.inspect({ content: null }, 'end_turn').action, 'retry');
assert.equal(recovery.inspect({ content: null }, 'end_turn').action, 'exhausted');
assert.equal(recovery.inspect({ tool_calls: [{}] }, 'tool_use').action, 'accept');
assert.equal(recovery.inspect({ content: null }, 'end_turn').action, 'retry');
assert.equal(recovery.inspect({ content: 'OK' }, 'end_turn').action, 'accept');
assert.equal(recovery.inspect({ content: null }, 'refusal').action, 'accept');
assert.equal(recovery.inspect({ content: null }, undefined, true).action, 'accept');
assert.equal(recovery.inspect({ content: 'Partial answer' }, 'max_tokens').action, 'retry');
assert.equal(recovery.inspect({ content: 'Partial answer' }, 'incomplete_stream').action, 'retry');
assert.equal(recovery.outputBudget('anthropic', 'claude-fable-5-1'), 32768);
recovery.inspect({ tool_calls: [{}] }, 'tool_use');
assert.equal(recovery.inspect({}, 'end_turn').action, 'retry');
recovery.inspect({ tool_calls: [{}] }, 'tool_use');
assert.equal(recovery.inspect({}, 'end_turn').action, 'exhausted', 'total recovery cap survives intervening tool work');

// Wiring matters: the historical bug removed tools and dropped recovered calls.
const router = fs.readFileSync(path.join(__dirname, '../routes/chat.router.ts'), 'utf8');
assert.doesNotMatch(router, /salvageRound|Do not call any more tools|MAX_EMPTY_FINAL_SALVAGE/);
assert.match(router, /modelResponseRecovery\.inspect\(response, responseStopReason/);
assert.match(router, /num_predict:.*modelResponseRecovery\.outputBudget/);
assert.equal((router.match(/responseStopReason = result.stopReason/g) || []).length, 2);
assert.doesNotMatch(router, /content: 'Understood\. I will steer/);
const shim = fs.readFileSync(path.join(__dirname, '../../agents/ollama-client.ts'), 'utf8');
assert.match(shim, /stopReason: result.stopReason/);
console.log('Model response recovery limits and chat-loop wiring passed.');
