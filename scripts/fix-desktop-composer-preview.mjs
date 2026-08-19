import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(root, 'web-ui/src/pages/ChatPage.js'), 'utf8');
const modulePath = path.join(root, 'web-ui/src/features/chat/composer/desktop-composer.js');
const generatedPath = path.join(root, 'generated/public-web-ui/static/features/chat/composer/desktop-composer.js');
const names = ['renderUnifiedDesktopComposerHtml', 'toggleUnifiedDesktopComposerDictation'];

function functionText(name) {
  const marker = `function ${name}(`;
  const start = source.indexOf(marker);
  if (start < 0 || source.indexOf(marker, start + marker.length) >= 0) throw new Error(`${name}: declaration missing or not unique`);
  const signatureEnd = source.indexOf(') {', start + marker.length);
  if (signatureEnd < 0) throw new Error(`${name}: function body opener not found`);
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
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error(`${name}: function closing brace not found`);
}

const moduleSource = `/** Desktop composer rendering/dictation staged verbatim for dependency review. */\n\n${names.map((name) => `export ${functionText(name)}`).join('\n\n')}\n`;
if (!moduleSource.includes('export function renderUnifiedDesktopComposerHtml(options = {}) {')) throw new Error('composer renderer signature was not extracted correctly');
if (!moduleSource.includes('export function toggleUnifiedDesktopComposerDictation(inputId, button = null) {')) throw new Error('dictation signature was not extracted correctly');
fs.writeFileSync(modulePath, moduleSource);
fs.writeFileSync(generatedPath, moduleSource);
console.log(`Corrected desktop composer preview (${Buffer.byteLength(moduleSource)} bytes).`);
