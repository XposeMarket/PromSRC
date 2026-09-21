import assert from 'node:assert/strict';
import { normalizeWorkspaceWrapperTool } from './subagent-executor.js';

const normalized = normalizeWorkspaceWrapperTool('workspace_edit', {
  action: 'append',
  path: 'games/last-ward-vita/ISSUES.md',
  content: '\n| Open | New observation | Investigate |\n',
});
assert.deepEqual(normalized, {
  name: 'append_file',
  args: {
    filename: 'games/last-ward-vita/ISSUES.md',
    content: '\n| Open | New observation | Investigate |\n',
  },
});
console.log('Workspace append routing regression passed');
