import assert from 'node:assert/strict';
import { createDeterministicBaselineReport, enumerateDeterministicBaseline, formatDeterministicBaselineReport } from './deterministic-baseline.mjs';
const cases = [['alpha', 'tsx', 'src/alpha.regression.ts'], ['beta', 'tsx', 'src/beta.regression.ts']];
assert.deepEqual(enumerateDeterministicBaseline(cases), [{ label: 'alpha', kind: 'tsx', path: 'src/alpha.regression.ts' }, { label: 'beta', kind: 'tsx', path: 'src/beta.regression.ts' }]);
const report = createDeterministicBaselineReport({ mode: 'deterministic_no_llm', cases, caseResults: [{ status: 0 }, { status: 3, error: new Error('intentional failure') }] });
assert.deepEqual(report, { schemaVersion: 1, kind: 'deterministic-regression-baseline', mode: 'deterministic_no_llm', total: 2, passed: 1, failed: 1, cases: [{ label: 'alpha', kind: 'tsx', path: 'src/alpha.regression.ts', status: 'passed' }, { label: 'beta', kind: 'tsx', path: 'src/beta.regression.ts', status: 'failed', exitCode: 3, signal: null, error: 'intentional failure' }] });
const line = formatDeterministicBaselineReport(report); assert.match(line, /^DETERMINISTIC_BASELINE=/); assert.deepEqual(JSON.parse(line.slice('DETERMINISTIC_BASELINE='.length)), report); console.log('deterministic baseline harness regression passed');
