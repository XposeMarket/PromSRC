import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { highlightMobileVoiceMarkdown, mobileVoiceWordSpeechWeight } from '../web-ui/src/mobile/mobile-voice-markdown-highlight.js';

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

// Time-weighted progress: long words and sentence pauses take more of the audio.
assert.ok(mobileVoiceWordSpeechWeight('internationalization') > mobileVoiceWordSpeechWeight('a') * 3, 'long words weigh more');
assert.ok(mobileVoiceWordSpeechWeight('done.') > mobileVoiceWordSpeechWeight('done'), 'sentence end adds a pause');
const spokenAt = (html, p) => {
  const div = document.createElement('div');
  div.innerHTML = highlightMobileVoiceMarkdown(html, p, document);
  return div.querySelectorAll('.pm-voice-word--spoken').length;
};
const para = '<p>I think so. Extraordinarily complicated infrastructure considerations remain unresolved.</p>';
// Halfway through the audio must NOT be halfway through the word count: the
// short opener is spoken quickly, so more than half the words are done by 50%.
assert.ok(spokenAt(para, 0.25) >= 2, 'short opener words finish early');
assert.ok(spokenAt(para, 0.5) < 7, 'long tail words are not rushed');
let last = -1;
for (let p = 0; p <= 1.0001; p += 0.05) { const n = spokenAt(para, p); assert.ok(n >= last, 'monotonic'); last = n; }
assert.equal(spokenAt(para, 1), 9);
console.log('PASS voice Markdown structure, text, link, code, and completed highlighting');
