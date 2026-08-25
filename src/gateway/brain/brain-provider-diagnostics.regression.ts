import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

async function main(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-brain-provider-diagnostics-'));
  const workspace = path.join(root, 'workspace');
  const previousDataDir = process.env.PROMETHEUS_DATA_DIR;
  const previousWorkspaceDir = process.env.PROMETHEUS_WORKSPACE_DIR;
  process.env.PROMETHEUS_DATA_DIR = root;
  process.env.PROMETHEUS_WORKSPACE_DIR = workspace;

  try {
    const diagnostics = await import('./brain-provider-diagnostics');
    const makeFailedRun = (runId: string) => {
      const context = diagnostics.createBrainProviderDiagnosticsContext({
        job: 'thought',
        runId,
        date: '2099-12-31',
        sessionId: `brain_thought_${runId}`,
        startedAt: Date.now() - 250,
      });
      diagnostics.captureBrainProviderEvent(context, {
        type: 'provider_event',
        nativeType: 'codex_incomplete_stream',
        provider: 'openai_codex',
        model: 'gpt-5.6-sol',
        data: {
          failureClass: 'empty_completion',
          sawCompleted: true,
          outputItemTypes: [],
          outputItemCount: 0,
          finalTextChars: 0,
          toolCallCount: 0,
          attempt: 2,
          retrying: false,
          durationMs: 250,
          rawResponse: 'secret prompt should not be stored',
        },
      });
      return diagnostics.finishBrainProviderDiagnostics(context, {
        outcome: 'failed',
        error: 'response.completed contained no assistant text or tool calls',
        toolCount: 3,
        resultTextChars: 0,
      });
    };

    makeFailedRun('thought-empty-1');
    makeFailedRun('thought-empty-2');
    const records = diagnostics.readBrainProviderDiagnosticRecords();
    assert.equal(records.filter((record) => record.kind === 'run_summary').length, 2);
    assert.equal(records.filter((record) => record.kind === 'provider_event').length, 2);
    assert.equal(JSON.stringify(records).includes('secret prompt'), false, 'provider diagnostics must not persist raw response/prompt payloads');

    const paused = diagnostics.shouldDeferAutomaticBrainJob('thought');
    assert.equal(paused.defer, true, 'repeated empty completions must pause automatic Thought runs');
    assert.equal(paused.provider, 'openai_codex');
    assert.equal(paused.model, 'gpt-5.6-sol');
    assert.equal(paused.consecutiveFailures, 2);

    const recovered = diagnostics.createBrainProviderDiagnosticsContext({
      job: 'thought',
      runId: 'thought-success-1',
      date: '2099-12-31',
      sessionId: 'brain_thought_success',
      startedAt: Date.now() - 100,
    });
    diagnostics.captureBrainProviderEvent(recovered, {
      type: 'provider_event',
      nativeType: 'response.completed',
      provider: 'openai_codex',
      model: 'gpt-5.6-sol',
      data: {
        sawCompleted: true,
        outputItemTypes: ['message'],
        outputItemCount: 1,
        finalTextChars: 42,
        toolCallCount: 0,
      },
    });
    diagnostics.finishBrainProviderDiagnostics(recovered, { outcome: 'success', resultTextChars: 42 });
    assert.equal(diagnostics.shouldDeferAutomaticBrainJob('thought').defer, false, 'a successful provider run must clear the consecutive-failure guard');

    console.log('brain provider diagnostics regression passed');
  } finally {
    if (previousDataDir === undefined) delete process.env.PROMETHEUS_DATA_DIR;
    else process.env.PROMETHEUS_DATA_DIR = previousDataDir;
    if (previousWorkspaceDir === undefined) delete process.env.PROMETHEUS_WORKSPACE_DIR;
    else process.env.PROMETHEUS_WORKSPACE_DIR = previousWorkspaceDir;
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
