import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const chatPath = path.join(root, 'web-ui/src/pages/ChatPage.js');
const generatedChatPath = path.join(root, 'generated/public-web-ui/static/pages/ChatPage.js');
const cardPath = path.join(root, 'web-ui/src/features/chat/approvals/ApprovalCard.js');
const generatedCardPath = path.join(root, 'generated/public-web-ui/static/features/chat/approvals/ApprovalCard.js');
const baselinePath = path.join(root, 'scripts/web-ui-architecture-baseline.json');
const imports = "import { renderInlineApprovalRequest } from '../features/chat/approvals/ApprovalCard.js';\nimport { encodeInlineJsString } from '../features/chat/rendering/inline-escape.js';\n";
const importAnchor = 'installToolActivityExpansionPersistence();';

function skipQuoted(source, index, quote) {
  for (let i = index + 1; i < source.length; i += 1) {
    if (source[i] === '\\') { i += 1; continue; }
    if (source[i] === quote) return i + 1;
  }
  throw new Error(`unterminated ${quote} string`);
}

function skipLineComment(source, index) {
  const end = source.indexOf('\n', index + 2);
  return end < 0 ? source.length : end + 1;
}

function skipBlockComment(source, index) {
  const end = source.indexOf('*/', index + 2);
  if (end < 0) throw new Error('unterminated block comment');
  return end + 2;
}

function skipRegex(source, index) {
  let inClass = false;
  for (let i = index + 1; i < source.length; i += 1) {
    const char = source[i];
    if (char === '\\') { i += 1; continue; }
    if (char === '[') { inClass = true; continue; }
    if (char === ']') { inClass = false; continue; }
    if (char === '/' && !inClass) {
      i += 1;
      while (/[a-z]/i.test(source[i] || '')) i += 1;
      return i;
    }
    if (char === '\n' || char === '\r') return index + 1;
  }
  return index + 1;
}

function isRegexStart(source, index) {
  let i = index - 1;
  while (i >= 0 && /\s/.test(source[i])) i -= 1;
  if (i < 0) return true;
  return /[({[=,:;!?&|+\-*%^~<>]/.test(source[i]);
}

function scanTemplate(source, index) {
  for (let i = index + 1; i < source.length;) {
    const char = source[i];
    if (char === '\\') { i += 2; continue; }
    if (char === '`') return i + 1;
    if (char === '$' && source[i + 1] === '{') {
      i = scanCodeBlock(source, i + 1);
      continue;
    }
    i += 1;
  }
  throw new Error('unterminated template literal');
}

function scanCodeBlock(source, openBraceIndex) {
  assert.equal(source[openBraceIndex], '{');
  let depth = 1;
  for (let i = openBraceIndex + 1; i < source.length;) {
    const char = source[i];
    const next = source[i + 1];
    if (char === "'" || char === '"') { i = skipQuoted(source, i, char); continue; }
    if (char === '`') { i = scanTemplate(source, i); continue; }
    if (char === '/' && next === '/') { i = skipLineComment(source, i); continue; }
    if (char === '/' && next === '*') { i = skipBlockComment(source, i); continue; }
    if (char === '/' && isRegexStart(source, i)) { i = skipRegex(source, i); continue; }
    if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
    i += 1;
  }
  throw new Error('unterminated code block');
}

function functionSpan(source, name) {
  const marker = `function ${name}(`;
  const start = source.indexOf(marker);
  assert.ok(start >= 0, `${name} declaration must exist`);
  assert.equal(source.indexOf(marker, start + marker.length), -1, `${name} declaration must be unique`);
  const open = source.indexOf('{', start + marker.length);
  assert.ok(open >= 0, `${name} opening brace must exist`);
  let end = scanCodeBlock(source, open);
  if (source[end] === '\r' && source[end + 1] === '\n') end += 2;
  else if (source[end] === '\n') end += 1;
  return { name, start, end, text: source.slice(start, end) };
}

const source = fs.readFileSync(chatPath, 'utf8');
assert.equal(source, fs.readFileSync(generatedChatPath, 'utf8'), 'ChatPage source/public mirror must match before extraction');
assert.equal(source.includes(imports.trim()), false, 'Approval Card imports must not already exist');
const spans = ['encodeInlineJsString', 'renderInlineApprovalRequest'].map((name) => functionSpan(source, name)).sort((a, b) => a.start - b.start);
assert.ok(spans[0].end <= spans[1].start, 'extraction ranges must not overlap');
const removedBytes = spans.reduce((sum, span) => sum + Buffer.byteLength(span.text), 0);
assert.ok(removedBytes > 5_000 && removedBytes < 20_000, `unexpected Approval Card extraction size: ${removedBytes} bytes`);

let next = source;
for (const span of [...spans].sort((a, b) => b.start - a.start)) next = next.slice(0, span.start) + next.slice(span.end);
const anchor = next.indexOf(importAnchor);
assert.ok(anchor >= 0 && next.indexOf(importAnchor, anchor + importAnchor.length) < 0, 'import anchor must be unique');
next = next.slice(0, anchor) + imports + next.slice(anchor);
for (const span of spans) assert.equal(next.includes(`function ${span.name}(`), false, `${span.name} must leave ChatPage.js`);
assert.match(next, /\brenderInlineApprovalRequest\(/);
assert.match(next, /\bencodeInlineJsString\(/);

const previousBytes = Buffer.byteLength(source);
const nextBytes = Buffer.byteLength(next);
assert.equal(nextBytes, previousBytes - removedBytes + Buffer.byteLength(imports), 'byte delta must exactly equal removed functions plus imports');
const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
assert.equal(Number(baseline.legacySurfaces['web-ui/src/pages/ChatPage.js']), previousBytes, 'ChatPage must match current ratchet before extraction');
baseline.legacySurfaces['web-ui/src/pages/ChatPage.js'] = nextBytes;

fs.writeFileSync(chatPath, next);
fs.writeFileSync(generatedChatPath, next);
fs.writeFileSync(generatedCardPath, fs.readFileSync(cardPath, 'utf8'));
fs.writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`);
console.log(`Safely extracted Approval Card: ${previousBytes} -> ${nextBytes} bytes; removed ${removedBytes} bytes before imports.`);
