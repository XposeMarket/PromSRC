import assert from 'node:assert/strict';
import { capabilityPolicyTier, resolveToolCapabilityMetadata } from './tool-capabilities.js';
import { UNKNOWN_TOOL_REASON, capabilityTierReason } from './policy.js';

const tierOf = (name: string, args: Record<string, any> = {}) =>
  capabilityPolicyTier(resolveToolCapabilityMetadata(name, undefined, args));

// Fresh install on Default permissions: talking to the user, tracking the plan
// and loading tools must never raise an approval card (GR install, IMG_2140).
for (const name of [
  'ask_prometheus_questions', 'await_prometheus_question_response', 'declare_plan',
  'complete_plan_step', 'bg_plan_declare', 'bg_plan_advance', 'request_tool_category',
  'tool_search', 'tool_describe', 'tool_result_read', 'switch_model', 'request_browser_login',
  'show_ui_card', 'show_weather', 'show_chart', 'background_wait', 'background_status',
  'get_agent_result', 'read_webui_source', 'grep_source', 'browser_list_tabs',
]) {
  assert.equal(tierOf(name), 'read', `${name} is read-only conversation/lookup work`);
}

// Argument-aware tools (Astra review on #913): reads stay reads, mutating modes are gated.
assert.equal(tierOf('browser_open', { url: 'https://example.com' }), 'read');
assert.equal(tierOf('browser_open', { url: 'example.com/path' }), 'read');
assert.equal(tierOf('browser_open', { url: 'javascript:alert(1)' }), 'commit');
assert.equal(tierOf('browser_open', { url: 'file:///C:/Users' }), 'commit');
assert.equal(tierOf('browser_open', {}), 'commit', 'missing url fails closed');
assert.equal(tierOf('browser_new_tab', {}), 'read');
assert.equal(tierOf('browser_new_tab', { url: 'data:text/html,<script>1</script>' }), 'commit');
assert.equal(tierOf('browser_scroll_collect_v2', { schema: { fields: [] } }), 'read');
assert.equal(tierOf('browser_scroll_collect_v2', { save_as: 'jobs' }), 'propose');
assert.equal(tierOf('browser_scroll_collect', { options: { remember_as: 'x' } }), 'propose');
assert.equal(tierOf('browser_scroll_collect_v2', { save_as: 123 }), 'propose', 'non-string save alias still saves');
assert.equal(tierOf('browser_scroll_collect', { saveAs: true }), 'propose');
assert.equal(tierOf('browser_scroll_collect', { save_as: '' }), 'read', 'empty alias does not save');
assert.equal(tierOf('inspect_console', { action: 'read' }), 'read');
assert.equal(tierOf('inspect_console', { action: 'clear' }), 'propose');
assert.equal(tierOf('schedule_job_outputs', { action: 'get' }), 'read');
assert.equal(tierOf('schedule_job_outputs', { action: 'set', confirm: true }), 'propose', 'agent-supplied confirm is not approval');

// Things that change state stay gated, now with an honest classification.
for (const name of ['timer', 'append_file', 'background_spawn', 'set_current_model', 'git_commit', 'browser_close']) {
  const caps = resolveToolCapabilityMetadata(name, undefined, {});
  assert.equal(caps.known, true, `${name} is classified`);
  assert.equal(tierOf(name), 'propose', `${name} still asks on Default permissions`);
}
for (const name of ['delivery_send', 'browser_run_js', 'browser_type', 'browser_vision_click']) {
  assert.equal(tierOf(name), 'commit', `${name} can act outside the chat`);
}

// Unknown tools still fail closed.
assert.equal(resolveToolCapabilityMetadata('future_unclassified_tool', undefined, {}).known, false);
assert.equal(tierOf('future_unclassified_tool'), 'commit');
assert.equal(tierOf('tool_call'), 'commit', 'tool_call is gated on the inner tool, never auto-read');

// Multi-action control tools are classified per action (2026-11 tool audit):
// looking at tasks, runs, chats and watches is a read and must not prompt.
const metaOf = (name: string, args: Record<string, any> = {}) => resolveToolCapabilityMetadata(name, undefined, args);
for (const [name, args] of [
  ['task_control', { action: 'list' }], ['task_control', { action: 'get', task_id: 't' }], ['task_control', { action: 'list_approvals' }],
  ['prometheus_thread_ops', { action: 'read', session_id: 's' }], ['prometheus_thread_ops', { action: 'status' }],
  ['prometheus_thread_ops', { action: 'LIST_PROJECTS' }], ['agent_run_ops', { action: 'list' }], ['agent_run_ops', { action: 'get', task_id: 't' }],
  ['schedule_job_patch', { action: 'preview', job_id: 'j' }], ['schedule_job_patch', { job_id: 'j' }], ['schedule_job_patch', { action: '', job_id: 'j' }],
  ['prometheus_request_ops', { action: 'recovery_candidates' }], ['prometheus_audit_ops', { action: 'skill_routing_stats' }],
  ['team_manage', { action: 'list' }], ['team_escalation', { escalation_action: 'list' }],
  ['browser_intercept_network', { action: 'read' }], ['connection_ops', { action: 'status' }], ['mcp_server_manage', { action: 'list_tools' }],
  ['secure_access', { action: 'list' }], ['webhook_manage', { action: 'get' }],
  ['request_final_action_approval', {}], ['get_composite', {}], ['run_accessibility_check', {}], ['creative_measure_text', {}],
] as Array<[string, Record<string, any>]>) {
  assert.equal(tierOf(name, args), 'read', `${name} ${JSON.stringify(args)} is a read`);
  assert.equal(metaOf(name, args).known, true);
}

// Changing something stays approval-gated on Default permissions, with an honest label.
for (const [name, args] of [
  ['task_control', { action: 'steer' }], ['task_control', { action: 'pause' }], ['prometheus_thread_ops', { action: 'send' }],
  ['prometheus_thread_ops', { action: 'create_and_supervise' }], ['agent_run_ops', { action: 'rerun' }], ['internal_watch', { action: 'create' }],
  ['prometheus_request_ops', { action: 'recover' }], ['prometheus_audit_ops', { action: 'context_receipt_configure' }],
  ['team_escalation', { escalation_action: 'dismiss' }], ['browser_intercept_network', { action: 'start' }],
  // Review findings: these look like reads but persist state, so they are writes.
  ['prometheus_thread_ops', { action: 'supervision_wait' }], ['internal_watch', { action: 'list' }],
  // Review finding: the handler reads escalation_action only, so a decoy `action` must not decide the tier.
  ['team_escalation', { action: 'list', escalation_action: 'dismiss' }],
  ['dispatch_team_agent', {}], ['message_main_agent', {}], ['write_entity', {}], ['set_agent_model', {}], ['memory_accept_claim', {}],
  ['edit_proposal', {}], ['schedule_job_stuck_control', { action: 'rerun_clean' }],
] as Array<[string, Record<string, any>]>) {
  assert.equal(tierOf(name, args), 'propose', `${name} ${JSON.stringify(args)} changes local state`);
}
for (const [name, args] of [
  ['task_control', { action: 'delete' }], ['task_control', { action: 'cancel' }], ['agent_run_ops', { action: 'cancel' }],
  ['schedule_job_patch', { action: 'apply', job_id: 'j' }], ['connection_ops', { action: 'disconnect' }],
  ['delete_composite', {}],
] as Array<[string, Record<string, any>]>) {
  assert.equal(tierOf(name, args), 'commit', `${name} ${JSON.stringify(args)} is destructive`);
  assert.equal(metaOf(name, args).known, true);
}

// Fail closed: a missing action, an action nobody classified, a non-string
// action, and anything that grants or runs something stay in the unknown tier.
for (const [name, args] of [
  ['task_control', {}], ['task_control', { action: 'resolve_approval', decision: 'approve' }], ['task_control', { action: 'brand_new_action' }],
  ['task_control', { action: ['list'] }], ['task_control', { action: { toString: () => 'list' } }],
  ['prometheus_thread_ops', {}], ['prometheus_thread_ops', { action: 'delete_everything' }], ['agent_run_ops', { action: '' }],
  ['internal_watch', {}], ['team_manage', { action: 'delete' }], ['team_manage', { action: 'create' }],
  ['connection_ops', { action: 'connect' }], ['connection_ops', {}], ['mcp_server_manage', { action: 'upsert' }], ['mcp_server_manage', { action: 'connect' }],
  ['mcp_server_manage', { action: 'delete' }], ['secure_access', { action: 'fill' }], ['secure_access', { action: 'request' }], ['secure_access', { action: 'revoke' }],
  ['webhook_manage', { action: 'set' }], ['constructor', { action: 'list' }], ['toString', {}],
  // Review finding: handlers do String(args.action), so ["apply"] runs as apply. A supplied
  // non-string action must never fall back to the documented default.
  ['schedule_job_patch', { action: ['apply'], job_id: 'j', confirm: true }], ['schedule_job_patch', { action: ['preview'], job_id: 'j' }],
  ['schedule_job_patch', { action: 0, job_id: 'j' }], ['schedule_job_patch', { action: { toString: () => 'preview' }, job_id: 'j' }],
  ['browser_intercept_network', { action: ['read'] }],
  // Review finding: only the argument the handler reads counts; wrapper aliases do not classify.
  ['team_escalation', { action: 'list' }], ['team_manage', { team_action: 'list' }], ['browser_intercept_network', { network_action: 'read' }],
  // Review finding: this "list" creates the session's creative folder.
  ['creative_list_html_motion_templates', {}],
] as Array<[string, Record<string, any>]>) {
  assert.equal(metaOf(name, args).known, false, `${name} ${JSON.stringify(args)} stays fail-closed`);
  assert.equal(tierOf(name, args), 'commit');
}
// Trailing whitespace and case do not change the action; a prefix does not match.
assert.equal(tierOf('task_control', { action: '  List ' }), 'read');
assert.equal(metaOf('task_control', { action: 'list_all' }).known, false);

// Reasons shown on approval cards are plain language, not policy jargon.
for (const text of [UNKNOWN_TOOL_REASON, capabilityTierReason('commit'), capabilityTierReason('propose'), capabilityTierReason('read')]) {
  assert.doesNotMatch(text, /COMMIT|PROPOSE|capability metadata|failing closed/);
}

console.log('core-tool-capabilities regression passed');
