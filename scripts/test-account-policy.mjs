import assert from 'node:assert/strict';
const { bindAccountAction, revalidateAccountAction } = await import('../dist/connections/account-policy.js');
const record = id => ({ id, serviceId:'gmail', enabled:true, authenticated:true, authState:'healthy', account:{email:`${id}@example.invalid`}, accountAccess:{ ownerId:'owner',label:id,family:'connector',instanceId:id,generation:1,policyRevision:1 } });
const personal=record('personal'), business=record('business');
const owner={ownerId:'owner',principalId:'owner',isOwner:true,grantLayers:[]};
const grant={connectionId:'business',principalId:'team',capabilities:['read']};
const team={ownerId:'owner',principalId:'team',isOwner:false,grantLayers:[[grant]]};
const base={connections:[personal,business],principal:owner,capability:'read',tool:'read',args:{query:'fixture'}};
assert.throws(()=>bindAccountAction(base),/SELECTION_REQUIRED/);
assert.throws(()=>bindAccountAction({...base,connectionId:'unknown'}),/UNAVAILABLE/);
const binding=bindAccountAction({...base,connectionId:'business'});
revalidateAccountAction(binding,{...base,args:{query:'fixture'}});
assert.throws(()=>revalidateAccountAction(binding,{...base,args:{query:'changed'}}),/STALE/);
assert.throws(()=>revalidateAccountAction(binding,{...base,connections:[personal,{...business,accountAccess:{...business.accountAccess,generation:2}}]}),/STALE/);
assert.throws(()=>bindAccountAction({...base,principal:team,connectionId:'personal'}),/UNAVAILABLE/);
assert.equal(bindAccountAction({...base,principal:team,connectionId:'business'}).connectionId,'business');
assert.throws(()=>bindAccountAction({...base,principal:team}),/SELECTION_REQUIRED/);
assert.throws(()=>bindAccountAction({...base,principal:{...team,grantLayers:[[grant],[]]},connectionId:'business'}),/UNAVAILABLE/);
assert.throws(()=>bindAccountAction({...base,principal:team,connectionId:'business',capability:'send'}),/UNAVAILABLE/);
assert.throws(()=>bindAccountAction({...base,principal:{...team,grantLayers:[[{...grant,expiresAt:1}]]},connectionId:'business'}),/UNAVAILABLE/);
assert.throws(()=>bindAccountAction({...base,connections:[{...business,enabled:false}],connectionId:'business'}),/REAUTH/);
assert.equal(bindAccountAction({...base,connections:[personal]}).connectionId,'personal');
assert.throws(()=>bindAccountAction({...base,connections:[{...business,accountAccess:undefined}],connectionId:'business'}),/UNAVAILABLE/);
console.log('PASS account-policy fixtures: ambiguity, no fallback, grants, delegation intersection, expiry, generation/action binding');

const fs = await import('node:fs');
const os = await import('node:os');
const path = await import('node:path');
const { ConnectionStore } = await import('../dist/connections/connection-store.js');
const dir = fs.mkdtempSync(path.join(os.tmpdir(),'prom-account-store-'));
try {
  const store = new ConnectionStore(dir);
  const input = {serviceId:'gmail',pluginId:'gmail',strategyId:'oauth',installed:true,enabled:true,configured:true,authenticated:true,registered:true,exposed:true,verified:true,authState:'healthy',health:'healthy',grantedCapabilities:[],registeredTools:[],exposedTools:[]};
  const a = store.upsert({...input,accountAccess:personal.accountAccess});
  const b = store.upsert({...input,accountAccess:business.accountAccess});
  assert.notEqual(a.id,b.id);
  const legacy = store.upsert(input);
  assert.notEqual(legacy.id,a.id);
  assert.equal(store.upsert(input).id,legacy.id);
  assert.equal(new ConnectionStore(dir).findByService('gmail').length,3);
  assert.throws(()=>store.create({...input,accountAccess:{...business.accountAccess,generation:-1}}),/Invalid/);
  const {AccountLifecycle}=await import('../dist/connections/account-lifecycle.js');
  const lifecycle=new AccountLifecycle(store);
  const mcpAdded=lifecycle.add(a,'owner','MCP instance','mcp');
  assert.equal(mcpAdded.accountAccess.instanceId,`account_${mcpAdded.id}`);
  const added=lifecycle.add({...a,credentialRef:'must-not-copy',configuration:{secret:'must-not-copy'}},'owner','New business','connector');
  assert.equal(added.credentialRef,undefined);assert.equal(added.configuration,undefined);
  assert.equal(added.authenticated,false);
  assert.equal(lifecycle.rename(added.id,'owner','Renamed').accountAccess.label,'Renamed');
  assert.throws(()=>lifecycle.rename(added.id,'other','No'),/UNAVAILABLE/);
  await assert.rejects(lifecycle.disconnect(a.id,'owner',async()=>{throw new Error('fixture detach failure');}),/detach failure/);
  assert.equal(store.get(a.id).enabled,false);
  assert.equal(store.get(b.id).enabled,true);
  assert.equal(store.get(a.id).accountAccess.generation,2);
  console.log('PASS canonical sibling persistence, legacy dedup, add/rename and fail-closed disconnect');
} finally { fs.rmSync(dir,{recursive:true,force:true}); }

const {withAccountExecution,currentAccountExecution}=await import('../dist/connections/account-execution-context.js');
let checks=0;
const execution={binding,serviceId:'gmail',revalidate(){checks++;}};
await Promise.all([
  withAccountExecution(execution,async()=>{await new Promise(resolve=>setTimeout(resolve,5));assert.equal(currentAccountExecution('gmail').binding.connectionId,'business');assert.throws(()=>currentAccountExecution('github'),/SERVICE_MISMATCH/);}),
  withAccountExecution({...execution,binding:{...binding,connectionId:'personal'}},async()=>{await Promise.resolve();assert.equal(currentAccountExecution('gmail').binding.connectionId,'personal');})
]);
assert.equal(currentAccountExecution(),undefined);
assert(checks>=4);
withAccountExecution(execution,()=>assert.throws(()=>withAccountExecution({...execution,binding:{...binding,connectionId:'personal'}},()=>{}),/WIDENING/));
console.log('PASS asynchronous account binding isolation and nested account-switch rejection');

const {dispatchAccountAction}=await import('../dist/connections/account-dispatch.js');
let records=[business]; let sends=0;
const host={readConnections:()=>records,readPrincipal:()=>owner,approve:async approved=>{assert.equal(approved.connectionId,'business');return true;}};
const request={serviceId:'gmail',connectionId:'business',capability:'read',tool:'fixture-read',args:{query:'fixture'},requiresApproval:true};
await dispatchAccountAction(host,request,async()=>{sends++;assert.equal(currentAccountExecution().binding.connectionId,'business');});
assert.equal(sends,1);
await assert.rejects(dispatchAccountAction({...host,approve:async()=>{records=[{...business,accountAccess:{...business.accountAccess,generation:2}}];return true;}},request,async()=>{sends++;}),/STALE/);
assert.equal(sends,1);
records=[business];
await assert.rejects(dispatchAccountAction({...host,approve:async()=>false},request,async()=>{sends++;}),/NOT_APPROVED/);
assert.equal(sends,1);
console.log('PASS dispatch revalidates selected account after approval and blocks denied/stale actions');

const {connectionInstanceIdentity}=await import('../dist/connections/instance-identity.js');
const mcpContext=id=>({attempt:{serviceId:'preset',metadata:id?{connectionId:id}:{},plan:{strategy:{configuration:{mcpServerId:'preset-template'}}}}});
assert.equal(connectionInstanceIdentity(mcpContext()).instanceId,'preset-template');
assert.equal(connectionInstanceIdentity(mcpContext('a')).templateId,'preset-template');
assert.notEqual(connectionInstanceIdentity(mcpContext('a')).instanceId,connectionInstanceIdentity(mcpContext('b')).instanceId);
assert.throws(()=>connectionInstanceIdentity(mcpContext('../a')),/INVALID/);
console.log('PASS MCP template/instance separation and legacy identity');

const {resolvePluginAccountOwner}=await import('../dist/connections/account-owner.js');
const ownerDir=fs.mkdtempSync(path.join(os.tmpdir(),'prom-owner-fixture-'));
try {
  const local=resolvePluginAccountOwner(ownerDir,null);
  assert.equal(resolvePluginAccountOwner(ownerDir,null),local);
  assert.notEqual(resolvePluginAccountOwner(ownerDir,'signed-in-user'),local);
  assert.notEqual(resolvePluginAccountOwner(ownerDir,'other-user'),resolvePluginAccountOwner(ownerDir,'signed-in-user'));
  fs.writeFileSync(path.join(ownerDir,'plugin-local-owner.json'),'corrupt');
  assert.throws(()=>resolvePluginAccountOwner(ownerDir,null),/UNAVAILABLE/);
  console.log('PASS durable local owner, separate signed-in identities and corrupt-owner fail closed');
} finally {fs.rmSync(ownerDir,{recursive:true,force:true});}

const {resolveAccountPrincipal}=await import('../dist/connections/account-principal.js');
const delegatedRecord={...business,accountAccess:{...business.accountAccess,grants:[
  {connectionId:'business',principalId:'team:xpose',capabilities:['read','send']},
  {connectionId:'business',principalId:'agent:worker',capabilities:['read']}
]}};
const actor={kind:'agent',ownerId:'owner',principalId:'agent:worker',ancestors:['team:xpose']};
const resolved=resolveAccountPrincipal(actor,[delegatedRecord]);
assert.equal(bindAccountAction({...base,connections:[delegatedRecord],connectionId:'business',principal:resolved}).connectionId,'business');
assert.throws(()=>bindAccountAction({...base,connections:[delegatedRecord],connectionId:'business',principal:resolved,capability:'send'}),/UNAVAILABLE/);
assert.throws(()=>bindAccountAction({...base,connections:[delegatedRecord],connectionId:'business',principal:resolveAccountPrincipal({...actor,ancestors:['team:other']},[delegatedRecord])}),/UNAVAILABLE/);
assert.throws(()=>resolveAccountPrincipal({...actor,kind:'owner'},[delegatedRecord]),/PRINCIPAL_UNAVAILABLE/);
assert.equal(resolveAccountPrincipal({...actor,ownerId:'different'},[delegatedRecord]).grantLayers.flat().length,0);
console.log('PASS persisted actor grants intersect parent authority without owner escalation or cross-owner leakage');

const {assertAccountToolBoundary}=await import('../dist/connections/account-tool-boundary.js');
assertAccountToolBoundary([{serviceId:'gmail'}],'gmail','read',{query:'fixture'});
assert.throws(()=>assertAccountToolBoundary([business],'gmail','read'),/SELECTION_REQUIRED/);
const toolRecord={...business,pluginId:binding.pluginId,availableTools:['read']};
withAccountExecution(execution,()=>{
  assertAccountToolBoundary([toolRecord],'gmail','read',{query:'fixture'});
  assert.throws(()=>assertAccountToolBoundary([toolRecord],'gmail','send'),/TOOL_MISMATCH/);
  assert.throws(()=>assertAccountToolBoundary([{...toolRecord,enabled:false}],'gmail','read',{query:'fixture'}),/TOOL_UNAVAILABLE/);
});
console.log('PASS family dispatch boundary denies singleton bypass and ungranted tools while retaining legacy-only behavior');

const {assertMcpAccountBoundary}=await import('../dist/connections/account-tool-boundary.js');
const mcpRecord={...toolRecord,accountAccess:{...toolRecord.accountAccess,family:'mcp',instanceId:'account_business'},configuration:{mcpServerId:'account_business'}};
assertMcpAccountBoundary([],'legacy-server','read',{query:'fixture'});
assert.throws(()=>assertMcpAccountBoundary([mcpRecord],'account_business','read'),/SELECTION_REQUIRED/);
withAccountExecution(execution,()=>{
  assertMcpAccountBoundary([mcpRecord],'account_business','read',{query:'fixture'});
  assert.throws(()=>assertMcpAccountBoundary([mcpRecord],'legacy-server','read'),/SERVICE_MISMATCH/);
});
console.log('PASS MCP transport boundary requires exact account binding and forbids sibling/legacy transport escape');

const authority=await import('../dist/connections/account-session-authority.js');
assert.throws(()=>authority.getAccountSessionAuthority('unknown'),/PRINCIPAL_UNAVAILABLE/);
for(const invalid of [
  {kind:'owner',ownerId:'owner',principalId:'other',ancestors:[]},
  {kind:'owner',ownerId:'owner',principalId:'owner',ancestors:['team:x']},
  {kind:'agent',ownerId:'owner',principalId:'agent:',ancestors:[]},
  {kind:'agent',ownerId:'owner',principalId:'agent:x',ancestors:['owner']},
]) assert.throws(()=>authority.setAccountSessionAuthority('invalid-authority',invalid),/PRINCIPAL_UNAVAILABLE/);
assert.throws(()=>authority.getAccountSessionAuthority('invalid-authority'),/PRINCIPAL_UNAVAILABLE/);
authority.setAccountSessionAuthority('owner-session',{kind:'owner',ownerId:'owner',principalId:'owner',ancestors:[]});
authority.delegateAccountSessionAuthority('owner-session','team-session','team','team:xpose');
authority.delegateAccountSessionAuthority('team-session','worker-session','agent','agent:worker');
assert.deepEqual(authority.getAccountSessionAuthority('worker-session').ancestors,['team:xpose']);
assert.throws(()=>authority.setAccountSessionAuthority('worker-session',{kind:'owner',ownerId:'owner',principalId:'owner',ancestors:[]}),/REBIND_FORBIDDEN/);
assert.throws(()=>authority.delegateAccountSessionAuthority('team-session','invalid','agent','team:xpose'),/DELEGATION_INVALID/);
for(const id of ['owner-session','team-session','worker-session'])authority.clearAccountSessionAuthority(id);
console.log('PASS host session authority requires explicit binding, retains delegation ancestors and forbids identity rebinding');

const {prepareRuntimeAccountAction}=await import('../dist/connections/account-runtime-binding.js');
authority.setAccountSessionAuthority('binding-fixture',{kind:'owner',ownerId:'owner',principalId:'owner',ancestors:[]});
let runtimeRecords=[toolRecord];
const prepared=prepareRuntimeAccountAction({sessionId:'binding-fixture',serviceId:'gmail',connectionId:'business',tool:'read',args:{query:'fixture'},readConnections:()=>runtimeRecords});
assert.equal(prepared.approvalAccount.connectionId,'business');
assert.equal(prepared.run(()=>currentAccountExecution().binding.connectionId),'business');
runtimeRecords=[{...toolRecord,accountAccess:{...toolRecord.accountAccess,generation:2}}];
assert.throws(()=>prepared.run(()=>assert.fail('stale approved call ran')),/STALE/);
authority.clearAccountSessionAuthority('binding-fixture');
assert.throws(()=>prepared.run(()=>assert.fail('cleared authority ran')),/PRINCIPAL_UNAVAILABLE/);
authority.setAccountSessionAuthority('binding-fixture',{kind:'owner',ownerId:'owner',principalId:'owner',ancestors:[]});
assert.throws(()=>prepared.run(()=>assert.fail('revoked approval revived')),/AUTHORITY_CHANGED/);
const admissionVersion=authority.getAccountSessionAuthorityVersion('binding-fixture');
authority.setAccountSessionAuthority('binding-fixture',{kind:'owner',ownerId:'owner',principalId:'owner',ancestors:[]});
assert.equal(authority.getAccountSessionAuthorityVersion('binding-fixture'),admissionVersion);
authority.clearAccountSessionAuthority('binding-fixture');
console.log('PASS revoked authority cannot revive prepared actions after same-identity re-admission');
console.log('PASS runtime preparation exposes exact approval identity and revalidates generation/session before dispatch');

authority.setAccountSessionAuthority('mutable-args',{kind:'owner',ownerId:'owner',principalId:'owner',ancestors:[]});
let actualArgs={recipient:'first@example.invalid'};
const exactAction=prepareRuntimeAccountAction({sessionId:'mutable-args',serviceId:'gmail',connectionId:'business',tool:'read',args:actualArgs,readArgs:()=>actualArgs,readConnections:()=>[toolRecord]});
actualArgs={recipient:'different@example.invalid'};
assert.throws(()=>exactAction.run(()=>assert.fail('modified approved recipient executed')),/STALE/);
authority.clearAccountSessionAuthority('mutable-args');
console.log('PASS post-approval argument mutation cannot reuse an exact-account action binding');

const {discoverAccounts}=await import('../dist/connections/account-discovery.js');
const visible=discoverAccounts([personal,delegatedRecord],resolved,'gmail','read');
assert.deepEqual(visible.map(row=>row.id),['business']);
assert.equal(JSON.stringify(visible).includes('credentialRef'),false);
assert.equal(discoverAccounts([personal,delegatedRecord],resolved,'gmail','send').length,0);
console.log('PASS account discovery filters personal identity and credentials before worker projection');

const {accountFamilySupport}=await import('../dist/connections/account-family-support.js');
const {nativeAccountConnectorIds}=await import('../dist/integrations/connector-instances.js');
assert.equal(nativeAccountConnectorIds.length,14);
assert.equal(accountFamilySupport('connector','x').mode,'account');
for(const id of nativeAccountConnectorIds)assert.equal(accountFamilySupport('connector',id).mode,'account');
assert.equal(accountFamilySupport('mcp_preset','fixture').mode,'instance');
assert.equal(accountFamilySupport('provider','fixture').mode,'existing-model-connection');
assert.equal(accountFamilySupport('connector','obsidian').mode,'account');
assert.equal(accountFamilySupport('connector','unknown').mode,'gated');
assert.equal(accountFamilySupport('integration','browser').mode,'gated');
console.log('PASS family contract distinguishes native, MCP, existing model identities and explicitly gated adapters');

authority.setAccountSessionAuthority('root-revoke',{kind:'owner',ownerId:'owner',principalId:'owner',ancestors:[]});
authority.delegateAccountSessionAuthority('root-revoke','team-revoke','team','team:xpose');
authority.delegateAccountSessionAuthority('team-revoke','leaf-revoke','agent','agent:worker');
assert.throws(()=>authority.delegateAccountSessionAuthority('leaf-revoke','root-revoke','task','task:cycle'),/DELEGATION_INVALID/);
authority.clearAccountSessionAuthority('root-revoke');
assert.throws(()=>authority.getAccountSessionAuthority('leaf-revoke'),/PRINCIPAL_UNAVAILABLE/);
assert.throws(()=>authority.getAccountSessionAuthority('team-revoke'),/PRINCIPAL_UNAVAILABLE/);
console.log('PASS revoking parent session cascades to descendants and delegation cycles fail closed');

const actors=await import('../dist/gateway/runtime-actor.js');
authority.setAccountSessionAuthority('actor-clear',{kind:'owner',ownerId:'owner',principalId:'owner',ancestors:[]});
actors.clearRuntimeActorContext('actor-clear');
assert.throws(()=>authority.getAccountSessionAuthority('actor-clear'),/PRINCIPAL_UNAVAILABLE/);
console.log('PASS runtime actor teardown clears account session authority');

authority.setAccountSessionAuthority('actor-rebind',{kind:'owner',ownerId:'owner',principalId:'owner',ancestors:[]});
actors.setRuntimeActorContext('actor-rebind',{kind:'agent',surface:'background_dispatch',agentId:'fixture'});
assert.throws(()=>authority.getAccountSessionAuthority('actor-rebind'),/PRINCIPAL_UNAVAILABLE/);
actors.clearRuntimeActorContext('actor-rebind');
console.log('PASS runtime actor identity change cannot inherit stale owner account authority');

withAccountExecution(execution,()=>{
 assert.throws(()=>assertAccountToolBoundary([toolRecord],'gmail','read',{query:'changed'}),/PAYLOAD_MISMATCH/);
 assert.throws(()=>assertMcpAccountBoundary([mcpRecord],'account_business','read',{query:'changed'}),/PAYLOAD_MISMATCH/);
 assert.throws(()=>assertAccountToolBoundary([toolRecord],'gmail','read',{query:'fixture',connection_id:'personal'}),/PAYLOAD_MISMATCH/);
 assertAccountToolBoundary([toolRecord],'gmail','read',{query:'fixture',connection_id:'business'});
});
console.log('PASS actual downstream native/MCP payload is compared against immutable approved payload, including selector mismatch');

const leaseOwner={kind:'owner',ownerId:'owner',principalId:'owner',ancestors:[]};
authority.setAccountSessionAuthority('logout-root',leaseOwner);
const beforeLogout=authority.getAccountSessionAuthorityVersion('logout-root');
authority.delegateAccountSessionAuthority('logout-root','logout-child','task','task:logout');
authority.clearAllAccountSessionAuthorities();
assert.throws(()=>authority.getAccountSessionAuthority('logout-child'),/PRINCIPAL_UNAVAILABLE/);
authority.setAccountSessionAuthority('logout-root',leaseOwner);
assert.notEqual(authority.getAccountSessionAuthorityVersion('logout-root'),beforeLogout);
authority.clearAllAccountSessionAuthorities();
console.log('PASS global account logout clears descendants without recycling admission versions');

const {sessionAccountChoices}=await import('../dist/connections/account-discovery.js');
assert.deepEqual(await sessionAccountChoices('no-discovery-authority',[personal,business]),[]);
authority.setAccountSessionAuthority('choice-owner',leaseOwner);
assert.deepEqual((await sessionAccountChoices('choice-owner',[personal,business])).map(item=>item.id),['personal','business']);
authority.clearAccountSessionAuthority('choice-owner');
assert.deepEqual(await sessionAccountChoices('choice-owner',[personal,business]),[]);
console.log('PASS session connector choices expose explicit account IDs only while host authority is active');
