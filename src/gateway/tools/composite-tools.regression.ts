import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

async function main() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'prometheus-composite-regression-'));
  const previousDataDir = process.env.PROMETHEUS_DATA_DIR;
  process.env.PROMETHEUS_DATA_DIR = tempRoot;

  try {
    const {
      saveComposite,
      loadComposites,
      getCompositeDefs,
      executeCompositeDetailed,
    } = await import('./composite-tools.js');

    saveComposite({
      name: 'post_to_x_browser',
      description: 'Post text to X through a deterministic browser workflow.',
      parameters: {
        text: { type: 'string', description: 'Post body.', required: true },
      },
      steps: [
        {
          id: 'open',
          tool: 'browser_open',
          args: { url: 'https://x.com/compose/post' },
          assert: { result_contains: 'composer_ref' },
        },
        {
          id: 'focus',
          tool: 'browser_act',
          args: { action: 'click', ref: '{{steps.open.parsed.composer_ref}}' },
          assert: { result_contains: 'focused' },
        },
        {
          id: 'type',
          tool: 'browser_act',
          args: { action: 'type', ref: '{{steps.open.parsed.composer_ref}}', text: '{{text}}' },
          assert: { result_contains: 'typed' },
        },
        {
          id: 'send',
          tool: 'browser_act',
          args: { action: 'click', ref: 'post-button' },
          assert: { result_contains: 'posted' },
        },
      ],
    });

    assert.equal(loadComposites().has('post_to_x_browser'), true);
    assert.equal(getCompositeDefs().some((tool: any) => tool?.function?.name === 'post_to_x_browser'), true);

    const calls: Array<{ name: string; args: any }> = [];
    const fakeExecute = async (name: string, args: any) => {
      calls.push({ name, args });
      if (name === 'browser_open') {
        return { result: JSON.stringify({ composer_ref: 'composer-42' }), error: false };
      }
      if (args.action === 'type') {
        return { result: `typed:${args.text}`, error: false };
      }
      if (args.ref === 'post-button') {
        return { result: 'posted:https://x.com/example/status/1', error: false };
      }
      return { result: `focused:${args.ref}`, error: false };
    };

    const result = await executeCompositeDetailed(
      'post_to_x_browser',
      { text: 'hello from a composite' },
      fakeExecute,
    );

    assert.equal(result.error, false);
    assert.equal(calls.length, 4, 'one composite invocation should execute the full workflow without model turns between steps');
    assert.deepEqual(calls.map((call) => call.name), ['browser_open', 'browser_act', 'browser_act', 'browser_act']);
    assert.equal(calls[1].args.ref, 'composer-42', 'later steps should consume parsed state from prior tool results');
    assert.equal(calls[2].args.text, 'hello from a composite', 'call-time params should template into underlying tool args');
    assert.match(result.result, /posted:https:\/\/x\.com\/example\/status\/1/);

    let invoked = false;
    const missing = await executeCompositeDetailed(
      'post_to_x_browser',
      {},
      async () => {
        invoked = true;
        return { result: 'should not run', error: false };
      },
    );
    assert.equal(missing.error, true);
    assert.match(missing.result, /Missing required parameter\(s\): text/);
    assert.equal(invoked, false, 'missing required params must fail before workflow execution');

    console.log('[composite-tools.regression] deterministic multi-tool workflow execution and state templating passed');
  } finally {
    if (previousDataDir === undefined) delete process.env.PROMETHEUS_DATA_DIR;
    else process.env.PROMETHEUS_DATA_DIR = previousDataDir;
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
