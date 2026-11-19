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
  'get_agent_result', 'read_webui_source', 'grep_source', 'browser_open', 'browser_list_tabs',
]) {
  assert.equal(tierOf(name), 'read', `${name} is read-only conversation/lookup work`);
}

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

// Reasons shown on approval cards are plain language, not policy jargon.
for (const text of [UNKNOWN_TOOL_REASON, capabilityTierReason('commit'), capabilityTierReason('propose'), capabilityTierReason('read')]) {
  assert.doesNotMatch(text, /COMMIT|PROPOSE|capability metadata|failing closed/);
}

console.log('core-tool-capabilities regression passed');
