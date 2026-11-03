import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
async function main() {
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'planned-api-'));
 process.env.PROMETHEUS_DATA_DIR=root;
 const {default:express}={default: require('express')};
 const {router}=require('../src/gateway/routes/tasks.router');
 const {registerLiveRuntime,finishLiveRuntime}=require('../src/gateway/live-runtime-registry');
 const {recordPlannedChatProgress,finishPlannedChatRun}=require('../src/gateway/tasks/planned-chat-runs');
 const {getPrometheusQuestionQueue,createPrometheusQuestionPayload}=require('../src/gateway/prometheus-questions');
 const app=express();app.use(express.json());app.use(router);
 const server=app.listen(0,'127.0.0.1');
 await new Promise<void>(resolve=>server.on('listening',resolve));
 const port=(server.address() as any).port;
 const ids:string[]=[];
 try {
  for(let i=0;i<4;i++){
   const id=registerLiveRuntime({kind:'main_chat',label:'Fixture',deferTerminalCleanup:true,sessionId:`fixture-${i}`});ids.push(id);
   recordPlannedChatProgress(id,`fixture-${i}`,{source:'declared',taskSummary:`Plan ${i}`,activeIndex:0,items:[{text:'Build',status:'in_progress'},{text:'Test',status:'pending'}]},'fallback');
  }
  const read=async()=>await(await fetch(`http://127.0.0.1:${port}/api/bg-tasks?mobile=1`)).json() as any;
  let result=await read();assert.equal(result.success,true);assert.equal(result.tasks.filter((r:any)=>r.sourceKind==='planned_chat').length,4);
  const queue=getPrometheusQuestionQueue();const q=queue.create(createPrometheusQuestionPayload({sessionId:'fixture-0',questions:[{id:'answer',label:'Choose',mode:'single_select',options:['A','B']}]}));
  result=await read();assert.equal(result.tasks.find((r:any)=>r.runtimeId===ids[0]).status,'awaiting_user_input');
  queue.cancel(q.id);result=await read();assert.equal(result.tasks.find((r:any)=>r.runtimeId===ids[0]).status,'running');
  finishPlannedChatRun(ids[0],'completed');finishLiveRuntime(ids[0]);
  finishLiveRuntime(ids[1]);
  result=await read();assert.equal(result.tasks.find((r:any)=>r.runtimeId===ids[0]).status,'completed');assert.equal(result.tasks.find((r:any)=>r.runtimeId===ids[1]).status,'interrupted');
  assert.deepEqual(result.tasks[0].supportedActions,['open_chat']);
  console.log('PASS real Tasks API: four runtimes, request-derived waiting/resume, completion/history, disappeared owner interruption');
 }finally{for(const id of ids)finishLiveRuntime(id);await new Promise<void>(resolve=>server.close(()=>resolve()));await new Promise(resolve=>setTimeout(resolve,300)); fs.rmSync(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
}
main().then(()=>process.exit(0),error=>{console.error(error);process.exit(1)});
