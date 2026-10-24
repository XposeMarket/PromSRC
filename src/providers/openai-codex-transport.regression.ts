import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { saveTokens } from '../auth/openai-oauth';
import { CodexIncompleteStreamError, OpenAICodexAdapter } from './openai-codex-adapter';

function erroringResponse(err: unknown, chunks: string[] = []): Response {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
    },
    pull(controller) {
      controller.error(err);
    },
  }), {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

// The exact shape Node's fetch produces when the socket closes mid-body.
function socketTerminated(): TypeError {
  const err = new TypeError('terminated');
  (err as any).cause = Object.assign(new Error('other side closed'), { code: 'UND_ERR_SOCKET' });
  return err;
}

function completedResponse(text: string): Response {
  const event = JSON.stringify({
    type: 'response.completed',
    response: { output: [{ type: 'message', content: [{ type: 'output_text', text }] }], usage: { input_tokens: 3, output_tokens: 2 } },
  });
  return new Response(`data: ${event}\n\n`, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

async function parse(response: Response, options?: any) {
  const adapter = new OpenAICodexAdapter(process.cwd());
  return (adapter as any).parseSSEStream(response, 'gpt-5.6-sol', options);
}

// Runs chat() against a scripted fetch: each call receives its 1-based attempt number.
async function chatWithFetch(script: (attempt: number) => Response, controller?: AbortController): Promise<{ calls: number; result?: any; error?: unknown }> {
  const authDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-codex-transport-'));
  const originalFetch = globalThis.fetch;
  let calls = 0;
  try {
    saveTokens(authDir, { access_token: 'test-access-token', refresh_token: 'test-refresh-token', expires_at: Date.now() + 3_600_000 });
    globalThis.fetch = (async () => {
      calls += 1;
      return script(calls);
    }) as typeof fetch;
    const adapter = new OpenAICodexAdapter({ configDir: authDir });
    try {
      const result = await adapter.chat([{ role: 'user', content: 'hi' }] as any, 'gpt-5.6-sol', controller ? { abortSignal: controller.signal } as any : {});
      return { calls, result };
    } catch (error) {
      return { calls, error };
    }
  } finally {
    globalThis.fetch = originalFetch;
    fs.rmSync(authDir, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  // Reader-level classification.
  await assert.rejects(
    () => parse(erroringResponse(socketTerminated())),
    (error: unknown) => error instanceof CodexIncompleteStreamError,
    'UND_ERR_SOCKET reader termination must classify as a retryable incomplete stream',
  );
  await assert.rejects(
    () => parse(erroringResponse(new Error('boom'))),
    (error: unknown) => error instanceof Error && !(error instanceof CodexIncompleteStreamError) && error.message === 'boom',
    'nontransport reader errors must propagate unchanged and must not be retried',
  );

  // Success regression: first attempt dies with a socket termination, retry completes; only final text returned.
  const retried = await chatWithFetch((n) => (n === 1
    ? erroringResponse(socketTerminated(), ['data: {"type":"response.output_text.delta","delta":"partial"}\n\n'])
    : completedResponse('Final answer.')));
  assert.equal(retried.calls, 2, 'a transient socket termination must be retried exactly once');
  assert.equal(retried.result?.message?.content, 'Final answer.', 'the retry must return only the final response');

  // Repeated failure: both attempts terminate; the caller gets a truthful incomplete-stream error after exactly two requests.
  const repeated = await chatWithFetch(() => erroringResponse(socketTerminated()));
  assert.equal(repeated.calls, 2, 'repeated transport failure must stop after the single retry');
  assert.ok(repeated.error instanceof CodexIncompleteStreamError, 'repeated failure must surface as CodexIncompleteStreamError');

  // Partial tool fragments: a function_call started on the failed attempt must never appear in the successful result.
  const toolFragment = 'data: {"type":"response.output_item.added","output_index":0,"item":{"type":"function_call","call_id":"stale_call","name":"stale_tool","arguments":""}}\n\n'
    + 'data: {"type":"response.function_call_arguments.delta","output_index":0,"delta":"{\\"x\\":"}\n\n';
  const toolRetry = await chatWithFetch((n) => (n === 1
    ? erroringResponse(socketTerminated(), [toolFragment])
    : completedResponse('Clean final.')));
  assert.equal(toolRetry.calls, 2, 'the tool-fragment attempt must be retried once');
  assert.equal(toolRetry.result?.message?.content, 'Clean final.');
  assert.ok(!JSON.stringify(toolRetry.result).includes('stale_tool'), 'partial tool fragments from the failed attempt must not be returned');

  // Aborted signal: a TypeError 'terminated' raised after abort must not be retried.
  const aborter = new AbortController();
  const aborted = await chatWithFetch((n) => {
    if (n === 1) aborter.abort();
    return erroringResponse(new TypeError('terminated'));
  }, aborter);
  assert.equal(aborted.calls, 1, 'an aborted request must not be retried, even for a terminated TypeError');
  assert.ok(!(aborted.error instanceof CodexIncompleteStreamError), 'an aborted request must not be reclassified as a retryable stream failure');

  console.log('openai-codex transport regression: ok');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
