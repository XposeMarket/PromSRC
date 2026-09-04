import assert from 'node:assert/strict';
import {
  filterToolDefinitionsForWorkspaceMode,
  getWorkspaceToolMode,
  isTerminalFirstWorkspaceMode,
  normalizeWorkspaceToolMode,
} from './workspace-tool-mode';

function tool(name: string): { type: 'function'; function: { name: string } } {
  return { type: 'function', function: { name } };
}

const definitions = [
  tool('workspace_read'),
  tool('workspace_edit'),
  tool('read_file'),
  tool('write_file'),
  tool('git_status'),
  tool('workspace_git'),
  tool('workspace_safety'),
  tool('workspace_code_nav'),
  tool('run_tests'),
  tool('terminal'),
  tool('run_command'),
  tool('start_process'),
  tool('process_status'),
  tool('dev_source_read'),
];

assert.equal(normalizeWorkspaceToolMode(undefined), 'prometheus');
assert.equal(normalizeWorkspaceToolMode('prometheus'), 'prometheus');
assert.equal(normalizeWorkspaceToolMode('terminal-first'), 'terminal-first');
assert.equal(normalizeWorkspaceToolMode('terminal_first'), 'terminal-first');
assert.equal(normalizeWorkspaceToolMode('terminal'), 'terminal-first');
assert.equal(normalizeWorkspaceToolMode('shell'), 'terminal-first');
assert.equal(normalizeWorkspaceToolMode('unknown'), 'prometheus');

assert.equal(getWorkspaceToolMode({ tools: { workspace_mode: 'terminal-first' } }), 'terminal-first');
assert.equal(getWorkspaceToolMode({ workspaceMode: 'terminal-first' }), 'terminal-first');
assert.equal(getWorkspaceToolMode({ tools: { workspaceMode: 'terminal-first' } }), 'terminal-first');
assert.equal(getWorkspaceToolMode({ tools: { workspace_mode: 'prometheus' } }), 'prometheus');
assert.equal(isTerminalFirstWorkspaceMode({ tools: { workspace_mode: 'terminal-first' } }), true);
assert.equal(isTerminalFirstWorkspaceMode({ tools: { workspace_mode: 'prometheus' } }), false);

const defaultNames = filterToolDefinitionsForWorkspaceMode(definitions, 'prometheus').map((item) => item.function.name);
assert.deepEqual(defaultNames, definitions.map((item) => item.function.name));

const terminalFirstNames = filterToolDefinitionsForWorkspaceMode(definitions, 'terminal-first')
  .map((item) => item.function.name);
assert.deepEqual(terminalFirstNames, [
  'git_status',
  'workspace_git',
  'workspace_safety',
  'workspace_code_nav',
  'run_tests',
  'terminal',
  'run_command',
  'start_process',
  'process_status',
  'dev_source_read',
]);

const brainNativeNames = filterToolDefinitionsForWorkspaceMode(
  definitions,
  'terminal-first',
  { allowNativeFileTools: true },
).map((item) => item.function.name);
assert.deepEqual(
  brainNativeNames,
  definitions.map((item) => item.function.name),
  'an explicitly scoped Brain runtime must retain native workspace tools',
);

console.log(JSON.stringify({
  ok: true,
  defaultToolCount: defaultNames.length,
  terminalFirstToolCount: terminalFirstNames.length,
  terminalToolsRemainAvailable: terminalFirstNames.includes('run_command'),
  sourceToolsRemainSeparate: terminalFirstNames.includes('dev_source_read'),
  brainNativeToolsRestored: brainNativeNames.includes('workspace_edit') && brainNativeNames.includes('write_file'),
}, null, 2));
