import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
// Execute the actual saved-route resolver: red on main, not a source-pattern test.
const badge = fs.readFileSync(new URL('../web-ui/src/mobile/mobile-model-badge.js', import.meta.url), 'utf8');
const resolver = badge.slice(badge.indexOf('function _normalizeSavedChatModelRoute('), badge.indexOf('\nfunction _readSavedChatModelRoute('));
const normalize = vm.runInNewContext(`${resolver}; _normalizeSavedChatModelRoute`);
for (const [saved, configured] of [['high', 'low'], ['low', 'high']]) {
  const route = normalize({providerId:'anthropic', model:'claude-opus-5-5', reasoningEffort:saved});
  assert.equal(route.override.reasoningEffort ?? configured, configured, 'new drafts must inherit configured default, not last chat effort');
}
const { pendingStatusLabel, updatePendingStatus, startPendingStatusTimer } = await import('../web-ui/src/mobile/mobile-ttft-state.js');
assert.equal(pendingStatusLabel(3999, false), '');
assert.equal(pendingStatusLabel(4000, false), '', 'no duplicate Thinking row under Working for');
assert.equal(pendingStatusLabel(60000, false), '');
assert.equal(pendingStatusLabel(9000, true), 'Waiting for a model slot');
for (const event of [{type:'token',text:'a'}, {type:'reasoning_summary_delta',text:'a'}, {type:'tool_start',name:'read'}, {type:'done'}]) {
  const state = {queued:true}; updatePendingStatus(state, event); assert.equal(state.finished, true);
}
const state = {};
updatePendingStatus(state, {type:'latency',phase:'queued'}); assert.equal(state.queued, true);
updatePendingStatus(state, {type:'latency',phase:'running'}); assert.equal(state.queued, false);
updatePendingStatus(state, {type:'thinking_delta',thinking:'private'}); assert.equal(state.finished, undefined);
let tick, count=0, cleared=0, elapsed=0, label='';
const stop=startPendingStatusTimer(()=>elapsed,()=>false,(v)=>{label=v;}, {setInterval(fn){tick=fn;count++;return 1;},clearInterval(){cleared++;}});
assert.equal(count,1); assert.equal(label,''); elapsed=4200;tick();assert.equal(label,'');stop();stop();assert.equal(cleared,1);
console.log('PASS mobile effort defaults, both polarities; pending status transitions and timer cleanup');

const applySource=badge.slice(badge.indexOf('export async function applyMobileDraftModelRouteToSession('),badge.indexOf('\nfunction _modelDetail(')).replace('export ','');
for(const [configured,explicit] of [['low',undefined],['high',undefined],['low','high']]) {
 const writes=[];
 const context={_mobileDraftModelRoute:explicit?{override:{providerId:'anthropic',model:'claude-opus-5-5',reasoningEffort:explicit}}:null,_readSavedChatModelRoute:()=>normalize({providerId:'anthropic',model:'claude-opus-5-5',reasoningEffort:'high'}),_loadDefaultEffort:async()=>configured,_normalizedReasoningEffort:(_p,_m,v)=>v,_writeSavedChatModelRoute:()=>{},_rememberChatRoute:(_sid,r)=>{context.window.__pmChatModelRoute=r;return r;},window:{},mobileGatewayFetch:async(_url,init)=>{writes.push(JSON.parse(init.body));return {chatModelRoute:{effective:JSON.parse(init.body)}};}};
 const apply=vm.runInNewContext(`${applySource}; applyMobileDraftModelRouteToSession`,context);
 await apply('new-chat'); assert.equal(writes.length,1);assert.equal(writes[0].reasoningEffort,explicit||configured);
}
console.log('PASS actual draft submission: default low/high and explicit high preserved');
