// Usage awareness must be per provider and silent above 30% left.
// A model on Anthropic must never be shown OpenAI's usage (or vice versa),
// and nothing should be injected in the normal case (keeps the prompt cache stable).
import assert from 'node:assert/strict';
// Must be set before import: the module must never touch live credentials here.
process.env.PROMETHEUS_DISABLE_USAGE_AWARENESS_REFRESH = '1';
import {
  recordAnthropicRateLimitHeaders,
  recordUsageApiSnapshot,
  formatUsageAwarenessForPrompt,
  resetUsageAwarenessForTests,
} from './usage-awareness';

resetUsageAwarenessForTests();
const now = Date.now();
const in2h = String(Math.floor((now + 2 * 3600_000) / 1000));
const in3d = String(Math.floor((now + 3 * 86400_000) / 1000));

// Healthy Anthropic plan: silent.
recordAnthropicRateLimitHeaders({
  'anthropic-ratelimit-unified-5h-utilization': '0.40',
  'anthropic-ratelimit-unified-5h-reset': in2h,
  'anthropic-ratelimit-unified-7d-utilization': '0.50',
  'anthropic-ratelimit-unified-7d-reset': in3d,
});
assert.equal(formatUsageAwarenessForPrompt('anthropic', now), '', 'above 30% left must inject nothing');

// Weekly at 78% used -> 22% left: notice tier, tightest window drives it.
recordAnthropicRateLimitHeaders({
  'anthropic-ratelimit-unified-5h-utilization': '0.40',
  'anthropic-ratelimit-unified-5h-reset': in2h,
  'anthropic-ratelimit-unified-7d-utilization': '0.78',
  'anthropic-ratelimit-unified-7d-reset': in3d,
});
const notice = formatUsageAwarenessForPrompt('anthropic', now);
assert.match(notice, /provider=anthropic/);
assert.match(notice, /Weekly 22% left/);
assert.match(notice, /Be economical/);

// OpenAI is low, but a model on Anthropic must never see it.
recordUsageApiSnapshot('openai_codex', [{ label: '5-hour', used_percent: 97, reset_at: null }]);
assert.doesNotMatch(formatUsageAwarenessForPrompt('anthropic', now), /openai/i, 'Anthropic turn must not show OpenAI usage');
const openai = formatUsageAwarenessForPrompt('openai_codex', now);
assert.match(openai, /provider=openai_codex/);
assert.match(openai, /3% left/);
assert.match(openai, /CRITICAL/);
assert.doesNotMatch(openai, /anthropic/i, 'OpenAI turn must not show Anthropic usage');

// Caution tier.
recordAnthropicRateLimitHeaders({ 'anthropic-ratelimit-unified-5h-utilization': '0.88' });
assert.match(formatUsageAwarenessForPrompt('anthropic', now), /Low: keep turns tight/);

// Unknown provider: nothing.
assert.equal(formatUsageAwarenessForPrompt('xai', now), '');

// Guard: the regression itself must not have started any live refresh.
console.log('usage-awareness regression: ok');
