import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'prom-x-accounts-'));
process.env.PROMETHEUS_DATA_DIR=root;process.env.PROMETHEUS_WORKSPACE_DIR=path.join(root,'workspace');
const originalFetch=globalThis.fetch;let code=0;
try{
 const {getConfig}=await import('../dist/config/config.js');
 const {getConnectorInstances}=await import('../dist/integrations/connector-instances.js');
 const {withAccountExecution}=await import('../dist/connections/account-execution-context.js');
 const {bindAccountAction}=await import('../dist/connections/account-policy.js');
 const {executeXApiTool}=await import('../dist/extensions/bundled/connectors/x/x-api-client.js');
 const defs=await import('../dist/extensions/bundled/connectors/x/x-api-tools.js');
 const instances=getConnectorInstances(getConfig().getConfigDir());
 const make=id=>({id,serviceId:'x',pluginId:'x',enabled:true,authenticated:true,authState:'healthy',accountAccess:{ownerId:'owner',label:id,family:'connector',instanceId:id,generation:1,policyRevision:1}});
 const records=['personal','business'].map(make);
 for(const r of records)instances.get('x',r.id).saveTokens({access_token:`fixture-${r.id}`,expires_at:Date.now()+600000,account_id:r.id});
 const seen=[];
 globalThis.fetch=async(url,options)=>{seen.push(options.headers.Authorization);return new Response(JSON.stringify({data:{id:'123',username:'fixture'}}),{status:200});};
 for(const r of records){
  const binding=bindAccountAction({connections:records,principal:{ownerId:'owner',principalId:'owner',isOwner:true,grantLayers:[]},serviceId:'x',connectionId:r.id,capability:'read',tool:defs.X_API_ME_TOOL_NAME,args:{}});
  const result=await withAccountExecution({binding,serviceId:'x',revalidate:()=>{}},()=>executeXApiTool(defs.X_API_ME_TOOL_NAME,{}));
  assert.equal(result.success,true,JSON.stringify(result));
 }
 assert.deepEqual(seen,['Bearer fixture-personal','Bearer fixture-business']);
 instances.disconnect('x','business');
 assert.equal(instances.get('x','personal').loadTokens().access_token,'fixture-personal');
 console.log('PASS actual X API executor uses exact scoped account token and sibling survives disconnect');
}catch(error){console.error(error);code=1;}
finally{globalThis.fetch=originalFetch;fs.rmSync(root,{recursive:true,force:true});}
process.exit(code);
