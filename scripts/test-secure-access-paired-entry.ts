import assert from 'node:assert/strict';
import express from 'express';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SecureAccessBroker } from '../src/security/secure-access';
import { createSecureAccessRouter } from '../src/gateway/routes/secure-access.router';
(async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'paired-entry-'));
 const broker=new SecureAccessBroker({directory:root,persistentAllowed:()=>false,store:{get:()=>null,set:()=>{},delete:()=>{}}});
 let active=true;
 const app=express(); app.use(express.json());
 const runtime:any={getSecureAccess:()=>broker,secureAccessCredentials:()=>broker.list(),secureAccessStatus:async()=>broker.status(),prepareProtectedLogin:async()=>{throw Error('unexpected');},submitProtectedLogin:async()=>{throw Error('unexpected');},cancelProtectedLogin:async()=>{}};
 app.use(createSecureAccessRouter(runtime,{ownerToken:()=>'',deviceTrusted:()=>false,verifyDevice:()=>false},token=>active&&token==='synthetic-paired'));
 const server=app.listen(0,'127.0.0.1'); await new Promise<void>(r=>server.once('listening',r));
 const origin=`http://127.0.0.1:${(server.address() as any).port}`;
 const call=(route:string,body?:object,headers:Record<string,string>={})=>fetch(origin+'/api/secure-access'+route,{method:body?'POST':'GET',headers:{origin,'content-type':'application/json','x-pairing-token':'synthetic-paired',...headers},body:body?JSON.stringify(body):undefined});
 try {
  const state:any=await (await call('/status')).json(); assert.equal(state.entry.canEnter,true);assert.equal(state.owner.canApprove,false);
  const request=broker.create({sessionId:'fixture',origin:'https://example.test',mode:'existing',identifier:'fixture@example.test'});
  const route=`/requests/${request.id}/submit`; const body={secret:'SYNTHETIC_SECRET',identifier:'fixture@example.test'};
  for(const headers of [{'x-pairing-token':''},{'x-pairing-token':'invalid'},{origin:'https://evil.test'},{'content-type':'text/plain'}]) assert.equal((await call(route,body,headers)).status,403);
  active=false;assert.equal((await call(route,body)).status,403);assert.equal((await (await call('/status')).json() as any).entry.canEnter,false);active=true;
  const saved=await call(route,body);assert.equal(saved.status,200);const text=await saved.text();assert(!text.includes('SYNTHETIC_SECRET'));const credential=JSON.parse(text).credential;
  assert.equal((await call(route,body)).status,400);
  for(const suffix of ['login/prepare','login/submit','grants','replace','delete','outcome'])assert.equal((await call(`/credentials/${credential.id}/${suffix}`,{confirm:true,grants:['main']})).status,403,suffix);
  assert.equal((await call('/requests',{origin:'https://example.test',mode:'existing'})).status,403);
  const replacement=broker.replace(credential.id,'fixture');
  const denied=await call(`/requests/${replacement.id}/submit`,body);assert.equal(denied.status,400);assert.equal((await denied.json() as any).error,'OWNER_APPROVAL_REQUIRED_FOR_REPLACEMENT');assert.equal(broker.list()[0].version,1);
  assert.equal((await call(`/requests/${replacement.id}/cancel`,{})).status,200);
  assert.equal((await call(`/credentials/${credential.id}/revoke`,{})).status,200);
  for(const file of fs.readdirSync(root))assert(!fs.readFileSync(path.join(root,file),'utf8').includes('SYNTHETIC_SECRET'));
  console.log('PASS paired fresh entry, revoked/invalid pairing, transport, mutation isolation, replacement denial, no secret receipts');
 } finally {await new Promise<void>(r=>server.close(()=>r()));fs.rmSync(root,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
