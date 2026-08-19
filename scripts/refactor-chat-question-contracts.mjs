import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const root = process.cwd();
const chatPath = path.join(root, 'web-ui/src/pages/ChatPage.js');
const generatedChatPath = path.join(root, 'generated/public-web-ui/static/pages/ChatPage.js');
const contractsPath = path.join(root, 'web-ui/src/features/chat/questions/contracts.js');
const generatedContractsPath = path.join(root, 'generated/public-web-ui/static/features/chat/questions/contracts.js');
const baselinePath = path.join(root, 'scripts/web-ui-architecture-baseline.json');

const chat = fs.readFileSync(chatPath, 'utf8');
assert.equal(chat, fs.readFileSync(generatedChatPath, 'utf8'), 'ChatPage source/generated mirrors must match');
const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
const beforeBytes = Buffer.byteLength(chat);
assert.equal(beforeBytes, baseline.legacySurfaces['web-ui/src/pages/ChatPage.js'], 'ChatPage must match current architecture ratchet');

const sourceFile = ts.createSourceFile('ChatPage.js', chat, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const functions = new Map();
for (const statement of sourceFile.statements) {
  if (!ts.isFunctionDeclaration(statement) || !statement.name?.text) continue;
  if (!functions.has(statement.name.text)) functions.set(statement.name.text, []);
  functions.get(statement.name.text).push(statement);
}

function topLevelFunction(name) {
  const matches = functions.get(name) || [];
  assert.equal(matches.length, 1, `${name} must have exactly one top-level declaration`);
  const node = matches[0];
  const start = node.getStart(sourceFile, false);
  let end = node.end;
  while (chat[end] === '\r' || chat[end] === '\n') end += 1;
  return { name, node, start, end, text: chat.slice(start, node.end) };
}

const validation = topLevelFunction('getMissingPrometheusQuestionAnswers');
const eventAdapter = topLevelFunction('questionFromEventPayload');
const extractedBytes = Buffer.byteLength(validation.text) + Buffer.byteLength(eventAdapter.text);
assert.ok(extractedBytes >= 900 && extractedBytes <= 9000, `Question contracts extraction size ${extractedBytes} is implausible`);

const adaptedEventText = eventAdapter.text
  .replace('function questionFromEventPayload(event = {}, status = \'\') {', "function questionFromEventPayload(event = {}, status = '', defaultSessionId = '') {")
  .replace("String(event.sessionId || window.activeChatSessionId || '').trim()", "String(event.sessionId || defaultSessionId || '').trim()");
assert.equal(adaptedEventText.includes('window.'), false, 'Question event adapter must not retain window dependencies');
assert.notEqual(adaptedEventText, eventAdapter.text, 'Question event adapter must explicitly receive its session fallback');

const contractsSource = `import { normalizePrometheusQuestionRecord } from './model.js';\n\n/** Pure validation and event adaptation for Prometheus Question requests. */\nexport ${validation.text.trim()}\n\nexport ${adaptedEventText.trim()}\n`;

const callEdits = [];
function visit(node) {
  if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'questionFromEventPayload') {
    const insideDeclaration = node.getStart(sourceFile) >= eventAdapter.start && node.end <= eventAdapter.end;
    if (!insideDeclaration) {
      assert.ok(node.arguments.length >= 1 && node.arguments.length <= 2, `unexpected questionFromEventPayload arity: ${node.arguments.length}`);
      const insertion = node.arguments.length === 1
        ? ", '', window.activeChatSessionId"
        : ', window.activeChatSessionId';
      callEdits.push({ start: node.end - 1, end: node.end - 1, text: insertion });
    }
  }
  ts.forEachChild(node, visit);
}
visit(sourceFile);
assert.ok(callEdits.length >= 1, 'questionFromEventPayload must have at least one page call site');

const edits = [
  { start: validation.start, end: validation.end, text: '' },
  { start: eventAdapter.start, end: eventAdapter.end, text: '' },
  ...callEdits,
].sort((a, b) => b.start - a.start || b.end - a.end);

let nextChat = chat;
for (const edit of edits) {
  nextChat = nextChat.slice(0, edit.start) + edit.text + nextChat.slice(edit.end);
}

const anchor = "import { applyPrometheusQuestionComposerAnswer, collectPrometheusQuestionAnswers, toggleQuestionOther, toggleQuestionRadio } from '../features/chat/questions/interactions.js';\n";
assert.equal(nextChat.split(anchor).length, 2, 'Question interactions import anchor must be unique');
nextChat = nextChat.replace(anchor, anchor + "import { getMissingPrometheusQuestionAnswers, questionFromEventPayload } from '../features/chat/questions/contracts.js';\n");

assert.equal(nextChat.includes('function getMissingPrometheusQuestionAnswers('), false, 'validation declaration must move out of ChatPage');
assert.equal(nextChat.includes('function questionFromEventPayload('), false, 'event adapter declaration must move out of ChatPage');
assert.ok((nextChat.match(/getMissingPrometheusQuestionAnswers\(/g) || []).length >= 1, 'validation call sites must remain');
const remainingEventCalls = nextChat.match(/questionFromEventPayload\([^\n;]*/g) || [];
assert.ok(remainingEventCalls.length >= callEdits.length, 'event adapter call sites must remain');
assert.equal((nextChat.match(/questionFromEventPayload\(/g) || []).length, callEdits.length, 'only page event-adapter calls should remain');
for (const call of remainingEventCalls) {
  assert.ok(call.includes('window.activeChatSessionId'), 'every page event-adapter call must pass the active session fallback explicitly');
}

const afterBytes = Buffer.byteLength(nextChat);
assert.ok(afterBytes < beforeBytes, 'ChatPage must shrink after Question contract extraction');
baseline.legacySurfaces['web-ui/src/pages/ChatPage.js'] = afterBytes;

fs.mkdirSync(path.dirname(contractsPath), { recursive: true });
fs.mkdirSync(path.dirname(generatedContractsPath), { recursive: true });
fs.writeFileSync(contractsPath, contractsSource);
fs.writeFileSync(generatedContractsPath, contractsSource);
fs.writeFileSync(chatPath, nextChat);
fs.writeFileSync(generatedChatPath, nextChat);
fs.writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`);

console.log(`Question contracts extracted: ${extractedBytes} bytes; updated ${callEdits.length} event-adapter call site(s); ChatPage ${beforeBytes} -> ${afterBytes}`);
