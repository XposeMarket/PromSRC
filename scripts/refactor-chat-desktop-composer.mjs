import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const chatPath = path.join(root, 'web-ui/src/pages/ChatPage.js');
const generatedChatPath = path.join(root, 'generated/public-web-ui/static/pages/ChatPage.js');
const modulePath = path.join(root, 'web-ui/src/features/chat/composer/desktop-composer.js');
const generatedModulePath = path.join(root, 'generated/public-web-ui/static/features/chat/composer/desktop-composer.js');
const baselinePath = path.join(root, 'scripts/web-ui-architecture-baseline.json');
const names = ['renderUnifiedDesktopComposerHtml', 'toggleUnifiedDesktopComposerDictation'];
const chatImport = "import { renderUnifiedDesktopComposerHtml, toggleUnifiedDesktopComposerDictation } from '../features/chat/composer/desktop-composer.js';\n";
const moduleImport = "import { escHtml, showToast } from '../../../utils.js';\n\n";
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
    const char = source[index];
    const next = source[index + 1];
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
const generatedChat = fs.readFileSync(generatedChatPath, 'utf8');
if (chat !== generatedChat) throw new Error('ChatPage source/public mirror must match before composer extraction');
if (chat.includes(chatImport.trim())) throw new Error('desktop composer import already present');

const spans = names.map((name) => ({ name, ...functionSpan(chat, name) })).sort((a, b) => b.start - a.start);
for (const span of spans) chat = chat.slice(0, span.start) + chat.slice(span.end);
const anchor = chat.indexOf(importAnchor);
if (anchor < 0 || chat.indexOf(importAnchor, anchor + importAnchor.length) >= 0) throw new Error('import anchor missing or not unique');
chat = chat.slice(0, anchor) + chatImport + chat.slice(anchor);
for (const name of names) {
  if (chat.includes(`function ${name}(`)) throw new Error(`${name}: declaration remained in ChatPage.js`);
  if (!new RegExp(`\\b${name}\\(`).test(chat)) throw new Error(`${name}: call sites disappeared`);
}

let moduleSource = fs.readFileSync(modulePath, 'utf8');
if (!moduleSource.startsWith(moduleImport)) moduleSource = moduleImport + moduleSource;
if (!moduleSource.includes('export function renderUnifiedDesktopComposerHtml(options = {}) {')) throw new Error('composer renderer export missing');
if (!moduleSource.includes('export function toggleUnifiedDesktopComposerDictation(inputId, button = null) {')) throw new Error('composer dictation export missing');

fs.writeFileSync(chatPath, chat);
fs.writeFileSync(generatedChatPath, chat);
fs.writeFileSync(modulePath, moduleSource);
fs.writeFileSync(generatedModulePath, moduleSource);

const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
const nextBytes = Buffer.byteLength(chat);
const previous = Number(baseline?.legacySurfaces?.['web-ui/src/pages/ChatPage.js'] || 0);
if (!previous || nextBytes >= previous) throw new Error(`ChatPage ratchet did not shrink: ${nextBytes} >= ${previous}`);
baseline.legacySurfaces['web-ui/src/pages/ChatPage.js'] = nextBytes;
fs.writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`);
console.log(`Extracted desktop composer from ChatPage.js: ${previous} -> ${nextBytes} bytes`);
