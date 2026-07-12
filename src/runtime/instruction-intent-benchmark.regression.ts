import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { INSTRUCTION_INTENT_BENCHMARK_CASES } from './instruction-intent-benchmark.fixtures';
import { detectStage4InstructionIntents, type Stage4IntentId } from './instruction-intent-detector';

const IDS: Stage4IntentId[] = ['file_edit_intent', 'command_execution_intent', 'proposal_workflow_intent', 'web_research_intent', 'business_context_intent'];

function main(): void {
  const metrics = Object.fromEntries(IDS.map((id) => [id, { tp: 0, fp: 0, tn: 0, fn: 0 }])) as Record<Stage4IntentId, { tp: number; fp: number; tn: number; fn: number }>;
  const splitMetrics: Record<string, { total: number; exact: number }> = {};
  const failures: Array<{ id: string; split: string; source: string; expected: string[]; actual: string[] }> = [];

  for (const test of INSTRUCTION_INTENT_BENCHMARK_CASES) {
    const result = detectStage4InstructionIntents({ message: test.message, recentMessages: test.history });
    const expected = new Set(test.expected);
    const actual = new Set(IDS.filter((id) => result[id]));
    for (const id of IDS) {
      const e = expected.has(id);
      const a = actual.has(id);
      if (e && a) metrics[id].tp += 1;
      else if (!e && a) metrics[id].fp += 1;
      else if (e && !a) metrics[id].fn += 1;
      else metrics[id].tn += 1;
    }
    const exact = IDS.every((id) => expected.has(id) === actual.has(id));
    const split = splitMetrics[test.split] ||= { total: 0, exact: 0 };
    split.total += 1;
    if (exact) split.exact += 1;
    else failures.push({ id: test.id, split: test.split, source: test.source, expected: [...expected].sort(), actual: [...actual].sort() });
  }

  const liveNegative = detectStage4InstructionIntents({
    message: 'Reply with exactly OK. Do not call any tools.',
    activeToolCategories: ['workspace_write'],
  });
  assert.equal(liveNegative.file_edit_intent, false, 'explicit no-tool instruction must suppress an auto-activated write category');
  assert.equal(liveNegative.command_execution_intent, false, 'explicit no-tool instruction must suppress an auto-activated command category');

  const scores = Object.fromEntries(IDS.map((id) => {
    const m = metrics[id];
    const precision = m.tp / Math.max(1, m.tp + m.fp);
    const recall = m.tp / Math.max(1, m.tp + m.fn);
    const accuracy = (m.tp + m.tn) / Math.max(1, m.tp + m.fp + m.tn + m.fn);
    return [id, { ...m, precision, recall, accuracy }];
  })) as Record<Stage4IntentId, any>;
  const splitScores = Object.fromEntries(Object.entries(splitMetrics).map(([split, value]) => [split, { ...value, exactAccuracy: value.exact / value.total }]));
  const report = {
    version: 1,
    generatedAt: new Date().toISOString(),
    cases: INSTRUCTION_INTENT_BENCHMARK_CASES.length,
    sources: Object.fromEntries(['synthetic', 'sanitized_real_typed', 'sanitized_real_voice'].map((source) => [source, INSTRUCTION_INTENT_BENCHMARK_CASES.filter((test) => test.source === source).length])),
    scores,
    splits: splitScores,
    failureCount: failures.length,
    failures,
  };
  const outputDir = path.join(process.cwd(), '.prometheus');
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, 'instruction-intent-benchmark-report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ cases: report.cases, sources: report.sources, scores, splits: splitScores, failureCount: failures.length, failureIds: failures.slice(0, 30).map((failure) => failure.id) }, null, 2));

  assert.ok(report.cases >= 500, 'benchmark must contain at least 500 cases');
  for (const id of IDS) {
    assert.ok(scores[id].precision >= 0.97, `${id}: precision below 97%`);
    assert.ok(scores[id].recall >= 0.97, `${id}: recall below 97%`);
  }
  assert.ok(splitScores.validation.exactAccuracy >= 0.95, 'validation exact-match accuracy below 95%');
  assert.ok(splitScores.holdout.exactAccuracy >= 0.95, 'holdout exact-match accuracy below 95%');
}

main();
