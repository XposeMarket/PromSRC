import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'planned-resume-'));
for (const key of ['PROMETHEUS_APP_DATA_DIR','PROMETHEUS_DATA_DIR','PROMETHEUS_WORKSPACE_DIR','APPDATA','USERPROFILE','HOME']) process.env[key] = root;
process.env.PROMETHEUS_CONFIG_PATH = path.join(root, 'config.json');
const sleep = () => new Promise(r => setTimeout(r, 20));
async function main() {
 const config = require('../../config/config').getConfig(); config.getConfigDir = () => root; config.getWorkspacePath = () => root;
 const plans = require('./planned-chat-runs'); const sessions = require('../session'); const resume = require('./planned-chat-resume');
 const sid = 'mobile_resume_fixture'; sessions.getSession(sid); sessions.addMessage(sid, { role: 'user', content: 'Do the original work', timestamp: Date.now() });
 for(let i=0;i<100 && !sessions.sessionExists(sid);i++) await sleep();
 const progress = { source: 'declared', taskSummary: 'Recovery fixture', activeIndex: 1, items: [{text:'Done work',status:'done'},{text:'Remaining work',status:'in_progress'}] };
 plans.recordPlannedChatProgress('old', sid, progress, 'Recovery fixture'); plans.finishPlannedChatRun('old','failed');
 for(let i=0;i<100 && plans.getPlannedChatRunDetail('old')?.status!=='paused';i++) await sleep();
 for (const text of ['Continue writing the email, not the deployment', 'Resume editing the memo', 'Pick up groceries']) assert.equal(plans.findResumableChatPlan(sid, text), undefined);
 for (const text of ['Continue','Resume the plan.', 'Continue the paused plan.']) assert.equal(plans.findResumableChatPlan(sid, text)?.runtimeId, 'old');
 let calls=0; let release!:()=>void; let emit:any;
 const run = async (message:string, target:string, send:any, _pins:any, _signal:any, context:string) => { calls++; assert.equal(target,sid); assert.match(message,/Continue/); assert.match(context,/\[done\] Done work/); emit=send; await new Promise<void>(r=>release=r); return {type:'chat',text:'done'}; };
 const started = await resume.continuePlannedChat('chat-plan:old',run); assert.equal(started.success,true,JSON.stringify(started));
 assert.equal((await resume.continuePlannedChat('chat-plan:old',run)).success,false,'duplicate blocked');
 assert.equal(calls,1);
 for(let i=0;i<100 && plans.listPlannedChatRuns()[0]?.runtimeId==='old';i++) await sleep();
 assert.equal(plans.listPlannedChatRuns().length,1,'single logical task');
 emit('progress_state',{...progress,items:progress.items.map((x:any)=>({...x,status:'done'}))}); release();
 for(let i=0;i<100 && plans.listPlannedChatRuns()[0]?.status!=='completed';i++) await sleep();
 assert.equal(plans.listPlannedChatRuns()[0].status,'completed');
 assert.equal((await resume.continuePlannedChat(plans.listPlannedChatRuns()[0].id,run)).success,false,'completed immutable');
 assert.equal((await resume.continuePlannedChat('chat-plan:missing',run)).success,false);
 const registry = require('../live-runtime-registry');
 for (const [reason, expected] of [['operator_abort','cancelled'],['gateway_shutdown','paused']]) {
   const id = `seed-${reason}`; plans.recordPlannedChatProgress(id,sid,progress,''); plans.finishPlannedChatRun(id,'failed');
   for(let i=0;i<100 && plans.getPlannedChatRunDetail(id)?.status!=='paused';i++) await sleep();
   assert.equal((await resume.continuePlannedChat(id,run)).success,true);
   for(let i=0;i<100 && plans.listPlannedChatRuns()[0]?.runtimeId===id;i++) await sleep();
   const active = registry.listLiveRuntimes().find((r:any)=>r.sessionId===sid);
   registry.abortLiveRuntime(active.id,reason); release();
   for(let i=0;i<100 && plans.listPlannedChatRuns()[0]?.status!==expected;i++) await sleep();
   assert.equal(plans.listPlannedChatRuns()[0].status,expected);
 }
 // A gateway restart replays the original request, not a typed "Continue".
 const items = [{text:'Build',status:'done'},{text:'Deploy',status:'done'},{text:'Verify restart',status:'in_progress'}];
 const checkpoint = { ...progress, items, activeIndex:2 };
 plans.recordPlannedChatProgress('pre-restart',sid,checkpoint,'Deploy');
 plans.finishPlannedChatRun('pre-restart','interrupted');
 for(let i=0;i<100 && !plans.getPlannedChatRunDetail('pre-restart');i++) await sleep();
 const restored = plans.findResumableChatPlan(sid,'Deploy it please','pre-restart');
 assert.deepEqual(restored?.runtimeProgress.items.map(({text,status}:any)=>({text,status})),items,'restart must restore the exact checklist without a resume phrase');
 assert.equal(restored.runtimeProgress.activeIndex,2);
 assert.equal(plans.findResumableChatPlan('another_chat','Continue','pre-restart'),undefined);
 assert.equal(plans.findResumableChatPlan(sid,'Continue','missing-runtime'),undefined,'must not fall back to a different plan');
 // Real chat loop with a scripted local model; no live gateway, network or real tasks.
 const {SkillsManager} = require('../skills-runtime/skills-manager');
 require('../routes/chat.router').initChatRouter({skillsManager:new SkillsManager(root),telegramChannel:null,cronScheduler:null});
 const client = require('../../agents/ollama-client').getOllamaClient();
 const {handleChat} = require('../routes/chat/pipeline/handle-chat');
 for (const finish of [true,false]) {
   const events: Array<[string,any]> = []; let passes=0;
   client.chatWithThinking = async (_messages:any, _role:any, opts:any) => {
     assert(++passes < 24,'finalization retries are bounded');
     if (finish && passes===2) return {message:{role:'assistant',content:'',tool_calls:[{id:'step3',type:'function',function:{name:'complete_plan_step',arguments:{note:'Verified restarted instance is healthy.'}}}]}};
     const content = finish && passes>2 ? 'Verification complete.' : 'PREMATURE SUCCESS';
     opts.onToken?.(content); return {message:{role:'assistant',content}};
   };
   const answer = await handleChat('Deploy it please',sid,(e:string,p:any)=>events.push([e,p]),undefined,undefined,undefined,undefined,'interactive',undefined,undefined,undefined,undefined,undefined,{predecessorRuntimeId:'pre-restart'});
   assert(events.some(([e,p])=>e==='progress_state' && p.activeIndex===2 && p.items[2]?.status==='in_progress'));
   assert(!events.some(([e,p])=>e==='token' && String(p.text).includes('PREMATURE SUCCESS')));
   assert.match(answer.text,finish?/Verification complete/:/paused.*Verify restart/i);
   assert.equal(events.some(([e,p])=>e==='progress_state' && p.items[2]?.status==='done'),finish);
 }
 // A real provider cutoff after plan work, followed by a typed Continue four days later.
 const usageSid='mobile_usage_cutoff'; const realNow=Date.now; const t0=realNow();
 const runUsage=(msg:string,id:string,events:Array<[string,any]>)=>handleChat(msg,usageSid,(e:string,p:any)=>{
   events.push([e,p]); if(e==='progress_state') plans.recordPlannedChatProgress(id,usageSid,p,msg,undefined,msg);
 },undefined,undefined,undefined,undefined,'interactive',undefined,undefined,undefined,undefined,undefined,{runtimeId:id,mainChatUsageNotice:true});
 const tool=(name:string,args:any)=>({message:{role:'assistant',content:'',tool_calls:[{id:name,type:'function',function:{name,arguments:args}}]}});
 let rounds=0; const usageEvents:Array<[string,any]>=[];
 client.chatWithThinking=async()=>{
   if(++rounds===1)return tool('declare_plan',{task_summary:'Release',steps:['Build release','Verify release']});
   if(rounds===2)return tool('complete_plan_step',{note:'Build verified'});
   throw new Error('anthropic API error 429: {"error":{"type":"rate_limit_error","message":"This request would exceed your account limit"}}');
 };
 const cutoff=await runUsage('Build and verify the release','usage-old',usageEvents);
 assert.match(cutoff.text,/^Usage limit reached\. Reset time unavailable\.\n\nType `continue` to resume\.$/);
 assert.equal(cutoff.usageLimitPaused,true); assert(usageEvents.some(([e,p])=>e==='progress_state' && p.reason==='usage_limit_paused' && p.activeIndex===1));
 assert.equal(rounds,3,'no extra provider call to summarize a usage cutoff'); assert(cutoff.toolResults?.length);
 plans.finishPlannedChatRun('usage-old','completed'); // A final chat reply is not a finished checklist.
 for(let i=0;i<100 && plans.getPlannedChatRunDetail('usage-old')?.status!=='paused';i++)await sleep();
 try {
   Date.now=()=>t0+4*86400000; const events:Array<[string,any]>=[]; let calls=0;
   client.chatWithThinking=async(_m:any,_r:any,opts:any)=>{
     if(++calls===1)return tool('declare_plan',{task_summary:'Replacement',steps:['Wrong one','Wrong two']});
     if(calls===2)return tool('complete_plan_step',{note:'Release verified'});
     assert(calls<8);return {message:{role:'assistant',content:'Verified release.'}};
   };
   await runUsage('Continue','usage-new',events);
   const snapshots=events.filter(([e,p])=>e==='progress_state'&&p.source==='declared').map(([,p])=>p);
   assert.equal(snapshots[0]?.activeIndex,1); assert.deepEqual(snapshots[0]?.items.map((i:any)=>i.status),['done','in_progress']);
   assert(!snapshots.some(p=>p.items.some((i:any)=>i.text==='Wrong one')),'typed Continue must protect the original plan just like a restart');
   assert(snapshots.some(p=>p.items[1]?.text==='Verify release' && p.items[1].status==='done'));
   for(let i=0;i<100 && !plans.getPlannedChatRunDetail('usage-new');i++)await sleep();
   const linked=plans.getPlannedChatRunDetail('usage-new'); assert.equal(linked?.resumedFromRuntimeId,'usage-old');
   assert.equal(linked?.originPrompt,'Build and verify the release','Continue must not replace the assignment');
 } finally {Date.now=realNow;}
 // Background tools sometimes use interactive mode: without main-chat opt-in they still see failure.
 client.chatWithThinking=async()=>{throw new Error('anthropic API error 429: rate_limit_error');};
 const worker=await handleChat('Analyze this task','worker-usage',()=>{},undefined,undefined,undefined,undefined,'interactive');
 assert.match(worker.text,/^Error:/); assert.equal(worker.usageLimitPaused,undefined); assert.doesNotMatch(worker.text,/Type `continue`/);
 const {buildNeedsYouItems}=require('../needs-you');
 const pending=buildNeedsYouItems({proposals:[{id:'approval',status:'pending',requiresSrcEdit:true,sourceSessionId:sid}]});
 assert.equal(pending[0].sessionId,sid,'sourceSessionId normalized before resume guard');
 assert(!plans.listPlannedChatRuns(pending).find((r:any)=>r.sessionId===sid).supportedActions.includes('resume'),'pending approval hides Resume');
 console.log('PASS original-thread Resume, saved context, one card, duplicate/terminal/missing guards, Stop cancellation, shutdown pause, normalized approval guard');
}
main().then(()=>process.exit(0),e=>{console.error(e);process.exit(1)});
