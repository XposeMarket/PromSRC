import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { highlightMobileVoiceMarkdown } from '../web-ui/src/mobile/mobile-voice-markdown-highlight.js';

const { document } = parseHTML('<html><body></body></html>');
const markdown = '<h2>Here are the tools</h2><p>Try <strong>bold words</strong> and <a href="https://example.com/?a=1&amp;b=2">a link</a>.</p><ul><li>First item</li><li>Second item</li></ul><pre><code>npm run test</code></pre>';
const original = document.createElement('div');
original.innerHTML = markdown;
for (const progress of [0, .2, .52, .98, 1]) {
  const highlighted = highlightMobileVoiceMarkdown(markdown, progress, document);
  const result = document.createElement('div');
  result.innerHTML = highlighted;
  assert.equal(result.textContent, original.textContent, 'visible Markdown text must not change');
  assert.equal(result.querySelector('a')?.getAttribute('href'), 'https://example.com/?a=1&b=2');
  assert.equal(result.querySelector('strong')?.textContent, 'bold words');
  assert.equal(result.querySelector('li')?.textContent, 'First item');
  assert.equal(result.querySelector('pre code')?.textContent, 'npm run test');
  assert.equal(result.querySelector('pre .pm-voice-word'), null, 'code must not be split');
  assert.ok(result.querySelectorAll('.pm-voice-word').length >= 12);
  if (progress === 1) assert.equal(result.querySelectorAll('.pm-voice-word--pending').length, 0);
}
assert.equal(highlightMobileVoiceMarkdown('<p>Hey</p>', .5, null), '<p>Hey</p>');
console.log('PASS voice Markdown structure, text, link, code, and completed highlighting');
