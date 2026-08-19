import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const chatPath = path.join(root, 'web-ui/src/pages/ChatPage.js');
const generatedChatPath = path.join(root, 'generated/public-web-ui/static/pages/ChatPage.js');
const cardPath = path.join(root, 'web-ui/src/features/chat/approvals/ApprovalCard.js');
const generatedCardPath = path.join(root, 'generated/public-web-ui/static/features/chat/approvals/ApprovalCard.js');
const baselinePath = path.join(root, 'scripts/web-ui-architecture-baseline.json');
const names = new Set(['encodeInlineJsString', 'renderInlineApprovalRequest']);
const imports = "import { renderInlineApprovalRequest } from '../features/chat/approvals/ApprovalCard.js';\nimport { encodeInlineJsString } from '../features/chat/rendering/inline-escape.js';\n";
const importAnchor = 'installToolActivityExpansionPersistence();';

const source = fs.readFileSync(chatPath, 'utf8');
assert.equal(source, fs.readFileSync(generatedChatPath, 'utf8'), 'ChatPage source/public mirror must match before extraction');
assert.equal(source.includes(imports.trim()), false, 'Approval Card imports must not already exist');

const sourceFile = ts.createSourceFile(chatPath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const spans = [];
for (const statement of sourceFile.statements) {
  if (!ts.isFunctionDeclaration(statement) || !statement.name || !names.has(statement.name.text)) continue;
  let start = statement.getStart(sourceFile);
  let end = statement.end;
  if (source[end] === '\r' && source[end + 1] === '\n') end += 2;
  else if (source[end] === '\n') end += 1;
  spans.push({ name: statement.name.text, start, end, text: source.slice(start, end) });
}
assert.deepEqual(new Set(spans.map((span) => span.name)), names, 'AST must find exactly the two intended top-level functions');
assert.equal(spans.length, 2, 'AST must find each intended function exactly once');
spans.sort((a, b) => a.start - b.start);
assert.ok(spans[0].end <= spans[1].start, 'extraction ranges must not overlap');

const removedBytes = spans.reduce((sum, span) => sum + Buffer.byteLength(span.text), 0);
assert.ok(removedBytes > 5_000 && removedBytes < 20_000, `unexpected Approval Card extraction size: ${removedBytes} bytes`);

let next = source;
for (const span of [...spans].sort((a, b) => b.start - a.start)) next = next.slice(0, span.start) + next.slice(span.end);
const anchor = next.indexOf(importAnchor);
assert.ok(anchor >= 0 && next.indexOf(importAnchor, anchor + importAnchor.length) < 0, 'import anchor must exist exactly once');
next = next.slice(0, anchor) + imports + next.slice(anchor);

for (const name of names) assert.equal(next.includes(`function ${name}(`), false, `${name} declaration must leave ChatPage.js`);
assert.match(next, /\brenderInlineApprovalRequest\(/, 'Approval Card call sites must remain');
assert.match(next, /\bencodeInlineJsString\(/, 'shared inline escaping call sites must remain');
const previousBytes = Buffer.byteLength(source);
const nextBytes = Buffer.byteLength(next);
assert.equal(nextBytes, previousBytes - removedBytes + Buffer.byteLength(imports), 'ChatPage byte delta must exactly match AST removals plus imports');

fs.writeFileSync(chatPath, next);
fs.writeFileSync(generatedChatPath, next);
const card = fs.readFileSync(cardPath, 'utf8');
assert.match(card, /export function renderInlineApprovalRequest\(item\)/);
assert.match(card, /normalizeChatApprovalRecord\(item\)/);
fs.mkdirSync(path.dirname(generatedCardPath), { recursive: true });
fs.writeFileSync(generatedCardPath, card);

const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
const priorRatchet = Number(baseline?.legacySurfaces?.['web-ui/src/pages/ChatPage.js'] || 0);
assert.equal(priorRatchet, previousBytes, 'ChatPage must match its current architecture ratchet before extraction');
assert.ok(nextBytes < previousBytes, 'ChatPage must shrink');
baseline.legacySurfaces['web-ui/src/pages/ChatPage.js'] = nextBytes;
fs.writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`);
console.log(`AST-extracted Approval Card from ChatPage.js: ${previousBytes} -> ${nextBytes} bytes (${removedBytes} removed before imports)`);
