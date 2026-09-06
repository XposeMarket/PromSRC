export const DETERMINISTIC_BASELINE_SCHEMA_VERSION = 1;
export function enumerateDeterministicBaseline(cases) { return cases.map((testCase) => ({ label: testCase[0], kind: testCase[1], path: testCase[2] })); }
export function createDeterministicBaselineReport(input) {
  const outcomes = enumerateDeterministicBaseline(input.cases).map((testCase, index) => {
    const result = input.caseResults[index] || {};
    if (result.status === 0) return { label: testCase.label, kind: testCase.kind, path: testCase.path, status: 'passed' };
    const outcome = { label: testCase.label, kind: testCase.kind, path: testCase.path, status: 'failed', exitCode: result.status == null ? null : result.status, signal: result.signal == null ? null : result.signal };
    if (result.error) outcome.error = String(result.error.message || result.error);
    return outcome;
  });
  const failed = outcomes.filter((outcome) => outcome.status === 'failed');
  return { schemaVersion: DETERMINISTIC_BASELINE_SCHEMA_VERSION, kind: 'deterministic-regression-baseline', mode: input.mode, total: outcomes.length, passed: outcomes.length - failed.length, failed: failed.length, cases: outcomes };
}
export function formatDeterministicBaselineReport(report) { return 'DETERMINISTIC_BASELINE=' + JSON.stringify(report); }
