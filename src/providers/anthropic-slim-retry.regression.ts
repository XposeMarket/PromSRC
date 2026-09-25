import assert from 'node:assert/strict';
import {
  activeCategoriesFromSystem,
  buildSlimRetryNotice,
  slimToolsForExtraUsageRetry,
  slimToolsForExtraUsageRetryDetailed,
} from './anthropic-adapter';

const names = [
  'web_search','memory','write_note','request_tool_category','read_file','search_files',
  'workspace_run','workspace_edit','workspace_read','workspace_git',
  'desktop_screen','desktop_apps','desktop_input',
  ...Array.from({ length: 80 }, (_, i) => `browser_extra_${i}`),
];
const tools = names.map((name) => ({ name, description: '', input_schema: { type: 'object' } }));

// 1. Explicit request_tool_category unlocks survive (#437).
{
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
}

// 2. Session/planner-activated categories (no request_tool_category call) survive.
//    2026-09-25 turn dd89c525: browser_automation/external_apps/integration_admin
//    were active, 130 tools built, retry sent core only.
const connectorTools = [
  'browser_session', 'browser_act', 'connection_ops', 'connector_list', 'connector_gmail_list_emails',
  'x_posts', 'x_users', 'x_search_ops', 'vercel_ops',
  ...Array.from({ length: 50 }, (_, i) => `x_api_tool_${i}`),
  ...Array.from({ length: 21 }, (_, i) => `connector_vercel_tool_${i}`),
  'desktop_screen', 'desktop_apps', 'desktop_input', 'web_search', 'memory', 'request_browser_login',
].map((name) => ({ name, description: '', input_schema: { type: 'object' } }));
const system = [
  { type: 'text', text: 'You are Claude Code.' },
  { type: 'text', text: 'blah\n\n[ACTIVE_TOOL_CATEGORIES] Already active for this session: browser_automation, external_apps, integration_admin. Do not request these categories again; use their tools directly when relevant.\n\nmore' },
];
assert.deepEqual(
  Array.from(activeCategoriesFromSystem(system)).sort(),
  ['browser_automation', 'external_apps', 'integration_admin'],
);
{
  const result = slimToolsForExtraUsageRetryDetailed(connectorTools as any, [] as any, system, 'active');
  assert.ok(result, 'slims: wrapper duplicates + inactive desktop tools go');
  const kept = new Set(result!.tools.map((t: any) => t.name));
  for (const n of ['browser_session', 'browser_act', 'connection_ops', 'connector_list', 'connector_gmail_list_emails', 'x_posts', 'x_search_ops', 'vercel_ops', 'request_browser_login']) {
    assert.ok(kept.has(n), `active-category tool ${n} must survive`);
  }
  assert.ok(!kept.has('x_api_tool_0'), 'x_api_* direct tools dropped when the x wrappers are present');
  assert.ok(!kept.has('connector_vercel_tool_0'), 'connector_vercel_* dropped when vercel_ops is present');
  assert.ok(!kept.has('desktop_screen'), 'inactive category still dropped');
  assert.equal(result!.droppedDirectDuplicates, 71);
  assert.deepEqual(result!.droppedCategories, ['desktop_automation']);
  const notice = buildSlimRetryNotice(result!);
  assert.match(notice, /^\[TOOL_SURFACE_NOTICE\]/);
  assert.match(notice, /desktop_automation/);
}

// 3. Second retry (minimal) drops gateway-active categories and says so.
{
  const result = slimToolsForExtraUsageRetryDetailed(connectorTools as any, [] as any, system, 'minimal');
  assert.ok(result);
  const kept = new Set(result!.tools.map((t: any) => t.name));
  assert.ok(!kept.has('browser_session'));
  assert.ok(kept.has('web_search'));
  assert.ok(result!.droppedCategories.includes('browser_automation'));
  assert.match(buildSlimRetryNotice(result!), /NOT callable/);
}

console.log('anthropic slim retry keeps unlocked + active categories regression passed');
