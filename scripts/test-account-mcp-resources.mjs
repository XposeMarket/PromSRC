import assert from 'node:assert/strict';
import fs from 'node:fs';
const {getExtensionRuntimeRegistry}=await import('../dist/extensions/runtime-registry.js');
const {buildMcpServerConfigFromPreset}=await import('../dist/extensions/mcp-preset-service.js');
for (const [id,field] of [['filesystem','rootPath'],['postgres','connectionString'],['sqlite','dbPath']]) {
 const descriptor=JSON.parse(fs.readFileSync(new URL(`../src/extensions/bundled/mcp_presets/${id}/prometheus.extension.json`,import.meta.url),'utf8'));
 assert.ok(descriptor.setup.fields.some(item=>item.key===field && item.required));
 const placeholder=`{{credential:${id}:${field}}}`;
 assert.ok(descriptor.mcpPreset.args.includes(placeholder));
 getExtensionRuntimeRegistry().registerMcpPreset(id,{id,name:id,config:{...descriptor.mcpPreset,setup:descriptor.setup}});
 assert.throws(()=>buildMcpServerConfigFromPreset(id),/MCP_PRESET_INPUT_REQUIRED/);
 const render=value=>buildMcpServerConfigFromPreset(id,{[field]:value}).args;
 assert.ok(render('resource-a').includes('resource-a'));
 assert.ok(!render('resource-a').includes('resource-b'));
 assert.ok(render('resource-b').includes('resource-b'));
}
console.log('PASS MCP resource templates use explicit filesystem/database inputs, not hardcoded example resources');

const {resolveMcpAccountTransport}=await import('../dist/connections/mcp-account-transport.js');
const record={id:'one',pluginId:'postgres',serviceId:'postgres',adapterId:'mcp-stdio',enabled:true,accountAccess:{instanceId:'account_one',family:'mcp',ownerId:'owner'}};
const deps={readConnection:id=>id==='one'?record:undefined,readFields:()=>({connectionString:'db-one'}),build:buildMcpServerConfigFromPreset};
assert.equal(resolveMcpAccountTransport('legacy',deps),undefined);
assert.equal(resolveMcpAccountTransport('account_one',deps).id,'account_one');
assert.ok(resolveMcpAccountTransport('account_one',deps).args.includes('db-one'));
assert.throws(()=>resolveMcpAccountTransport('account_other',deps),/MCP_ACCOUNT_UNAVAILABLE/);
record.enabled=false;
assert.throws(()=>resolveMcpAccountTransport('account_one',deps),/MCP_ACCOUNT_UNAVAILABLE/);
console.log('PASS canonical MCP transport resolver rejects missing/disabled sibling identities');

const {McpStdioConnectionAdapter}=await import('../dist/connections/adapters/mcp-stdio.js');
let launches=0;
const adapter=new McpStdioConnectionAdapter({connect:async()=>{launches++;return {ok:true,tools:['read_fixture']};},prepareFields:async()=>({state:'awaiting_secure_input',userAction:{type:'secure-input',credentialSessionId:'fixture'}})});
const context={attempt:{serviceId:'postgres',metadata:{connectionId:'one'},plan:{strategy:{configuration:{command:'fixture-command'}}}}};
assert.equal((await adapter.prepare(context)).state,'awaiting_secure_input');
const saved=await adapter.continue({...context,credentialRef:'fixture-ref'});
assert.equal(saved.state,'registering');assert.equal(saved.userAction.type,'package-install-review');assert.equal(launches,0);
await assert.rejects(()=>adapter.connect(context),/MCP_PROCESS_APPROVAL_REQUIRED/);
assert.equal(launches,0);
assert.equal((await adapter.connect({...context,configuration:{approved:true}})).state,'verifying');
assert.equal(launches,1);
console.log('PASS MCP protected save never starts process; distinct approved connect required');
