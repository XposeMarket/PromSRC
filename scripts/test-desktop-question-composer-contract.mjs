import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const chatPage = read('web-ui/src/pages/ChatPage.js');
const styles = read('web-ui/src/styles/components.css');

const cardStart = chatPage.indexOf('function renderInlinePrometheusQuestion(');
const cardEnd = chatPage.indexOf('function toggleQuestionOther(', cardStart);
assert(cardStart >= 0 && cardEnd > cardStart, 'desktop question card renderer must remain discoverable');
const cardSource = chatPage.slice(cardStart, cardEnd);

assert.match(cardSource, /const visibleQuestions = pending \? \[question\.questions\[currentIndex\]\] : question\.questions/,
  'pending desktop cards must render only the active question');
assert.match(cardSource, /data-question-current-index=/,
  'desktop cards must expose their active step for draft preservation');
assert.match(cardSource, /data-question-submit=/,
  'desktop question cards must expose a semantic submit/next control');
assert.match(cardSource, /handleDesktopQuestionOptionChange\(/,
  'single-select options must participate in automatic step advance');
assert.match(cardSource, /Type your answer/,
  'text questions must own an inline answer field');
assert.match(cardSource, /Type another answer/,
  'Other answers must own an inline answer field');
assert.match(chatPage, /const desktopQuestionDrafts = new Map\(\)/,
  'desktop question steps must have a DOM-independent draft store');
assert.match(chatPage, /advanceStep: options\.advanceStep !== false/,
  'desktop submit must advance intermediate question steps locally');
assert.match(chatPage, /syncDesktopQuestionCardAfterStep\(/,
  'desktop step advance must repaint the single composer-owned card');
assert.match(chatPage, /desktopQuestionDrafts\.set\(qid, state\)/,
  'desktop question drafts must be saved before stream-driven repaints');
assert.match(styles, /\.chat-question-card \.pq-options[\s\S]*?border-top: 1px solid/,
  'desktop question options must have a light separating rule');
assert.match(styles, /\.chat-question-card \.pq-option[\s\S]*?border-bottom: 1px solid/,
  'desktop question options must be separated row by row');

console.log('Desktop question composer contract passed.');
