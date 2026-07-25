import assert from 'node:assert/strict';
import { parseCodexLiveUsage, selectCodexUsageForModel } from './provider-usage-limits';

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
console.log('provider usage limits regression checks passed');
