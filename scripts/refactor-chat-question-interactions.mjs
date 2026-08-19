import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const root = process.cwd();
const chatPath = path.join(root, 'web-ui/src/pages/ChatPage.js');
const genChatPath = path.join(root, 'generated/public-web-ui/static/pages/ChatPage.js');
const interactionsPath = path.join(root, 'web-ui/src/features/chat/questions/interactions.js');
const genInteractionsPath = path.join(root, 'generated/public-web-ui/static/features/chat/questions/interactions.js');
const cssPath = path.join(root, 'web-ui/src/features/chat/rendering/css-escape.js');
const genCssPath = path.join(root, 'generated/public-web-ui/static/features/chat/rendering/css-escape.js');
const baselinePath = path.join(root, 'scripts/web-ui-architecture-baseline.json');

const chat = fs.readFileSync(chatPath, 'utf8');
assert.equal(chat, fs.readFileSync(genChatPath, 'utf8'), 'ChatPage source/generated mirrors must match');
const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
const before = Buffer.byteLength(chat);
assert.equal(before, baseline.legacySurfaces['web-ui/src/pages/ChatPage.js'], 'ChatPage must match current architecture ratchet');

const sourceFile = ts.createSourceFile('ChatPage.js', chat, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const functionNodes = new Map();
for (const statement of sourceFile.statements) {
  if (!ts.isFunctionDeclaration(statement) || !statement.name?.text) continue;
  const name = statement.name.text;
  if (!functionNodes.has(name)) functionNodes.set(name, []);
  functionNodes.get(name).push(statement);
}

function extractFunction(name) {
  const matches = functionNodes.get(name) || [];
  assert.equal(matches.length, 1, `${name} must have exactly one top-level function declaration`);
  const node = matches[0];
  const start = node.getStart(sourceFile, false);
  let end = node.end;
  while (chat[end] === '\r' || chat[end] === '\n') end += 1;
  return { name, start, end, text: chat.slice(start, node.end) };
}

const css = extractFunction('cssEscapeValue');
const interactionNames = [
  'toggleQuestionRadio',
  'toggleQuestionOther',
  'collectPrometheusQuestionAnswers',
  'applyPrometheusQuestionComposerAnswer',
];
const interactions = interactionNames.map(extractFunction);
const extractedBytes = [css, ...interactions].reduce((sum, part) => sum + Buffer.byteLength(part.text), 0);
assert.ok(extractedBytes >= 2500 && extractedBytes <= 18000, `interaction extraction size ${extractedBytes} is implausible`);

const cssSource = `/** Escape dynamic values used in CSS selectors. */\nexport ${css.text.trim()}\n`;
const interactionSource = `import { cssEscapeValue } from '../rendering/css-escape.js';\n\n/** DOM-only Prometheus Question interaction helpers. */\n${interactions.map((part) => `export ${part.text.trim()}`).join('\n\n')}\n`;

let nextChat = chat;
for (const part of [css, ...interactions].sort((a, b) => b.start - a.start)) {
  nextChat = nextChat.slice(0, part.start) + nextChat.slice(part.end);
}

const anchor = "import { renderInlinePrometheusQuestion } from '../features/chat/questions/QuestionCard.js';\n";
assert.equal(nextChat.split(anchor).length, 2, 'QuestionCard import anchor must be unique');
nextChat = nextChat.replace(
  anchor,
  anchor
    + "import { applyPrometheusQuestionComposerAnswer, collectPrometheusQuestionAnswers, toggleQuestionOther, toggleQuestionRadio } from '../features/chat/questions/interactions.js';\n"
    + "import { cssEscapeValue } from '../features/chat/rendering/css-escape.js';\n",
);

for (const name of ['cssEscapeValue', ...interactionNames]) {
  assert.equal(nextChat.includes(`function ${name}(`), false, `${name} declaration must move out of ChatPage`);
}
for (const name of interactionNames) {
  const references = nextChat.match(new RegExp(`\\b${name}\\b`, 'g')) || [];
  assert.ok(references.length >= 2, `${name} must retain at least one page reference in addition to its import`);
}
const cssReferences = nextChat.match(/\bcssEscapeValue\b/g) || [];
assert.ok(cssReferences.length >= 2, 'cssEscapeValue must retain at least one ChatPage use in addition to its import');

const after = Buffer.byteLength(nextChat);
assert.ok(after < before, 'ChatPage must shrink after interaction extraction');
baseline.legacySurfaces['web-ui/src/pages/ChatPage.js'] = after;

for (const [target, content] of [
  [interactionsPath, interactionSource],
  [genInteractionsPath, interactionSource],
  [cssPath, cssSource],
  [genCssPath, cssSource],
]) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}
fs.writeFileSync(chatPath, nextChat);
fs.writeFileSync(genChatPath, nextChat);
fs.writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`);

console.log(`Question interactions extracted: ${extractedBytes} bytes; ChatPage ${before} -> ${after}`);
