import fs from 'node:fs';

const state = fs.readFileSync('src/gateway/chat/chat-state.ts', 'utf8');

if (!state.includes('return Number.MAX_SAFE_INTEGER;')) {
  throw new Error('interactive chat tool-round ceiling is bounded again');
}
if (!state.includes('delete process.env.PROMETHEUS_INTERACTIVE_MAX_TOOL_ROUNDS;')) {
  throw new Error('legacy interactive max-round environment override can restore the boundary');
}
if (/return\s+48\s*;/.test(state)) {
  throw new Error('legacy 48-round interactive ceiling was reintroduced');
}

console.log('interactive tool-round boundary regression passed');
