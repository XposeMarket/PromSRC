import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const write = (p, v) => { fs.mkdirSync(path.dirname(path.join(root, p)), { recursive: true }); fs.writeFileSync(path.join(root, p), v); };
const replaceOnce = (source, from, to, label) => {
  const first = source.indexOf(from);
  if (first < 0) throw new Error(`Missing replacement target: ${label}`);
  if (source.indexOf(from, first + from.length) >= 0) throw new Error(`Ambiguous replacement target: ${label}`);
  return source.slice(0, first) + to + source.slice(first + from.length);
};

// Fix #348: repeated recovery must not append the same durable trace forever.
const helperPath = 'web-ui/src/mobile/mobile-background-trace-merge.js';
write(helperPath, `function traceIdentity(entry) {
  if (!entry || typeof entry !== 'object') return \`primitive:\${String(entry)}\`;
  const activity = entry.activity && typeof entry.activity === 'object' ? entry.activity : {};
  const extra = entry.extra && typeof entry.extra === 'object' ? entry.extra : {};
  const type = String(entry.type || '').trim().toLowerCase();
  const stableId = String(
    entry.id || entry.eventKey || extra.eventKey
    || activity.callId || activity.call_id || activity.activityId
    || extra.callId || extra.call_id || extra.toolCallId || extra.tool_call_id
    || entry.callId || entry.call_id || entry.toolCallId || '',
  ).trim();
  if (stableId) return \`id:\${type}:\${stableId}\`;
  try { return \`value:\${JSON.stringify(entry)}\`; } catch { return \`fallback:\${type}:\${String(entry.text || entry.content || '')}:\${String(entry.time || entry.ts || '')}\`; }
}

export function mergeMobileBackgroundTraceEntries(currentEntries = [], recoveredEntries = [], limit = 500) {
  const seen = new Set();
  const merged = [];
  for (const entry of [...(Array.isArray(currentEntries) ? currentEntries : []), ...(Array.isArray(recoveredEntries) ? recoveredEntries : [])]) {
    const key = traceIdentity(entry);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(entry);
  }
  return merged.slice(-Math.max(1, Number(limit) || 500));
}
`);

let renderer = read('web-ui/src/mobile/mobile-chat-renderer-runtime.js');
renderer = replaceOnce(
  renderer,
  "import { animateThinkingTextSwap, renderThinkingState } from '../utils.js';\n",
  "import { animateThinkingTextSwap, renderThinkingState } from '../utils.js';\nimport { mergeMobileBackgroundTraceEntries } from './mobile-background-trace-merge.js';\n",
  'mobile trace helper import',
);
renderer = replaceOnce(
  renderer,
  "    if (!Array.isArray(lane.message.liveTraceEntries)) lane.message.liveTraceEntries = [];\n    lane.message.liveTraceEntries = [...lane.message.liveTraceEntries, ...storedLiveTraceEntries].slice(-500);",
  "    lane.message.liveTraceEntries = mergeMobileBackgroundTraceEntries(\n      lane.message.liveTraceEntries,\n      storedLiveTraceEntries,\n      500,\n    );",
  'idempotent mobile trace merge',
);
write('web-ui/src/mobile/mobile-chat-renderer-runtime.js', renderer);

write('scripts/test-mobile-background-trace-merge.mjs', `import assert from 'node:assert/strict';
import { mergeMobileBackgroundTraceEntries } from '../web-ui/src/mobile/mobile-background-trace-merge.js';

const live = [{ type: 'tool', id: 'evt-1', text: 'live newer' }];
const durable = [
  { type: 'tool', id: 'evt-1', text: 'durable older' },
  { type: 'result', id: 'evt-1', text: 'done' },
  { type: 'think', text: 'durable thought', ts: 7 },
];
const once = mergeMobileBackgroundTraceEntries(live, durable);
const twice = mergeMobileBackgroundTraceEntries(once, durable);
assert.equal(once.length, 3, 'tool + result + thought should remain distinct');
assert.equal(twice.length, once.length, 'repeated recovery must be idempotent');
assert.equal(twice[0].text, 'live newer', 'live entry should win over stale durable duplicate');
assert.deepEqual(twice, once, 'second recovery must not mutate trace ordering/content');
console.log('mobile background trace merge regression passed');
`);

// Fix #350/#343: preserve UTF-8 code points split across 64 KiB read chunks.
let materializer = read('src/gateway/audit/materializer.ts');
materializer = replaceOnce(materializer, "import { fork, type ChildProcess } from 'child_process';\n", "import { fork, type ChildProcess } from 'child_process';\nimport { StringDecoder } from 'string_decoder';\n", 'StringDecoder import');
materializer = replaceOnce(materializer, 'function streamLinesSync(filePath: string, maxLineBytes: number, onLine: (line: string, truncated: boolean) => void): StreamLinesResult {', 'export function streamLinesSync(filePath: string, maxLineBytes: number, onLine: (line: string, truncated: boolean) => void): StreamLinesResult {', 'export streamLinesSync');
materializer = replaceOnce(materializer, "  const buffer = Buffer.allocUnsafe(64 * 1024);\n  let position = 0;", "  const buffer = Buffer.allocUnsafe(64 * 1024);\n  const decoder = new StringDecoder('utf8');\n  let position = 0;", 'stateful UTF-8 decoder');
materializer = replaceOnce(materializer, "      feed(buffer.toString('utf8', 0, count));\n    }\n    if (discardingOversizedLine) {", "      feed(decoder.write(buffer.subarray(0, count)));\n    }\n    const decodedTail = decoder.end();\n    if (decodedTail) feed(decodedTail);\n    if (discardingOversizedLine) {", 'stream decoder use');
write('src/gateway/audit/materializer.ts', materializer);

write('src/gateway/audit/materializer.utf8-boundary.regression.ts', `import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { streamLinesSync } from './materializer.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-audit-utf8-'));
try {
  const file = path.join(root, 'boundary.txt');
  const prefix = 'x'.repeat((64 * 1024) - 1);
  const expected = prefix + '😀' + '-tail';
  fs.writeFileSync(file, expected + '\\n', 'utf8');
  const lines: string[] = [];
  const result = streamLinesSync(file, 2 * 1024 * 1024, (line, truncated) => {
    assert.equal(truncated, false);
    lines.push(line);
  });
  assert.equal(result.lines, 1);
  assert.deepEqual(lines, [expected]);
  assert.equal(lines[0].includes('�'), false, 'split UTF-8 sequence must never be replaced');
  console.log('audit UTF-8 boundary regression passed');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
`);

console.log('Applied merged regression fixes');
