import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const root = path.resolve(__dirname);
type Task = { id:string; category:string; prompt:string; setup:Record<string,string>; grader:{files:Record<string,string>; command?:string[]}; timeoutSec:number; turns?:string[]; maxCostUsd?:number };
type Row = {id:string; category:string; status:string; detail?:string; elapsedSec:number; toolCalls:number|null; costUsd:number|null};
const arg = (name:string, fallback='') => { const i=process.argv.indexOf('--'+name); return i<0 ? fallback : process.argv[i+1]; };
const safe = (s:string) => s.replace(/[^a-zA-Z0-9_.-]/g,'_');
async function writeFiles(dir:string, files:Record<string,string>) { for (const [name, text] of Object.entries(files)) { const p=path.resolve(dir,name); if(!p.startsWith(dir+path.sep)) throw Error('Unsafe fixture path'); await fs.mkdir(path.dirname(p),{recursive:true}); await fs.writeFile(p,text); } }
async function grade(task:Task, dir:string) {
  for (const [name, expected] of Object.entries(task.grader.files)) { try { if(await fs.readFile(path.join(dir,name),'utf8')!==expected) return false; } catch {return false;} }
  if(task.grader.command) {const [cmd,...args]=task.grader.command; const r=spawnSync(cmd,args,{cwd:dir,timeout:10000,encoding:'utf8'}); if(r.status!==0) return false;}
  return true;
}
function cli(binary:string, args:string[], cwd:string, signal:AbortSignal):Promise<string> {
  return new Promise((resolve,reject)=>{ const child=spawn(binary,args,{cwd,signal,stdio:['ignore','pipe','pipe'],shell:false}); let output=''; child.stdout.on('data',c=>{if(output.length<1000000)output+=c;}); child.stderr.on('data',c=>{if(output.length<1000000)output+=c;}); child.on('error',reject); child.on('close',code=>code===0?resolve(output):reject(Error(`CLI exit ${code}: ${output.slice(-1000)}`))); });
}
async function gatewayTask(task:Task, dir:string, model:string, signal:AbortSignal) {
  const gateway=arg('gateway','http://127.0.0.1:32466').replace(/\/$/,'');
  const url=new URL(gateway); if(!['127.0.0.1','localhost','[::1]'].includes(url.hostname)) throw Error('Only local loopback gateway is supported');
  const api=async(method:string,route:string,body?:unknown, s=signal)=>{const r=await fetch(gateway+route,{method,headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:s}); if(!r.ok)throw Error(`${route}: HTTP ${r.status}`); return r.json() as Promise<any>;};
  const status=await api('GET','/api/status');
  if(!status.workspace || await fs.realpath(status.workspace)!==await fs.realpath(arg('workspace')))throw Error('Gateway workspace mismatch');
  const id=`harness_${randomUUID()}`; const sep=model.indexOf(':'); if(sep<1)throw Error('--model requires provider:model for Prometheus');
  let calls=0; let completed=false;
  try {
    const route=await api('PUT',`/api/sessions/${id}/model-route`,{providerId:model.slice(0,sep),model:model.slice(sep+1)});
    if(route.chatModelRoute?.availability!=='ready')throw Error('Model route not ready');
    for(const prompt of [task.prompt,...(task.turns||[])]) {
      completed=false;
      const r=await fetch(gateway+'/api/chat',{method:'POST',headers:{'Content-Type':'application/json',Accept:'text/event-stream'},body:JSON.stringify({sessionId:id,message:`Work only in ${dir}. This is an isolated evaluation workspace. ${prompt}`,useTools:true,clientRequestId:randomUUID(),origin:{source:'local_benchmark'}}),signal});
      if(!r.ok||!r.body)throw Error(`chat HTTP ${r.status}`);
      const reader=r.body.getReader();const decoder=new TextDecoder();let buffer='';
      try { while(!completed) {const next=await reader.read();if(next.done)break;buffer+=decoder.decode(next.value,{stream:true});const packets=buffer.split(/\r?\n\r?\n/);buffer=packets.pop()||'';for(const packet of packets){const data=packet.split(/\r?\n/).filter(l=>l.startsWith('data:')).map(l=>l.slice(5).trim()).join('\n');if(!data)continue;let e:any;try{e=JSON.parse(data);}catch{continue;}if(e.type==='tool_result')calls++;if(e.type==='error')throw Error(String(e.error||e.message));if(e.type==='done')completed=true;} } } finally {await reader.cancel().catch(()=>{});}
      if(!completed)throw Error('Stream ended without done event');
    }
    return {toolCalls:calls,costUsd:null};
  } finally {
    if(!completed) {
      // Stop and confirm before the caller can clean a directory an agent still uses.
      const cleanup=AbortSignal.timeout(15000);
      await api('POST','/api/mobile/commands/stop-now',{sessionId:id,source:'harness_suite_cleanup'},cleanup);
      let settled=false;
      for(let i=0;i<20;i++){const r=await api('GET','/api/mobile/commands/stop-targets',undefined,cleanup);if(r.success===true&&Array.isArray(r.targets)&&!r.targets.some((t:any)=>t.sessionId===id)){settled=true;break;}await new Promise(r=>setTimeout(r,250));}
      if(!settled)throw Error(`Cleanup not confirmed; preserved workspace ${dir}`);
    }
  }
}
async function run(tasks:Task[], adapter:string, model:string, noop=false) {
  const rows:Row[]=[];
  const installed=!['hermes','openclaw'].includes(adapter)||spawnSync(process.platform==='win32'?'where.exe':'which',[adapter],{encoding:'utf8'}).status===0;
  for(const task of tasks) {
    const row:Row={id:task.id,category:task.category,status:'fail',elapsedSec:0,toolCalls:null,costUsd:null};const start=Date.now();
    if(!installed){row.status='not_run';row.detail='harness not installed';rows.push(row);continue;}
    if(adapter!=='dry'&&task.maxCostUsd!==undefined){row.status='not_run';row.detail='cost budget unverified: no trusted cost telemetry; not executed';rows.push(row);continue;}
    if(['hermes','openclaw'].includes(adapter)&&task.turns?.length){row.status='not_run';row.detail='CLI adapter has no verified multi-turn session contract';rows.push(row);continue;}
    const tempRoot=adapter==='prometheus'?path.resolve(arg('workspace')):os.tmpdir();
    const dir=await fs.mkdtemp(path.join(tempRoot,'prom-harness-'));let keep=false;
    const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),task.timeoutSec*1000);
    try {
      await writeFiles(dir,task.setup);
      if(task.category==='file-edit') {const r=spawnSync('git',['init','-q'],{cwd:dir});if(r.status!==0)throw Error('git init failed');}
      if(adapter==='dry') {if(!noop)await fs.cp(path.join(root,'tasks',task.id,'solution'),dir,{recursive:true});}
      else if(adapter==='prometheus')Object.assign(row,await gatewayTask(task,dir,model,controller.signal));
      else {
        const prompts=[task.prompt,...(task.turns||[])];
        // Explicit CLI contract; failures are published, not converted to simulated passes.
        if(adapter==='hermes')await cli('hermes',['chat','--model',model,'--query',prompts.join('\nThen: ')],dir,controller.signal);
        else await cli('openclaw',['agent','--local','--session-id',randomUUID(),'--model',model,'--message',prompts.join('\nThen: ')],dir,controller.signal);
      }
      row.elapsedSec=(Date.now()-start)/1000;
      const correct=await grade(task,dir);
      row.status=!controller.signal.aborted&&(Date.now()-start)/1000<=task.timeoutSec&&correct?'pass':'fail';
      if(task.maxCostUsd!==undefined&&adapter!=='dry'&&row.costUsd===null){row.status='not_run';row.detail='cost budget unverified: adapter has no trusted cost telemetry';}
    } catch(e) {row.status=controller.signal.aborted?'timeout':'error';row.detail=String(e);keep=adapter==='prometheus';}
    finally{clearTimeout(timer);row.elapsedSec=(Date.now()-start)/1000;if(!keep)await fs.rm(dir,{recursive:true,force:true});}
    rows.push(row);console.log(`${adapter}${noop?'-noop':''} ${task.id}: ${row.status}`);
  }
  return rows;
}
async function report(rows:Row[], adapter:string, model:string) {
  const stamp=new Date().toISOString().replace(/[:.]/g,'-');const out=arg('out',path.join(root,'results'));await fs.mkdir(out,{recursive:true});const base=path.join(out,`${stamp}-${safe(adapter)}-${safe(model)}`);
  const times=rows.filter(r=>!['not_run'].includes(r.status)).map(r=>r.elapsedSec).sort((a,b)=>a-b);const median=times.length?(times[Math.floor((times.length-1)/2)]+times[Math.ceil((times.length-1)/2)])/2:null;
  const categories=Object.fromEntries([...new Set(rows.map(r=>r.category))].map(c=>{const a=rows.filter(r=>r.category===c);return[c,{pass:a.filter(r=>r.status==='pass').length,total:a.length,notRun:a.filter(r=>r.status==='not_run').length}];}));
  await fs.writeFile(base+'.json',JSON.stringify({version:1,adapter,model,createdAt:new Date().toISOString(),medianSec:median,categories,results:rows},null,2)+'\n');
  await fs.writeFile(base+'.md',`# Harness suite: ${adapter}\nModel: ${model}\nMedian time: ${median??'unavailable'} seconds\nTool calls and cost: null means unavailable, never estimated as zero.\n\n| Category | Pass / total | Not run |\n|---|---:|---:|\n`+Object.entries(categories).map(([c,v])=>`| ${c} | ${v.pass}/${v.total} | ${v.notRun} |`).join('\n')+'\n\n'+rows.map(r=>`- ${r.id}: ${r.status}${r.detail?' — '+r.detail:''}; ${r.elapsedSec.toFixed(3)}s; tools=${r.toolCalls??'unavailable'}; USD=${r.costUsd??'unavailable'}`).join('\n')+'\n');
}
async function main(){const adapter=arg('adapter','dry'),model=arg('model',adapter==='dry'?'reference':'');if(!['dry','prometheus','hermes','openclaw'].includes(adapter))throw Error('Unknown adapter');if(!model)throw Error('--model required for real harnesses');if(adapter==='prometheus'&&!arg('workspace'))throw Error('--workspace must be the gateway workspace');let tasks:Task[]=[];for(const f of (await fs.readdir(path.join(root,'tasks'))).filter(f=>f.endsWith('.json')).sort())tasks.push(JSON.parse(await fs.readFile(path.join(root,'tasks',f),'utf8')));const only=arg('tasks');if(only)tasks=tasks.filter(t=>only.split(',').includes(t.id));if(!tasks.length)throw Error('No tasks');const rows=await run(tasks,adapter,model,process.argv.includes('--noop'));await report(rows,adapter,model);if(process.argv.includes('--self-test')){if(adapter!=='dry')throw Error('Self-test requires dry');const noops=await run(tasks,'dry',model,true);await report(noops,'dry-noop',model);if(rows.some(r=>r.status!=='pass')||noops.some(r=>r.status!=='fail'))throw Error('Grader discrimination failed');console.log(`Grader self-test: ${rows.length}/${rows.length} reference pass; 0/${noops.length} no-op pass`);} }
void main().catch(e=>{console.error(e);process.exitCode=1;});
