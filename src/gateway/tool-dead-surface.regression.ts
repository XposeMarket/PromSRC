/**
 * Dead/duplicate tool surface cleanup (2026-11, audit of 84,912 tool calls).
 *
 * Builds the full model-facing tool surface (every runtime category active)
 * and asserts that the removed tools and wrapper actions are gone everywhere a
 * model can see them, while every tool on the keep list is still offered.
 * Run: npx tsx src/gateway/tool-dead-surface.regression.ts
 */
import assert from 'node:assert/strict';
import { buildTools, normalizeToolCategory } from './tool-builder';
import { buildToolsContext } from './prompt-context';
import { getRuntimeToolCategoryIds } from '../runtime/tool-category-manifest';
import { normalizeAgentTeamWrapperTool, normalizeWorkspaceWrapperTool } from './agents-runtime/wrapper-normalizers';
import { normalizeDesktopWrapperTool } from './desktop-wrappers';

const REMOVED_TOOLS = [
  'memory_browse', 'memory_search_project', 'memory_search_timeline', 'memory_get_related',
  'memory_graph_snapshot', 'memory_index_refresh', 'memory_debug_search', 'memory_embedding_status',
  'memory_embedding_backfill', 'memory_provider_status',
  'list_agent_model_templates', 'save_agent_model_template', 'update_agent_model_template',
  'apply_agent_model_template', 'select_agent_model_template', 'delete_agent_model_template',
  'social_intel', 'desktop_macro', 'webhook_manage', 'integration_quick_setup',
  'save_site_shortcut', 'run_task_now',
];

const REMOVED_ACTIONS: Record<string, string[]> = {
  workspace_run: ['test', 'lint', 'format', 'typecheck', 'telemetry', 'benchmark_summary'],
  workspace_safety: ['operation_plan', 'preview_patch'],
  agent_chat_ops: ['talk', 'message', 'send', 'turn_request', 'reply_wait', 'thread_watch'],
  team_ops_wrapper: ['delete', 'dispatch_team_agent'],
};

const KEPT_TOOLS = [
  'create_composite', 'get_composite', 'edit_composite', 'delete_composite', 'list_composites',
  'memory', 'memory_read_record', 'memory_consolidate', 'memory_review_claims', 'memory_accept_claim',
  'memory_reject_claim', 'memory_supersede_record',
  'list_entities', 'read_entity', 'write_entity', 'append_entity_event', 'business_context_mode',
  'desktop_screen', 'desktop_apps', 'desktop_window', 'desktop_input', 'desktop_background',
  'workspace_read', 'workspace_edit', 'workspace_run', 'workspace_git', 'workspace_safety', 'workspace_code_nav',
  'creative_project', 'creative_scene', 'creative_image_ops', 'creative_video_ops',
  'creative_hyperframes_ops', 'creative_quality_ops',
  // generate_image/generate_video were already schema-hidden compat tools on the
  // base branch (media_generate is their model-facing route); they are untouched.
  'media_generate', 'video_project',
  'get_agent_models', 'set_agent_model', 'provider_accounts',
  'trigger_ops', 'connection_ops', 'mcp_server_manage', 'secure_access', 'plugin_ops',
  'task_control', 'internal_watch', 'automation_dashboard',
  'agent_chat_ops', 'team_ops_wrapper', 'browser_session',
];

const KEPT_ACTIONS: Record<string, string[]> = {
  workspace_run: ['run', 'start', 'status', 'log', 'wait', 'kill', 'submit'],
  workspace_safety: ['snapshot', 'restore', 'revert_last', 'scan_secrets', 'scan_large_files'],
  workspace_edit: ['preview_patch'],
  workspace_git: ['open_pr'],
  agent_chat_ops: ['chat', 'delegate', 'steer', 'send_mailbox'],
  team_ops_wrapper: ['manage', 'dispatch', 'update_goal', 'manage_goal'],
};

const wordPattern = (name: string) => new RegExp(`(^|[^A-Za-z0-9_])${name}([^A-Za-z0-9_]|$)`);

const deps = { getMCPManager: () => ({ getAllTools: () => [] }), skipDynamicExtensionTools: true };
const categories = new Set<string>(getRuntimeToolCategoryIds());
const surface = buildTools(deps as any, categories);
const byName = new Map<string, any>(surface.map((tool: any) => [tool.function.name, tool]));
const schemaText = JSON.stringify(surface);

// 1. Removed tools are gone from every model-facing schema, name or text.
for (const name of REMOVED_TOOLS) {
  assert.equal(byName.has(name), false, `${name} must not be a model-facing tool`);
  assert.equal(wordPattern(name).test(schemaText), false, `${name} must not be named in any model-facing schema`);
}

// 2. Removed wrapper actions are gone from the wrapper enums; kept actions remain.
const actionEnum = (tool: string): string[] => byName.get(tool)?.function?.parameters?.properties?.action?.enum || [];
for (const [tool, actions] of Object.entries(REMOVED_ACTIONS)) {
  const offered = actionEnum(tool);
  assert.ok(offered.length > 0, `${tool} must expose an action enum`);
  for (const action of actions) assert.equal(offered.includes(action), false, `${tool} must not offer action ${action}`);
}
for (const [tool, actions] of Object.entries(KEPT_ACTIONS)) {
  const offered = actionEnum(tool);
  for (const action of actions) assert.ok(offered.includes(action), `${tool} must still offer action ${action}`);
}
const safetyProps = Object.keys(byName.get('workspace_safety')?.function?.parameters?.properties || {});
assert.equal(safetyProps.includes('operations'), false, 'workspace_safety operations parameter belonged to operation_plan only');
assert.equal(safetyProps.includes('patch'), false, 'workspace_safety patch parameter belonged to preview_patch only');
const chatProps = Object.keys(byName.get('agent_chat_ops')?.function?.parameters?.properties || {});
assert.equal(chatProps.includes('thread_id'), false, 'agent_chat_ops thread_id belonged to the legacy reply/watch actions only');

// 3. Every keep-list tool is still on the surface.
for (const name of KEPT_TOOLS) assert.ok(byName.has(name), `${name} must stay model-facing`);

// 4. The emptied social_intelligence category is gone and rejected cleanly.
assert.equal(categories.has('social_intelligence'), false, 'social_intelligence category must be removed');
assert.equal(normalizeToolCategory('social_intelligence'), null, 'an old social_intelligence request must normalize to null (Invalid category)');

// 5. The category menu and every category policy block stop naming removed tools.
const promptText = buildToolsContext(categories);
for (const name of REMOVED_TOOLS) {
  assert.equal(wordPattern(name).test(promptText), false, `${name} must not be named in category menu or policy text`);
}
for (const stale of ['"operation_plan"', '"benchmark_summary"', '|"typecheck"', '"manage"|"delete"', 'social_intelligence']) {
  assert.equal(promptText.includes(stale), false, `prompt text must not list ${stale}`);
}

// 6. Routing: removed actions fail with the wrapper's own error; survivors route unchanged.
for (const action of REMOVED_ACTIONS.workspace_run) {
  const out = normalizeWorkspaceWrapperTool('workspace_run', { action, command: 'npm test' });
  assert.ok(out?.error && /Unsupported workspace_run action/.test(out.error), `workspace_run ${action} must be rejected`);
}
for (const action of REMOVED_ACTIONS.workspace_safety) {
  const out = normalizeWorkspaceWrapperTool('workspace_safety', { action });
  assert.ok(out?.error && /Unsupported workspace_safety action/.test(out.error), `workspace_safety ${action} must be rejected`);
}
for (const action of REMOVED_ACTIONS.team_ops_wrapper) {
  const out = normalizeAgentTeamWrapperTool('team_ops_wrapper', { action, team_id: 't1' });
  assert.ok(out?.error && /Unsupported team_ops_wrapper action/.test(out.error), `team_ops_wrapper ${action} must be rejected`);
}
const viaManage = normalizeAgentTeamWrapperTool('team_ops_wrapper', { action: 'manage', team_action: 'delete', team_id: 't1', confirm: true });
assert.equal(viaManage?.name, 'team_manage');
assert.equal(viaManage?.args.action, 'delete', 'manage + team_action delete still reaches team_manage delete');
const dispatch = normalizeAgentTeamWrapperTool('team_ops_wrapper', { action: 'dispatch', team_id: 't1', agent_id: 'a1', task: 'x', background: false });
assert.equal(dispatch?.name, 'dispatch_team_agent');
assert.equal(dispatch?.args.background, false, 'dispatch passes the background flag through unchanged');
assert.equal(dispatch?.args.task_prompt, 'x');
// Legacy agent_chat_ops actions stay accepted for older stored runs.
assert.equal(normalizeAgentTeamWrapperTool('agent_chat_ops', { action: 'turn_request', agent_id: 'a1', message: 'hi' })?.name, 'agent_turn_request');
assert.equal(normalizeDesktopWrapperTool('desktop_macro', { action: 'list' }), null, 'desktop_macro is no longer a wrapper');

console.log(JSON.stringify({ tools: surface.length, schemaChars: schemaText.length, removedTools: REMOVED_TOOLS.length, removedActions: Object.values(REMOVED_ACTIONS).flat().length }));
console.log('tool dead surface regression: PASS');
