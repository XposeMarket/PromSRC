import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {fileURLToPath} from 'node:url';
if (!process.env.ACCOUNT_RESOURCE_FIXTURE_CHILD) {
 const result=spawnSync(process.execPath,[fileURLToPath(import.meta.url)],{env:{...process.env,ACCOUNT_RESOURCE_FIXTURE_CHILD:'1',PROMETHEUS_VAULT_KEY_STDIN:'1',PROMETHEUS_VAULT_OS_PROTECTED:'1'},input:randomBytes(32).toString('hex')+'\n',encoding:'utf8',timeout:25000});
 process.stdout.write(result.stdout||'');process.stderr.write(result.stderr||'');process.exit(result.status??1);
}
import { withAccountExecution } from '../dist/connections/account-execution-context.js';
import { selectedAccountResource, requireSelectedResource } from '../dist/connections/account-resource-binding.js';
const binding={connectionId:'a',instanceId:'a',serviceId:'obsidian',ownerId:'owner'};
const record={id:'a',serviceId:'obsidian',accountAccess:{instanceId:'a',ownerId:'owner'},configuration:{resourceId:'vault-a'}};
assert.equal(selectedAccountResource('obsidian',()=>{throw new Error('legacy must not read account store');}),undefined);
let validations=0;
withAccountExecution({serviceId:'obsidian',binding,revalidate(){validations++;}},()=>{
 assert.equal(selectedAccountResource('obsidian',()=>record),'vault-a');
 assert.equal(requireSelectedResource('vault-a',undefined),'vault-a');
 assert.equal(requireSelectedResource('vault-a','vault-a'),'vault-a');
 assert.throws(()=>requireSelectedResource('vault-a','vault-b'),/ACCOUNT_RESOURCE_MISMATCH/);
 for(const changed of [undefined,{...record,id:'b'},{...record,serviceId:'other'},{...record,accountAccess:{instanceId:'b',ownerId:'owner'}},{...record,accountAccess:{instanceId:'a',ownerId:'other'}},{...record,configuration:{}}]) {
  assert.throws(()=>selectedAccountResource('obsidian',()=>changed),/ACCOUNT_RESOURCE_UNAVAILABLE/);
 }
 assert.throws(()=>selectedAccountResource('other',()=>record),/ACCOUNT_SERVICE_MISMATCH/);
});
assert.ok(validations>=3);
console.log('PASS resource binding: exact canonical vault, sibling/foreign/missing denial, legacy preservation');

// Exercise the real Obsidian runtime against isolated local vaults (never user data).
const fs = await import('node:fs');
const os = await import('node:os');
const path = await import('node:path');
const root = fs.mkdtempSync(path.join(os.tmpdir(),'prom-resource-'));
process.env.PROMETHEUS_DATA_DIR=root;
process.env.PROMETHEUS_WORKSPACE_DIR=path.join(root,'workspace');
try {
 const {getConnectionRuntime}=await import('../dist/connections/runtime.js');
 const {upsertObsidianVault}=await import('../dist/gateway/obsidian/bridge.js');
 const {default:extension}=await import('../dist/extensions/bundled/connectors/obsidian/runtime.js');
 const vaults=['a','b'].map(id=>{const dir=path.join(root,id);fs.mkdirSync(dir);return upsertObsidianVault({path:dir,name:id,mode:'assisted',enabled:true});});
 const {obsidianResourceHost}=await import('../dist/connections/obsidian-resource-host.js');
 const {LocalResourceConnectionAdapter}=await import('../dist/connections/adapters/local-resource.js');
 const adapter=new LocalResourceConnectionAdapter(obsidianResourceHost);
 const context={attempt:{serviceId:'obsidian',plan:{strategy:{configuration:{resourceKind:'directory'}}}},configuration:{}};
 assert.equal((await adapter.connect(context)).state,'awaiting_approval');
 const configured=await adapter.continue(context,{path:vaults[0].path});
 assert.equal(configured.connection.configuration.resourceId,vaults[0].id);
 const verify=await adapter.verify(context,{id:'fixture',configuration:configured.connection.configuration});
 assert.equal(verify[0].passed,true);
 const mismatched=await adapter.verify(context,{id:'fixture',configuration:{...configured.connection.configuration,resourceId:vaults[1].id}});
 assert.equal(mismatched[0].passed,false);
 const runtime=getConnectionRuntime();
 const mcpSetup=await runtime.accountSetup.add({serviceId:'brave',serviceName:'Brave',pluginId:'brave',strategyId:'brave-preset',adapterId:'mcp-stdio',installed:true},'owner','Search account','mcp');
 assert.equal(mcpSetup.attempt.plan.strategy.adapter,'mcp-stdio');
 const mcpPrepared=await runtime.orchestrator.prepareInput(mcpSetup.attempt.id);
 assert.equal(mcpPrepared.state,'awaiting_secure_input');
 const mcpSecret=runtime.secureInput.submit(mcpPrepared.requiredUserAction.credentialSessionId,{BRAVE_API_KEY:'fixture-only'});
 runtime.orchestrator.recordStoredCredential(mcpPrepared.id,mcpSecret.credentialRef);
 const {bindPluginCredential}=await import('../dist/connections/plugin-credential-binding.js');
 const {getConfig}=await import('../dist/config/config.js');
 bindPluginCredential(getConfig().getConfigDir(),'brave',mcpSecret.credentialRef,mcpPrepared.id,mcpSetup.connection.id);
 const mcpSaved=await runtime.orchestrator.continue(mcpPrepared.id,{credentialRef:mcpSecret.credentialRef});
 assert.equal(mcpSaved.state,'registering');
 assert.equal(mcpSaved.requiredUserAction.type,'package-install-review');
 assert.equal(runtime.connections.get(mcpSetup.connection.id).authenticated,false);
 const {resolveProtectedMcpLaunch}=await import('../dist/connections/mcp-account-host.js');
 assert.equal(resolveProtectedMcpLaunch(getConfig().getConfigDir(),`account_${mcpSetup.connection.id}`).env.BRAVE_API_KEY,'fixture-only');
 const setup=await runtime.accountSetup.add({serviceId:'obsidian',serviceName:'Obsidian',pluginId:'obsidian',strategyId:'obsidian-local-vault',adapterId:'local-resource',installed:true},'owner','Setup vault','resource');
 assert.equal(setup.attempt.state,'awaiting_approval');
 const connected=await runtime.orchestrator.connect(setup.attempt.id,{approved:true,path:vaults[0].path});
 assert.notEqual(connected.state,'failed',JSON.stringify(connected.error));
 assert.equal(runtime.connections.get(setup.connection.id).configuration.resourceId,vaults[0].id);
 const verified=await runtime.orchestrator.verify(connected.id);
 assert.equal(verified.state,'connected');
 const reauth=await runtime.accountSetup.resume(setup.connection.id,'owner');
 const replacement=await runtime.orchestrator.connect(reauth.id,{approved:true,path:vaults[1].path});
 assert.equal(replacement.state,'failed');
 assert.equal(runtime.connections.get(setup.connection.id).configuration.resourceId,vaults[0].id);
 await runtime.orchestrator.disconnect(setup.connection.id);
 assert.equal(runtime.connections.get(setup.connection.id).enabled,false);
 const connection=runtime.accountLifecycle.add({serviceId:'obsidian',serviceName:'Obsidian',pluginId:'obsidian',strategyId:'local-vault',adapterId:'local-resource',installed:true},'owner','Vault A','resource');
 runtime.connections.update(connection.id,{configuration:{resourceId:vaults[0].id}});
 const tools=new Map();(extension.default || extension).register({registerConnector(){},registerTool(tool){tools.set(tool.name,tool);}});
 const selected={...binding,connectionId:connection.id,instanceId:connection.accountAccess.instanceId};
 await withAccountExecution({serviceId:'obsidian',binding:selected,revalidate(){}},async()=>{
  const status=await tools.get('connector_obsidian_status').execute({});
  const text=JSON.stringify(status);
  assert.ok(text.includes(vaults[0].id));assert.ok(!text.includes(vaults[1].id));
  await assert.rejects(()=>tools.get('connector_obsidian_sync').execute({vault_id:vaults[1].id}),/ACCOUNT_RESOURCE_MISMATCH/);
  await assert.rejects(()=>tools.get('connector_obsidian_writeback').execute({vault_id:vaults[1].id,title:'wrong',content:'wrong'}),/ACCOUNT_RESOURCE_MISMATCH/);
  await assert.rejects(()=>tools.get('connector_obsidian_connect_vault').execute({path:vaults[1].path}),/ACCOUNT_RESOURCE_SETUP_REQUIRED/);
 });
 const {adoptLegacyObsidianAccounts}=await import('../dist/connections/account-resource-migration.js');
 const legacy=runtime.connections.create({serviceId:'obsidian',serviceName:'Obsidian',pluginId:'obsidian',strategyId:'legacy',adapterId:'legacy',installed:true,enabled:true,configured:true,authenticated:true,authState:'healthy',registered:false,exposed:false,verified:false,health:'unknown',grantedCapabilities:[],registeredTools:[],exposedTools:[]});
 adoptLegacyObsidianAccounts(runtime.connections,legacy.id,'owner');
 const migrated=runtime.connections.list().filter(item=>item.account?.provider==='obsidian');
 assert.equal(migrated.length,2);
 runtime.connections.update(migrated[0].id,{enabled:false,authenticated:false});
 adoptLegacyObsidianAccounts(runtime.connections,legacy.id,'owner');
 assert.equal(runtime.connections.list().filter(item=>item.account?.provider==='obsidian').length,2);
 assert.equal(runtime.connections.get(migrated[0].id).enabled,false);
 assert.throws(()=>adoptLegacyObsidianAccounts(runtime.connections,legacy.id,'foreign'),/ACCOUNT_UNAVAILABLE/);
 console.log('PASS Obsidian actual executor: scoped status, sibling sync/writeback and resource replacement blocked');
} finally { fs.rmSync(root,{recursive:true,force:true}); }
