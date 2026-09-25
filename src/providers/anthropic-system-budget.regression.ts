import assert from 'node:assert/strict';
import { AnthropicAdapter, anthropicContextWindowTokens } from './anthropic-adapter';

assert.equal(anthropicContextWindowTokens('claude-opus-5-5'), 1_000_000);
assert.equal(anthropicContextWindowTokens('claude-haiku-4-5-20251001'), 200_000);

const proto: any = (AnthropicAdapter as any).prototype;
const recovery = '[GATEWAY RESTART RECOVERY]\nYou are resuming YOUR OWN turn. PR #999 merged.\n[/GATEWAY RESTART RECOVERY]';
const system = `[SOUL]\nsoul\n\n[USER]\nuser\n\n${'x'.repeat(80_000)}\n\n${recovery}`;

// ~190k-token chat on Opus 5.5 (1M window): system must be kept whole.
const body190k = ' '.repeat(190_000 * 3.5);
assert.equal(proto.trimSystemForBudget.call({}, system, body190k, 'claude-opus-5-5'), system, 'Opus 5.5 must not trim at 190k tokens');

// Same body on a 200k model: system is trimmed hard, but the recovery block survives.
const trimmed = proto.trimSystemForBudget.call({}, system, body190k, 'claude-haiku-4-5');
assert.ok(trimmed.includes('PR #999 merged'), 'restart recovery block must survive truncation');

// Body alone over budget: still keep the recovery block.
const huge = proto.trimSystemForBudget.call({}, system, ' '.repeat(4_000_000), 'claude-opus-5-5');
assert.ok(huge.includes('[GATEWAY RESTART RECOVERY]'), 'recovery block kept even when budget is negative');

console.log('anthropic system budget regression passed');
