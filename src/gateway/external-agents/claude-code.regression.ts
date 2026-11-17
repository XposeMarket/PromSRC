import assert from 'assert';
import { ClaudeCodeAdapter } from './adapters/claude-code';
async function main() {
  const command = { command: '/fixture/claude', args: [], source: '/fixture/claude' };
  const inputs: any[] = [];
  let closes = 0;
  let bound = '';
  let permission: any;
  const query = (input: any) => {
    inputs.push(input);
    assert.ok(bound, 'identity persisted before SDK launch');
    const session = input.options.resume || input.options.sessionId;
    return { close() { closes++; }, async interrupt() {}, async *[Symbol.asyncIterator]() {
      assert.equal(typeof input.prompt[Symbol.asyncIterator], 'function');
      const message = await input.prompt[Symbol.asyncIterator]().next();
      assert.equal(message.value.message.content[0].text, 'hi');
      yield { type: 'system', subtype: 'init', session_id: session, model: 'claude-default' };
      permission = await input.options.canUseTool('Bash', { command: 'npm test' }, { signal: new AbortController().signal });
      yield { type: 'stream_event', session_id: session, event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hello' } } };
      yield { type: 'assistant', session_id: session, message: { content: [{ type: 'text', text: 'Hello' }] } };
      yield { type: 'result', subtype: 'success', session_id: session, result: 'Hello' };
    } };
  };
  const adapter = new ClaudeCodeAdapter({ resolve: () => command, status: async () => true, query });
  assert.equal((await adapter.detect()).found, true);
  assert.equal(inputs.length, 0, 'detection does not launch SDK');
  assert.equal((await adapter.verify()).status, 'ready');
  assert.equal(inputs.length, 0, 'verification does not submit a model prompt');
  const events: any[] = [];
  const base = { sessionId: 's', cwd: '/fixture', text: 'hi', signal: new AbortController().signal, emit: (e: any) => events.push(e), onSessionBound: (id: string) => { bound = id; }, requestUser: async () => ({ optionId: 'allow' }) };
  const first = await adapter.runTurn(base);
  assert.equal(first.status, 'completed'); assert.equal(first.finalText, 'Hello');
  assert.equal(events.filter((e) => e.type === 'text_delta').length, 1);
  assert.equal(permission.behavior, 'allow');
  assert.equal(inputs[0].options.pathToClaudeCodeExecutable, command.command);
  for (const key of ['model', 'permissionMode', 'tools', 'mcpServers', 'settingSources']) assert.ok(!(key in inputs[0].options), `preserve own ${key}`);
  assert.deepEqual(inputs[0].options.systemPrompt, { type: 'preset', preset: 'claude_code' });
  await adapter.runTurn({ ...base, upstreamSessionId: first.upstreamSessionId, requestUser: async () => ({ optionId: 'deny' }) });
  assert.equal(inputs[1].options.resume, first.upstreamSessionId);
  assert.equal(permission.behavior, 'deny');
  assert.equal(closes, 2); assert.equal(adapter.isRunning(), false);
  const abort = new AbortController(); abort.abort();
  assert.equal((await adapter.runTurn({ ...base, signal: abort.signal })).status, 'interrupted');
  assert.equal(inputs.length, 2);
  assert.equal((await new ClaudeCodeAdapter({ resolve: () => null }).verify()).status, 'not_installed');
  assert.equal((await new ClaudeCodeAdapter({ resolve: () => command, status: async () => false, query }).verify()).status, 'signed_out');
  await adapter.shutdown();
  // Import the installed real SDK without invoking query or launching the CLI.
  const load = new Function('return import("@prometheus/claude-driver")');
  assert.equal(typeof (await load()).createQuery, 'function');
  console.log('claude-code regression: ok (fake SDK; real SDK module load only)');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
