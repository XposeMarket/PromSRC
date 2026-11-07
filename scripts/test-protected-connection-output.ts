import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { publicConnectionValue } from '../src/connections/serialize-public';
import { ConnectionAttemptStore } from '../src/connections/attempt-store';
import { ConnectionStore } from '../src/connections/connection-store';
import { ConnectionActivityStore } from '../src/connections/activity-store';
import { ConnectionAdapterRegistry } from '../src/connections/adapter-registry';
import { ConnectionOrchestrator } from '../src/connections/orchestrator';
const ref = 'vault:connection.credentials.synthetic';
const raw = { credentialRef: ref, nested: [{ x: ref }], result: JSON.stringify({ credentialRef: ref }) };
assert(!JSON.stringify(publicConnectionValue(raw)).includes('connection.credentials.'));
assert.equal(raw.credentialRef, ref);
assert.equal(publicConnectionValue('vault:openai.api_key'), 'vault:openai.api_key');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'protected-output-'));
async function main() { try {
 const attempts = new ConnectionAttemptStore(dir), connections = new ConnectionStore(dir), adapters = new ConnectionAdapterRegistry();
 const events: any[] = [];
 const plans: any = { resolve: async ({serviceId, requestedCapabilities}: any) => ({id:'fixture',serviceId,pluginId:'fixture',strategy:{id:'fixture-key',adapter:'api-key',capabilities:[],readOnly:true},requestedCapabilities,summary:'fixture',createdAt:new Date().toISOString()}) };
 const orchestrator = new ConnectionOrchestrator({ attempts, connections, adapters, activity:new ConnectionActivityStore(dir),plans,validateCredentialReference:(r,s,a)=>r===ref && s==='fixture' && Boolean(a),broadcast:e=>events.push(e) });
 const attempt=orchestrator.create({serviceId:'fixture',metadata:{nested:ref}});
 await orchestrator.plan(attempt.id);
 orchestrator.recordStoredCredential(attempt.id,ref);
 const stored=connections.list()[0];
 assert.equal(stored.credentialRef,ref); assert.equal(stored.authenticated,false); assert.equal(stored.authState,'pending');
 assert.equal(orchestrator.getAttempt(attempt.id)?.connectionId,stored.id);
 assert(!JSON.stringify(events).includes('connection.credentials.'));
 assert.throws(()=>orchestrator.recordStoredCredential(attempt.id,'vault:connection.credentials.foreign'));
 // Pending record survives process/store reconstruction and is addressable for cleanup even if continuation fails.
 assert.equal(new ConnectionStore(dir).get(stored.id)?.credentialRef,ref);
 const route=fs.readFileSync('src/gateway/routes/connections-v2.router.ts','utf8');
 assert(route.includes('json(publicConnectionValue(value))'));
 assert(route.indexOf('recordStoredCredential(session.attemptId!')<route.indexOf('await runtime.orchestrator.continue(session.attemptId!'));
 const tool=fs.readFileSync('src/gateway/agents-runtime/capabilities/platform-executor.ts','utf8');
 assert(tool.includes('return publicConnectionValue(await (async () =>'));
 console.log('PASS protected connection output: nested/serialized handles stripped, broadcasts sanitized, pending key durable and manageable, internal ref preserved.');
} finally { fs.rmSync(dir,{recursive:true,force:true}); }
}
main().catch(error => { console.error(error); process.exitCode=1; });
