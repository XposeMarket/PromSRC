import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import {createRequire} from 'node:module';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'cm-team-lifecycle-'));const home=path.join(root,'home');fs.mkdirSync(home,{recursive:true});
Object.assign(process.env,{HOME:home,USERPROFILE:home,APPDATA:path.join(root,'appdata'),LOCALAPPDATA:path.join(root,'local'),PROMETHEUS_CONFIG_DIR:path.join(root,'config'),PROMETHEUS_DATA_DIR:path.join(root,'data'),PROMETHEUS_HOME:path.join(root,'prom-home')});
const require=createRequire(import.meta.url);require('tsx/cjs');
const {getConfig}=require('../src/config/config.ts');const workspace=path.join(root,'workspace');fs.mkdirSync(workspace,{recursive:true});getConfig().updateConfig({workspace:{path:workspace}});
const {getReferenceService}=require('../src/gateway/resources/reference-service.ts');
const {readReferencePins}=require('../src/gateway/resources/reference-store.ts');
const teams=require('../src/gateway/teams/managed-teams.ts');const tasks=require('../src/gateway/tasks/task-store.ts');
const rt=require('../src/gateway/resources/reference-team-runtime.ts');const access=require('../src/gateway/resources/reference-access.ts');const {runInTrace}=require('../src/gateway/observability/turn-trace.ts');
const service=getReferenceService(workspace);const sharing=()=>service.metadata.sharing();
const teamRun=(teamId,taskId,sid,fn)=>rt.teamReferenceChat(teamId,taskId,(_,session)=>runInTrace({sessionId:session,executionMode:taskId?'team_subagent':'team_manager'},fn))('fixture',sid);
const mkTeam=n=>teams.createManagedTeam({name:n,description:'Synthetic',subagentIds:[],teamContext:'test',managerSystemPrompt:'test'});
const mkTask=(team,title,bindings=[])=>tasks.createTask({title,prompt:'p',sessionId:title,channel:'web',teamSubagent:{teamId:team.id,agentId:'fixture-agent',agentName:'Fixture',callerContext:''},referenceBindings:bindings});
const holderRows=taskId=>service.metadata.db.prepare("SELECT version_id FROM version_pins WHERE holder_kind='task' AND holder_id=?").all(`${workspace}:${taskId}`).map(r=>r.version_id);
const results={};
function kase(name,fn){try{fn();results[name]='PASS';}catch(e){results[name]='FAIL: '+String(e&&e.message||e).split('\n')[0];}}

kase('1 snapshot-save/opened+unselect durable', ()=>{
  const team=mkTeam('C1');const a=service.saveText({operationId:'c1-a',title:'C1 A',content:'A bytes',userQuote:'qa'});const b=service.saveText({operationId:'c1-b',title:'C1 B',content:'B bytes',userQuote:'qb'});
  sharing().grant(team.id,'reference',a.id);sharing().grant(team.id,'reference',b.id);
  const task=mkTask(team,'c1');
  teamRun(team.id,task.id,'c1-builder',()=>rt.selectTeamEvidence('c1-builder',{referenceId:a.id,purpose:'explicit A'}));
  const stale=tasks.loadTask(task.id);
  teamRun(team.id,task.id,'c1-builder',()=>access.accessibleReferenceOpen(workspace,'c1-builder',b.id));
  stale.status='running';tasks.saveTask(stale);
  const afterStale=tasks.loadTask(task.id).referenceBindings.map(x=>x.referenceId).sort();
  assert.deepEqual(afterStale,[a.id,b.id].sort(),'stale snapshot save erased a later opened/selected binding');
  teamRun(team.id,task.id,'c1-builder',()=>rt.selectTeamEvidence('c1-builder',{referenceId:a.id,remove:true}));
  const reloaded=tasks.loadTask(task.id).referenceBindings.map(x=>x.referenceId);
  assert.deepEqual(reloaded,[b.id],'explicit unselect not persisted');
});

kase('2 >25 versions + flushSync keeps task-held original', ()=>{
  const team=mkTeam('C2'); const resources=service.resources;
  const add=(canonical,content)=>resources.attach({kind:'file',title:'Retained original',origin:'user_upload',locator:{type:'file',canonical},content,snapshotKind:'text'});
  const first=add('task-retention.txt','ORIGINAL_BYTES'), dependency=add('dependency.txt','DEPENDENT_BYTES');
  const binding={resourceId:first.resource.id,versionId:first.version.id}, depBinding={resourceId:dependency.resource.id,versionId:dependency.version.id};
  const ref=service.saveExisting({operationId:'c2-original',binding,title:'Retained original',dependencies:[depBinding]});
  sharing().grant(team.id,'reference',ref.id);const task=mkTask(team,'c2',[sharing().select(team.id,ref.id,'Exact original')]);
  service.metadata.remove(ref.id);
  for(let i=2;i<=28;i++){add('task-retention.txt',`replacement ${i}`);add('dependency.txt',`dependency ${i}`);}
  resources.flushSync();assert.equal(resources.referenceContent(binding.resourceId,binding.versionId).bytes.toString(),'ORIGINAL_BYTES');assert.equal(resources.referenceContent(depBinding.resourceId,depBinding.versionId).bytes.toString(),'DEPENDENT_BYTES');
  const pins=readReferencePins(resources.rootDir);assert.ok(pins.has(binding.versionId));assert.ok(pins.has(depBinding.versionId));
  tasks.updateTaskStatus(task.id,'failed');assert.ok(!readReferencePins(resources.rootDir).has(binding.versionId));
});

kase('3 required grant guidance + deterministic dispatch + collection freeze', ()=>{
  const team=mkTeam('C3');const req=service.saveText({operationId:'c3-req',title:'Baseline',content:'REQ bytes'});const opt=service.saveText({operationId:'c3-opt',title:'Optional',content:'OPT bytes'});
  const defG=sharing().grant(team.id,'reference',opt.id);assert.equal(defG.required,false,'default grant must not be required');
  const reqG=sharing().grant(team.id,'reference',req.id,{required:true,purpose:'Owner baseline'});assert.equal(reqG.required,true);
  const d1=teamRun(team.id,undefined,'c3-mgr',()=>rt.dispatchReferenceBindings(team.id));
  const d2=teamRun(team.id,undefined,'c3-mgr',()=>rt.dispatchReferenceBindings(team.id));
  assert.deepEqual(d1,d2,'dispatch not deterministic');
  assert.deepEqual(d1.map(b=>[b.referenceId,b.grantId,b.required]),[[req.id,reqG.id,true]]);
  const coll=sharing().saveCollection({title:'C3 coll',purpose:'p'});sharing().setMember(coll.id,opt.id,true);sharing().grant(team.id,'collection',coll.id);
  const task=mkTask(team,'c3');
  teamRun(team.id,task.id,'c3-builder',()=>rt.selectTeamEvidence('c3-builder',{collectionId:coll.id}));
  const newRef=service.saveText({operationId:'c3-new',title:'Later',content:'NEW bytes'});sharing().setMember(coll.id,newRef.id,true,true);
  const frozen=tasks.loadTask(task.id).referenceBindings.map(b=>b.referenceId);
  assert.deepEqual(frozen,[opt.id],'collection select did not freeze members / later member implicitly added');
  teamRun(team.id,task.id,'c3-verifier',()=>rt.validateTaskReferences(tasks.loadTask(task.id)));
  assert.deepEqual(tasks.loadTask(task.id).referenceBindings.map(b=>b.referenceId),[opt.id]);
});

kase('4 revoke: validate/resume fail, pause+fail saves not wedged', ()=>{
  const team=mkTeam('C4');const a=service.saveText({operationId:'c4-a',title:'C4 A',content:'A4 bytes'});const g=sharing().grant(team.id,'reference',a.id);
  const task=mkTask(team,'c4');
  teamRun(team.id,task.id,'c4-builder',()=>rt.selectTeamEvidence('c4-builder',{referenceId:a.id,purpose:'p'}));
  sharing().revoke(g.id);
  assert.throws(()=>rt.validateTaskReferences(tasks.loadTask(task.id)),/revoked/);
  assert.throws(()=>teamRun(team.id,task.id,'c4-resumed',()=>{}),/revoked/);
  tasks.updateTaskStatus(task.id,'paused',{pauseReason:'user_pause'});assert.equal(tasks.loadTask(task.id).status,'paused','pause save wedged');
  tasks.updateTaskStatus(task.id,'failed',{pauseReason:undefined});assert.equal(tasks.loadTask(task.id).status,'failed','fail save wedged');
});

kase('6 unselect-all task releases historical pins only after a durable terminal write', ()=>{
  const team=mkTeam('C6');const a=service.saveText({operationId:'c6-a',title:'C6 A',content:'A6 bytes'});
  sharing().grant(team.id,'reference',a.id);const t=mkTask(team,'c6');
  teamRun(team.id,t.id,'c6',()=>rt.selectTeamEvidence('c6',{referenceId:a.id,purpose:'t6'}));
  teamRun(team.id,t.id,'c6',()=>rt.selectTeamEvidence('c6',{referenceId:a.id,remove:true}));
  assert.deepEqual(tasks.loadTask(t.id).referenceBindings,[],'precondition: unselected');
  assert.ok(holderRows(t.id).length>0,'precondition: historical pins remain until terminal');
  const fsMod=require('fs');const proto=Object.getPrototypeOf(sharing());const origFsync=fsMod.fsyncSync,origRel=proto.releaseTask;const order=[];
  fsMod.fsyncSync=fd=>{order.push('fsync');return origFsync(fd);};proto.releaseTask=function(id){order.push('release');return origRel.call(this,id);};
  try{tasks.updateTaskStatus(t.id,'complete');}finally{fsMod.fsyncSync=origFsync;proto.releaseTask=origRel;}
  assert.equal(holderRows(t.id).length,0,'unselect-all task kept pins after terminal');
  assert.ok(order.includes('fsync')&&order.indexOf('fsync')<order.indexOf('release'),'pins released before durable terminal write: '+order.join(','));
});

{ const name='7 trusted team turn cannot read owner memory via related';
  try{ const team=mkTeam('C7');const t=mkTask(team,'c7');
    fs.writeFileSync(path.join(workspace,'MEMORY.md'),'# Memory\n## projects\n- [m:canry] owner-only canary fact [[stage-d-canary]]\n');
    const {memoryCapabilityExecutor}=require('../src/gateway/agents-runtime/capabilities/memory-executor.ts');
    const r=await teamRun(team.id,t.id,'c7-verifier',()=>memoryCapabilityExecutor.execute({name:'memory',args:{action:'related',query:'stage-d-canary'},workspacePath:workspace,sessionId:'c7-verifier'}));
    assert.equal(r.error,true,'memory related allowed inside trusted team scope');assert.ok(!String(r.result).includes('owner-only canary fact'),'owner memory leaked');
    results[name]='PASS'; }catch(e){results[name]='FAIL: '+String(e&&e.message||e).split('\n')[0];} }

kase('5 terminal release only own pins; restart read-only', ()=>{
  const team=mkTeam('C5');const a=service.saveText({operationId:'c5-a',title:'C5 A',content:'A5 bytes'});const b=service.saveText({operationId:'c5-b',title:'C5 B',content:'B5 bytes'});
  sharing().grant(team.id,'reference',a.id);sharing().grant(team.id,'reference',b.id);
  const t1=mkTask(team,'c5-t1');const t2=mkTask(team,'c5-t2');
  teamRun(team.id,t1.id,'c5-t1',()=>rt.selectTeamEvidence('c5-t1',{referenceId:a.id,purpose:'t1'}));
  teamRun(team.id,t2.id,'c5-t2',()=>rt.selectTeamEvidence('c5-t2',{referenceId:b.id,purpose:'t2'}));
  teamRun(team.id,t1.id,'c5-t1',()=>rt.selectTeamEvidence('c5-t1',{referenceId:b.id,purpose:'t1b'}));
  assert.ok(holderRows(t1.id).length>0&&holderRows(t2.id).length>0,'precondition: both tasks hold pins');
  const t2Before=holderRows(t2.id).slice().sort();
  tasks.updateTaskStatus(t1.id,'complete');
  assert.equal(holderRows(t1.id).length,0,'terminal task kept its own pins');
  assert.deepEqual(holderRows(t2.id).slice().sort(),t2Before,'terminal release touched another holder');
  service.metadata.close();
  const restarted=readReferencePins(service.resources.rootDir);
  assert.ok(restarted.has(b.versionId),'t2-held version missing after restart read');
});

console.log(JSON.stringify(results,null,1));
const failed=Object.entries(results).filter(([,v])=>v!=='PASS');
fs.rmSync(root,{recursive:true,force:true});
if(failed.length){console.error('team lifecycle FAIL: '+failed.map(([k])=>k).join('; '));process.exitCode=1;}
else console.log('team lifecycle PASS');
