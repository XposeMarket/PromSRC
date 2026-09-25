/**
 * Regression: ChatGPT-as-model (openai_codex/chatgpt).
 *
 *   npx tsx src/providers/chatgpt-web/chatgpt-web.regression.ts
 *
 * Covers the SSE parser against a real captured web-search stream (split at
 * every possible chunk boundary), mode mapping, message building, the MCP
 * bridge JSON-RPC surface and its "only while a ChatGPT turn is active" gate.
 */

import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { ChatGPTWebStreamParser, applyContentReferences, stripCitationMarkers, type ChatGPTWebStreamEvent } from './chatgpt-web-stream';
import { resolveChatGPTWebMode, isChatGPTWebModel, CHATGPT_WEB_MODES } from './chatgpt-web-models';
import { buildChatGPTWebMessages } from './chatgpt-web-adapter';
import { buildConversationBody, solveProofOfWork } from './chatgpt-web-client';
import { beginChatGPTBridgeTurn, clearChatGPTBridgeTurns, getActiveChatGPTBridgeTurn } from './chatgpt-bridge-sessions';
import { getReasoningCapability } from '../reasoning-capabilities';

const fixture = fs.readFileSync(path.join(__dirname, '__fixtures__', 'web-search-stream.sse'), 'utf8');

function parseAll(chunks: string[]) {
  const parser = new ChatGPTWebStreamParser();
  const events: ChatGPTWebStreamEvent[] = [];
  for (const c of chunks) events.push(...parser.push(c));
  events.push(...parser.end());
  return { parser, events };
}

async function main() {
  // 1. Whole-stream parse: text, tool row, reasoning, conversation id.
  {
    const { parser, events } = parseAll([fixture]);
    const text = events.filter((e) => e.type === 'text_delta').map((e: any) => e.text).join('');
    assert.match(text, /Godot 4\.7\.2-stable/, 'final text streamed');
    assert.ok(!/[\ue200-\ue202]/.test(text), 'no citation private-use characters leak into streamed text');
    const starts = events.filter((e) => e.type === 'tool_start');
    const results = events.filter((e) => e.type === 'tool_result');
    assert.ok(starts.length >= 1, 'ChatGPT web search surfaced as a tool start');
    assert.strictEqual(starts[0].type === 'tool_start' && starts[0].name, 'chatgpt_web_search');
    assert.strictEqual(results.length, starts.length, 'every ChatGPT tool row is closed');
    assert.ok(events.some((e) => e.type === 'reasoning'), 'reasoning summary surfaced');
    assert.ok(parser.getConversationId(), 'conversation id captured');
    assert.strictEqual(events.filter((e) => e.type === 'done').length, 1, 'exactly one done');
    const final = parser.getFinalText();
    assert.match(final, /Godot 4\.7\.2-stable/);
    assert.ok(!/[\ue200-\ue202]/.test(final), 'final text has no raw citation markers');
  }

  // 2. Chunk-boundary invariance: same text regardless of how bytes arrive.
  {
    const baseline = parseAll([fixture]).events.filter((e) => e.type === 'text_delta').map((e: any) => e.text).join('');
    for (const size of [1, 7, 64, 333, 4096]) {
      const chunks: string[] = [];
      for (let i = 0; i < fixture.length; i += size) chunks.push(fixture.slice(i, i + size));
      const text = parseAll(chunks).events.filter((e) => e.type === 'text_delta').map((e: any) => e.text).join('');
      assert.strictEqual(text, baseline, `chunk size ${size} yields identical text`);
    }
  }

  // 3. Citation handling.
  assert.strictEqual(stripCitationMarkers('a \ue200cite\ue202turn0search1\ue201b'), 'a b');
  assert.strictEqual(
    applyContentReferences('Godot 4.7 \ue200cite\ue202turn0search1\ue201', [{ matched_text: '\ue200cite\ue202turn0search1\ue201', alt: '([godotengine.org](https://godotengine.org))' }]).trim(),
    'Godot 4.7 ([godotengine.org](https://godotengine.org))',
  );

  // 4. Delta ops: implicit repeat-path appends and patch batches.
  {
    const lines = [
      'data: {"p":"","o":"add","v":{"message":{"id":"m1","author":{"role":"assistant"},"recipient":"all","content":{"content_type":"text","parts":[""]},"status":"in_progress","metadata":{}}}}',
      'data: {"p":"/message/content/parts/0","o":"append","v":"Hel"}',
      'data: {"v":"lo"}',
      'data: {"p":"","o":"patch","v":[{"p":"/message/content/parts/0","o":"append","v":" world"},{"p":"/message/status","o":"replace","v":"finished_successfully"}]}',
      'data: [DONE]',
      '',
    ].join('\n');
    const { parser } = parseAll([lines]);
    assert.strictEqual(parser.getFinalText(), 'Hello world');
  }

  // 5. Modes.
  assert.ok(isChatGPTWebModel('chatgpt') && isChatGPTWebModel('openai_codex/chatgpt') && !isChatGPTWebModel('gpt-6-astra'));
  assert.strictEqual(resolveChatGPTWebMode('low').slug, 'gpt-5-6-instant');
  assert.deepStrictEqual([resolveChatGPTWebMode('high').slug, resolveChatGPTWebMode('high').thinkingEffort], ['gpt-5-6-thinking', 'standard']);
  assert.strictEqual(resolveChatGPTWebMode('max').thinkingEffort, 'max');
  assert.strictEqual(resolveChatGPTWebMode('ultra').slug, 'gpt-6-pro');
  assert.strictEqual(resolveChatGPTWebMode('garbage').effort, 'high');
  assert.strictEqual(resolveChatGPTWebMode('extra_high').effort, 'xhigh');
  assert.deepStrictEqual(getReasoningCapability('openai_codex', 'chatgpt').efforts, Object.keys(CHATGPT_WEB_MODES));

  // 6. Message building: hidden system, alternation, tool folding, ends on user.
  {
    const built = buildChatGPTWebMessages([
      { role: 'system', content: 'SYS' },
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: '', tool_calls: [{ id: 't1', type: 'function', function: { name: 'read_file', arguments: '{"path":"a"}' } }] as any },
      { role: 'tool', content: 'FILE', tool_call_id: 't1', name: 'read_file' } as any,
    ], true);
    assert.strictEqual(built[0].author.role, 'system');
    assert.strictEqual(built[0].metadata.is_visually_hidden_from_conversation, true);
    assert.match(built[0].content.parts[0], /SYS/);
    assert.match(built[0].content.parts[0], /"Prometheus" connector is attached/);
    assert.strictEqual(built[built.length - 1].author.role, 'user', 'turn ends on a user message');
    const assistant = built.find((m) => m.author.role === 'assistant')!;
    assert.match(assistant.content.parts[0], /read_file/);
    assert.match(assistant.content.parts[0], /FILE/, 'tool result folded into the assistant note');
    for (let i = 2; i < built.length; i += 1) assert.notStrictEqual(built[i].author.role, built[i - 1].author.role, 'roles alternate');
  }

  // 7. Request body: temporary chat default + MCP source attached to last message.
  {
    const body: any = buildConversationBody({
      messages: [{ id: 'u', author: { role: 'user' }, content: { content_type: 'text', parts: ['x'] } }],
      model: 'gpt-5-6-thinking',
      thinkingEffort: 'standard',
      mcpSources: [{ id: 'connector_abc', name: 'Prometheus' }],
    });
    assert.strictEqual(body.history_and_training_disabled, true);
    assert.strictEqual(body.thinking_effort, 'standard');
    assert.deepStrictEqual(body.messages[0].metadata.search_connectors, ['connector_abc']);
  }

  // 8. Proof-of-work matches the web client's format and difficulty rule.
  {
    const proof = solveProofOfWork('0.123', '0fffff');
    assert.ok(proof && proof.startsWith('gAAAAAB'));
  }

  // 9. Bridge gate: no active turn -> tools/list empty, tools/call refused.
  {
    const { handleBridgeRpc } = await import('../../gateway/routes/chatgpt-bridge.router');
    clearChatGPTBridgeTurns();
    const init: any = await handleBridgeRpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } });
    assert.strictEqual(init.result.serverInfo.name, 'prometheus');
    const idleList: any = await handleBridgeRpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    assert.deepStrictEqual(idleList.result.tools, []);
    const idleCall: any = await handleBridgeRpc({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'read_file', arguments: {} } });
    assert.strictEqual(idleCall.result.isError, true);

    const calls: string[] = [];
    const end = beginChatGPTBridgeTurn({
      sessionId: 's1',
      turnId: 't1',
      startedAt: Date.now(),
      allowedTools: () => [{ name: 'read_file', description: 'Read a file', parameters: { type: 'object', properties: { path: { type: 'string' } } } }],
      executeTool: async (name, args) => { calls.push(`${name}:${JSON.stringify(args)}`); return { result: 'CONTENTS', error: false }; },
    });
    const list: any = await handleBridgeRpc({ jsonrpc: '2.0', id: 4, method: 'tools/list' });
    assert.deepStrictEqual(list.result.tools.map((t: any) => t.name), ['read_file']);
    assert.strictEqual(list.result.tools[0].annotations.readOnlyHint, true);
    const denied: any = await handleBridgeRpc({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'run_command', arguments: { command: 'whoami' } } });
    assert.strictEqual(denied.result.isError, true, 'tools outside the turn surface are refused');
    const ok: any = await handleBridgeRpc({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'read_file', arguments: { path: 'a.txt' } } });
    assert.strictEqual(ok.result.isError, false);
    assert.strictEqual(ok.result.content[0].text, 'CONTENTS');
    assert.deepStrictEqual(calls, ['read_file:{"path":"a.txt"}']);
    end();
    assert.strictEqual(getActiveChatGPTBridgeTurn(), null, 'bridge closes when the provider call ends');
    const notif = await handleBridgeRpc({ jsonrpc: '2.0', method: 'notifications/initialized' });
    assert.strictEqual(notif, null);
  }

  console.log('chatgpt-web regression: all checks passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
