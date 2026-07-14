import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const moduleUrl = pathToFileURL(path.join(root, 'dist', 'providers', 'provider-usage-limits.js')).href;
// This module normally loads inside the initialized gateway. A standalone test
// import can make the extension scanner report its expected config-cycle warning;
// silence only that known bootstrap message while loading the pure exports.
const originalConsoleError = console.error;
console.error = (...args) => {
  if (String(args[0] || '').startsWith('[extensions] Failed to scan user plugins dir:')) return;
  originalConsoleError(...args);
};
const usageModule = await import(moduleUrl);
const { isCodexSparkModel, parseCodexLiveUsage, selectCodexUsageForModel } = usageModule;

const window = (used, seconds, resetAfter) => ({
  used_percent: used,
  limit_window_seconds: seconds,
  reset_after_seconds: resetAfter,
});

const live = parseCodexLiveUsage({
  plan_type: 'pro',
  rate_limit: {
    primary_window: window(21, 18_000, 900),
    secondary_window: window(34, 604_800, 86_400),
  },
  additional_rate_limits: [{
    limit_name: 'GPT-5.3-Codex-Spark',
    metered_feature: 'codex_bengalfox',
    rate_limit: {
      primary_window: window(7, 18_000, 1200),
      secondary_window: window(11, 604_800, 172_800),
    },
  }],
});

assert.equal(live.plan_label, 'pro');
assert.equal(live.windows[0]?.used_percent, 21);
assert.equal(live.model_limits?.[0]?.id, 'codex-spark');
assert.deepEqual(live.model_limits?.[0]?.model_ids, ['gpt-5.3-codex-spark']);

const standard = selectCodexUsageForModel(live, 'gpt-5.4-codex');
assert.equal(standard.usage_scope, 'provider');
assert.equal(standard.usage_model, null);
assert.equal(standard.windows[0]?.used_percent, 21, 'non-Spark models must retain standard Codex usage');

const spark = selectCodexUsageForModel(live, 'openai_codex/gpt-5.3-codex-spark');
assert.equal(spark.usage_scope, 'model');
assert.equal(spark.usage_model, 'gpt-5.3-codex-spark');
assert.equal(spark.windows[0]?.used_percent, 7);
assert.equal(spark.windows[0]?.label, '5-hour · Spark');
assert.equal(spark.windows[1]?.label, 'Weekly · Spark');

const missing = selectCodexUsageForModel({ ...live, model_limits: [] }, 'gpt-5.3-codex-spark');
assert.equal(missing.usage_scope, 'model');
assert.deepEqual(missing.windows, []);
assert.match(missing.error || '', /not returned/i);

assert.equal(isCodexSparkModel('gpt-5.3-codex-spark'), true);
assert.equal(isCodexSparkModel('gpt-5.4-codex'), false);

console.log('Codex Spark usage parsing and active-model selection checks passed.');
