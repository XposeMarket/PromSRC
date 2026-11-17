// Run with npx tsx; real supervisor + actual handler body, isolated store, no gateway/model.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ts from 'typescript';
import { ProcessSupervisor } from '../src/gateway/process/supervisor.ts';
import { ProcessRunStore } from '../src/gateway/process/store.ts';
import { boundedProcessWait, processWaitBudget } from '../src/gateway/process/bounded-wait.ts';
import { classifyCommandTermination } from '../src/gateway/process/command-outcome.ts';
import { capCommandOutput } from '../src/gateway/agents-runtime/command-output-cap.ts';
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-wait-test-'));
const supervisor = new ProcessSupervisor(new ProcessRunStore(path.join(fixture, 'records')));
const source = fs.readFileSync('src/gateway/agents-runtime/handlers/misc.ts', 'utf8');
const body = source.slice(source.indexOf("      case 'process_wait': {") + "      case 'process_wait': {".length, source.indexOf("      case 'process_kill': {")).trim().replace(/}\s*$/, '');
const compiled = ts.transpile(`async function invoke(args: any, deps: any) { const name='process_wait'; ${body} }`, { target: ts.ScriptTarget.ES2022 });
const invoke = new Function('getProcessSupervisor', 'boundedProcessWait', 'processWaitBudget', 'classifyCommandTermination', 'capCommandOutput', compiled + ';return invoke;')(() => supervisor, boundedProcessWait, processWaitBudget, classifyCommandTermination, capCommandOutput);
const runs = [];
try {
  fs.writeFileSync(path.join(fixture, 'long.cjs'), 'setTimeout(()=>{console.log("final-output");process.exit(0)},32000)');
  const run = await supervisor.spawn({ command: `${process.platform === 'win32' ? '& ' : ''}"${process.execPath}" long.cjs`, cwd: fixture, mode: 'background', captureOutput: true }); runs.push(run);
  for (const native of [true, false]) {
    const controller = new AbortController(); const token = { aborted: false, ...(native ? { signal: controller.signal } : {}) };
    const started = Date.now(); const timer = setTimeout(() => { token.aborted = true; if (native) controller.abort(); }, 150);
    const result = await invoke({ runId: run.runId, timeout_ms: 300000 }, { abortSignal: token }); clearTimeout(timer);
    assert.equal(result.extra.cancelled, true); assert.ok(Date.now() - started < 2000); assert.notEqual(supervisor.get(run.runId).state, 'exited');
  }
  let progress = 0; const started = Date.now();
  const result = await invoke({ runId: run.runId, timeout_ms: 300000 }, { sendSSE: (event) => { assert.equal(event, 'tool_progress'); progress++; } });
  assert.equal(result.error, false, JSON.stringify(result)); assert.match(result.result, /final-output/); assert.ok(Date.now() - started > 30000); assert.ok(progress >= 2);
  assert.equal(result.extra.terminationReason, 'exit');
  const missing = await invoke({ runId: 'nonexistent' }, {}); assert.equal(missing.error, true);
  fs.writeFileSync(path.join(fixture, 'fail.cjs'), 'console.error("expected failure");process.exit(7)');
  const failed = await supervisor.spawn({ command: `${process.platform === 'win32' ? '& ' : ''}"${process.execPath}" fail.cjs`, cwd: fixture, mode: 'background', captureOutput: true }); runs.push(failed);
  const failedResult = await invoke({ runId: failed.runId, timeoutMs: 10000 }, {});
  assert.equal(failedResult.error, true); assert.match(failedResult.result, /expected failure/);
  console.log('PASS real >30s completion in one wait, progress, native/main-style and flag/agent-style abort without kill, missing run, nonzero exit');
} finally {
  for (const run of runs) { run.cancel(); await run.wait(); }
  fs.rmSync(fixture, { recursive: true, force: true });
}
