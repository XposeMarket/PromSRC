import fs from 'node:fs';

const source = fs.readFileSync('src/gateway/chat/chat-state.ts', 'utf8');

if (!source.includes('return Number.MAX_SAFE_INTEGER;')) {
  throw new Error('interactive handleChat tool-round ceiling is bounded again');
}
if (source.includes('PROMETHEUS_INTERACTIVE_MAX_TOOL_ROUNDS')) {
  throw new Error('interactive fixed tool-round environment limit was reintroduced');
}
if (/return\s+48\s*;/.test(source)) {
  throw new Error('legacy 48-round interactive cap was reintroduced');
}

console.log('unbounded interactive tool-round contract passed');
