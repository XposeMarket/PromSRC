import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildContextWindowPressure } from './context-window-pressure';
import { getCompactionRequestPressure, recordCompactionRequestPressure } from './compaction-pressure';
import { withCompactionDeadline } from './compaction-deadline';
import { runCompactionTransaction } from './compaction-safety';

async function main(): Promise<void> {
  const route = { providerId: 'openai_codex', model: 'gpt-6-astra', contextWindowTokens: 272000, inputBudgetTokens: 236144, compactionTriggerTokens: 236144 };
  const session = { history: [{}], contextStartIndex: 0, contextTokenEstimate: 195000, latestContextSummary: '' };
  const pressureInput = { ...route, contextTokenEstimate: 195000, compactionThreshold: 'auto' };
  recordCompactionRequestPressure('incident', session, route, 236553, 100);
  const request = getCompactionRequestPressure('incident', session, route, 101);
  const pressure = buildContextWindowPressure({ ...pressureInput, assembledRequestTokens: request });
  assert.equal(pressure.pressureTokens, 236553);
  assert.equal(pressure.atOrPastCompactionTrigger, true);
  assert.equal(pressure.compactionTriggerTokens, 236144);
  assert.equal(buildContextWindowPressure(pressureInput).atOrPastCompactionTrigger, false);
  assert.equal(buildContextWindowPressure({ ...pressureInput, assembledRequestTokens: 236553, calibrationFactor: 1.1 }).pressureTokens, 236553, 'assembled estimate must not be calibrated twice');
  assert.equal(buildContextWindowPressure({ ...pressureInput, assembledRequestTokens: NaN }).pressureTokens, 195000);
  assert.equal(buildContextWindowPressure({ ...pressureInput, compactionThreshold: 0.7, compactionThresholdMode: 'manual' }).compactionTriggerTokens, 190400);
  assert.equal(getCompactionRequestPressure('other-session', session, route, 101), undefined);
  for (const changed of [
    { ...session, history: [{}, {}] }, { ...session, contextStartIndex: 1 },
    { ...session, contextTokenEstimate: 1234 }, { ...session, latestContextSummary: 'new' },
  ]) {
    recordCompactionRequestPressure('revision', session, route, 236553, 100);
    assert.equal(getCompactionRequestPressure('revision', changed, route, 101), undefined);
  }
  for (const changed of [{ ...route, model: 'other' }, { ...route, contextWindowTokens: 872000 }, { ...route, compactionTriggerTokens: 190400 }]) {
    recordCompactionRequestPressure('route', session, route, 236553, 100);
    assert.equal(getCompactionRequestPressure('route', session, changed, 101), undefined);
  }
  assert.equal(getCompactionRequestPressure('incident', session, route, 1800101), undefined);
  for (let i = 0; i < 257; i++) recordCompactionRequestPressure(`bounded-${i}`, session, route, i);
  assert.equal(getCompactionRequestPressure('bounded-0', session, route), undefined);
  assert.equal(await withCompactionDeadline(async () => 'summary', undefined, 100), 'summary');
  let timedOutSignal: AbortSignal | undefined;
  await assert.rejects(withCompactionDeadline(async signal => {
    timedOutSignal = signal;
    return new Promise<never>(() => {});
  }, undefined, 5), /deadline/);
  assert.equal(timedOutSignal?.aborted, true);
  const parent = new AbortController();
  let cancellationSignal: AbortSignal | undefined;
  const pending = withCompactionDeadline(async signal => {
    cancellationSignal = signal;
    return new Promise<never>(() => {});
  }, parent.signal, 1000);
  parent.abort();
  await assert.rejects(pending, /cancelled/);
  assert.equal(cancellationSignal?.aborted, true);
  let started = false;
  await assert.rejects(withCompactionDeadline(async () => { started = true; return ''; }, parent.signal), /cancelled/);
  assert.equal(started, false);
  let lateCommit = false;
  let lateResponse: (text: string) => void = () => {};
  let lateTransaction: Promise<unknown> | undefined;
  await assert.rejects(withCompactionDeadline(signal => {
    lateTransaction = runCompactionTransaction({
      messages: ['original conversation'], previousSummary: '', maxWords: 100,
      numCtx: 8192, numPredict: 1000, renderPrompt: () => 'summarize',
      summarize: () => new Promise<string>(resolve => { lateResponse = resolve; }),
      isAborted: () => signal.aborted,
      commit: () => { lateCommit = true; },
    });
    return lateTransaction;
  }, undefined, 5), /deadline/);
  lateResponse('late provider response');
  await lateTransaction;
  assert.equal(lateCommit, false, 'a late provider must not retire original history');
  // Real callsite guards: summary effort explicit, deadline signal checked before
  // transactional commit, both pressure producer and consumer wired to helpers.
  const pipeline = fs.readFileSync(path.join(__dirname, '../routes/chat/pipeline/compaction.ts'), 'utf8');
  assert.match(pipeline, /think: 'low'/);
  assert.match(pipeline, /abortSignal: signal/);
  assert.match(pipeline, /isAborted: \(\) => signal\.aborted/);
  assert.match(pipeline, /recordCompactionRequestPressure\(input.sessionId/);
  assert.match(fs.readFileSync(path.join(__dirname, '../routes/context-window-pressure.router.ts'), 'utf8'), /assembledRequestTokens,/);
  console.log('PASS compaction pressure: incident, auto/manual, calibration, isolation/revisions, eviction, cancellation/deadline and integration wiring');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
