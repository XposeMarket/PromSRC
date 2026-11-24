import assert from 'node:assert/strict';
import { getAgentTeamScheduleTools } from './agent-team-schedule';
import { getCreativeToolDefs } from './creative-tools';
import { normalizeCreativeWrapperTool } from '../../agents-runtime/wrapper-normalizers';

// Regression: handlers required arguments that the model-facing schema either
// hid (creative_quality_ops had no width for measure_text) or did not mark as
// required for the action (internal_watch on_match, task_control list_approvals).

const fn = (defs: any[], name: string) => defs.find((def) => def?.function?.name === name)?.function;

const schedule = getAgentTeamScheduleTools();
const watch = fn(schedule, 'internal_watch');
assert.match(watch.parameters.properties.on_match.description, /required for create/i);
const taskControl = fn(schedule, 'task_control');
assert.match(taskControl.parameters.properties.task_id.description, /required for [^;]*list_approvals/i);

const creative = getCreativeToolDefs();
const wrapper = fn(creative, 'creative_quality_ops');
const wrapperProps = wrapper.parameters.properties;
assert.equal(wrapperProps.width?.type, 'number', 'measure_text width is advertised');
const missing: string[] = [];
for (const action of wrapperProps.action.enum as string[]) {
  const routed = normalizeCreativeWrapperTool('creative_quality_ops', { action });
  assert.ok(routed && !routed.error, `action ${action} routes to a tool`);
  const target = fn(creative, routed!.name);
  assert.ok(target, `${action} maps to defined tool ${routed!.name}`);
  for (const required of (target.parameters?.required || []) as string[]) {
    if (!wrapperProps[required]) missing.push(`${action}.${required}`);
    else assert.equal(wrapperProps[required].type, target.parameters.properties[required].type, `${action}.${required} keeps its type`);
  }
}
assert.deepEqual(missing, [], 'every argument a creative_quality_ops action requires is in the wrapper schema');
console.log('hidden-required-args regression passed');
