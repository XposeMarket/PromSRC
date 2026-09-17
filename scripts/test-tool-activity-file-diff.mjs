import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { renderToolActivityEntry } from '../web-ui/src/tool-activity.js';

const html = renderToolActivityEntry({
  id: 'edit-1',
  text: 'Updated src/example.js',
  activity: {
    key: 'file.edit',
    kind: 'result',
    ok: true,
    target: 'src/example.js',
    args: JSON.stringify({ patch: '@@ -8,2 +8,2 @@\n-oldValue();\n+newValue();' }),
  },
}, (value) => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]));

assert.match(html, /role="region"/);
assert.match(html, /tool-activity-diff-number[^>]*>8</);
assert.match(html, /tool-activity-diff-line is-removed/);
assert.match(html, /tool-activity-diff-line is-added/);
assert.match(html, /tool-activity-diff-marker[^>]*>−</);
assert.match(html, /tool-activity-diff-marker[^>]*>\+</);
assert.doesNotMatch(html, /<pre class="tool-activity-inline-detail tool-activity-file-diff"/);

const markupHtml = renderToolActivityEntry({
  id: 'edit-html',
  text: 'Updated page.html',
  activity: {
    key: 'file.edit',
    kind: 'result',
    ok: true,
    target: 'page.html',
    args: JSON.stringify({ patch: '@@ -1 +1 @@\n-<section><h2>Old</h2></section>\n+<section><h2>New</h2><p>Added</p></section>' }),
  },
}, (value) => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]));
assert.match(markupHtml, /data-added-lines="4" data-removed-lines="3"/);
assert.equal((markupHtml.match(/tool-activity-diff-line is-added/g) || []).length, 4);
assert.equal((markupHtml.match(/tool-activity-diff-line is-removed/g) || []).length, 3);
assert.match(markupHtml, /class="tok-tag">section</);
assert.match(markupHtml, /class="tok-tag">h2</);

const mobileCss = fs.readFileSync(path.join(process.cwd(), 'web-ui/src/styles/mobile.css'), 'utf8');
assert.match(mobileCss, /\.pm-trace-tool-body \.tool-activity-file-diff \.tool-activity-diff-code \.tok-tag/);
assert.match(mobileCss, /\.tok-string \{ color: #a6da95 !important; \}/);

console.log('[test-tool-activity-file-diff] passed: structured rows, line numbers, markers, and accessible region');
