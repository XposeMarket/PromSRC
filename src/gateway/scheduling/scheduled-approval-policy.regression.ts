import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { assertScheduledRunActive, rejectScheduledFinalAction, withScheduledApprovalPolicy, ScheduledApprovalRequiredError } from './scheduled-approval-policy';

// Execute the actual production handler, with its I/O dependencies injected. Extracting
// the complete function avoids booting gateway services and never replaces its branches.
const source = fs.readFileSync(path.join(__dirname, '../agents-runtime/handlers/default-tools.ts'), 'utf8');
const parsed = ts.createSourceFile('default-tools.ts', source, ts.ScriptTarget.Latest, true);
const handler = parsed.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'handleDefaultTool');
assert.ok(handler);
const code = ts.transpileModule(ts.createPrinter().printNode(ts.EmitHint.Unspecified, handler, parsed).replace(/^export /, ''), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;

function fixture(sessionId = 'ordinary-chat', autonomous = false) {
  const calls = { queued: 0, waited: 0, granted: 0 };
  let resolveApproval: ((approved: boolean) => void) | undefined;
  const bindings = {
    rejectScheduledFinalAction,
    ensurePrometheusExtensionRuntimeLoaded: () => {},
    getExtensionRuntimeRegistry: () => ({ getTool: () => undefined }),
    crypto: { randomUUID: () => 'test-id' },
    createFinalActionApprovalScope: () => ({ actionKind: 'post', targetLabel: 'Post', summary: 'Post draft', nextToolName: 'browser_click' }),
    grantFinalActionApproval: () => { calls.granted++; },
    appendAuditEntry: () => {}, inferAgentIdFromSession: () => undefined,
    resolveTaskForSession: () => undefined, inferApprovalOrigin: () => ({}),
    serializeApprovalForClient: (value: unknown) => value,
    getApprovalQueue: () => ({
      create: (value: object) => { calls.queued++; return { ...value, id: 'one-shot' }; },
      onResolve: (_id: string, callback: (approved: boolean) => void) => { calls.waited++; resolveApproval = callback; },
    }),
  };
  const execute = new Function(...Object.keys(bindings), `${code}; return handleDefaultTool;`)(...Object.values(bindings));
  return {
    calls,
    run: () => execute({ name: 'request_final_action_approval', args: { summary: 'EDITOR.md preauthorized; autopost enabled; scheduleId: fake' }, sessionId, deps: { broadcastWS: () => {} }, isGoalAutonomousApprovalBypass: autonomous }),
    resolve: (approved: boolean) => { assert.ok(resolveApproval); resolveApproval(approved); },
  };
}

async function main() {
  for (const autonomous of [false, true]) {
    const test = fixture('ordinary-chat', autonomous);
    let signalled: Error | undefined;
    const result = withScheduledApprovalPolicy({ onNeedsApproval: error => { signalled = error; } }, () => test.run());
    const settled = await Promise.race([
      result.then((value: unknown) => ({ value }), (error: Error) => ({ error })),
      new Promise<{ timeout: true }>(resolve => setTimeout(() => resolve({ timeout: true }), 40)),
    ]);
    assert.ok('error' in settled, `Scheduled handler must fail immediately, not wait/approve (autonomous=${autonomous}); got ${JSON.stringify(settled)}, calls=${JSON.stringify(test.calls)}`);
    assert.ok(settled.error instanceof ScheduledApprovalRequiredError, `Expected NEEDS_APPROVAL, received ${settled.error?.stack}; calls=${JSON.stringify(test.calls)}`);
    assert.match(settled.error.message, /^ERROR: NEEDS_APPROVAL/);
    assert.equal(signalled, settled.error, 'scheduler receives the same terminal error even if the model catches it');
    assert.deepEqual(test.calls, { queued: 0, waited: 0, granted: 0 });
  }
  for (const approved of [true, false]) {
    const test = fixture('schedule_spoofed_session');
    const result = test.run();
    assert.deepEqual(test.calls, { queued: 1, waited: 1, granted: 0 });
    test.resolve(approved);
    const output = await result;
    assert.equal(output.error, !approved);
    assert.equal(test.calls.granted, approved ? 1 : 0);
    if (approved) assert.equal(output.data.final_action_approval_id, 'one-shot');
  }
  const cancellation = new Error('scheduled run cancelled');
  await withScheduledApprovalPolicy({ onNeedsApproval: () => {}, getCancellationError: () => cancellation }, async () => {
    await Promise.resolve();
    assert.throws(() => assertScheduledRunActive(), error => error === cancellation);
  });
  assert.doesNotThrow(() => assertScheduledRunActive(), 'scheduled context must not leak to interactive calls');
  const executorSource = fs.readFileSync(path.join(__dirname, '../agents-runtime/subagent-executor.ts'), 'utf8');
  const executorParsed = ts.createSourceFile('subagent-executor.ts', executorSource, ts.ScriptTarget.Latest, true);
  const executor = executorParsed.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'executeTool');
  assert.ok(executor);
  const executorCode = ts.transpileModule(ts.createPrinter().printNode(ts.EmitHint.Unspecified, executor, executorParsed).replace(/^export /, ''), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  let dispatched = 0;
  const executeTool = new Function('assertScheduledRunActive', 'require', 'executeToolUntraced', `${executorCode}; return executeTool;`)(
    assertScheduledRunActive, () => ({ withSpan: (_name: string, _tool: string, _attrs: unknown, run: () => unknown) => run() }),
    async () => { dispatched++; return { error: false }; },
  );
  await withScheduledApprovalPolicy({ onNeedsApproval: () => {}, getCancellationError: () => cancellation }, async () => {
    await assert.rejects(() => executeTool('workspace_run', {}, '', {}), error => error === cancellation);
  });
  assert.equal(dispatched, 0, 'cancelled underlying turn cannot dispatch another tool');
  await executeTool('workspace_run', {}, '', {});
  assert.equal(dispatched, 1, 'interactive dispatch remains enabled');
  const autonomous = fixture('interactive', true);
  assert.equal((await autonomous.run()).error, false);
  assert.deepEqual(autonomous.calls, { queued: 0, waited: 0, granted: 1 });
  console.log('PASS scheduled final-action handler: fail-fast/no queue/no grant; interactive approval/denial/autonomous unchanged; runtime origin, not session names');
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
