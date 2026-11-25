import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Regression: a background worker (background_ops spawn, background_<id>
// session) must not reach set_current_model, switch_model, update_heartbeat or
// background_ops through a saved composite. Composite steps run through
// executeTool (platform-executor ctxExecuteToolBridge), not the turn loop's
// dispatch check, so the refusal lives in executeTool. A main-chat or standalone
// subagent session running the same composite is not refused.

let finished = false;
process.on('beforeExit', () => {
  // A pending await (for example an approval card) must not pass silently.
  if (!finished) {
    console.error('background-worker-composite-refusal: exited before finishing');
    process.exitCode = 1;
  }
});

async function main() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'prometheus-worker-composite-'));
  const previousDataDir = process.env.PROMETHEUS_DATA_DIR;
  process.env.PROMETHEUS_DATA_DIR = tempRoot;
  try {
    const { saveComposite, executeCompositeDetailed } = await import('../tools/composite-tools.js');
    const { executeTool, setToolExecutionOverrideForTesting } = await import('../agents-runtime/subagent-executor.js');
    const { registerBackgroundSpawnWorkerSession } = await import('../chat/tool-dispatch-policy.js');

    // Production wiring this test mirrors: composite steps re-enter executeTool
    // with the caller's session id.
    const platformSource = fs.readFileSync(path.join(__dirname, '..', 'agents-runtime', 'capabilities', 'platform-executor.ts'), 'utf8');
    assert.match(platformSource, /handleCompositeTool\(name, args, ctxExecuteToolBridge\(workspacePath, deps, sessionId\)/);
    assert.match(platformSource, /executeTool\(toolName, toolArgs, workspacePath, deps, sessionId\)/);

    const stripped: Array<{ tool: string; args: Record<string, any> }> = [
      { tool: 'set_current_model', args: { model: 'openai/gpt-test' } },
      { tool: 'switch_model', args: { tier: 'low', reason: 'probe' } },
      { tool: 'update_heartbeat', args: { enabled: false } },
      { tool: 'background_ops', args: { action: 'spawn', prompt: 'placeholder' } },
      { tool: 'background_spawn', args: { prompt: 'placeholder' } },
    ];
    for (const step of stripped) {
      saveComposite({
        name: `worker_probe_${step.tool}`,
        description: `Probe ${step.tool}.`,
        parameters: {},
        steps: [{ id: 'only', tool: step.tool, args: step.args }],
      });
    }
    // Nested: a composite whose step is another composite that calls a stripped tool.
    saveComposite({
      name: 'worker_probe_nested',
      description: 'Probe nested composites.',
      parameters: {},
      steps: [{ id: 'inner', tool: 'worker_probe_set_current_model', args: {} }],
    });

    // Real tools are stubbed. Composite names run the composite engine with the
    // same executeTool bridge platform-executor uses (the approval card in front
    // of a saved composite is not under test here).
    const reached: string[] = [];
    setToolExecutionOverrideForTesting(async (name: string, args: any, sessionId: string) => {
      if (name.startsWith('worker_probe_')) {
        const bridge = (toolName: string, toolArgs: any) => executeTool(toolName, toolArgs, tempRoot, {} as any, sessionId);
        const run = await executeCompositeDetailed(name, args || {}, bridge, tempRoot, {}, sessionId);
        return { name, args, result: run.result, error: run.error };
      }
      reached.push(name);
      return { name, args, result: `STUB_OK ${name}`, error: false };
    });

    const run = (name: string, sessionId: string) => executeTool(name, {}, tempRoot, {} as any, sessionId);
    const WORKER = 'background_bg_probe';
    const MAIN = 'main_chat_probe';
    const SUBAGENT = 'subagent_researcher_1732500000000';
    // A configured session key that merely looks like a worker (webhook sessionKey).
    const LOOKALIKE = 'background_custom';
    // startBackgroundExecution registers the session when a worker round starts.
    registerBackgroundSpawnWorkerSession(WORKER);

    for (const step of stripped) {
      reached.length = 0;
      const refused = await run(`worker_probe_${step.tool}`, WORKER);
      assert.equal(refused.error, true);
      assert.match(String(refused.result), /not available to background workers/, `worker composite step ${step.tool} must be refused`);
      assert.match(String(refused.result), new RegExp(`${step.tool} was not run`));
      assert.deepEqual(reached, [], `${step.tool} must not execute for a worker`);

      reached.length = 0;
      const allowed = await run(`worker_probe_${step.tool}`, MAIN);
      assert.doesNotMatch(String(allowed.result), /not available to background workers/, `main chat composite step ${step.tool} is not refused`);
      assert.deepEqual(reached, [step.tool]);

      reached.length = 0;
      const subagent = await run(`worker_probe_${step.tool}`, SUBAGENT);
      assert.doesNotMatch(String(subagent.result), /not available to background workers/, `standalone subagent composite step ${step.tool} is not refused`);
      assert.deepEqual(reached, [step.tool]);

      reached.length = 0;
      const lookalike = await run(`worker_probe_${step.tool}`, LOOKALIKE);
      assert.doesNotMatch(String(lookalike.result), /not available to background workers/, `background_custom composite step ${step.tool} is not refused`);
      assert.deepEqual(reached, [step.tool]);
    }

    reached.length = 0;
    const nested = await run('worker_probe_nested', WORKER);
    assert.match(String(nested.result), /set_current_model was not run/, 'nested composite step must be refused for a worker');
    assert.deepEqual(reached, []);
    reached.length = 0;
    await run('worker_probe_nested', MAIN);
    assert.deepEqual(reached, ['set_current_model'], 'nested composite runs for main chat');

    // Direct executeTool calls (the path the turn loop uses).
    for (const name of ['set_current_model', 'switch_model', 'update_heartbeat', 'background_ops', 'background_follow_up']) {
      reached.length = 0;
      const direct = await executeTool(name, { action: 'spawn' }, tempRoot, {} as any, WORKER);
      assert.equal(direct.error, true);
      assert.match(String(direct.result), /not available to background workers/);
      assert.deepEqual(reached, []);
    }
    for (const name of ['set_current_model', 'switch_model', 'update_heartbeat', 'background_ops']) {
      reached.length = 0;
      await executeTool(name, {}, tempRoot, {} as any, LOOKALIKE);
      assert.deepEqual(reached, [name], `background_custom may run ${name}`);
    }
    for (const name of ['write_note', 'bg_plan_declare', 'bg_plan_advance']) {
      reached.length = 0;
      await executeTool(name, {}, tempRoot, {} as any, WORKER);
      assert.deepEqual(reached, [name], `worker may still run ${name}`);
    }

    setToolExecutionOverrideForTesting(null);
    finished = true;
    console.log('background-worker-composite-refusal regression: ok');
  } finally {
    if (previousDataDir === undefined) delete process.env.PROMETHEUS_DATA_DIR;
    else process.env.PROMETHEUS_DATA_DIR = previousDataDir;
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

main().then(() => process.exit(0)).catch((err) => {
  console.error(err);
  process.exit(1);
});
