import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = path.join(root, 'web-ui/src/features/chat/questions/model.js');
const generatedPath = path.join(root, 'generated/public-web-ui/static/features/chat/questions/model.js');
const chatPath = path.join(root, 'web-ui/src/pages/ChatPage.js');

assert.equal(
  fs.readFileSync(sourcePath, 'utf8'),
  fs.readFileSync(generatedPath, 'utf8'),
  'Question model source must match its public mirror',
);

const { normalizePrometheusQuestionRecord } = await import(`${pathToFileURL(sourcePath).href}?test=${Date.now()}`);

const normalized = normalizePrometheusQuestionRecord({
  questionId: ' question-1 ',
  sourceSessionId: ' session-1 ',
  title: ' Pick a path ',
  prompt: ' Choose carefully ',
  context: ' Existing project ',
  questions: [
    { id: 'choice', label: 'Choose', mode: 'single_select', options: ['A', ' B ', '', 'C'], allowOther: false },
    { label: 'Explain', mode: 'text', required: false, help_text: 'Optional detail' },
    { label: 'Fallback mode', mode: 'unsupported', options: ['1', '2'] },
    { label: 'Four' },
    { label: 'Five' },
    { label: 'Must be truncated' },
  ],
  allowGeneralOther: false,
  status: ' ANSWERED ',
  answers: [{ id: 'choice', selected: ['A'] }],
  generalOther: ' extra ',
});

assert.equal(normalized.id, 'question-1');
assert.equal(normalized.sessionId, 'session-1');
assert.equal(normalized.title, 'Pick a path');
assert.equal(normalized.prompt, 'Choose carefully');
assert.equal(normalized.context, 'Existing project');
assert.equal(normalized.questions.length, 5, 'Question model must retain the existing five-question bound');
assert.deepEqual(normalized.questions[0].options, ['A', 'B', 'C']);
assert.equal(normalized.questions[0].allowOther, false);
assert.equal(normalized.questions[1].id, 'q2');
assert.equal(normalized.questions[1].mode, 'text');
assert.equal(normalized.questions[1].required, false);
assert.equal(normalized.questions[1].helpText, 'Optional detail');
assert.equal(normalized.questions[2].mode, 'single_select');
assert.equal(normalized.allowGeneralOther, false);
assert.equal(normalized.status, 'answered');
assert.deepEqual(normalized.answers, [{ id: 'choice', selected: ['A'] }]);
assert.equal(normalized.generalOther, 'extra');

const fallback = normalizePrometheusQuestionRecord({}, {
  id: 'fallback-id',
  sessionId: 'fallback-session',
  summary: 'Fallback prompt',
  questions: [{ question: 'Fallback question', mode: 'multi_select', options: Array.from({ length: 10 }, (_, i) => `opt-${i}`) }],
});
assert.equal(fallback.id, 'fallback-id');
assert.equal(fallback.sessionId, 'fallback-session');
assert.equal(fallback.prompt, 'Fallback prompt');
assert.equal(fallback.questions[0].label, 'Fallback question');
assert.equal(fallback.questions[0].mode, 'multi_select');
assert.equal(fallback.questions[0].options.length, 8, 'Question options must retain the existing eight-option bound');
assert.equal(fallback.status, 'pending');

const chat = fs.readFileSync(chatPath, 'utf8');
assert.match(chat, /from '\.\.\/features\/chat\/questions\/model\.js'/);
assert.equal(chat.includes('function normalizePrometheusQuestionRecord('), false);
assert.ok((chat.match(/normalizePrometheusQuestionRecord\(/g) || []).length >= 3, 'Question normalization call sites must remain in ChatPage');

console.log('Chat Question model contract passed.');
