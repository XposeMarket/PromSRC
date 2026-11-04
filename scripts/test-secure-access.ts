import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { SecureAccessBroker, exactAccessOrigin } from '../src/security/secure-access';

async function main() {
 const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'secure-access-test-'));
 const values = new Map<string,string>();
 const store = { set:(k:string,v:string)=>{values.set(k,v);}, get:(k:string)=>values.get(k), delete:(k:string)=>values.delete(k) };
 let protectedKey = true, now = Date.now();
 const options = {directory:dir,store,persistentAllowed:()=>protectedKey,now:()=>now};
 try {
 const broker = new SecureAccessBroker(options);
 const canary = `  CANARY_${randomUUID()}  `;
 const make = (mode:any='existing')=>broker.create({sessionId:'web_test',origin:'https://example.test',mode,label:'Demo',identifier:'alex@example.test'});
 for (const bad of ['http://example.test','https://example.test/path','https://u:p@example.test','https://example.test/?a=1','https://example.test/#f']) assert.throws(()=>exactAccessOrigin(bad));
 const r = make();
 assert.throws(()=>broker.submit(r.id,{secret:canary,remember:true,generated:true}),/RECOVERY/);
 protectedKey=false; assert.throws(()=>broker.submit(r.id,{secret:canary,remember:true}),/PROTECTED_STORAGE/); protectedKey=true;
 const c=broker.submit(r.id,{secret:canary,remember:true});
 assert.equal([...values.values()][0],canary,'whitespace preserved');
 assert.throws(()=>broker.submit(r.id,{secret:canary}),/USED/);
 assert.throws(()=>broker.submit('nope',{secret:canary}),/USED/);
 assert(!JSON.stringify(broker.list()).includes(canary));
 assert(!fs.readFileSync(path.join(dir,'secure-access-metadata.json'),'utf8').includes(canary));
 for (const origin of ['https://example.test:444','https://sub.example.test','https://example.test.evil.test']) await assert.rejects(()=>broker.use(c.id,'main',origin,async()=>{throw Error('should not run');}),/USE_DENIED/);
 await assert.rejects(()=>broker.use(c.id,'team:demo',c.origin,async()=>{}),/USE_DENIED/);
 await assert.rejects(()=>broker.use('vault:private','main',c.origin,async()=>{}),/INVALID_CREDENTIAL/);
 let captured=false; await broker.use(c.id,'main',c.origin,async(value,_meta,check)=>{check();assert.equal(value,canary);captured=true;}); assert(captured);
 await assert.rejects(()=>broker.use(c.id,'main',c.origin,async()=>{throw Error(canary);}),e=>String(e).includes('PROTECTED_USE_FAILED')&&!String(e).includes(canary));
 broker.markDispatched(c.id); assert.equal(broker.list()[0].state,'submitted_outcome_unknown');
 broker.revoke(c.id); assert.equal(values.size,1);
 await assert.rejects(()=>broker.use(c.id,'main',c.origin,async()=>{}),/USE_DENIED/);
 broker.grants(c.id,['main']); assert.throws(()=>broker.grants(c.id,['team:any']));
 const rotated = broker.replace(c.id,'web_test'); broker.submit(rotated.id,{secret:'CANARY_REPLACEMENT',remember:true}); assert.equal(values.size,2); assert.equal(broker.list()[0].state,'needs_attention');
 const restored=new SecureAccessBroker(options); assert.equal(restored.list()[0].priorVersions.length,1);
 assert.throws(()=>restored.delete(c.id,false),/CONFIRMATION/);
 assert(!JSON.stringify(restored.events(c.id)).includes(canary));
 const pending=restored.create({origin:c.origin,mode:'existing',sessionId:'web_pending'});
 const restarted=new SecureAccessBroker(options); assert.equal(restarted.listRequests('web_pending')[0].id,pending.id);
 const ephemeral=broker.submit(make('otp').id,{secret:'ALPHA-123',remember:true}); assert.equal(ephemeral.storage,'session');
 assert(!new SecureAccessBroker(options).list().some(x=>x.id===ephemeral.id));
 now+=600001; assert.throws(()=>broker.submit(make().id,{secret:''}),/INVALID_SECRET/);
 assert.throws(()=>restarted.submit(pending.id,{secret:canary}),/EXPIRED/);
 restored.delete(c.id,true); assert.equal(values.size,0);
 console.log('PASS secure-access broker: exact origins, no plaintext metadata/errors, replay, recovery, storage, actors, rotation, revoke, restart, delete.');
 } finally {fs.rmSync(dir,{recursive:true,force:true});}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
