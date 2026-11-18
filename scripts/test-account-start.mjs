import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { ConnectionStartService } = require('../dist/connections/start-service.js');
const attempts = new Map();
const created = [];
const orchestrator = {
  listConnections: () => ['personal', 'business'].map(id => ({id,serviceId:'gmail',pluginId:'connector.gmail',accountAccess:{ownerId:'owner',generation:1},account:{provider:'gmail',email:`${id}@example.invalid`}})),
  discover: () => ({status:'resolved',canonicalServiceId:'gmail',matches:[{pluginId:'connector.gmail'}]}),
  getAttempt: id => attempts.get(id),
  create: input => {const a={id:`attempt${created.length}`,serviceId:'gmail',state:'requested',metadata:{...input.metadata,pluginKind:'connector'}};created.push(a);attempts.set(a.id,a);return a;},
  plan: async id => {await new Promise(resolve=>setTimeout(resolve,5));return {...attempts.get(id),state:'awaiting_approval'};},
  cancel: () => assert.fail('No fresh fixture should be cancelled'),
};
const service = new ConnectionStartService(orchestrator);
const [personal,business] = await Promise.all(['personal','business'].map(connectionId=>service.start({serviceId:'gmail',kind:'connector',connectionId})));
assert.notEqual(personal.id,business.id);
assert.equal(personal.metadata.connectionId,'personal');
assert.equal(business.metadata.connectionId,'business');
assert.equal(business.metadata.expectedAccountId,'business@example.invalid');
await assert.rejects(service.start({serviceId:'gmail',kind:'connector',connectionId:'personal',attemptId:business.id}),/SERVICE_IDENTITY_MISMATCH/);
await assert.rejects(service.start({serviceId:'gmail',kind:'connector',attemptId:business.id}),/SERVICE_IDENTITY_MISMATCH/);
await assert.rejects(service.start({serviceId:'gmail',connectionId:'unknown'}),/ACCOUNT_UNAVAILABLE/);
const legacy=await service.start({serviceId:'gmail',kind:'connector'});
assert.equal(legacy.metadata.connectionId,undefined);
assert.equal((await service.start({serviceId:'gmail',kind:'connector',attemptId:legacy.id})).id,legacy.id);
const before=created.length;
const same=await Promise.all([1,2].map(()=>service.start({serviceId:'gmail',kind:'connector',connectionId:'personal'})));
assert.equal(same[0].id,same[1].id);
assert.equal(created.length,before+1);
console.log('PASS account setup starts isolate simultaneous identities, reject cross-account resume, coalesce same identity and retain legacy behavior');

// A completed/late adapter response must not revive an account disconnected meanwhile.
const { ConnectionOrchestrator } = require('../dist/connections/orchestrator.js');
let generation=2;
let writes=0;
const target={id:'business',serviceId:'gmail',pluginId:'connector.gmail',accountAccess:{generation}};
const late={id:'late',serviceId:'gmail',pluginId:'connector.gmail',state:'awaiting_oauth',metadata:{connectionId:'business',accountGeneration:1},plan:{pluginId:'connector.gmail',strategy:{id:'oauth'}}};
const runtime=Object.create(ConnectionOrchestrator.prototype);
runtime.options={connections:{get:()=>({...target,accountAccess:{generation}}),upsert:()=>{writes++;}},attempts:{get:()=>late}};
runtime.fail=(_attempt,code)=>({state:'failed',error:{code}});
assert.throws(()=>runtime.context(late),/ACCOUNT_ATTEMPT_STALE/);
const result=runtime.applyResult(late,{connection:{authenticated:true}},'connector-oauth');
assert.equal(result.error.code,'ACCOUNT_UNAVAILABLE');
assert.equal(writes,0);
generation=1;
assert.equal(runtime.context(late).attempt.id,'late');
console.log('PASS stale account generation blocks adapter entry and late-result resurrection');

const keyAttempt={...late,requestedCapabilities:[],plan:{pluginId:'connector.gmail',strategy:{id:'key',adapter:'api-key'}}};
let saved;
runtime.options={connections:{get:()=>({...target,accountAccess:{generation:1}}),upsert:value=>(saved=value,{...value,id:value.id}),findByService:()=>assert.fail('Account-scoped storage cannot select first service sibling')},attempts:{get:()=>keyAttempt,update:()=>{}},validateCredentialReference:(_ref,_service,_attempt,connectionId)=>connectionId==='business'};
const stored=runtime.recordStoredCredential('late','vault:fixture');
assert.equal(stored.connectionId,'business');
assert.equal(saved.id,'business');
assert.equal(saved.accountAccess.generation,1);
assert.equal(saved.credentialRef,'vault:fixture');
console.log('PASS protected credential pending record targets exact account without service-first sibling lookup');

const {AccountSetupService}=require('../dist/connections/account-setup.js');
let setupInput;
let denied=false;
const setupRecord={id:'new',serviceId:'gmail',accountAccess:{ownerId:'owner'}};
const setup=new AccountSetupService({get:()=>setupRecord,update:(_id,patch)=>{denied=patch.enabled===false;}},{add:()=>setupRecord},{start:async input=>{setupInput=input;return {id:'setup'};}});
assert.equal((await setup.add({serviceId:'gmail'},'owner','Business','connector')).attempt.id,'setup');
assert.equal(setupInput.connectionId,'new');
await assert.rejects(setup.resume('new','other-owner'),/ACCOUNT_UNAVAILABLE/);
await setup.resume('new','owner','setup');
assert.equal(setupInput.attemptId,'setup');
const failedSetup=new AccountSetupService({update:(_id,patch)=>{denied=patch.enabled===false;}},{add:()=>setupRecord},{start:async()=>{throw new Error('fixture-start-failed');}});
await assert.rejects(failedSetup.add({},'owner','Business','connector'),/fixture-start-failed/);
assert.equal(denied,true);
console.log('PASS account setup owns resume and preserves failed adds in a disabled recoverable state');

let reauthRecord={id:'reauth',serviceId:'gmail',accountAccess:{ownerId:'owner',generation:4}};
const reauth=new AccountSetupService({get:()=>reauthRecord,update:(_id,patch)=>{reauthRecord={...reauthRecord,...patch};}}, {}, {start:async()=>({id:'reauth-attempt'})});
await reauth.resume('reauth','owner');
assert.equal(reauthRecord.accountAccess.generation,5);
await reauth.resume('reauth','owner','reauth-attempt');
assert.equal(reauthRecord.accountAccess.generation,5);
console.log('PASS fresh reauth invalidates pending approvals while continuing the same attempt retains generation');

await Promise.all([reauth.resume('reauth','owner'),reauth.resume('reauth','owner')]);
assert.equal(reauthRecord.accountAccess.generation,6);
console.log('PASS concurrent reauth clicks coalesce without superseding their own generation');
