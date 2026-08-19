import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(root, 'web-ui/src/pages/ChatPage.js'), 'utf8');
const output = path.join(root, 'web-ui/src/features/chat/approvals/model.js');
const generatedOutput = path.join(root, 'generated/public-web-ui/static/features/chat/approvals/model.js');
const names = ['getApprovalRiskLevel', 'normalizeChatApprovalRecord'];

function functionText(name) {
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
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error(`${name}: closing brace not found`);
}

const moduleSource = `/** Pure approval normalization and risk classification. */\n\n${names.map((name) => `export ${functionText(name)}`).join('\n\n')}\n`;
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.mkdirSync(path.dirname(generatedOutput), { recursive: true });
fs.writeFileSync(output, moduleSource);
fs.writeFileSync(generatedOutput, moduleSource);
console.log(`Staged approval model (${Buffer.byteLength(moduleSource)} bytes).`);
