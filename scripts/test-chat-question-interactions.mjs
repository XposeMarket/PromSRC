import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { parseHTML } from 'linkedom';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const interactionsPath = path.join(root, 'web-ui/src/features/chat/questions/interactions.js');
const generatedInteractionsPath = path.join(root, 'generated/public-web-ui/static/features/chat/questions/interactions.js');
const cssEscapePath = path.join(root, 'web-ui/src/features/chat/rendering/css-escape.js');
const generatedCssEscapePath = path.join(root, 'generated/public-web-ui/static/features/chat/rendering/css-escape.js');
const chatPath = path.join(root, 'web-ui/src/pages/ChatPage.js');

assert.equal(fs.readFileSync(interactionsPath, 'utf8'), fs.readFileSync(generatedInteractionsPath, 'utf8'), 'Question interactions source must match its public mirror');
assert.equal(fs.readFileSync(cssEscapePath, 'utf8'), fs.readFileSync(generatedCssEscapePath, 'utf8'), 'CSS escape source must match its public mirror');

const { window } = parseHTML(`
<html><body>
  <div class="chat-question-card" data-question-id="question-1" data-question-compose-target="choice::other">
    <input id="radio-a" type="radio" data-question-id="choice" value="A">
    <input id="radio-b" type="radio" data-question-id="choice" value="B">
    <div data-question-compose-id="choice"></div>
    <input data-question-other="choice" value="Custom option">
    <input type="checkbox" data-question-id="multi" value="X">
    <input type="checkbox" data-question-id="multi" value="Y">
    <textarea data-question-text="notes">Typed note</textarea>
    <textarea data-question-general-other="1">General note</textarea>
  </div>
  <textarea id="chat-input"></textarea>
</body></html>
`);
globalThis.window = window;
globalThis.document = window.document;
globalThis.Event = window.Event;

const cssMod = await import(`${pathToFileURL(cssEscapePath).href}?test=${Date.now()}`);
const interactions = await import(`${pathToFileURL(interactionsPath).href}?test=${Date.now()}`);

window.CSS = { escape: (value) => `native-${value}` };
assert.equal(cssMod.cssEscapeValue('a b'), 'native-a b');
window.CSS = undefined;
assert.equal(cssMod.cssEscapeValue('a"b['), 'a\\"b\\[');

const radioA = document.getElementById('radio-a');
radioA.checked = true;
let changeCount = 0;
radioA.addEventListener('change', () => { changeCount += 1; });
interactions.toggleQuestionRadio('radio-a');
await new Promise((resolve) => setTimeout(resolve, 5));
assert.equal(radioA.checked, false, 'clicking an already-selected single-select radio must clear it');
assert.equal(changeCount, 1, 'radio deselection must emit one change event');

let composerFocused = false;
document.getElementById('chat-input').focus = () => { composerFocused = true; };
interactions.toggleQuestionOther('question-1', 'choice');
const card = document.querySelector('[data-question-id="question-1"]');
assert.equal(card.getAttribute('data-question-compose-target'), 'choice::other');
assert.equal(composerFocused, true, 'Other targeting must focus the main composer');

radioA.checked = true;
document.getElementById('radio-b').checked = true;
const multi = card.querySelectorAll('[data-question-id="multi"]');
multi[0].checked = true;
multi[1].checked = true;
const question = {
  id: 'question-1',
  questions: [
    { id: 'choice', label: 'Choice', mode: 'single_select', allowOther: true },
    { id: 'multi', label: 'Multi', mode: 'multi_select' },
    { id: 'notes', label: 'Notes', mode: 'text' },
  ],
  allowGeneralOther: true,
};
const collected = interactions.collectPrometheusQuestionAnswers(question);
assert.deepEqual(collected.answers[0].selected, ['A'], 'single-select answers must remain bounded to one value');
assert.equal(collected.answers[0].other, 'Custom option');
assert.deepEqual(collected.answers[1].selected, ['X', 'Y']);
assert.equal(collected.answers[2].text, 'Typed note');
assert.equal(collected.generalOther, 'General note');

const payload = structuredClone(collected);
interactions.applyPrometheusQuestionComposerAnswer(question, payload, 'Composer override');
assert.equal(payload.answers[0].other, 'Composer override', 'explicit ::other target must route composer text to the selected answer Other field');

card.removeAttribute('data-question-compose-target');
const textPayload = { answers: question.questions.map((item) => ({ id: item.id, text: '', other: '', selected: [] })), generalOther: '' };
interactions.applyPrometheusQuestionComposerAnswer(question, textPayload, 'Text fallback');
assert.equal(textPayload.answers[2].text, 'Text fallback', 'without an explicit target, the first text question must receive composer text');

const generalPayload = { answers: [], generalOther: '' };
interactions.applyPrometheusQuestionComposerAnswer({ id: 'question-1', questions: [], allowGeneralOther: true }, generalPayload, 'General fallback');
assert.equal(generalPayload.generalOther, 'General fallback');

const chat = fs.readFileSync(chatPath, 'utf8');
assert.match(chat, /from '\.\.\/features\/chat\/questions\/interactions\.js'/);
assert.match(chat, /from '\.\.\/features\/chat\/rendering\/css-escape\.js'/);
for (const name of ['toggleQuestionRadio', 'toggleQuestionOther', 'collectPrometheusQuestionAnswers', 'applyPrometheusQuestionComposerAnswer', 'cssEscapeValue']) {
  assert.equal(chat.includes(`function ${name}(`), false, `${name} declaration must not remain in ChatPage`);
}
for (const name of ['toggleQuestionRadio', 'toggleQuestionOther', 'collectPrometheusQuestionAnswers', 'applyPrometheusQuestionComposerAnswer']) {
  assert.ok((chat.match(new RegExp(`\\b${name}\\b`, 'g')) || []).length >= 2, `${name} must remain referenced by ChatPage/controller wiring`);
}

console.log('Chat Question interaction contract passed.');
