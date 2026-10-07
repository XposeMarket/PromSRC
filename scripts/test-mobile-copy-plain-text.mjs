// Regression: mobile "Copy" on a reply must give plain text, not markdown source.
import assert from 'node:assert/strict';
import fs from 'node:fs';

const src = fs.readFileSync(new URL('../web-ui/src/mobile/mobile-pages.js', import.meta.url), 'utf8');
const start = src.indexOf('const MOBILE_COPY_DROP_FENCES');
const end = src.indexOf('function _mobileMessageCopyText');
assert.ok(start > 0 && end > start, 'mobileMarkdownToPlainText not found');
const mobileMarkdownToPlainText = new Function(`${src.slice(start, end)}; return mobileMarkdownToPlainText;`)();

const input = [
  'PR-1 is open as **[#557](https://github.com/XposeMarket/PromSRC/pull/557)**. Nothing in live `PromSRC` changed.',
  '',
  '## What it removes',
  '',
  '- **About 1,776 lines in `chat.router.ts`**, across 29 chunks.',
  '* *italic* and ~~gone~~ and snake_case_name stays',
  '',
  '| File | Lines |',
  '|---|---:|',
  '| chat.router.ts | 24,303 → **22,480** |',
  '',
  '---',
  '',
  '```ts',
  'const x = **not bold**;',
  '```',
  '',
  '```followups',
  '["Merged — pull, build and restart"]',
  '```',
  '',
  '```writing',
  '{"kind":"Post","text":"hello world"}',
  '```',
  '{{card:abc123}}',
  '![Proof shot](shots/a.png)',
].join('\n');

const out = mobileMarkdownToPlainText(input);
const expect = (s) => assert.ok(out.includes(s), `missing: ${s}\n---\n${out}`);
const reject = (s) => assert.ok(!out.includes(s), `should not contain: ${s}\n---\n${out}`);

expect('PR-1 is open as #557. Nothing in live PromSRC changed.');
expect('What it removes');
expect('- About 1,776 lines in chat.router.ts, across 29 chunks.');
expect('- italic and gone and snake_case_name stays');
expect('File\tLines');
expect('chat.router.ts\t24,303 → 22,480');
expect('const x = **not bold**;');
expect('hello world');
expect('Proof shot');
for (const bad of ['**', '##', '](', '|---', '```', 'followups', 'Merged — pull', '{{card', '`']) {
  if (bad === '**') { assert.equal(out.replace('const x = **not bold**;', '').includes('**'), false, out); continue; }
  reject(bad);
}
assert.equal(mobileMarkdownToPlainText(''), '');
assert.equal(mobileMarkdownToPlainText('just text'), 'just text');
console.log('test-mobile-copy-plain-text: ok');
