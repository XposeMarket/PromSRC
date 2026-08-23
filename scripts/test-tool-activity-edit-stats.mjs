import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const sourcePath = path.resolve('web-ui/src/tool-activity.js');
const source = fs.readFileSync(sourcePath, 'utf8');
const activity = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

const {
  applyToolActivityEvent,
  renderToolActivityEntry,
  toolActivityEditStats,
} = activity;

const escapeHtml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

function completedEdit(args, result = 'ok', extra = {}) {
  const entries = [];
  applyToolActivityEvent(entries, 'call', {
    toolCallId: 'edit_stats_call',
    action: 'workspace_edit',
    args,
  });
  return applyToolActivityEvent(entries, 'result', {
    toolCallId: 'edit_stats_call',
    action: 'workspace_edit',
    args,
    result,
    error: false,
    durationMs: 420,
    ...extra,
  });
}

{
  const entry = completedEdit(
    {
      action: 'replace_lines',
      path: 'src/example.js',
      start_line: 10,
      end_line: 11,
      new_content: 'alpha\nbeta\ngamma',
    },
    'Updated src/example.js: replaced lines 10-11.',
  );
  assert.deepEqual(toolActivityEditStats(entry.activity), { added: 3, removed: 2 });
  const html = renderToolActivityEntry(entry, escapeHtml);
  assert.match(html, /data-added-lines="3"/);
  assert.match(html, /data-removed-lines="2"/);
  assert.match(html, /tool-activity-edit-added[^>]*>\+3</);
  assert.match(html, /tool-activity-edit-removed[^>]*>−2</);
  assert.match(html, /\+3[\s\S]*−2[\s\S]*420 ms/, 'diff stats render before the duration');
  assert.match(html, /var\(--ok/);
  assert.match(html, /var\(--err/);
}

{
  const entry = completedEdit({
    action: 'find_replace',
    path: 'src/one-line.js',
    find: 'const oldValue = 1;',
    replace: 'const newValue = 2;',
  });
  assert.deepEqual(toolActivityEditStats(entry.activity), { added: 1, removed: 1 });
}

{
  const entry = completedEdit({
    action: 'apply_patch',
    patch: [
      'diff --git a/src/a.js b/src/a.js',
      '--- a/src/a.js',
      '+++ b/src/a.js',
      '@@ -1,2 +1,3 @@',
      '-old',
      '+new',
      '+another',
      ' keep',
    ].join('\n'),
  });
  assert.deepEqual(toolActivityEditStats(entry.activity), { added: 2, removed: 1 });
}

{
  const entry = completedEdit({
    action: 'patchset',
    edits: [
      { filename: 'a.js', op: 'insert_after', content: 'one\ntwo' },
      { filename: 'b.js', op: 'delete_lines', start_line: 4, end_line: 5 },
      { filename: 'c.js', op: 'replace_lines', start_line: 8, end_line: 9, new_content: 'replacement' },
    ],
  });
  assert.deepEqual(toolActivityEditStats(entry.activity), { added: 3, removed: 4 });
}

{
  const entry = completedEdit({
    action: 'create',
    path: 'src/new-file.js',
    content: 'first\nsecond\n',
  });
  assert.deepEqual(toolActivityEditStats(entry.activity), { added: 2, removed: 0 });
}

{
  const entry = completedEdit({
    action: 'write',
    path: 'src/existing.js',
    content: 'replacement file contents',
  });
  assert.equal(toolActivityEditStats(entry.activity), null, 'full-file overwrite omits invented diff stats');
}

{
  const entry = completedEdit(
    { action: 'delete_lines', path: 'src/fail.js', start_line: 1, end_line: 2 },
    'permission denied',
    { error: true },
  );
  assert.equal(toolActivityEditStats(entry.activity), null, 'failed edits never display change counts');
}

console.log('[tool-activity-edit-stats] cloud/workspace edit line additions and removals passed');
