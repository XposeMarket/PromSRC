import assert from 'node:assert/strict';
import { AnthropicAdapter, fromAnthropicWireToolName, toAnthropicWireToolName } from './anthropic-adapter';

// 2026-09-25: a tool named `mcp_<x>` makes Anthropic bill a setup-token request
// to extra usage (400 "out of extra usage", org_level_disabled) every time.
// The adapter must alias such names on the wire and map them back.

assert.equal(toAnthropicWireToolName('mcp_server_manage'), 'prom_mcp_server_manage');
assert.equal(toAnthropicWireToolName('mcp_server_tools'), 'prom_mcp_server_tools');
assert.equal(toAnthropicWireToolName('mcp__github__list'), 'mcp__github__list');
assert.equal(toAnthropicWireToolName('workspace_read'), 'workspace_read');
assert.equal(fromAnthropicWireToolName('prom_mcp_server_manage'), 'mcp_server_manage');
assert.equal(fromAnthropicWireToolName('workspace_read'), 'workspace_read');
for (const n of ['mcp_server_manage', 'mcp_x', 'mcp__a__b', 'tool_call', 'prom_other']) {
  assert.equal(fromAnthropicWireToolName(toAnthropicWireToolName(n)), n);
}

(async () => {
  const adapter = new AnthropicAdapter({ apiKey: 'test', authHeader: 'x-api-key' } as any);
  const originalFetch = globalThis.fetch;
  let sent: any = null;
  globalThis.fetch = (async (_url: any, init: any) => {
    sent = JSON.parse(String(init.body));
    return new Response(JSON.stringify({
      id: 'm', type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_reason: 'tool_use',
      content: [{ type: 'tool_use', id: 'tu_1', name: 'prom_mcp_server_manage', input: { action: 'list' } }],
      usage: { input_tokens: 1, output_tokens: 1 },
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as any;
  try {
    const result: any = await adapter.chat([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: '', tool_calls: [{ id: 'tu_0', type: 'function', function: { name: 'mcp_server_manage', arguments: '{}' } }] } as any,
      { role: 'tool', content: 'ok', tool_call_id: 'tu_0' } as any,
    ], 'claude-opus-5-5', {
      tools: [
        { type: 'function', function: { name: 'mcp_server_manage', description: 'x', parameters: { type: 'object', properties: {} } } },
        { type: 'function', function: { name: 'workspace_read', description: 'y', parameters: { type: 'object', properties: {} } } },
      ],
    } as any);
    const wireNames = sent.tools.map((t: any) => t.name);
    assert.deepEqual(wireNames, ['prom_mcp_server_manage', 'workspace_read']);
    assert.ok(!JSON.stringify(sent).match(/"name":"mcp_server_manage"/), 'no raw mcp_ name may reach the wire');
    assert.equal(result.message?.tool_calls?.[0]?.function?.name, 'mcp_server_manage');
  } finally {
    globalThis.fetch = originalFetch;
  }
  console.log('anthropic tool-name alias regression: ok');
})().catch((err) => { console.error(err); process.exit(1); });
