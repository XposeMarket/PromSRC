// Regression: harness tool calls map onto native Prometheus tool names/args so the
// chat stream labels them exactly like Prometheus tools.
import assert from 'node:assert/strict';
import { acpToolToNative, claudeToolToNative, codexItemToNative, toolResultText } from './native-tool-map';

assert.deepStrictEqual(claudeToolToNative('Bash', { command: 'node --version' }), { name: 'run_command', args: { command: 'node --version' } });
assert.deepStrictEqual(claudeToolToNative('PowerShell', { command: 'Get-ChildItem' }), { name: 'run_command', args: { command: 'Get-ChildItem' } });
assert.deepStrictEqual(claudeToolToNative('Read', { file_path: 'C:/x/notes.md' }), { name: 'read_file', args: { path: 'C:/x/notes.md' } });
assert.deepStrictEqual(claudeToolToNative('Edit', { file_path: 'a.ts', old_string: 'x' }), { name: 'edit_file', args: { path: 'a.ts' } });
assert.deepStrictEqual(claudeToolToNative('Grep', { pattern: 'foo', path: 'src' }), { name: 'grep_files', args: { pattern: 'foo', path: 'src' } });
assert.strictEqual(claudeToolToNative('TodoWrite', {}).name, 'complete_plan_step');
assert.strictEqual(claudeToolToNative('mcp__github__get_file', { a: 1 }).name, 'mcp__github__get_file');
assert.strictEqual(claudeToolToNative('SomethingNew', {}).name, 'something_new');

assert.deepStrictEqual(acpToolToNative({ kind: 'execute', title: 'node --version', rawInput: { command: 'node --version' } }), { name: 'run_command', args: { command: 'node --version' } });
assert.deepStrictEqual(acpToolToNative({ kind: 'read', title: 'read_file: notes.md', locations: [{ path: 'C:/x/notes.md' }] }), { name: 'read_file', args: { path: 'C:/x/notes.md' } });
assert.deepStrictEqual(acpToolToNative({ kind: 'execute', title: 'ls -la' }), { name: 'run_command', args: { command: 'ls -la' } });
assert.deepStrictEqual(acpToolToNative({ kind: 'other', title: 'Thinking it over' }), { name: '', args: { title: 'Thinking it over' } });

assert.deepStrictEqual(codexItemToNative('commandExecution', { command: 'npm test' }), { name: 'run_command', args: { command: 'npm test' } });
assert.deepStrictEqual(codexItemToNative('fileChange', { changes: [{ path: 'a.ts' }] }), { name: 'edit_file', args: { path: 'a.ts' } });
assert.deepStrictEqual(codexItemToNative('webSearch', { query: 'acp spec' }), { name: 'web_search', args: { query: 'acp spec' } });

assert.strictEqual(toolResultText([{ type: 'text', text: 'v20.20.2' }]), 'v20.20.2');
assert.strictEqual(toolResultText([{ type: 'content', content: { type: 'text', text: 'ok' } }]), 'ok');
assert.strictEqual(toolResultText('plain'), 'plain');

console.log('native-tool-map regression: ok');
