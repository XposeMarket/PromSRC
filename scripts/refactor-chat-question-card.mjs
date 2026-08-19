import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const sourceChatPath = path.join(root, 'web-ui/src/pages/ChatPage.js');
const generatedChatPath = path.join(root, 'generated/public-web-ui/static/pages/ChatPage.js');
const sourceCardPath = path.join(root, 'web-ui/src/features/chat/questions/QuestionCard.js');
const generatedCardPath = path.join(root, 'generated/public-web-ui/static/features/chat/questions/QuestionCard.js');
const baselinePath = path.join(root, 'scripts/web-ui-architecture-baseline.json');

function skipQuoted(source, index, quote) {
  for (let i = index + 1; i < source.length; i += 1) {
    if (source[i] === '\\') { i += 1; continue; }
    if (source[i] === quote) return i;
  }
  throw new Error(`Unterminated ${quote} string`);
}
function skipLineComment(source, index) { let i = index + 2; while (i < source.length && source[i] !== '\n') i += 1; return i; }
function skipBlockComment(source, index) { const end = source.indexOf('*/', index + 2); if (end < 0) throw new Error('Unterminated block comment'); return end + 1; }
function scanInterpolation(source, index) {
  let depth = 1;
  for (let i = index; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === "'" || ch === '"') { i = skipQuoted(source, i, ch); continue; }
    if (ch === '`') { i = skipTemplate(source, i); continue; }
    if (ch === '/' && source[i + 1] === '/') { i = skipLineComment(source, i); continue; }
    if (ch === '/' && source[i + 1] === '*') { i = skipBlockComment(source, i); continue; }
    if (ch === '{') depth += 1;
    else if (ch === '}') { depth -= 1; if (depth === 0) return i; }
  }
  throw new Error('Unterminated template interpolation');
}
function skipTemplate(source, index) {
  for (let i = index + 1; i < source.length; i += 1) {
    if (source[i] === '\\') { i += 1; continue; }
    if (source[i] === '`') return i;
    if (source[i] === '$' && source[i + 1] === '{') i = scanInterpolation(source, i + 2);
  }
  throw new Error('Unterminated template literal');
}
function findClosingParen(source, openIndex) {
  let depth = 0;
  for (let i = openIndex; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === "'" || ch === '"') { i = skipQuoted(source, i, ch); continue; }
    if (ch === '`') { i = skipTemplate(source, i); continue; }
    if (ch === '/' && source[i + 1] === '/') { i = skipLineComment(source, i); continue; }
    if (ch === '/' && source[i + 1] === '*') { i = skipBlockComment(source, i); continue; }
    if (ch === '(') depth += 1;
    else if (ch === ')') { depth -= 1; if (depth === 0) return i; }
  }
  throw new Error('Unterminated parameter list');
}
function findClosingBrace(source, openIndex) {
  let depth = 0;
  for (let i = openIndex; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === "'" || ch === '"') { i = skipQuoted(source, i, ch); continue; }
    if (ch === '`') { i = skipTemplate(source, i); continue; }
    if (ch === '/' && source[i + 1] === '/') { i = skipLineComment(source, i); continue; }
    if (ch === '/' && source[i + 1] === '*') { i = skipBlockComment(source, i); continue; }
    if (ch === '{') depth += 1;
    else if (ch === '}') { depth -= 1; if (depth === 0) return i; }
  }
  throw new Error('Unterminated function body');
}
function locateFunction(source, name) {
  const needle = `function ${name}(`;
  const start = source.indexOf(needle);
  assert.notEqual(start, -1, `${name} declaration missing`);
  assert.equal(source.indexOf(needle, start + needle.length), -1, `${name} declaration must be unique`);
  const openParen = source.indexOf('(', start + `function ${name}`.length);
  const closeParen = findClosingParen(source, openParen);
  let bodyStart = closeParen + 1;
  while (/\s/.test(source[bodyStart])) bodyStart += 1;
  assert.equal(source[bodyStart], '{', `${name} body must begin with {`);
  const bodyEnd = findClosingBrace(source, bodyStart);
  let end = bodyEnd + 1;
  while (source[end] === '\r' || source[end] === '\n') end += 1;
  return { start, end, text: source.slice(start, end) };
}

const sourceChat = fs.readFileSync(sourceChatPath, 'utf8');
const generatedChat = fs.readFileSync(generatedChatPath, 'utf8');
assert.equal(sourceChat, generatedChat, 'ChatPage source/generated mirror must match before extraction');
const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
const priorBytes = Buffer.byteLength(sourceChat);
assert.equal(priorBytes, baseline.legacySurfaces['web-ui/src/pages/ChatPage.js'], 'ChatPage must match current architecture ratchet before extraction');

const target = locateFunction(sourceChat, 'renderInlinePrometheusQuestion');
const extractedBytes = Buffer.byteLength(target.text);
assert.ok(extractedBytes >= 2500 && extractedBytes <= 15000, `Question Card extraction size ${extractedBytes} is implausible`);

const cardSource = `import { escHtml } from '../../../utils.js';\nimport { normalizePrometheusQuestionRecord } from './model.js';\nimport { encodeInlineJsString } from '../rendering/inline-escape.js';\n\n/** Render a Prometheus Question Card without owning answer submission/session state. */\nexport ${target.text.trim()}\n`;
const importLine = "import { renderInlinePrometheusQuestion } from '../features/chat/questions/QuestionCard.js';\n";
const anchor = "import { normalizePrometheusQuestionRecord } from '../features/chat/questions/model.js';\n";
assert.equal(sourceChat.split(anchor).length, 2, 'Question Card import anchor must be unique');

let nextChat = sourceChat.slice(0, target.start) + sourceChat.slice(target.end);
nextChat = nextChat.replace(anchor, anchor + importLine);
assert.equal(nextChat.includes('function renderInlinePrometheusQuestion('), false, 'old Question Card renderer must be removed');
assert.ok((nextChat.match(/renderInlinePrometheusQuestion\(/g) || []).length >= 1, 'Question Card call sites must remain');
const nextBytes = Buffer.byteLength(nextChat);
assert.ok(nextBytes < priorBytes, 'ChatPage must shrink after Question Card extraction');
baseline.legacySurfaces['web-ui/src/pages/ChatPage.js'] = nextBytes;

fs.mkdirSync(path.dirname(sourceCardPath), { recursive: true });
fs.mkdirSync(path.dirname(generatedCardPath), { recursive: true });
fs.writeFileSync(sourceCardPath, cardSource);
fs.writeFileSync(generatedCardPath, cardSource);
fs.writeFileSync(sourceChatPath, nextChat);
fs.writeFileSync(generatedChatPath, nextChat);
fs.writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`);
console.log(`Question Card extracted: ${extractedBytes} bytes; ChatPage ${priorBytes} -> ${nextBytes}`);
