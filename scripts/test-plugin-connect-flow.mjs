import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { PluginConnectionPlanResolver } = require('../dist/connections/plugin-plan-resolver.js');
const { listExtensionDescriptors } = require('../dist/extensions/registry.js');
const { ConnectionOrchestrator } = require('../dist/connections/orchestrator.js');
const { ConnectionAttemptStore } = require('../dist/connections/attempt-store.js');
const { ConnectionStore } = require('../dist/connections/connection-store.js');
const { ConnectionActivityStore } = require('../dist/connections/activity-store.js');
const { ConnectionAdapterRegistry } = require('../dist/connections/adapter-registry.js');
const { ConnectionStartService } = require('../dist/connections/start-service.js');
const resolver = new PluginConnectionPlanResolver(() => []);
for (const service of ['x','X','Twitter','X / Twitter','x.com']) {
  assert.equal(resolver.discover(service).canonicalServiceId, 'x', service);
}
assert.equal(resolver.discover('github').status, 'ambiguous');
assert.equal(resolver.discover('').status, 'research_required');
for (const descriptor of listExtensionDescriptors()) {
  const selector = `${descriptor.kind}:${descriptor.id}`;
  const result = resolver.discover(selector);
  assert.equal(result.status, 'resolved', selector);
  assert.equal(result.canonicalServiceId, descriptor.id, selector);
  assert.equal(result.matches[0].pluginKind, descriptor.kind, selector);
}
for (const id of ['x','instagram','linkedin','tiktok']) {
  const plan = await resolver.resolve({ serviceId: id, requestedCapabilities: [], readOnly: true, metadata: { pluginKind:'connector' } });
  assert.equal(plan.serviceId,id); assert.equal(plan.strategy.adapter,'connector-oauth');
}
await assert.rejects(() => resolver.resolve({ serviceId:'obsidian', requestedCapabilities:[], readOnly:true }), /SETUP_UNAVAILABLE/);
const root = fs.mkdtempSync(path.join(os.tmpdir(),'plugin-connect-'));
try {
  const adapters = new ConnectionAdapterRegistry(); let calls = 0; let release;
  adapters.register({ id:'fixture',kind:'connector-oauth',displayName:'Fixture',supports:()=>true,
    connect:async()=>{ calls++; return {state:'awaiting_oauth'}; },
    continue:async()=>new Promise(resolve=>{release=resolve;}) });
  const orch = new ConnectionOrchestrator({ attempts:new ConnectionAttemptStore(root),connections:new ConnectionStore(root),activity:new ConnectionActivityStore(root),adapters,plans:resolver });
  const start = new ConnectionStartService(orch);
  const [a,b] = await Promise.all([start.start({serviceId:'x',kind:'connector'}), start.start({serviceId:'x',kind:'connector'})]);
  assert.equal(a.id,b.id); assert.equal(a.state,'awaiting_approval');
  assert.equal((await orch.continue(a.id,{approved:true})).state,'awaiting_approval'); assert.equal(calls,0);
  await assert.rejects(()=>start.start({serviceId:'github',kind:'connector',attemptId:a.id}),/IDENTITY/);
  await orch.connect(a.id,{approved:true}); assert.equal(calls,1);
  const pending = orch.continue(a.id); orch.cancel(a.id); release({state:'registering',connection:{authenticated:true}});
  assert.equal((await pending).state,'cancelled');
  assert.equal((await orch.plan(a.id)).state,'cancelled');
  assert.equal((await orch.connect(a.id,{approved:true})).state,'cancelled');
  assert.equal((await orch.verify(a.id)).state,'cancelled');
} finally { fs.rmSync(root,{recursive:true,force:true}); }
console.log('PASS: actual catalog identity/aliases/kind separation, native strategies, concurrent start, consent and late-cancel guards');

const { nativeAppSetup } = require('../dist/connections/native-app-setup.js');
const nativeAttempt = { id:'schema-fixture',serviceId:'x',state:'awaiting_secure_input',updatedAt:new Date().toISOString(),plan:{strategy:{adapter:'connector-oauth'}} };
const schemaOrch = { getAttempt:()=>nativeAttempt };
assert.deepEqual(nativeAppSetup(schemaOrch,'schema-fixture','x').fields.map(f=>f.key),['clientId','clientSecret']);
assert.throws(()=>nativeAppSetup(schemaOrch,'schema-fixture','github'),/MISMATCHED/);
nativeAttempt.state='cancelled';assert.throws(()=>nativeAppSetup(schemaOrch,'schema-fixture','x'),/MISMATCHED/);
const configuredMcp = new PluginConnectionPlanResolver(()=>[{id:'filesystem',transport:'stdio',command:'fixture-only-no-execution'}]);
assert.equal((await configuredMcp.resolve({serviceId:'filesystem',requestedCapabilities:[],readOnly:true,metadata:{pluginKind:'mcp_preset'}})).strategy.adapter,'mcp-stdio');
await assert.rejects(()=>resolver.resolve({serviceId:'obsidian',requestedCapabilities:[],readOnly:true,metadata:{endpoint:'https://wrong.example'}}),/SETUP_UNAVAILABLE/);
const nous = await resolver.resolve({serviceId:'nous',requestedCapabilities:[],readOnly:true});
assert.equal(nous.strategy.adapter,'openai-compatible-model');assert.equal(nous.strategy.configuration.authentication,'none');
console.log('PASS native schema correlation/cancel, configured MCP family, unsupported identity isolation, Nous endpoint strategy');
