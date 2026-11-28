import assert from 'node:assert/strict';
import {
  normaliseGrokBillingWindows,
  parseAnthropicUsageWindows,
  parseCodexLiveUsage,
  selectCodexUsageForModel,
} from './provider-usage-limits';

// Claude: per-model weekly windows are labelled from Anthropic's own keys, not hard-coded to Opus.
const claudeWindows = parseAnthropicUsageWindows({
  five_hour: { utilization: 4, resets_at: '2026-11-28T17:20:00Z' },
  seven_day: { utilization: 63, resets_at: '2026-12-01T10:00:00Z' },
  seven_day_oauth_apps: { utilization: 2, resets_at: null },
  seven_day_opus: null,
  seven_day_fable: { utilization: 81, resets_at: '2026-12-01T10:00:00Z' },
  seven_day_sonnet: { utilization: 12, resets_at: null },
  extra_usage: { is_enabled: false },
});
assert.deepEqual(
  claudeWindows.map(window => [window.label, window.used_percent]),
  [['5-hour', 4], ['Weekly', 63], ['Weekly · Fable', 81], ['Weekly · Sonnet', 12]],
);
assert.deepEqual(
  parseAnthropicUsageWindows({ five_hour: { utilization: 4 }, seven_day: { utilization: 63 } }).map(window => window.label),
  ['5-hour', 'Weekly'],
  'no per-model line when Anthropic sends none',
);
assert.deepEqual(parseAnthropicUsageWindows(null), []);

const live = parseCodexLiveUsage({
  plan_type: 'Plus',
  rate_limit: {
    primary_window: { used_percent: 25, reset_after_seconds: 3600 },
  },
  additional_rate_limits: [{
    limit_name: 'Codex Spark',
    metered_feature: 'codex-spark',
    rate_limit: { primary_window: { used_percent: 40, reset_after_seconds: 7200 } },
  }],
});

const spark = selectCodexUsageForModel(live, 'gpt-5.3-codex-spark');
assert.equal(spark.usage_scope, 'provider', 'Spark must not replace the account-wide Codex limit view');
assert.deepEqual(spark.windows.map(window => window.label), ['Primary', 'Primary · Spark']);

const grokWindows = normaliseGrokBillingWindows(
  {
    config: {
      currentPeriod: {
        type: 'USAGE_PERIOD_TYPE_WEEKLY',
        start: '2026-07-27T06:15:47.161476+00:00',
        end: '2026-08-03T06:15:47.161476+00:00',
      },
      creditUsagePercent: 9,
      productUsage: [
        { product: 'Api', usagePercent: 9 },
        { product: 'GrokChat', usagePercent: 2 },
      ],
      billingPeriodStart: '2026-07-27T06:15:47.161476+00:00',
      billingPeriodEnd: '2026-08-03T06:15:47.161476+00:00',
    },
  },
  {
    config: {
      monthlyLimit: { val: 4000 },
      used: { val: 994 },
      billingPeriodEnd: '2026-08-01T00:00:00+00:00',
    },
  },
);

assert.equal(grokWindows[0]?.label, 'Weekly');
assert.equal(grokWindows[0]?.used_percent, 9);
assert.equal(grokWindows[0]?.reset_at, '2026-08-03T06:15:47.161476+00:00');
assert.ok(grokWindows.some((w) => w.label === 'Weekly · API' && w.used_percent === 9));
assert.ok(grokWindows.some((w) => w.label === 'Weekly · Grok Chat' && w.used_percent === 2));
assert.ok(grokWindows.some((w) => w.label === 'Monthly credits' && w.used === 994 && w.limit === 4000));

// Missing creditUsagePercent should still surface a weekly window from period end only when no better signal exists.
const zeroish = normaliseGrokBillingWindows({
  config: {
    currentPeriod: {
      type: 'USAGE_PERIOD_TYPE_WEEKLY',
      end: '2026-07-28T21:30:08.947082+00:00',
    },
  },
});
assert.equal(zeroish[0]?.label, 'Weekly');
assert.equal(zeroish[0]?.used_percent, 0);
assert.equal(zeroish[0]?.reset_at, '2026-07-28T21:30:08.947082+00:00');

console.log('provider usage limits regression checks passed');
