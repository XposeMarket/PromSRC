// Regression: mobile project chats were listed twice (under the project and in
// the plain chat list) because the session normalizer dropped projectId, and
// pinned project chats stayed inside their project group instead of Pinned.
// Executes the real functions extracted from the shipped source.
import fs from 'node:fs';
import assert from 'node:assert/strict';

function extractFunction(file, name) {
  const src = fs.readFileSync(file, 'utf8');
  const start = src.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} not found in ${file}`);
  let depth = 0;
  let i = src.indexOf('{', start);
  for (; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') { depth -= 1; if (depth === 0) break; }
  }
  return src.slice(start, i + 1);
}

// 1. Normalizer keeps project membership.
const normalize = new Function(`${extractFunction('web-ui/src/mobile/mobile-api.js', '_normalizeSessionSummary')}; return _normalizeSessionSummary;`)();
const projectChat = normalize({ id: 'a', title: 'x', projectId: 'proj_1', projectName: 'OUTSIDE DC' });
assert.equal(projectChat.projectId, 'proj_1');
assert.equal(projectChat.projectName, 'OUTSIDE DC');
const plainChat = normalize({ id: 'b', title: 'y' });
assert.equal(plainChat.projectId, null, 'non-project chat must not gain a project');

// 2. Main list filter (same predicate as _sessionPageHtml) hides project chats only.
const mainList = [projectChat, plainChat].filter((s) => !s?.projectId && s?.source !== 'project');
assert.deepEqual(mainList.map((s) => s.id), ['b']);

// 3. Project group rows skip pinned chats; unpinned ones stay.
const rowsSrc = extractFunction('web-ui/src/mobile/mobile-shell.js', '_projectSessionRows');
const makeRows = (pinnedIds) => new Function(
  '_drawerExpandedProjectIds', '_isPinned', '_hydrateDrawerSessionStates', '_sessionButtonHtml',
  `${rowsSrc}; return _projectSessionRows;`,
)(new Set(['proj_1']), (id) => pinnedIds.includes(id), (rows) => rows, (s) => `[${s.id}]`);
const project = { id: 'proj_1', name: 'OUTSIDE DC', sessions: [{ id: 'p1' }, { id: 'p2' }] };
const pinnedHtml = makeRows(['p1'])(project);
assert.ok(!pinnedHtml.includes('[p1]'), 'pinned project chat must leave the project group');
assert.ok(pinnedHtml.includes('[p2]'));
const unpinnedHtml = makeRows([])(project);
assert.ok(unpinnedHtml.includes('[p1]') && unpinnedHtml.includes('[p2]'), 'unpinned chat returns to its project');

console.log('test-mobile-project-chat-drawer: PASS');
