import assert from 'node:assert/strict';
import { parseTextToolCalls, recoverLocalToolCalls } from './local-tool-calls';
import { OllamaAdapter } from './ollama-adapter';
import { OpenAICompatAdapter } from './openai-compat-adapter';
import { createServer } from 'node:http';

// Representative public Qwen/Hermes protocol envelopes, not claimed model captures.
const fixtures = [
  '<tool_call>\n{"name":"read","arguments":{"path":"a.txt"}}\n</tool_call>',
  '<tool_call>{"function":{"name":"read","arguments":"{\\"path\\":\\"a.txt\\"}"}}</tool_call>',
  '```json\n{"name":"read","arguments":{"path":"a.txt"}}\n```',
  '<tool_call>{"name":"read","parameters":{"path":"a.txt"}}</tool_call>',
];
let checks = 0;
for (const text of fixtures) {
  const calls = parseTextToolCalls(text, new Set(['read']));
  assert.equal(calls.length, 1); assert.equal(calls[0].function.name, 'read');
  assert.deepEqual(JSON.parse(calls[0].function.arguments), { path: 'a.txt' }); checks++;
}
for (const text of ['plain response', '<tool_call>{broken}</tool_call>', '<tool_call>{"name":"read","arguments":[]}</tool_call>', '<think>'+fixtures[0]+'</think>', '{"name":"read","arguments":{}}']) {
  assert.deepEqual(parseTextToolCalls(text), []); checks++;
}
assert.equal(recoverLocalToolCalls(fixtures[0], undefined, undefined), undefined); checks++;
assert.equal(recoverLocalToolCalls(fixtures[0], undefined, [{function:{name:'other'}}]), undefined); checks++;
const native = [{id:'native', type:'function' as const, function:{name:'read',arguments:'{}'}}];
assert.equal(recoverLocalToolCalls(fixtures[0], native, [{function:{name:'read'}}]), native); checks++;
assert.equal(parseTextToolCalls(fixtures[0]+fixtures[2]).length, 2); checks++;

// Exercise the actual Ollama adapter in both callback and internal-stream paths.
async function main() {
  for (const streaming of [false, true]) {
    const adapter = new OllamaAdapter('http://127.0.0.1:1');
    (adapter as any).client = { chat: async function* () {
      for (const content of [fixtures[0].slice(0,23), fixtures[0].slice(23)]) yield {message:{content}};
    }};
    const result = await adapter.chat([{role:'user',content:'Read a.txt'}], 'qwen-fixture', {
      tools:[{type:'function',function:{name:'read',description:'Read',parameters:{type:'object',properties:{}}}}],
      ...(streaming ? {onToken: (_text: string) => {}} : {}),
    });
    assert.equal(result.message.tool_calls?.[0].function.name, 'read'); checks++;
  }
  for (const streaming of [false, true]) {
    const adapter = new OllamaAdapter('http://127.0.0.1:1');
    (adapter as any).client = {chat: async function* () {
      yield {message:{tool_calls:[native[0]]}};
      yield {message:{tool_calls:[{...native[0],id:'second'}]}};
    }};
    const result = await adapter.chat([{role:'user',content:'Read twice'}], 'fixture', streaming ? {onToken: () => {}} : {});
    assert.equal(result.message.tool_calls?.length, 2); checks++;
  }
  const server = createServer((req, res) => {
    let body = ''; req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      if (JSON.parse(body).stream) {
        res.writeHead(200, {'Content-Type':'text/event-stream'});
        for (const content of [fixtures[0].slice(0,23), fixtures[0].slice(23)]) res.write(`data: ${JSON.stringify({choices:[{delta:{content}}]})}\n\n`);
        res.end('data: [DONE]\n\n');
      } else { res.setHeader('Content-Type','application/json'); res.end(JSON.stringify({choices:[{message:{content:fixtures[0]}}]})); }
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const endpoint = `http://127.0.0.1:${(server.address() as any).port}`;
    for (const providerId of ['lm_studio', 'llama_cpp', 'openai'] as const) {
      for (const streaming of [false, true]) {
        const adapter = new OpenAICompatAdapter({providerId, endpoint});
        const result = await adapter.chat([{role:'user',content:'Read'}], 'fixture', {
          tools:[{type:'function',function:{name:'read',description:'Read',parameters:{type:'object',properties:{}}}}],
          ...(streaming ? {onToken: (_text: string) => {}} : {}),
        });
        assert.equal(result.message.tool_calls?.length ?? 0, providerId === 'openai' ? 0 : 1); checks++;
      }
    }
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
  console.log(`local-tool-loop: ${checks} checks passed`);
}
void main().catch(error => {console.error(error); process.exitCode=1;});
