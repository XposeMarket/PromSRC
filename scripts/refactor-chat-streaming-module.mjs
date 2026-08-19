import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = path.join(root, 'web-ui/src/pages/ChatPage.js');
const generatedPath = path.join(root, 'generated/public-web-ui/static/pages/ChatPage.js');
const baselinePath = path.join(root, 'scripts/web-ui-architecture-baseline.json');
const importLine = "import { flushStreamingRenderFor, scheduleStreamingRenderFor } from '../features/chat/streaming/render-coalescer.js';\n";
const importAnchor = 'installToolActivityExpansionPersistence();';
const blockStartMarker = '// ── Streaming render coalescer';
const flushMarker = 'function flushStreamingRenderFor(sessionId, renderFn) {';

function transform(source, label) {
  if (source.includes(importLine.trim())) throw new Error(`${label}: stream coalescer import already present`);
  const start = source.indexOf(blockStartMarker);
  if (start < 0) throw new Error(`${label}: streaming render block start marker not found`);
  if (source.indexOf(blockStartMarker, start + blockStartMarker.length) >= 0) throw new Error(`${label}: streaming render block marker is not unique`);

  const flushStart = source.indexOf(flushMarker, start);
  if (flushStart < 0) throw new Error(`${label}: flush function not found after streaming marker`);
  const close = source.indexOf('\n}', flushStart);
  if (close < 0) throw new Error(`${label}: flush function closing brace not found`);
  const end = close + 2;
  const block = source.slice(start, end);

  for (const required of [
    'const STREAM_RENDER_THROTTLE_MS = 180;',
    'const _streamRenderTimers = new Map();',
    'function scheduleStreamingRenderFor(sessionId, renderFn)',
    'function flushStreamingRenderFor(sessionId, renderFn)',
  ]) {
    if (!block.includes(required)) throw new Error(`${label}: expected streaming block fragment missing: ${required}`);
  }

  const anchor = source.indexOf(importAnchor);
  if (anchor < 0) throw new Error(`${label}: import anchor not found`);
  if (source.indexOf(importAnchor, anchor + importAnchor.length) >= 0) throw new Error(`${label}: import anchor is not unique`);

  let next = source.slice(0, start) + source.slice(end);
  const nextAnchor = next.indexOf(importAnchor);
  next = next.slice(0, nextAnchor) + importLine + next.slice(nextAnchor);

  if (next.includes('const _streamRenderTimers = new Map()')) throw new Error(`${label}: legacy timer map remained after extraction`);
  if (next.includes('const STREAM_RENDER_THROTTLE_MS = 180;')) throw new Error(`${label}: legacy throttle constant remained after extraction`);
  if (!next.includes('scheduleStreamingRenderFor(thisSessionId')) throw new Error(`${label}: expected stream scheduling call sites disappeared`);
  if (!next.includes('flushStreamingRenderFor(thisSessionId')) throw new Error(`${label}: expected finalization flush call disappeared`);
  return next;
}

const source = fs.readFileSync(sourcePath, 'utf8');
const generated = fs.readFileSync(generatedPath, 'utf8');
if (source !== generated) throw new Error('ChatPage source/public mirror must match before extraction');

const transformed = transform(source, 'ChatPage.js');
fs.writeFileSync(sourcePath, transformed);
fs.writeFileSync(generatedPath, transformed);

const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
const nextBytes = Buffer.byteLength(transformed);
const previous = Number(baseline?.legacySurfaces?.['web-ui/src/pages/ChatPage.js'] || 0);
if (!previous || nextBytes >= previous) throw new Error(`ChatPage ratchet did not shrink: ${nextBytes} >= ${previous}`);
baseline.legacySurfaces['web-ui/src/pages/ChatPage.js'] = nextBytes;
fs.writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`);

console.log(`Extracted streaming render ownership from ChatPage.js: ${previous} -> ${nextBytes} bytes`);
