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

async function parse(response: Response, options?: any) {
  const adapter = new OpenAICodexAdapter(process.cwd());
  return (adapter as any).parseSSEStream(response, 'gpt-5.6-sol', options);
}

const completedEvent = JSON.stringify({
  type: 'response.completed',
  response: {
    output: [{ type: 'message', content: [{ type: 'output_text', text: 'Final answer.' }] }],
    usage: { input_tokens: 3, output_tokens: 2 },
  },
});

async function main(): Promise<void> {
  await assert.rejects(
    () => parse(erroringResponse(socketTerminated())),
    (error: unknown) => error instanceof CodexIncompleteStreamError,
    'UND_ERR_SOCKET reader termination must classify as a retryable incomplete stream',
  );

  await assert.rejects(
    () => parse(erroringResponse(socketTerminated(), ['data: {"type":"response.output_text.delta","delta":"partial"}\n\n'])),
    (error: unknown) => error instanceof CodexIncompleteStreamError,
    'partial output followed by a socket termination is still an incomplete stream',
  );

  await assert.rejects(
    () => parse(erroringResponse(new Error('boom'))),
    (error: unknown) => error instanceof Error && !(error instanceof CodexIncompleteStreamError) && error.message === 'boom',
    'nontransport reader errors must propagate unchanged and must not be retried',
  );

  const aborted = new AbortController();
  aborted.abort();
  await assert.rejects(
    () => parse(erroringResponse(socketTerminated()), { abortSignal: aborted.signal }),
    (error: unknown) => !(error instanceof CodexIncompleteStreamError),
    'an aborted request must not be reclassified as a retryable stream failure',
  );

  // End-to-end: the first attempt dies with a socket termination after partial text;
  // the existing single retry must return the final response from the second attempt only.
  const authDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-codex-transport-'));
  const originalFetch = globalThis.fetch;
  let calls = 0;
  try {
    saveTokens(authDir, { access_token: 'test-access-token', refresh_token: 'test-refresh-token', expires_at: Date.now() + 3_600_000 });
    globalThis.fetch = (async () => {
      calls += 1;
      if (calls === 1) return erroringResponse(socketTerminated(), ['data: {"type":"response.output_text.delta","delta":"partial"}\n\n']);
      return new Response(`data: ${completedEvent}\n\n`, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    }) as typeof fetch;
    const adapter = new OpenAICodexAdapter({ configDir: authDir });
    const result = await adapter.chat([{ role: 'user', content: 'hi' }] as any, 'gpt-5.6-sol', {});
    assert.equal(calls, 2, 'a transient socket termination must be retried exactly once');
    assert.equal(result.message.content, 'Final answer.', 'the retry must return only the final response, not the partial attempt');
  } finally {
    globalThis.fetch = originalFetch;
    fs.rmSync(authDir, { recursive: true, force: true });
  }

  console.log('openai-codex transport regression: ok');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
