import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = path.join(root, 'web-ui/src/pages/ChatPage.js');
const generatedPath = path.join(root, 'generated/public-web-ui/static/pages/ChatPage.js');
const modulePath = path.join(root, 'web-ui/src/features/chat/timeline/render-state.js');
const generatedModulePath = path.join(root, 'generated/public-web-ui/static/features/chat/timeline/render-state.js');
const baselinePath = path.join(root, 'scripts/web-ui-architecture-baseline.json');
const importAnchor = 'installToolActivityExpansionPersistence();';
const importLine = "import { captureApprovalDetailsState, captureProcessPanelScroll, captureQuestionDraftState, restoreApprovalDetailsState, restoreProcessPanelScroll, restoreQuestionDraftState } from '../features/chat/timeline/render-state.js';\n";
const names = [
  'captureProcessPanelScroll',
  'restoreProcessPanelScroll',
  'captureQuestionDraftState',
  'restoreQuestionDraftState',
  'captureApprovalDetailsState',
  'restoreApprovalDetailsState',
];

function functionSpan(source, name) {
  const marker = `function ${name}(`;
  const start = source.indexOf(marker);
  if (start < 0) throw new Error(`${name}: declaration not found`);
  if (source.indexOf(marker, start + marker.length) >= 0) throw new Error(`${name}: declaration is not unique`);
  const open = source.indexOf('{', start + marker.length);
  if (open < 0) throw new Error(`${name}: opening brace not found`);
  let depth = 1;
  let mode = 'code';
  for (let index = open + 1; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    if (mode === 'line') {
      if (char === '\n') mode = 'code';
      continue;
    }
    if (mode === 'block') {
      if (char === '*' && next === '/') { mode = 'code'; index += 1; }
      continue;
    }
    if (mode === 'single') {
      if (char === '\\') { index += 1; continue; }
      if (char === "'") mode = 'code';
      continue;
    }
    if (mode === 'double') {
      if (char === '\\') { index += 1; continue; }
      if (char === '"') mode = 'code';
      continue;
    }
    if (mode === 'template') {
      if (char === '\\') { index += 1; continue; }
      if (char === '`') mode = 'code';
      continue;
    }
    if (char === '/' && next === '/') { mode = 'line'; index += 1; continue; }
    if (char === '/' && next === '*') { mode = 'block'; index += 1; continue; }
    if (char === "'") { mode = 'single'; continue; }
    if (char === '"') { mode = 'double'; continue; }
    if (char === '`') { mode = 'template'; continue; }
    if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return { start, end: index + 1, text: source.slice(start, index + 1) };
    }
  }
  throw new Error(`${name}: closing brace not found`);
}

function transform(source) {
  if (source.includes(importLine.trim())) throw new Error('timeline render-state import already present');
  const spans = names.map((name) => ({ name, ...functionSpan(source, name) })).sort((a, b) => a.start - b.start);
  for (let index = 1; index < spans.length; index += 1) {
    if (spans[index].start < spans[index - 1].end) throw new Error(`function spans overlap: ${spans[index - 1].name}/${spans[index].name}`);
  }
  const moduleSource = `/**\n * Timeline DOM snapshot/restore helpers.\n *\n * These preserve interactive state across the legacy full-message DOM rebuild\n * while ChatPage is incrementally decomposed toward a windowed timeline.\n */\n\n${spans.map((span) => `export ${span.text}`).join('\n\n')}\n`;

  let next = source;
  for (const span of [...spans].sort((a, b) => b.start - a.start)) {
    next = next.slice(0, span.start) + next.slice(span.end);
  }
  const anchor = next.indexOf(importAnchor);
  if (anchor < 0 || next.indexOf(importAnchor, anchor + importAnchor.length) >= 0) throw new Error('import anchor missing or not unique');
  next = next.slice(0, anchor) + importLine + next.slice(anchor);

  for (const name of names) {
    if (next.includes(`function ${name}(`)) throw new Error(`${name}: declaration remained in ChatPage.js`);
    if (!new RegExp(`\\b${name}\\(`).test(next)) throw new Error(`${name}: no call site remains in ChatPage.js`);
  }
  return { next, moduleSource };
}

const source = fs.readFileSync(sourcePath, 'utf8');
const generated = fs.readFileSync(generatedPath, 'utf8');
if (source !== generated) throw new Error('ChatPage source/public mirror must match before extraction');
const { next, moduleSource } = transform(source);

fs.mkdirSync(path.dirname(modulePath), { recursive: true });
fs.mkdirSync(path.dirname(generatedModulePath), { recursive: true });
fs.writeFileSync(sourcePath, next);
fs.writeFileSync(generatedPath, next);
fs.writeFileSync(modulePath, moduleSource);
fs.writeFileSync(generatedModulePath, moduleSource);

const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
const nextBytes = Buffer.byteLength(next);
const previous = Number(baseline?.legacySurfaces?.['web-ui/src/pages/ChatPage.js'] || 0);
if (!previous || nextBytes >= previous) throw new Error(`ChatPage ratchet did not shrink: ${nextBytes} >= ${previous}`);
baseline.legacySurfaces['web-ui/src/pages/ChatPage.js'] = nextBytes;
fs.writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`);
console.log(`Extracted timeline render state from ChatPage.js: ${previous} -> ${nextBytes} bytes`);
