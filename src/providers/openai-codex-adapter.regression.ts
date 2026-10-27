import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadTokens, saveTokens } from '../auth/openai-oauth';
import { CodexIncompleteStreamError, OpenAICodexAdapter, codexHttpErrorDetail } from './openai-codex-adapter';
import { readChatRouterSource } from '../testing/chat-router-source';

assert.equal(codexHttpErrorDetail('{"error":{"message":"Unsupported model sol"}}'), 'Unsupported model sol');
assert.equal(codexHttpErrorDetail('not JSON'), '');
assert.equal(codexHttpErrorDetail('{"error":{"message":"Bearer secret123 sk-examplekey"}}'), 'Bearer [redacted] [redacted]');

function sseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  }), {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

async function parse(chunks: string[], options?: any) {
  const adapter = new OpenAICodexAdapter(process.cwd());
  return (adapter as any).parseSSEStream(sseResponse(chunks), 'gpt-5.6-sol', options);
}

async function main(): Promise<void> {
  const authDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-codex-accounts-'));
  try {
    const token = { access_token: 'test-access-token', refresh_token: 'test-refresh-token', expires_at: Date.now() + 3_600_000 };
    saveTokens(authDir, token, 'connected');
    const accountAdapter = new OpenAICodexAdapter({ configDir: authDir, accountId: 'unfinished', accountIds: ['connected'] });
    assert.equal(await accountAdapter.testConnection(), true, 'connection test must try a connected named account');
    assert.equal(await new OpenAICodexAdapter({ configDir: authDir, accountId: 'unfinished' }).testConnection(), false);
    saveTokens(authDir, token);
    assert.equal(loadTokens(authDir, 'unfinished'), null, 'an unfinished account must not inherit a legacy unscoped token');
    assert.ok(loadTokens(authDir, 'default'), 'the default account must retain legacy token compatibility');
  } finally {
    fs.rmSync(authDir, { recursive: true, force: true });
  }

  const completedTextEvent = JSON.stringify({
    type: 'response.completed',
    response: {
      output: [{ type: 'message', content: [{ type: 'output_text', text: 'Actual final response.' }] }],
      usage: { input_tokens: 10, output_tokens: 4 },
    },
  });

  const trailing = await parse([`data: ${completedTextEvent}`]);
  assert.equal(trailing.message.content, 'Actual final response.', 'an unterminated final SSE line must be parsed');

  await assert.rejects(
    () => parse(['data: {"type":"response.output_text.delta","delta":"partial"}\n\n']),
    (error: unknown) => error instanceof CodexIncompleteStreamError
      && /before response\.completed/.test(error.message),
    'a stream that closes before response.completed must be retryable failure, not a partial final',
  );

  const emptyProviderEvents: any[] = [];
  await assert.rejects(
    () => parse(['data: {"type":"response.completed","response":{"output":[]}}\n\n'], {
      onModelEvent: (event: any) => emptyProviderEvents.push(event),
    }),
    (error: unknown) => error instanceof CodexIncompleteStreamError
      && /no assistant text or tool calls/.test(error.message)
      && error.diagnostics.failureClass === 'empty_completion'
      && error.diagnostics.outputItemCount === 0,
    'an empty completed response must be retryable failure with bounded diagnostics',
  );
  assert.equal(emptyProviderEvents[0]?.data?.failureClass, 'empty_completion');
  assert.deepEqual(emptyProviderEvents[0]?.data?.outputItemTypes, []);

  const toolCall = await parse([
    'data: {"type":"response.output_item.added","output_index":0,"item":{"type":"function_call","call_id":"call_1","name":"example","arguments":""}}\n\n',
    'data: {"type":"response.completed","response":{"output":[{"type":"function_call","call_id":"call_1","name":"example","arguments":"{\\"ok\\":true}"}]}}\n\n',
  ]);
  assert.equal(toolCall.message.tool_calls?.[0]?.id, 'call_1', 'completed tool calls must remain valid output');
  assert.equal(toolCall.message.tool_calls?.[0]?.function.arguments, '{"ok":true}');

  const phasedEvents: any[] = [];
  const phasedCommentary = await parse([
    'data: {"type":"response.output_item.added","output_index":0,"item":{"id":"msg_commentary","type":"message","phase":"commentary","content":[]}}\n\n',
    'data: {"type":"response.output_text.delta","item_id":"msg_commentary","output_index":0,"delta":"I found the cause."}\n\n',
    'data: {"type":"response.output_item.done","output_index":0,"item":{"id":"msg_commentary","type":"message","phase":"commentary","content":[{"type":"output_text","text":"I found the cause."}]}}\n\n',
    'data: {"type":"response.completed","response":{"output":[{"id":"msg_commentary","type":"message","phase":"commentary","content":[{"type":"output_text","text":"I found the cause."}]}]}}\n\n',
  ], { onModelEvent: (event: any) => phasedEvents.push(event) });
  assert.equal(phasedCommentary.message.phase, 'commentary', 'assistant phase must survive stream completion');
  assert.equal(phasedCommentary.message.item_id, 'msg_commentary', 'assistant item identity must survive stream completion');
  assert.equal(phasedEvents.find((event) => event.type === 'assistant_delta')?.phase, 'commentary');

  // Native reasoning (including public summaries) is thinking, never assistant
  // commentary. Only actual output_text belongs to the assistant token lane.
  const sse = (event: any) => `data: ${JSON.stringify(event)}\n\n`;
  const reasoningDeltaTypes = [
    'response.reasoning_summary_text.delta',
    'response.reasoning_summary.delta',
    'response.reasoning_text.delta',
    'response.reasoning.delta',
  ];
  for (const nativeType of reasoningDeltaTypes) {
    const summaries: string[] = [];
    const thoughts: string[] = [];
    const tokens: string[] = [];
    const events: any[] = [];
    const fragments = ['  Considering', ' ', 'the options.\n', '\n'];
    const commentary = '  I found the cause.\n';
    const isSummary = nativeType.includes('summary');
    const result = await parse([
      ...fragments.map((delta) => sse({ type: nativeType, delta })),
      sse({ type: 'response.output_item.added', output_index: 1, item: { id: 'msg_progress', type: 'message', phase: 'commentary', content: [] } }),
      sse({ type: 'response.output_text.delta', item_id: 'msg_progress', output_index: 1, delta: commentary }),
      sse({ type: 'response.completed', response: { output: [
        { id: 'msg_progress', type: 'message', phase: 'commentary', content: [{ type: 'output_text', text: commentary }] },
      ] } }),
    ], {
      onThinking: (text: string) => thoughts.push(text),
      onReasoningSummary: (text: string) => summaries.push(text),
      onToken: (text: string) => tokens.push(text),
      onModelEvent: (event: any) => events.push(event),
    });
    assert.deepEqual(summaries, isSummary ? fragments : [], `${nativeType}: summary lane must preserve raw fragments`);
    assert.deepEqual(thoughts, isSummary ? [] : fragments, `${nativeType}: raw thinking must stay separate from summaries`);
    assert.deepEqual(tokens, [commentary], `${nativeType}: reasoning must never become assistant output tokens`);
    assert.equal(result.thinking, fragments.join(''), `${nativeType}: accumulated thinking must preserve whitespace`);
    assert.equal(result.message.content, commentary);
    assert.equal(result.message.phase, 'commentary');
    assert.deepEqual(events.filter((event) => event.type === 'reasoning_delta').map((event) => ({ text: event.text, summary: event.summary, nativeType: event.nativeType })),
      fragments.map((text) => ({ text, summary: isSummary, nativeType })));
    assert.deepEqual(events.filter((event) => event.type === 'assistant_delta').map((event) => ({ text: event.text, phase: event.phase })),
      [{ text: commentary, phase: 'commentary' }], 'only actual output_text should produce assistant commentary events');
  }

  const summaryText = '  A reasoning summary.\n';
  const reasoningItem = { id: 'reasoning_1', type: 'reasoning', summary: [{ type: 'summary_text', text: summaryText }] };
  const summaryFallbacks = [
    { type: 'response.reasoning_summary_text.done', text: summaryText },
    { type: 'response.reasoning_summary.done', text: summaryText },
    { type: 'response.reasoning_summary_part.done', part: { type: 'summary_text', text: summaryText } },
    { type: 'response.output_item.done', item: reasoningItem },
  ];
  // Include snapshot-only completion, and ensure done/item/completed snapshots
  // do not replay a summary that was already emitted through deltas.
  for (const prefix of [[], ...summaryFallbacks.map((event) => [event]), [{ type: 'response.reasoning_summary_text.delta', delta: summaryText }, ...summaryFallbacks]]) {
    const summaries: string[] = [];
    const thoughts: string[] = [];
    const tokens: string[] = [];
    const events: any[] = [];
    const result = await parse([
      ...prefix.map(sse),
      sse({ type: 'response.completed', response: { output: [reasoningItem,
        { type: 'message', phase: 'final_answer', content: [{ type: 'output_text', text: 'Final answer.' }] },
      ] } }),
    ], {
      onReasoningSummary: (text: string) => summaries.push(text),
      onThinking: (text: string) => thoughts.push(text),
      onToken: (text: string) => tokens.push(text),
      onModelEvent: (event: any) => events.push(event),
    });
    assert.deepEqual(summaries, [summaryText], 'summary fallbacks must emit once without trimming or commentary promotion');
    assert.deepEqual(thoughts, []);
    assert.deepEqual(tokens, [], 'reasoning snapshots must not synthesize assistant token deltas');
    assert.equal(result.thinking, summaryText);
    assert.equal(result.message.content, 'Final answer.');
    assert.equal(result.message.phase, 'final_answer');
    assert.equal(events.filter((event) => event.type === 'reasoning_delta' || event.type === 'reasoning_done').length, 1);
    assert.ok(events.filter((event) => event.type === 'reasoning_delta' || event.type === 'reasoning_done').every((event) => event.summary === true));
    assert.equal(events.filter((event) => event.type === 'assistant_delta').length, 0);
  }

  const replayInput = (new OpenAICodexAdapter(process.cwd()) as any).buildInput([
    { role: 'user', content: 'Investigate' },
    {
      role: 'assistant',
      content: 'I found the cause.',
      phase: 'commentary',
      tool_calls: [{ id: 'call_replay', type: 'function', function: { name: 'inspect', arguments: '{}' } }],
    },
    { role: 'tool', tool_call_id: 'call_replay', content: 'evidence' },
  ]);
  assert.deepEqual(replayInput[1], { role: 'assistant', content: 'I found the cause.', phase: 'commentary' }, 'commentary preceding a tool call must be replayed');
  assert.equal(replayInput[2]?.type, 'function_call');

  const adapterSource = fs.readFileSync('src/providers/openai-codex-adapter.ts', 'utf8');
  assert.match(adapterSource, /allowIncompleteStreamRetry\s*=\s*true/, 'incomplete streams must have a one-retry guard');
  assert.match(adapterSource, /return runRequest\(requestedModel, allowFallback, fallbackFrom, fallbackReason, false, accountIndex\)/, 'the retry must disable itself after one attempt while staying on the same account');
  assert.match(adapterSource, /isRetryableAccountFailure\(response\.status, text\)/, 'quota and credential failures must advance to another configured account');
  assert.match(adapterSource, /accountId: activeAccountId/, 'the account that served the request must be recorded with usage');
  assert.doesNotMatch(adapterSource, /error:\s*text\.slice\(0,\s*400\)/, 'provider response bodies must not be persisted as runtime error text');

  const chatSource = readChatRouterSource();
  const fallbackStart = chatSource.indexOf('if (!finalText.trim())');
  const fallbackEnd = chatSource.indexOf('if (greetingLikeTurn', fallbackStart);
  assert.ok(fallbackStart >= 0 && fallbackEnd > fallbackStart, 'missing-final fallback block must exist');
  const fallbackBlock = chatSource.slice(fallbackStart, fallbackEnd);
  assert.match(fallbackBlock, /No final response was generated\. The task may still be unfinished/, 'missing finals must be reported explicitly');
  assert.doesNotMatch(fallbackBlock, /allToolResults|\.result\b|`Done\./, 'missing finals must never synthesize prose from tool results');

  const providerCatchStart = chatSource.indexOf("if (err?.code === 'CODEX_INCOMPLETE_STREAM'");
  const providerCatchEnd = chatSource.indexOf('let toolCalls', providerCatchStart);
  assert.ok(providerCatchStart >= 0 && providerCatchEnd > providerCatchStart, 'provider error handling block must exist');
  const providerCatchBlock = chatSource.slice(providerCatchStart, providerCatchEnd);
  assert.match(
    providerCatchBlock,
    /toolResults: preservedToolResults/,
    'provider failures must preserve tool results for Brain outcome verification and recovery',
  );

  const thoughtTerminalStart = chatSource.indexOf(
    "if (isBrainThoughtRuntime && toolName === 'brain_thought_submit' && !toolResult.error)",
  );
  const thoughtTerminalEnd = chatSource.indexOf("if (isSupervisionLoop && toolName === 'prometheus_thread_ops'", thoughtTerminalStart);
  assert.ok(thoughtTerminalStart >= 0 && thoughtTerminalEnd > thoughtTerminalStart, 'Brain Thought terminal submission guard must exist');
  const thoughtTerminalBlock = chatSource.slice(thoughtTerminalStart, thoughtTerminalEnd);
  assert.match(thoughtTerminalBlock, /type: 'execute'/, 'accepted Thought submissions must return an execution result');
  assert.match(thoughtTerminalBlock, /text: ''/, 'accepted Thought submissions must not request a prose final');
  assert.match(thoughtTerminalBlock, /toolResults: allToolResults/, 'accepted Thought submissions must return the completed tool history');

  console.log('openai-codex stream and commentary replay regressions passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
