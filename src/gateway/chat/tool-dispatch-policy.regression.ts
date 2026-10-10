import assert from 'node:assert/strict';
import { describeArgumentProblem, evaluateToolDispatch, resolveIdleRoundLimit, resolveToolSurfaceEnforcementMode, type ToolDispatchRequest } from './tool-dispatch-policy';

const known = new Set(['skill_list', 'web_fetch', 'desktop_screenshot', 'run_command', 'creative_add_element', 'request_tool_category']);
const categories: Record<string, string> = { desktop_screenshot: 'desktop_automation', run_command: 'workspace_write' };
const base = (over: Partial<ToolDispatchRequest>): ToolDispatchRequest => ({
  name: 'skill_list',
  rawArguments: '{}',
  offered: new Set(['skill_list', 'web_fetch', 'request_tool_category']),
  mode: 'enforce',
  restricted: false,
  isKnownTool: (n) => known.has(n),
  categoryOf: (n) => categories[n] || null,
  isCategoryActive: () => false,
  ...over,
});

// Offered + valid -> runs.
assert.deepEqual(evaluateToolDispatch(base({})), { ok: true });

// Unknown name -> refused without approval wording.
let d = evaluateToolDispatch(base({ name: 'definitely_not_a_tool' }));
assert.equal(d.ok, false);
assert.equal(!d.ok && d.code, 'unknown_tool');
d = evaluateToolDispatch(base({ name: '' }));
assert.equal(!d.ok && d.code, 'unknown_tool');

// Known tool in an inactive category -> refused with the activation hint.
d = evaluateToolDispatch(base({ name: 'desktop_screenshot' }));
assert.equal(!d.ok && d.code, 'not_offered');
assert.match(!d.ok ? d.message : '', /request_tool_category\(\{"category":"desktop_automation"\}\)/);

// Same tool with its category active (activated mid-batch) -> allowed with a warning.
d = evaluateToolDispatch(base({ name: 'desktop_screenshot', isCategoryActive: (c) => c === 'desktop_automation' }));
assert.equal(d.ok, true);
assert.equal(d.ok && d.warning?.code, 'not_offered');

// Restricted run (allowed_tools) -> anything off-surface is refused, even with no category.
d = evaluateToolDispatch(base({ name: 'creative_add_element', restricted: true }));
assert.equal(!d.ok && d.code, 'not_offered');
assert.match(!d.ok ? d.message : '', /restricted/);

// Unrestricted, known, no category (schema-hidden compat primitive) -> allowed with a warning.
d = evaluateToolDispatch(base({ name: 'creative_add_element' }));
assert.equal(d.ok, true);

// Malformed arguments -> refused, the model is told.
d = evaluateToolDispatch(base({ rawArguments: '{"query": "cod' }));
assert.equal(!d.ok && d.code, 'malformed_arguments');
assert.match(!d.ok ? d.message : '', /not valid JSON/);
assert.equal(describeArgumentProblem('skill_list', '[1,2]'), 'arguments must be a JSON object, got an array');
assert.equal(describeArgumentProblem('skill_list', { query: 'x' }), null);
assert.equal(describeArgumentProblem('skill_list', undefined), null);
assert.equal(describeArgumentProblem('skill_list', '   '), null);
// request_tool_category accepts bare-string shorthand.
assert.equal(describeArgumentProblem('request_tool_category', 'browser_automation'), null);
assert.equal(describeArgumentProblem('request_tool_category', '"browser_automation"'), null);

// warn mode never refuses but reports; off mode is a no-op.
d = evaluateToolDispatch(base({ name: 'definitely_not_a_tool', mode: 'warn' }));
assert.equal(d.ok, true);
assert.equal(d.ok && d.warning?.code, 'unknown_tool');
assert.deepEqual(evaluateToolDispatch(base({ name: 'definitely_not_a_tool', mode: 'off' })), { ok: true });

// Config resolution.
delete process.env.PROMETHEUS_TOOL_SURFACE_ENFORCEMENT;
delete process.env.PROMETHEUS_IDLE_ROUND_LIMIT;
assert.equal(resolveToolSurfaceEnforcementMode({}), 'enforce');
assert.equal(resolveToolSurfaceEnforcementMode({ runtime: { toolSurfaceEnforcement: 'warn' } }), 'warn');
assert.equal(resolveToolSurfaceEnforcementMode({ runtime: { tool_surface_enforcement: 'off' } }), 'off');
process.env.PROMETHEUS_TOOL_SURFACE_ENFORCEMENT = 'off';
assert.equal(resolveToolSurfaceEnforcementMode({ runtime: { toolSurfaceEnforcement: 'enforce' } }), 'off');
delete process.env.PROMETHEUS_TOOL_SURFACE_ENFORCEMENT;
assert.equal(resolveIdleRoundLimit({}), 8);
assert.equal(resolveIdleRoundLimit({ runtime: { idleRoundLimit: 4 } }), 4);
assert.equal(resolveIdleRoundLimit({ runtime: { idleRoundLimit: 1 } }), 8);

console.log('tool-dispatch-policy: all checks passed');
