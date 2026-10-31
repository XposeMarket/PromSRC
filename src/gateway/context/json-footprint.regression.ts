import assert from 'node:assert/strict';
import { countJsonContainerChars } from './json-footprint';
import { estimateTextTokensForModel } from './model-context';

const shared = { content: 'same object twice' };
const fixtures: unknown[] = [
  {}, [], { a: 1, b: true, c: null }, [undefined, , NaN, Infinity, -Infinity, -0, 1e-7, 1e21],
  { omitted: undefined, fn: () => 1, symbol: Symbol('x'), kept: false },
  { text: 'quote" slash\\ /\b\f\n\r\t\u0000\u001f', unicode: 'é你好😀\ud800x\udc00\ud800\ud800\udc00' },
  { a: shared, b: shared, list: [shared, shared] }, Object.assign(Object.create(null), { x: 'null prototype' }),
  { 'escaped\n"key': { nested: [1, 2, { a: 'value' }] } },
];
for (const value of fixtures) {
  const json = JSON.stringify(value);
  assert.equal(countJsonContainerChars(value), json.length, json);
  for (const tokenizer of ['openai', 'anthropic', 'qwen', 'llama', 'gemini', 'heuristic'] as const) {
    assert.equal(Math.ceil(countJsonContainerChars(value)! / 3.1), estimateTextTokensForModel(json, tokenizer));
  }
}
let seed = 47;
const random = () => (seed = (seed * 1664525 + 1013904223) >>> 0);
for (let n = 0; n < 250; n += 1) {
  const text = Array.from({ length: 60 }, () => String.fromCharCode(random() % 65536)).join('');
  const value = { [text.slice(0, 4)]: [text, n, n % 2 === 0, null] };
  assert.equal(countJsonContainerChars(value), JSON.stringify(value).length);
}
let calls = 0;
const getter = { get text() { calls++; return 'value'; } };
const custom = { toJSON() { calls++; return { replacement: true }; } };
for (const value of [getter, custom, [new Date()], [new Number(3)], { n: 1n }, new Map(), new Set(), Object.create({ x: 1 })]) {
  assert.equal(countJsonContainerChars(value), undefined);
}
const proxy = new Proxy({}, { getPrototypeOf() { calls++; return Object.prototype; } });
assert.equal(countJsonContainerChars(proxy), undefined);
assert.equal(calls, 0, 'probe never invokes getters, proxies or toJSON before native fallback');
const cycle: any = {}; cycle.self = cycle;
assert.equal(countJsonContainerChars(cycle), undefined);
assert.equal(countJsonContainerChars({ text: 'after cycle' }), JSON.stringify({ text: 'after cycle' }).length);
for (const value of [null, undefined, 'text', 123, true]) assert.equal(countJsonContainerChars(value), undefined);
// Multi-megabyte traces must not be copied by JSON.stringify, even for strings.
const big = 'trace "quoted"\\\n😀'.repeat(150_000);
const transcript = { history: Array.from({ length: 8 }, (_, i) => ({ content: big, processEntries: [{ i, text: big }] })) };
const expected = JSON.stringify(transcript).length;
const nativeStringify = JSON.stringify;
try {
  JSON.stringify = (() => { throw new Error('whole-transcript serialization forbidden'); }) as typeof JSON.stringify;
  assert.equal(countJsonContainerChars(transcript), expected);
} finally { JSON.stringify = nativeStringify; }
console.log(`PASS JSON footprint: ${fixtures.length} fixtures, 250 Unicode cases, fallback safety, ${expected} character transcript without serialization`);
process.exit(0);
