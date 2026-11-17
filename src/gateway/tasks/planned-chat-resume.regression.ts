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
 const {buildNeedsYouItems}=require('../needs-you');
 const pending=buildNeedsYouItems({proposals:[{id:'approval',status:'pending',requiresSrcEdit:true,sourceSessionId:sid}]});
 assert.equal(pending[0].sessionId,sid,'sourceSessionId normalized before resume guard');
 assert(!plans.listPlannedChatRuns(pending).find((r:any)=>r.sessionId===sid).supportedActions.includes('resume'),'pending approval hides Resume');
 console.log('PASS original-thread Resume, saved context, one card, duplicate/terminal/missing guards, Stop cancellation, shutdown pause, normalized approval guard');
}
main().then(()=>process.exit(0),e=>{console.error(e);process.exit(1)});
