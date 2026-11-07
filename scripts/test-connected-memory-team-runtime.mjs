import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {createRequire} from 'node:module';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'cm-team-runtime-'));const home=path.join(root,'home');fs.mkdirSync(home,{recursive:true});
Object.assign(process.env,{HOME:home,USERPROFILE:home,APPDATA:path.join(root,'appdata'),LOCALAPPDATA:path.join(root,'local'),PROMETHEUS_CONFIG_DIR:path.join(root,'config'),PROMETHEUS_DATA_DIR:path.join(root,'data'),PROMETHEUS_HOME:path.join(root,'prom-home')});
const require=createRequire(import.meta.url);require('tsx/cjs');
const {getConfig}=require('../src/config/config.ts');const workspace=path.join(root,'workspace');fs.mkdirSync(workspace,{recursive:true});getConfig().updateConfig({workspace:{path:workspace}});
const {getReferenceService}=require('../src/gateway/resources/reference-service.ts');const service=getReferenceService(workspace);
const teams=require('../src/gateway/teams/managed-teams.ts');const tasks=require('../src/gateway/tasks/task-store.ts');
const rt=require('../src/gateway/resources/reference-team-runtime.ts');const access=require('../src/gateway/resources/reference-access.ts');const {runInTrace}=require('../src/gateway/observability/turn-trace.ts');
const {setRuntimeActorContext}=require('../src/gateway/runtime-actor.ts');
try {
 const team=teams.createManagedTeam({name:'Fixture',description:'Synthetic',subagentIds:[],teamContext:'test',managerSystemPrompt:'test'});
 const other=teams.createManagedTeam({name:'Other',description:'Synthetic',subagentIds:[],teamContext:'test',managerSystemPrompt:'test'});
 const ref=service.saveText({operationId:'fixture-public',title:'Shared sample',content:'Evidence is orange',userQuote:'Use only for the sample task'});
 const secret=service.saveText({operationId:'fixture-private',title:'PRIVATE CANARY TITLE',content:'PRIVATE CANARY BYTES'});
 const grant=service.metadata.sharing().grant(team.id,'reference',ref.id);
 const run=(teamId,taskId,sid,fn)=>rt.teamReferenceChat(teamId,taskId,(_,session)=>runInTrace({sessionId:session,executionMode:taskId?'team_subagent':'team_manager'},fn))('fixture',sid);
 setRuntimeActorContext('spoof',{kind:'agent',surface:'team_dispatch',teamId:team.id});
 assert.throws(()=>runInTrace({sessionId:'spoof',executionMode:'team_subagent'},()=>access.accessibleReferenceSearch(workspace,'spoof','')),/personal|owner/i);
 await run(other.id,undefined,'other',()=>{assert.deepEqual(access.accessibleReferenceSearch(workspace,'other',''),[]);assert.throws(()=>access.accessibleReferenceOpen(workspace,'other',ref.id),/unavailable/i);});
 let selected;
 await run(team.id,undefined,'manager',()=>{assert.deepEqual(access.accessibleReferenceSearch(workspace,'manager','').map(r=>r.id),[ref.id]);assert.throws(()=>access.accessibleReferenceOpen(workspace,'manager',secret.id),/unavailable/i);selected=rt.selectTeamEvidence('manager',{referenceId:ref.id,purpose:'Designer exact sample'});assert.deepEqual(rt.inheritedTeamBindings(team.id),selected);});
 assert.equal(service.metadata.sharing().sessionBindings(team.id,'manager')[0].purpose,'Designer exact sample');
 const task=tasks.createTask({title:'Builder',prompt:'Build',sessionId:'builder',channel:'web',teamSubagent:{teamId:team.id,agentId:'fixture-agent',agentName:'Fixture',callerContext:''},referenceBindings:selected});
 assert.equal(tasks.loadTask(task.id).referenceBindings[0].versionId,ref.versionId);
 await run(team.id,task.id,'builder',()=>{const opened=access.accessibleReferenceOpen(workspace,'builder',ref.id);assert.equal(opened.text,'Evidence is orange');assert.equal(opened.reference.sourceSession,undefined);assert.deepEqual(rt.inheritedTeamBindings(team.id),selected);assert.throws(()=>access.accessibleReferenceOpen(workspace,'builder',ref.id,{versionId:'wrong'}),/mismatch/);});
 await run(team.id,task.id,'verifier',()=>assert.equal(access.accessibleReferenceOpen(workspace,'verifier',ref.id).reference.versionId,ref.versionId));
 // Loaders retain pointer-only refs and exact ids; no title-only context substitute.
 team.contextReferences=[{id:'ptr',title:'Pointer',content:'',referenceBindings:selected,createdAt:1,updatedAt:1}];teams.saveManagedTeam(team);assert.deepEqual(teams.getManagedTeam(team.id).contextReferences[0].referenceBindings,selected);
 const {SubagentManager}=require('../src/gateway/agents-runtime/subagent-manager.ts');const manager=new SubagentManager(workspace);const agentDir=path.join(root,'fake-agent');fs.mkdirSync(agentDir);fs.writeFileSync(path.join(agentDir,'context-refs.json'),JSON.stringify({refs:team.contextReferences}));assert.deepEqual(manager.loadContextRefsForAgentDir(agentDir)[0].referenceBindings,selected);
 service.metadata.sharing().revoke(grant.id);
 assert.throws(()=>rt.validateTaskReferences(tasks.loadTask(task.id)),/revoked/);
 assert.throws(()=>run(team.id,task.id,'resumed',()=>{}),/revoked/);
 tasks.updateTaskStatus(task.id,'paused');assert.equal(tasks.loadTask(task.id).status,'paused'); // revocation must not wedge persistence
 assert.ok(service.metadata.pins().has(ref.versionId));
 console.log('team runtime PASS: real grant filter/open; spoof denial; durable manager→builder→verifier; both loaders; revoke/resume/pause');
}finally{service.resources.flushSync();service.metadata.close();fs.rmSync(root,{recursive:true,force:true});}
