// Spawn rows read "Spawned <Model · Reasoning>: <prompt>" with the provider
// logo, and several spawns summarize as "Spawned N agents" (IMG 2, 2026-10-04).
import assert from 'node:assert/strict';
import { toolActivitySummary, applyToolActivityEvent, renderToolActivityEntry, coalesceToolActivityEntries } from '../web-ui/src/tool-activity.js';
import { agentAvatarHtml, agentModelLabel, providerLogoKey } from '../web-ui/src/components/provider-logo.js';

const entries = [];
const spawns = [
  ['c1', 'anthropic/claude-opus-5-5', 'medium', 'Review the browser report'],
  ['c2', 'openai_codex/gpt-6-sol', 'high', 'Check edge cases'],
];
for (const [callId, model, reasoning_effort, prompt] of spawns) {
  const args = { action: 'spawn', model, reasoning_effort, prompt };
  applyToolActivityEvent(entries, 'call', { action: 'background_ops', callId, args });
  applyToolActivityEvent(entries, 'result', { action: 'background_ops', callId, args, result: '{}' });
}
assert.equal(toolActivitySummary(entries), 'Spawned 2 agents');
const rows = coalesceToolActivityEntries(entries).map((entry) => renderToolActivityEntry(entry));
assert.equal(rows.length, 2);
assert.match(rows[0], /data-provider="anthropic"/);
assert.match(rows[1], /data-provider="openai"/);
assert.match(rows[0], /Spawned [^<]*Opus[^<]*: Review the browser report/);
assert.match(rows[1], /Spawned [^<]*Sol[^<]*: Check edge cases/);
assert.doesNotMatch(rows.join(''), /background agent/i);

// Default-routed spawn: model comes from the result payload.
const fromResult = [];
applyToolActivityEvent(fromResult, 'call', { action: 'background_ops', callId: 'c3', args: { action: 'spawn', prompt: 'Scan repo' } });
applyToolActivityEvent(fromResult, 'result', { action: 'background_ops', callId: 'c3', args: { action: 'spawn', prompt: 'Scan repo' }, result: JSON.stringify({ model: 'gpt-6-sol', providerId: 'openai_codex', reasoningEffort: 'high' }) });
const resultRow = renderToolActivityEntry(coalesceToolActivityEntries(fromResult)[0]);
assert.match(resultRow, /data-provider="openai"/);
assert.match(resultRow, /Sol[^<]*: Scan repo/);

assert.equal(providerLogoKey('', 'claude-opus-5-5'), 'anthropic');
assert.equal(providerLogoKey('xai', 'grok-4.7'), 'xai');
assert.match(agentAvatarHtml({ providerId: 'anthropic', model: 'claude-opus-5-5' }, 'Hera'), /<svg/);
assert.equal(agentAvatarHtml({}, 'Hera'), 'HE');
assert.ok(agentModelLabel({ providerId: 'openai_codex', model: 'gpt-6-sol', reasoningEffort: 'high' }).length > 0);
assert.equal(agentModelLabel({}), '');
console.log('agent spawn identity:', rows.map((row) => (row.match(/tool-activity-label">([^<]*)/) || [])[1]).join(' | '));
