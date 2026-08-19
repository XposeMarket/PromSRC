import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const chatPath = path.join(root, 'web-ui/src/pages/ChatPage.js');
const generatedChatPath = path.join(root, 'generated/public-web-ui/static/pages/ChatPage.js');
const baselinePath = path.join(root, 'scripts/web-ui-architecture-baseline.json');
const names = ['getApprovalRiskLevel', 'getApprovalToolLabel', 'summarizeApprovalForHumans', 'normalizeChatApprovalRecord'];
const importLine = "import { getApprovalRiskLevel, normalizeChatApprovalRecord } from '../features/chat/approvals/model.js';\n";
const importAnchor = 'installToolActivityExpansionPersistence();';

function functionSpan(source, name) {
  const marker = `function ${name}(`;
  const start = source.indexOf(marker);
  if (start < 0 || source.indexOf(marker, start + marker.length) >= 0) throw new Error(`${name}: declaration missing or not unique`);
  const signatureEnd = source.indexOf(') {', start + marker.length);
  if (signatureEnd < 0) throw new Error(`${name}: body opener not found`);
  const open = signatureEnd + 2;
  let depth = 1;
  let mode = 'code';
  for (let index = open + 1; index < source.length; index += 1) {
    const char = source[index], next = source[index + 1];
    if (mode === 'line') { if (char === '\n') mode = 'code'; continue; }
    if (mode === 'block') { if (char === '*' && next === '/') { mode = 'code'; index += 1; } continue; }
    if (mode === 'single') { if (char === '\\') { index += 1; continue; } if (char === "'") mode = 'code'; continue; }
    if (mode === 'double') { if (char === '\\') { index += 1; continue; } if (char === '"') mode = 'code'; continue; }
    if (mode === 'template') { if (char === '\\') { index += 1; continue; } if (char === '`') mode = 'code'; continue; }
    if (char === '/' && next === '/') { mode = 'line'; index += 1; continue; }
    if (char === '/' && next === '*') { mode = 'block'; index += 1; continue; }
    if (char === "'") { mode = 'single'; continue; }
    if (char === '"') { mode = 'double'; continue; }
    if (char === '`') { mode = 'template'; continue; }
    if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return { start, end: index + 1 };
    }
  }
  throw new Error(`${name}: closing brace not found`);
}

let chat = fs.readFileSync(chatPath, 'utf8');
const generated = fs.readFileSync(generatedChatPath, 'utf8');
if (chat !== generated) throw new Error('ChatPage source/public mirror must match before approval-model extraction');
if (chat.includes(importLine.trim())) throw new Error('approval model import already present');
const spans = names.map((name) => ({ name, ...functionSpan(chat, name) })).sort((a, b) => b.start - a.start);
for (const span of spans) chat = chat.slice(0, span.start) + chat.slice(span.end);
const anchor = chat.indexOf(importAnchor);
if (anchor < 0 || chat.indexOf(importAnchor, anchor + importAnchor.length) >= 0) throw new Error('import anchor missing or not unique');
chat = chat.slice(0, anchor) + importLine + chat.slice(anchor);
for (const name of names) {
  if (chat.includes(`function ${name}(`)) throw new Error(`${name}: declaration remained in ChatPage.js`);
}
if (!/\bnormalizeChatApprovalRecord\(/.test(chat)) throw new Error('approval normalization call sites disappeared');
if (!/\bgetApprovalRiskLevel\(/.test(chat)) throw new Error('approval risk call sites disappeared');
fs.writeFileSync(chatPath, chat);
fs.writeFileSync(generatedChatPath, chat);

const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
const nextBytes = Buffer.byteLength(chat);
const previous = Number(baseline?.legacySurfaces?.['web-ui/src/pages/ChatPage.js'] || 0);
if (!previous || nextBytes >= previous) throw new Error(`ChatPage ratchet did not shrink: ${nextBytes} >= ${previous}`);
baseline.legacySurfaces['web-ui/src/pages/ChatPage.js'] = nextBytes;
fs.writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`);
console.log(`Extracted approval model from ChatPage.js: ${previous} -> ${nextBytes} bytes`);
