import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
if(!process.env.ACCOUNT_HTTP_FIXTURE_CHILD){
 assert.ok(fs.existsSync(new URL('../dist/extensions/bundled/connectors/gmail/prometheus.extension.json',import.meta.url)),'Run build:backend (or tsc + copy-extension-descriptors) before this integration test.');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'prom-account-http-'));
 const result=spawnSync(process.execPath,[fileURLToPath(import.meta.url)],{
  env:{...process.env,ACCOUNT_HTTP_FIXTURE_CHILD:'1',PROMETHEUS_DATA_DIR:root,PROMETHEUS_WORKSPACE_DIR:path.join(root,'workspace'),PROMETHEUS_VAULT_KEY_STDIN:'1',PROMETHEUS_VAULT_OS_PROTECTED:'1'},
  input:randomBytes(32).toString('hex')+'\n',encoding:'utf8',timeout:25000});
 process.stdout.write(result.stdout||'');process.stderr.write(result.stderr||'');
 fs.rmSync(root,{recursive:true,force:true});process.exit(result.status??1);
}
let server,code=0;
try{
 const token=randomBytes(32).toString('hex');
 const secrets=await import('../dist/security/secure-access-owner.js');secrets.captureGatewayOwnerSecrets({PROMETHEUS_SECURE_ACCESS_OWNER_TOKEN:token});
 const {mintConsent,sha256Hex}=await import('../dist/security/secure-access-consent.js');
 const express=(await import('express')).default;
 const {pluginAccountsRouter}=await import('../dist/gateway/routes/plugin-accounts.router.js');
 const {getConnectionRuntime}=await import('../dist/connections/runtime.js');
 const {resolvePluginAccountOwner}=await import('../dist/connections/account-owner.js');
 const {getConfig}=await import('../dist/config/config.js');
 const {ensurePrometheusExtensionRuntimeLoaded}=await import('../dist/extensions/extension-bootstrap.js');
 ensurePrometheusExtensionRuntimeLoaded();
 const runtime=getConnectionRuntime();
 const owner=resolvePluginAccountOwner(getConfig().getConfigDir(),null);
 const template={serviceId:'gmail',serviceName:'Gmail',pluginId:'gmail',strategyId:'oauth',adapterId:'connector-oauth',installed:true};
 const personal=runtime.accountLifecycle.add(template,owner,'Personal','connector');
 const business=runtime.accountLifecycle.add(template,owner,'Business','connector');
 const app=express();app.use(express.json({verify:(req,_res,buf)=>{req.rawBody=Buffer.from(buf);}}));app.use(pluginAccountsRouter);
 server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
 const origin=`http://127.0.0.1:${server.address().port}`;
 const post=async(route,body={},authorized=true)=>{
  const raw=JSON.stringify(body);
  return fetch(origin+route,{method:'POST',headers:{'content-type':'application/json',origin,cookie:authorized?`prom_sa_owner=${token}`:'','x-prom-owner-consent':mintConsent(token,'POST',route,sha256Hex(raw))},body:raw});
 };
 assert.equal((await post('/api/plugin-accounts/list',{},false)).status,403);
 const list=await post('/api/plugin-accounts/list');assert.equal(list.status,200);
 assert.deepEqual((await list.json()).accounts.map(a=>a.label).sort(),['Business','Personal']);
 const renamed=await post(`/api/plugin-accounts/${business.id}/rename`,{label:'Work'});assert.equal(renamed.status,200);
 assert.equal(runtime.connections.get(personal.id).accountAccess.label,'Personal');
 assert.equal(runtime.connections.get(business.id).accountAccess.label,'Work');
 const foreign=runtime.accountLifecycle.add(template,'different-owner','Private','connector');
 const denied=await post(`/api/plugin-accounts/${foreign.id}/rename`,{label:'Stolen'});
 assert.notEqual(denied.status,200);
 assert.equal(runtime.connections.get(foreign.id).accountAccess.label,'Private');
 const disconnected=await post(`/api/plugin-accounts/${business.id}/disconnect`);
 assert.equal(disconnected.status,200);
 assert.equal(runtime.connections.get(business.id).enabled,false);
 assert.equal(runtime.connections.get(personal.id).enabled,true);
 const created=await post('/api/plugin-accounts/create',{serviceId:'gmail',label:'New account'});
 const createdBody=await created.json();
 assert.equal(created.status,200,JSON.stringify(createdBody));
 assert.ok(createdBody.account.id);
 assert.equal(createdBody.attempt.metadata.connectionId,createdBody.account.id);
 assert.equal(runtime.connections.get(personal.id).enabled,true);
 const local=await post('/api/plugin-accounts/create',{serviceId:'obsidian',label:'Notes'});
 const localBody=await local.json();assert.equal(local.status,200,JSON.stringify(localBody));
 assert.equal(localBody.account.family,'resource');
 assert.equal(localBody.attempt.metadata.connectionId,localBody.account.id);
 assert.equal(localBody.attempt.plan.strategy.adapter,'local-resource');
 const vercel=await post('/api/plugin-accounts/create',{serviceId:'vercel',label:'Hosting'});
 const vercelBody=await vercel.json();assert.equal(vercel.status,200,JSON.stringify(vercelBody));
 assert.equal(vercelBody.attempt.metadata.connectionId,vercelBody.account.id);
 assert.equal(vercelBody.attempt.state,'awaiting_approval');
 const preparedKey=await runtime.orchestrator.prepareInput(vercelBody.attempt.id);
 assert.equal(preparedKey.state,'awaiting_secure_input');
 assert.ok(preparedKey.requiredUserAction.fields.some(field=>field.key==='apiKey'));
 const originalFetch=globalThis.fetch;
 const key=runtime.secureInput.submit(preparedKey.requiredUserAction.credentialSessionId,{apiKey:'fixture-vercel'});
 runtime.orchestrator.recordStoredCredential(preparedKey.id,key.credentialRef);
 const {bindPluginCredential}=await import('../dist/connections/plugin-credential-binding.js');
 bindPluginCredential(getConfig().getConfigDir(),'vercel',key.credentialRef,preparedKey.id,vercelBody.account.id);
 globalThis.fetch=async()=>new Response(JSON.stringify({user:{id:'fixture-user'}}),{status:200});
 try{
  const connected=await runtime.orchestrator.continue(preparedKey.id,{credentialRef:key.credentialRef});
  assert.equal(connected.state,'verifying',JSON.stringify(connected.error));
  assert.equal((await runtime.orchestrator.verify(preparedKey.id)).state,'connected');
  assert.equal(runtime.connections.get(vercelBody.account.id).authenticated,true);
 }finally{globalThis.fetch=originalFetch;}
 const {getVault}=await import('../dist/security/vault.js');
 getVault(getConfig().getConfigDir()).set('integration.vercel.credentials',JSON.stringify({apiKey:'legacy-fixture'}),'fixture');
 const legacyKey=runtime.connections.create({...runtime.connections.get(vercelBody.account.id),id:'legacy-vercel',accountAccess:undefined,credentialRef:undefined});
 const adoptedKey=await post('/api/plugin-accounts/legacy-vercel/adopt');
 assert.equal(adoptedKey.status,200,JSON.stringify(await adoptedKey.json()));
 const {resolveBoundPluginCredential}=await import('../dist/connections/plugin-credential-binding.js');
 assert.equal(resolveBoundPluginCredential(getConfig().getConfigDir(),'vercel','apiKey','legacy-vercel').value,'legacy-fixture');
 assert.ok(getVault(getConfig().getConfigDir()).get('integration.vercel.credentials','fixture'));
 console.log('PASS real account HTTP router isolates lifecycle, authenticates scoped keys and preserves legacy Vercel credentials');
}catch(error){console.error(error);code=1;}
finally{if(server)await new Promise(resolve=>server.close(resolve));}
process.exit(code);
