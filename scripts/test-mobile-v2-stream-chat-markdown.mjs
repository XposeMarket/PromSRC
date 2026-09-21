import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const panelSource = fs.readFileSync(path.join(root, 'web-ui/src/mobile-v2/features/shared/stream-chat-panel.js'), 'utf8');
const { normalizeText } = await import(pathToFileURL(path.join(root, 'web-ui/src/mobile-v2/ui/page-kit.js')).href);

assert.equal(
  normalizeText({ content: [{ text: 'Audit identifies prompt inheritance.' }, { text: '## Early completion' }, { text: '**Expected impact:** Seconds to minutes.' }] }),
  'Audit identifies prompt inheritance.\n## Early completion\n**Expected impact:** Seconds to minutes.',
  'multipart agent content must preserve Markdown block boundaries',
);
assert.match(panelSource, /renderMd\(String\(text\)\)/, 'assistant output must use the shared sanitized Markdown renderer');
assert.match(panelSource, /ensureMobileV2Markdown\(\)/, 'the panel must repaint when Markdown dependencies become ready');
assert.match(panelSource, /roleOf\(row\)==='user'[\s\S]{0,120}escapeHtml/, 'user text must remain plain escaped text');

console.log('mobile-v2 stream chat Markdown regression passed.');
