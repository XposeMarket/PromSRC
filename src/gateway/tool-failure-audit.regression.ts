// Regressions for the 2026-09-24 tool-failure audit (tool_audit.log 9/16-9/24).
import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { resolvePullRequestNumber } from '../extensions/bundled/connectors/github/runtime.js';
import { inferProviderForBareModel } from '../agents/model-routing.js';
import { resolveBackgroundAgentModelRouting } from './tasks/task-runner.js';
import { formatToolAuditLine } from './chat/chat-helpers.js';
import { readRawToolResultRange, resolveWorkspaceToolResultSpool } from './tool-result-envelope.js';

async function main() {
  // 1) connector_github_merge_pr / get_pr: agents send pull_number -> NaN -> GitHub 404.
  assert.equal(resolvePullRequestNumber({ pr_number: 12 }), 12);
  assert.equal(resolvePullRequestNumber({ pull_number: 433 }), 433);
  assert.equal(resolvePullRequestNumber({ pull_number: '#434' }), 434);
  assert.equal(resolvePullRequestNumber({ number: '7' }), 7);
  assert.equal(resolvePullRequestNumber({}), null);
  assert.equal(resolvePullRequestNumber({ pr_number: 0 }), null);
  assert.equal(resolvePullRequestNumber({ pr_number: 'abc' }), null);
  assert.equal(resolvePullRequestNumber({ pr_number: 1.5 }), null);

  // 2) Audit log must keep exit code + error tail for failures.
  const longCmd = `cd C:\\x; ${'Get-Thing | '.repeat(40)}`;
  const failResult = `${longCmd} [exit 1] run=run_1 cwd=.\n${'noise\n'.repeat(80)}ParserError: Unexpected token '}' in expression.`;
  const failLine = formatToolAuditLine('2026-09-24T00:00:00.000Z', 'workspace_run', { command: longCmd }, failResult, true);
  assert.ok(failLine.startsWith('[2026-09-24T00:00:00.000Z] FAIL workspace_run('));
  assert.ok(failLine.includes('[exit 1]'), 'failed line records exit code');
  assert.ok(failLine.includes('ParserError: Unexpected token'), 'failed line records error tail');
  assert.equal(failLine.split('\n').length, 2, 'one physical line per call');
  const okLine = formatToolAuditLine('t', 'read_file', { a: 1 }, 'x'.repeat(500), false);
  assert.ok(okLine.length < 260, 'successful calls stay compact');
  const circular: any = {}; circular.self = circular;
  assert.ok(formatToolAuditLine('t', 'x', circular, 'err', true).includes('FAIL x('), 'unserializable args do not throw');

  // 3) Bare model ids on spawn: infer the provider when unambiguous.
  assert.equal(inferProviderForBareModel('gpt-5.6-sol'), 'openai_codex');
  assert.equal(inferProviderForBareModel('sol'), 'openai_codex');
  assert.equal(inferProviderForBareModel('gpt-6-astra'), 'openai_codex');
  assert.equal(inferProviderForBareModel('claude-opus-5-5'), 'anthropic');
  assert.equal(inferProviderForBareModel('opus-4.8'), 'anthropic');
  assert.equal(inferProviderForBareModel('gpt-5.5'), null, 'ambiguous ids stay unqualified');
  assert.equal(inferProviderForBareModel('openai_codex/gpt-5.6-sol'), null);
  const routed = resolveBackgroundAgentModelRouting({ model: 'gpt-5.6-sol', reasoningEffort: 'medium' } as any);
  assert.equal(routed.providerId, 'openai_codex');
  assert.equal(routed.model, 'gpt-5.6-sol');
  assert.equal(routed.reasoningEffort, 'medium');

  // 4) tool_result_read accepts workspace spool paths, confined to temp/tool-results.
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-audit-'));
  try {
    const dir = path.join(ws, 'temp', 'tool-results');
    fs.mkdirSync(dir, { recursive: true });
    const name = '1790203454986-mobile_x-read_files_batch.txt';
    fs.writeFileSync(path.join(dir, name), 'A'.repeat(100) + 'TAIL');
    const range = await readRawToolResultRange({ rawRef: `temp/tool-results/${name}`, sessionId: 's', offsetBytes: 100, maxChars: 500, workspacePath: ws });
    assert.equal(range.content, 'TAIL');
    assert.equal(range.nextOffsetBytes, null);
    const abs = await readRawToolResultRange({ rawRef: path.join(dir, name), sessionId: 's', workspacePath: ws });
    assert.equal(abs.totalBytes, 104);
    assert.equal(resolveWorkspaceToolResultSpool('temp/tool-results/../../secret.txt', ws), null);
    assert.equal(resolveWorkspaceToolResultSpool('C:/elsewhere/temp/tool-results/' + name, ws), null);
    assert.equal(resolveWorkspaceToolResultSpool(`temp/tool-results/${name}`, undefined), null);
    await assert.rejects(
      () => readRawToolResultRange({ rawRef: 'tool-result-raw://mobile_x/call_0a1b2c3d4e5f6789/result.txt', sessionId: 's', workspacePath: ws }),
      /do not construct or guess/,
    );
    await assert.rejects(
      () => readRawToolResultRange({ rawRef: 'whatever.txt', sessionId: 's', workspacePath: ws }),
      /Unsupported tool-result raw reference/,
    );
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }

  console.log('tool-failure-audit regression: ok');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
