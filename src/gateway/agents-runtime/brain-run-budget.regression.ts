import assert from 'node:assert/strict';
import {
  BrainRunBudget,
  DEFAULT_BRAIN_RUN_MAX_INPUT_TOKENS,
  DEFAULT_BRAIN_RUN_MAX_MODEL_CALLS,
  resolveBrainRunBudgetOptions,
} from './brain-run-budget';

const originalCalls = process.env.PROMETHEUS_BRAIN_RUN_MAX_MODEL_CALLS;
const originalTokens = process.env.PROMETHEUS_BRAIN_RUN_MAX_INPUT_TOKENS;
try {
  delete process.env.PROMETHEUS_BRAIN_RUN_MAX_MODEL_CALLS;
  delete process.env.PROMETHEUS_BRAIN_RUN_MAX_INPUT_TOKENS;
  assert.deepEqual(resolveBrainRunBudgetOptions(), {
    maxModelCalls: DEFAULT_BRAIN_RUN_MAX_MODEL_CALLS,
    maxInputTokens: DEFAULT_BRAIN_RUN_MAX_INPUT_TOKENS,
  });

  process.env.PROMETHEUS_BRAIN_RUN_MAX_MODEL_CALLS = '2';
  process.env.PROMETHEUS_BRAIN_RUN_MAX_INPUT_TOKENS = '30';
  assert.deepEqual(resolveBrainRunBudgetOptions(), { maxModelCalls: 2, maxInputTokens: 30 });

  const calls = new BrainRunBudget();
  assert.equal(calls.tryReserve([{ role: 'user', content: 'a' }]).allowed, true);
  assert.equal(calls.tryReserve([{ role: 'user', content: 'b' }]).allowed, true);
  const callLimit = calls.tryReserve([{ role: 'user', content: 'c' }]);
  assert.equal(callLimit.allowed, false);
  assert.equal(callLimit.hit, 'model_calls');
  assert.equal(callLimit.snapshot.modelCalls, 2);

  const inputs = new BrainRunBudget({ maxModelCalls: 5, maxInputTokens: 2 });
  const inputLimit = inputs.tryReserve([{ role: 'user', content: 'this input needs more than two tokens' }]);
  assert.equal(inputLimit.allowed, false);
  assert.equal(inputLimit.hit, 'input_tokens');
  assert.equal(inputLimit.snapshot.modelCalls, 0, 'rejected input must not consume a call');
  assert.equal(inputLimit.snapshot.inputTokens, 0, 'rejected input must not consume tokens');

  const reconciliation = new BrainRunBudget({ maxModelCalls: 5, maxInputTokens: 10 });
  assert.equal(reconciliation.tryReserve([{ role: 'user', content: 'x' }]).allowed, true);
  const actual = reconciliation.reconcileActualInput(12);
  assert.equal(actual.hit, 'input_tokens', 'actual provider input closes future admissions');
  assert.equal(reconciliation.tryReserve([{ role: 'user', content: 'y' }]).allowed, false);

  console.log('brain-run-budget regression passed');
} finally {
  if (originalCalls === undefined) delete process.env.PROMETHEUS_BRAIN_RUN_MAX_MODEL_CALLS;
  else process.env.PROMETHEUS_BRAIN_RUN_MAX_MODEL_CALLS = originalCalls;
  if (originalTokens === undefined) delete process.env.PROMETHEUS_BRAIN_RUN_MAX_INPUT_TOKENS;
  else process.env.PROMETHEUS_BRAIN_RUN_MAX_INPUT_TOKENS = originalTokens;
}
