import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = path.join(root, 'web-ui/src/pages/ChatPage.js');
const modulePath = path.join(root, 'web-ui/src/features/chat/composer/desktop-composer.js');
const generatedModulePath = path.join(root, 'generated/public-web-ui/static/features/chat/composer/desktop-composer.js');
const names = ['renderUnifiedDesktopComposerHtml', 'toggleUnifiedDesktopComposerDictation'];

function functionSpan(source, name) {
  const marker = `function ${name}(`;
  const start = source.indexOf(marker);
  if (start < 0) throw new Error(`${name}: declaration not found`);
  if (source.indexOf(marker, start + marker.length) >= 0) throw new Error(`${name}: declaration not unique`);
  const open = source.indexOf('{', start + marker.length);
  if (open < 0) throw new Error(`${name}: opening brace not found`);
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
  throw new Error(`${name}: closing brace not found`);
}

const source = fs.readFileSync(sourcePath, 'utf8');
const snippets = names.map((name) => functionSpan(source, name));
const moduleSource = `/** Desktop composer rendering/dictation extracted verbatim for dependency review. */\n\n${snippets.map((snippet) => `export ${snippet}`).join('\n\n')}\n`;
fs.mkdirSync(path.dirname(modulePath), { recursive: true });
fs.mkdirSync(path.dirname(generatedModulePath), { recursive: true });
fs.writeFileSync(modulePath, moduleSource);
fs.writeFileSync(generatedModulePath, moduleSource);
console.log(`Extracted desktop composer preview (${Buffer.byteLength(moduleSource)} bytes).`);
