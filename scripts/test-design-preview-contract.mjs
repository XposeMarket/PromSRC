import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(root, 'web-ui', 'src', 'pages', 'ChatPage.js'), 'utf8');

assert.match(source, /const isDesignMode = normalizeCreativeMode\(window\.currentCreativeMode\) === 'design';/);
assert.match(
  source,
  /if \(useProjectPreview \|\| \(isDesignMode && !tab\.isImage && !tab\.isBinary\)\) \{\s*sandboxPermissions\.push\('allow-same-origin'\);/s,
  'Design and project previews must retain the parent DOM bridge',
);
assert.match(source, /function setupDesignPreviewSelection\(frame, tab\)/);
assert.match(source, /doc\.addEventListener\('mouseover'/);
assert.match(source, /showDesignActionPopover\(target, frame\)/);

console.log('[test-design-preview-contract] passed: coding-file Design previews retain hover and Edit/Chat/Select interactions');
