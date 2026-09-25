import assert from 'node:assert/strict';
import { slimToolsForExtraUsageRetry } from './anthropic-adapter';

const names = [
  'web_search','memory','write_note','request_tool_category','read_file','search_files',
  'workspace_run','workspace_edit','workspace_read','workspace_git',
  'desktop_screen','desktop_apps','desktop_input',
  ...Array.from({ length: 80 }, (_, i) => `browser_extra_${i}`),
];
const tools = names.map((name) => ({ name, description: '', input_schema: { type: 'object' } }));
const messages = [
  { role: 'user', content: 'set up the extension' },
  { role: 'assistant', content: [
    { type: 'tool_use', id: 't1', name: 'request_tool_category', input: { category: 'workspace_write' } },
    { type: 'tool_use', id: 't2', name: 'request_tool_category', input: { category: 'desktop_automation' } },
  ] },
];
const slim = slimToolsForExtraUsageRetry(tools as any, messages as any);
assert.ok(slim, 'still slims (browser tools were never unlocked or used)');
const kept = new Set(slim!.map((t: any) => t.name));
for (const n of ['workspace_run', 'workspace_edit', 'workspace_read', 'desktop_screen', 'desktop_apps', 'desktop_input']) {
  assert.ok(kept.has(n), `unlocked category tool ${n} must survive the extra-usage retry`);
}
assert.ok(!kept.has('browser_extra_0'), 'tools from categories never unlocked are still dropped');
console.log('anthropic slim retry keeps unlocked categories regression passed');
