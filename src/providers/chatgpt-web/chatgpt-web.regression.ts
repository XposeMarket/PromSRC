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
import { ChatGPTWebStreamParser, applyContentReferences, stripCitationMarkers, parseConnectorCall, type ChatGPTWebStreamEvent } from './chatgpt-web-stream';
import { resolveChatGPTWebMode, isChatGPTWebModel, CHATGPT_WEB_MODES } from './chatgpt-web-models';
import { buildChatGPTWebMessages } from './chatgpt-web-adapter';
import { buildConversationBody, solveProofOfWork } from './chatgpt-web-client';
import { beginChatGPTBridgeTurn, bindChatGPTBridgeConversation, chatGPTBridgeTurnKey, clearChatGPTBridgeTurns, getActiveChatGPTBridgeTurn, unboundChatGPTBridgeTurnCount, waitForChatGPTBridgeSlot } from './chatgpt-bridge-sessions';
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

  // 4b. Echoed input history must not leak into the new answer (2026-09-25:
  // every earlier assistant reply was re-appended, doubling each turn).
  {
    const add = (id: string, role: string, text: string) => `data: {"p":"","o":"add","v":{"message":{"id":"${id}","author":{"role":"${role}"},"recipient":"all","content":{"content_type":"text","parts":["${text}"]},"status":"finished_successfully","metadata":{}}}}`;
    const lines = [
      add('h1', 'assistant', 'Yo Raul old reply'),
      add('u1', 'user', 'new question'),
      add('a1', 'assistant', ''),
      'data: {"p":"/message/content/parts/0","o":"append","v":"Fresh answer"}',
      'data: [DONE]',
      '',
    ].join('\n');
    const byId = new ChatGPTWebStreamParser({ inputMessageIds: ['h1', 'u1'] });
    const deltas = byId.push(lines).concat(byId.end()).filter((e: any) => e.type === 'text_delta').map((e: any) => e.text).join('');
    assert.strictEqual(byId.getFinalText(), 'Fresh answer');
    assert.strictEqual(deltas, 'Fresh answer');
    const byUserEcho = new ChatGPTWebStreamParser();
    byUserEcho.push(lines); byUserEcho.end();
    assert.strictEqual(byUserEcho.getFinalText(), 'Fresh answer', 'user echo marks prior messages as history even without ids');
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
    assert.match(built[0].content.parts[0], /"Prometheus" connector \(app\) is attached/);
    const withPath = buildChatGPTWebMessages([{ role: 'user', content: 'hi' }], { id: 'asdk_app_x', name: 'Prometheus', linkId: 'link_y' });
    assert.match(withPath[0].content.parts[0], /path "\/Prometheus\/link_y\/<tool_name>"/, 'system note tells ChatGPT the connector tool path');
    assert.strictEqual(built[built.length - 1].author.role, 'user', 'turn ends on a user message');
    const assistant = built.find((m) => m.author.role === 'assistant')!;
    assert.match(assistant.content.parts[0], /read_file/);
    assert.match(assistant.content.parts[0], /FILE/, 'tool result folded into the assistant note');
    for (let i = 2; i < built.length; i += 1) assert.notStrictEqual(built[i].author.role, built[i - 1].author.role, 'roles alternate');
  }

  // 7. Request body: temporary by default; a connector turn is never temporary
  //    (ChatGPT drops apps from Temporary Chats) and attaches the connector.
  {
    const base = {
      messages: [{ id: 'u', author: { role: 'user' }, content: { content_type: 'text', parts: ['x'] } }],
      model: 'gpt-5-6-thinking',
      thinkingEffort: 'standard',
    };
    const plain: any = buildConversationBody(base);
    assert.strictEqual(plain.history_and_training_disabled, true, 'text-only turns stay temporary');
    const body: any = buildConversationBody({ ...base, temporary: true, mcpSources: [{ id: 'connector_abc', name: 'Prometheus' }] });
    assert.strictEqual(body.history_and_training_disabled, false, 'connector turns cannot be temporary');
    assert.strictEqual(body.thinking_effort, 'standard');
    assert.deepStrictEqual(body.messages[0].metadata.search_connectors, ['connector_abc']);
    assert.deepStrictEqual(body.system_hints, ['connector:connector_abc']);
  }

  // 7b. Real captured connector call (2026-09-25): ChatGPT calls the
  //     Prometheus connector via api_tool.call_tool; the row carries the real
  //     connector + tool name and the tool output closes it.
  {
    const connectorFixture = fs.readFileSync(path.join(__dirname, '__fixtures__', 'connector-call-stream.sse'), 'utf8');
    assert.deepStrictEqual(parseConnectorCall('{"path":"/Prometheus/link_x/read_file","args":{"path":"a"}}'), { connector: 'Prometheus', tool: 'read_file', args: { path: 'a' } });
    assert.strictEqual(parseConnectorCall('{"path":"/Prom'), null, 'partial payload is not parsed');
    for (const size of [connectorFixture.length, 5, 97]) {
      const chunks: string[] = [];
      for (let i = 0; i < connectorFixture.length; i += size) chunks.push(connectorFixture.slice(i, i + size));
      const { parser, events } = parseAll(chunks);
      const starts = events.filter((e) => e.type === 'tool_start') as any[];
      const results = events.filter((e) => e.type === 'tool_result') as any[];
      assert.strictEqual(starts.length, 1, `one connector row (chunk ${size})`);
      assert.strictEqual(starts[0].name, 'chatgpt_app_prometheus_ping');
      assert.deepStrictEqual(starts[0].connector, { connector: 'Prometheus', tool: 'prometheus_ping', args: { note: 'Retrieve the Prometheus word as requested.' } });
      assert.strictEqual(results.length, 1);
      assert.match(results[0].result, /OBSIDIAN-FALCON-42/, 'connector output closes the row');
      assert.match(parser.getFinalText(), /OBSIDIAN-FALCON-42/);
    }
  }

  // 7c. Real capture where ChatGPT wrapped the connector call in functions.exec
  //     (nested, inner result arrives first): one row, closed by its own output.
  {
    const nested = fs.readFileSync(path.join(__dirname, '__fixtures__', 'connector-call-nested-exec.sse'), 'utf8');
    const { parser, events } = parseAll([nested]);
    const starts = events.filter((e) => e.type === 'tool_start') as any[];
    const results = events.filter((e) => e.type === 'tool_result') as any[];
    assert.deepStrictEqual(starts.map((s) => s.name), ['chatgpt_app_prometheus_ping'], 'functions.exec wrapper gets no row');
    assert.strictEqual(results.length, 1);
    assert.match(results[0].result, /OBSIDIAN-FALCON-42/, 'nested call closed by its own output, not the wrapper');
    assert.match(parser.getFinalText(), /OBSIDIAN-FALCON-42/);
  }

  // 7d. ChatGPT's own confirm_action prompt ends the turn with a clear error.
  {
    const lines = [
      'data: {"p":"","o":"add","v":{"message":{"id":"a1","author":{"role":"assistant"},"recipient":"api_tool.call_tool","content":{"content_type":"code","text":"{\\"path\\":\\"/Prometheus/link_x/run_command\\",\\"args\\":{}}"},"status":"finished_successfully","metadata":{}}}}',
      'data: {"p":"","o":"add","v":{"message":{"id":"t1","author":{"role":"tool","name":"api_tool.call_tool"},"recipient":"all","content":{"content_type":"text","parts":[""]},"status":"finished_successfully","metadata":{"jit_plugin_data":{"from_server":{"type":"confirm_action","body":{"params":{"path":"/asdk_app_x/link_x/run_command"}}}}}}}}',
      'data: [DONE]',
      '',
    ].join('\n');
    const { events } = parseAll([lines]);
    const err = events.find((e) => e.type === 'error') as any;
    assert.ok(err && /Full access/.test(err.message), 'confirm_action surfaces an actionable error');
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

  // 9c. Sandbox links, bot-check classification, sandbox file save.
{
  const { extractSandboxPaths, toNativeAbortSignal } = await import('./chatgpt-web-client');
  {
    // Foreign signal-like objects must become native AbortSignals (fetch rejects them otherwise).
    const listeners: Array<() => void> = [];
    const fake: any = { aborted: false, reason: undefined, addEventListener: (_: string, fn: () => void) => listeners.push(fn) };
    const native = toNativeAbortSignal(fake)!;
    assert.ok(native instanceof AbortSignal && !native.aborted);
    listeners.forEach((fn) => fn());
    assert.ok(native.aborted, 'foreign abort propagates');
    assert.strictEqual(toNativeAbortSignal(undefined), undefined);
    const real = new AbortController().signal;
    assert.strictEqual(toNativeAbortSignal(real), real);
  }
  assert.deepStrictEqual(
    extractSandboxPaths('Download [zip](sandbox:/mnt/data/neon_courier_game.zip). Also sandbox:/mnt/data/a b.png and sandbox:/mnt/data/../etc/passwd, again sandbox:/mnt/data/neon_courier_game.zip.'),
    ['/mnt/data/neon_courier_game.zip', '/mnt/data/a'],
    'sandbox paths are extracted, deduped, trailing punctuation trimmed, traversal rejected',
  );
  const os = await import('os');
  const fsm = await import('fs');
  const pathm = await import('path');
  const { saveChatGPTSandboxFile } = await import('./chatgpt-sandbox-files');
  const root = fsm.mkdtempSync(pathm.join(os.tmpdir(), 'cg-sbx-'));
  const a = await saveChatGPTSandboxFile('abcdef123456', 'game.zip', Buffer.from('x'), root);
  const b = await saveChatGPTSandboxFile('abcdef123456', 'game.zip', Buffer.from('y'), root);
  const c = await saveChatGPTSandboxFile('abcdef123456', '..\\evil:name.txt', Buffer.from('z'), root);
  assert.strictEqual(a, 'chatgpt-files/abcdef12/game.zip');
  assert.strictEqual(b, 'chatgpt-files/abcdef12/game-2.zip', 'never overwrites');
  assert.ok(c.startsWith('chatgpt-files/abcdef12/') && !c.includes('..'), `unsafe names are sanitized: ${c}`);
  fsm.rmSync(root, { recursive: true, force: true });
}

// 10. Concurrent ChatGPT chats: calls route by conversation id, never to the
  //     newest turn by default; unmatched multi-turn calls are refused.
  {
    const { handleBridgeRpc } = await import('../../gateway/routes/chatgpt-bridge.router');
    clearChatGPTBridgeTurns();
    const ran: string[] = [];
    const mk = (sessionId: string, startedAt: number, tools: string[]) => ({
      sessionId, turnId: 't', startedAt,
      allowedTools: () => tools.map((name) => ({ name, description: name, parameters: { type: 'object' } })),
      executeTool: async (name: string) => { ran.push(`${sessionId}:${name}`); return { result: sessionId, error: false }; },
    });
    const endA = beginChatGPTBridgeTurn(mk('A', Date.now() - 1000, ['read_file', 'write_file']));
    const endB = beginChatGPTBridgeTurn(mk('B', Date.now(), ['read_file']));
    const list: any = await handleBridgeRpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    assert.deepStrictEqual(list.result.tools.map((t: any) => t.name).sort(), ['read_file', 'write_file'], 'catalog is the union of live turns');
    const ambiguous: any = await handleBridgeRpc({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'read_file', arguments: {} } });
    assert.strictEqual(ambiguous.result.isError, true, 'unmatched call with two live turns is refused, not sent to the newest');
    const onlyOwner: any = await handleBridgeRpc({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'write_file', arguments: {} } });
    assert.strictEqual(onlyOwner.result.content[0].text, 'A', 'a tool only one turn exposes routes there');
    bindChatGPTBridgeConversation(chatGPTBridgeTurnKey({ sessionId: 'A', turnId: 't' }), 'conv-aaaa-1111');
    const byConv: any = await handleBridgeRpc({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'read_file', arguments: { path: 'x' }, _meta: { 'openai/conversationId': 'conv-aaaa-1111' } } });
    assert.strictEqual(byConv.result.content[0].text, 'A', 'conversation id wins over recency');
    const byHeader: any = await handleBridgeRpc({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'read_file', arguments: {} } }, { 'x-openai-conversation-id': 'conv-aaaa-1111' });
    assert.strictEqual(byHeader.result.content[0].text, 'A', 'conversation id in headers also routes');
    endA();
    const single: any = await handleBridgeRpc({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'read_file', arguments: {} } });
    assert.strictEqual(single.result.content[0].text, 'B', 'a single live turn still works without ids');
    endB();
    assert.deepStrictEqual(ran, ['A:write_file', 'A:read_file', 'A:read_file', 'B:read_file']);
  }

  // 10b. Real ChatGPT shape (2026-09-26): no conversation id in the call, only a
  //      per-chat x-openai-session header. Turn A binds while it is the only
  //      turn; B then gets every unknown session; neither ever crosses over.
  {
    const { handleBridgeRpc } = await import('../../gateway/routes/chatgpt-bridge.router');
    clearChatGPTBridgeTurns();
    const ran: string[] = [];
    const mk = (sessionId: string, startedAt: number) => ({
      sessionId, turnId: 't', startedAt,
      allowedTools: () => [{ name: 'read_file', description: 'r', parameters: { type: 'object' } }],
      executeTool: async (name: string) => { ran.push(`${sessionId}:${name}`); return { result: sessionId, error: false }; },
    });
    const call = (id: number, chat: string) => handleBridgeRpc({ jsonrpc: '2.0', id, method: 'tools/call', params: { name: 'read_file', arguments: {} } }, { 'x-openai-session': chat }) as Promise<any>;
    const endA = beginChatGPTBridgeTurn(mk('A', Date.now() - 1000));
    bindChatGPTBridgeConversation(chatGPTBridgeTurnKey({ sessionId: 'A', turnId: 't' }), 'conv-from-sse');
    assert.strictEqual(unboundChatGPTBridgeTurnCount(), 1, 'A is unidentified until its first call (SSE conversation id does not count)');
    const slowSlot = waitForChatGPTBridgeSlot(5_000, 10);
    assert.strictEqual((await call(1, 'v1/chatA')).result.content[0].text, 'A', 'single turn binds its chat');
    assert.strictEqual((await slowSlot).timedOut, false, 'a waiting turn proceeds once A binds');
    const endB = beginChatGPTBridgeTurn(mk('B', Date.now()));
    assert.strictEqual((await call(2, 'v1/chatB')).result.content[0].text, 'B', 'unknown chat goes to the only unbound turn');
    assert.strictEqual((await call(3, 'v1/chatA')).result.content[0].text, 'A', 'A keeps its chat with two live turns');
    assert.strictEqual((await call(4, 'v1/chatB')).result.content[0].text, 'B', 'B keeps its chat');
    endA();
    endB();
    assert.deepStrictEqual(ran, ['A:read_file', 'B:read_file', 'A:read_file', 'B:read_file']);
    assert.strictEqual(unboundChatGPTBridgeTurnCount(), 0);
  }


  // 11. Images on the latest user message become multimodal_text parts.
  {
    const { extractImageParts, attachImagesToLastUser } = await import('./chatgpt-web-adapter');
    const { imageDimensions } = await import('./chatgpt-web-client');
    const png = Buffer.alloc(33);
    png.writeUInt32BE(0x89504e47, 0); png.writeUInt32BE(640, 16); png.writeUInt32BE(480, 20);
    assert.deepStrictEqual(imageDimensions(png), { width: 640, height: 480 });
    const parts = extractImageParts([{ type: 'text', text: 'what is this' }, { type: 'image_url', image_url: { url: `data:image/png;base64,${png.toString('base64')}` } }]);
    assert.strictEqual(parts.length, 1);
    assert.strictEqual(parts[0].mimeType, 'image/png');
    const msgs = buildChatGPTWebMessages([{ role: 'user', content: [{ type: 'text', text: 'what is this' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,AA==' } }] as any }], null);
    attachImagesToLastUser(msgs, [{ fileId: 'file-123', name: 'image_1.png', mimeType: 'image/png', size: 33, width: 640, height: 480 }]);
    const last: any = msgs[msgs.length - 1];
    assert.strictEqual(last.content.content_type, 'multimodal_text');
    assert.strictEqual(last.content.parts[0].asset_pointer, 'file-service://file-123');
    assert.strictEqual(last.content.parts[1], 'what is this', 'the omitted-image note is stripped once images are attached');
    assert.strictEqual(last.metadata.attachments[0].id, 'file-123');
  }

  console.log('chatgpt-web regression: all checks passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
