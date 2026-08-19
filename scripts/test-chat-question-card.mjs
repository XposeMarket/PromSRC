import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { parseHTML } from 'linkedom';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cardPath = path.join(root, 'web-ui/src/features/chat/questions/QuestionCard.js');
const generatedCardPath = path.join(root, 'generated/public-web-ui/static/features/chat/questions/QuestionCard.js');
const chatPath = path.join(root, 'web-ui/src/pages/ChatPage.js');

assert.equal(
  fs.readFileSync(cardPath, 'utf8'),
  fs.readFileSync(generatedCardPath, 'utf8'),
  'Question Card source must match its public mirror',
);

// QuestionCard uses the shared browser escHtml utility. Install minimal DOM globals
// before importing so the component is exercised in a browser-like environment.
const { window } = parseHTML('<html><body></body></html>');
globalThis.window = window;
globalThis.document = window.document;
globalThis.Event = window.Event;

const { renderInlinePrometheusQuestion } = await import(`${pathToFileURL(cardPath).href}?test=${Date.now()}`);

const pending = renderInlinePrometheusQuestion({
  id: 'question"<&',
  title: 'Choose <one>',
  prompt: 'What should Prometheus do?',
  context: 'This & that',
  status: 'pending',
  questions: [
    { id: 'choice', label: 'Pick one', mode: 'single_select', options: ['A', 'B'], allowOther: true },
    { id: 'notes', label: 'Notes', mode: 'text', required: false },
  ],
});
assert.match(pending, /chat-question-card-pending/);
assert.match(pending, /Prometheus has a few questions/);
assert.match(pending, /Choose &lt;one&gt;/);
assert.match(pending, /This &amp; that/);
assert.match(pending, /type="radio"/);
assert.match(pending, /toggleQuestionRadio\(/);
assert.match(pending, /toggleQuestionOther\(/);
assert.match(pending, /cancelInlinePrometheusQuestion\(/);
assert.match(pending, /\(optional\)/);
assert.equal(pending.includes('data-question-id="question"<&"'), false, 'Question ids must be escaped in markup');

const resolved = renderInlinePrometheusQuestion({
  id: 'answered-1',
  title: 'Done',
  status: 'answered',
  questions: [
    { id: 'choice', label: 'Pick one', mode: 'single_select', options: ['A', 'B'] },
    { id: 'notes', label: 'Notes', mode: 'text' },
  ],
  answers: [
    { id: 'choice', selected: ['B'], other: 'Custom' },
    { id: 'notes', text: 'Finished' },
  ],
  generalOther: 'Anything else',
});
assert.match(resolved, /Question result/);
assert.match(resolved, /B/);
assert.match(resolved, /Other: Custom/);
assert.match(resolved, /Finished/);
assert.match(resolved, /Anything else/);
assert.match(resolved, /This question was answered\./);
assert.equal(resolved.includes('chat-approval-actions'), false);

const chat = fs.readFileSync(chatPath, 'utf8');
assert.match(chat, /from '\.\.\/features\/chat\/questions\/QuestionCard\.js'/);
assert.equal(chat.includes('function renderInlinePrometheusQuestion('), false);
assert.match(chat, /renderInlinePrometheusQuestion\(/);

console.log('Chat Question Card component contract passed.');
