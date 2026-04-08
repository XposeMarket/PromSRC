// Quick diagnostic: test Ollama directly with the same SDK the gateway uses
import { Ollama } from 'ollama';

const client = new Ollama({ host: 'http://localhost:11434' });

console.log('--- Testing Ollama connection ---');

// Test 1: list models
try {
  const models = await client.list();
  console.log('✓ Models available:', models.models.map(m => m.name).join(', '));
} catch (e) {
  console.error('✗ list() failed:', e.message);
  process.exit(1);
}

// Test 2: streaming chat (same as gateway uses — stream:false hangs on Qwen3)
console.log('\n--- Test 2: streaming chat (stream:true, no think) ---');
try {
  const stream = await client.chat({
    model: 'qwen3:1.7b',
    messages: [{ role: 'user', content: 'Say exactly: OK' }],
    stream: true,
  });
  let out = '';
  for await (const chunk of stream) {
    out += chunk.message?.content || '';
  }
  console.log('✓ Response:', JSON.stringify(out).slice(0, 200));
} catch (e) {
  console.error('✗ streaming chat failed:', e.message);
}

// Test 3: streaming chat
console.log('\n--- Test 3: streaming chat ---');
try {
  const stream = await client.chat({
    model: 'qwen3.5:4b',
    messages: [{ role: 'user', content: 'Say exactly: STREAM_OK' }],
    stream: true,
  });
  let out = '';
  for await (const chunk of stream) {
    out += chunk.message?.content || '';
  }
  console.log('✓ Stream response:', JSON.stringify(out).slice(0, 200));
} catch (e) {
  console.error('✗ stream chat failed:', e.message);
}

// Test 4: chat with think:false
console.log('\n--- Test 4: chat with think:false ---');
try {
  const r = await client.chat({
    model: 'qwen3.5:4b',
    messages: [{ role: 'user', content: 'Say exactly: THINK_OK' }],
    stream: false,
    think: false,
  });
  console.log('✓ Response:', JSON.stringify(r.message?.content).slice(0, 200));
} catch (e) {
  console.error('✗ think:false failed:', e.message);
}

// Test 5: chat with think:true (what the adapter tries first)
console.log('\n--- Test 5: chat with think:true ---');
try {
  const r = await client.chat({
    model: 'qwen3.5:4b',
    messages: [{ role: 'user', content: 'Say exactly: THINK_TRUE_OK' }],
    stream: false,
    think: true,
  });
  console.log('✓ Response:', JSON.stringify(r.message?.content).slice(0, 200));
  console.log('  thinking:', JSON.stringify((r.thinking || '').slice(0, 100)));
} catch (e) {
  console.error('✗ think:true failed:', e.message);
}

// Test 6: chat with tools (this is what gateway actually sends)
console.log('\n--- Test 6: chat with tools array ---');
try {
  const r = await client.chat({
    model: 'qwen3.5:4b',
    messages: [{ role: 'user', content: 'Say exactly: TOOLS_OK' }],
    stream: false,
    tools: [{
      type: 'function',
      function: {
        name: 'write_note',
        description: 'Save a note',
        parameters: { type: 'object', properties: { content: { type: 'string' } }, required: ['content'] }
      }
    }],
  });
  console.log('✓ Response:', JSON.stringify(r.message?.content).slice(0, 200));
} catch (e) {
  console.error('✗ tools chat failed:', e.message);
}

console.log('\n--- Done ---');
