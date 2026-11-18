import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const { ConnectorInstanceRegistry } = await import('../dist/integrations/connector-instances.js');
const { GmailConnector } = await import('../dist/integrations/connectors/gmail.js');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-account-fixture-'));
try {
  const registry = new ConnectorInstanceRegistry(directory);
  const personal = registry.get('gmail', 'personal-fixture');
  const business = registry.get('gmail', 'business-fixture');
  assert.notEqual(personal, business);
  assert.equal(registry.get('gmail', 'business-fixture'), business);
  assert.notEqual(personal.credentialReference(), business.credentialReference());
  assert.equal(new GmailConnector(directory).credentialReference(), 'vault:integration.gmail.oauth_tokens');
  assert.equal(business.credentialReference(), 'vault:integration.gmail.accounts.business-fixture.oauth_tokens');
  assert.throws(() => business.bindAccountInstance('personal-fixture'), /IMMUTABLE/);
  assert.throws(() => registry.get('github', 'personal-fixture'), /SERVICE_MISMATCH/);
  assert.throws(() => registry.get('gmail', '../personal'), /INVALID_CONNECTION_ID/);
  assert.throws(() => registry.get('__proto__', 'other'), /UNSUPPORTED/);
  for (const service of ['gmail','slack','github','notion','reddit','google_drive','hubspot','salesforce','stripe','ga4','instagram','tiktok','linkedin']) {
    const a = registry.get(service, `${service}-a`);
    const b = registry.get(service, `${service}-b`);
    assert.equal(a.id, service);
    assert.notEqual(a.credentialReference(), b.credentialReference());
  }
  // Constructors may initialize a vault under this disposable fixture directory.
  // No provider requests or live config are involved.
  personal.saveTokens({access_token:'fixture-personal',refresh_token:'refresh-personal',expires_at:Date.now()+3600000});
  business.saveTokens({access_token:'fixture-business',refresh_token:'refresh-business',expires_at:Date.now()+3600000});
  assert.equal(personal.loadTokens().access_token,'fixture-personal');
  assert.equal(business.loadTokens().access_token,'fixture-business');
  const reloaded = new ConnectorInstanceRegistry(directory);
  assert.equal(reloaded.get('gmail','business-fixture').loadTokens().access_token,'fixture-business');
  // A delayed refresh must not resurrect a disconnected instance or touch its sibling.
  personal.saveCredentials('fixture-client','fixture-secret');
  const originalFetch=globalThis.fetch;
  let release;
  let requests=0;
  globalThis.fetch=async()=>{ requests++; return await new Promise(resolve=>{release=()=>resolve(new Response(JSON.stringify({access_token:'late-fixture',expires_in:3600}),{status:200,headers:{'content-type':'application/json'}}));}); };
  try {
    const tokens=personal.loadTokens();
    const first=personal.refreshTokens(tokens);
    const second=personal.refreshTokens(tokens);
    // Register rejection observers before resolving the provider fixture.
    const settled=Promise.allSettled([first,second]);
    registry.disconnect('gmail','personal-fixture');
    release();
    assert.equal(requests,1);
    assert((await settled).every(result=>result.status==='rejected'));
    assert.equal(personal.loadTokens(),null);
    assert.equal(business.loadTokens().access_token,'fixture-business');
  } finally {globalThis.fetch=originalFetch;}
  registry.disconnect('gmail','personal-fixture');
  assert.equal(personal.loadTokens(),null);
  assert.equal(business.loadTokens().access_token,'fixture-business');
  assert.equal(new GmailConnector(directory).loadTokens(),null);
  console.log('PASS native14 immutable instance/key isolation and legacy key compatibility');
} finally { fs.rmSync(directory, { recursive: true, force: true }); }

const routedDir=fs.mkdtempSync(path.join(os.tmpdir(),'prom-routed-account-'));
try {
  const {initConnectorRegistry,getConnector}=await import('../dist/integrations/connector-registry.js');
  const {withAccountExecution}=await import('../dist/connections/account-execution-context.js');
  initConnectorRegistry(routedDir);
  const legacy=getConnector('gmail');
  const binding={connectionId:'routed-business',ownerId:'owner',principalId:'owner',generation:1,policyRevision:1,identityDigest:'fixture',actionDigest:'fixture'};
  await withAccountExecution({binding,serviceId:'gmail',revalidate(){}},async()=>{
    const client=getConnector('gmail');
    assert.notEqual(client,legacy);
    assert.equal(client.credentialReference(),'vault:integration.gmail.accounts.routed-business.oauth_tokens');
    assert.throws(()=>getConnector('github'),/SERVICE_MISMATCH/);
    await Promise.resolve();
    assert.equal(getConnector('gmail'),client);
  });
  assert.equal(getConnector('gmail'),legacy);
  console.log('PASS native registry uses trusted async binding without crossing services or legacy client');
} finally {fs.rmSync(routedDir,{recursive:true,force:true});}

const {buildAccountOAuthBridge}=await import('../dist/connections/connector-oauth-bridges.js');
let pending=true;
const bridge=buildAccountOAuthBridge({get:()=>({isConnected:()=>true}),hasPending:()=>pending},'gmail','fixture','attempt');
assert.equal(bridge.isConnected(),false);
pending=false;
assert.equal(bridge.isConnected(),true);
console.log('PASS active account re-auth cannot be skipped using still-valid previous tokens');

const {PrometheusExtensionRuntimeRegistry}=await import('../dist/extensions/runtime-registry.js');
const schemaRegistry=new PrometheusExtensionRuntimeRegistry();
schemaRegistry.registerTool('schema-fixture',{name:'connector_schema_fixture_read',connectorId:'schema_fixture',description:'Fixture',parameters:{type:'object',properties:{query:{type:'string'}}},execute:async()=>({})});
schemaRegistry.registerTool('schema-fixture',{name:'plain_fixture',description:'Fixture',parameters:{type:'object',properties:{}},execute:async()=>({})});
// Exercise the shared projection; source assertion verifies connected-list reuse without reading live storage.
schemaRegistry.connectorIdForTool=tool=>tool.name==='connector_schema_fixture_read'?'schema_fixture':'';
schemaRegistry.isConnectorConnected=()=>true;
for(const definition of schemaRegistry.listToolDefinitions()) {
  assert.equal(Boolean(definition.function.parameters.properties.connection_id),definition.function.name==='connector_schema_fixture_read');
}
const schemaSource=fs.readFileSync(new URL('../src/extensions/runtime-registry.ts',import.meta.url),'utf8');
assert.match(schemaSource,/listConnectedConnectorToolDefinitions\(\)[\s\S]*?\.map\(tool => this\.accountToolDefinition\(tool\)\)/);
console.log('PASS connector schema projection preserves account selector; non-connector schemas remain unchanged');
