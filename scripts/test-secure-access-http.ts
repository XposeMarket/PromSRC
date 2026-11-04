import express from 'express';
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { SecureAccessBroker } from '../src/security/secure-access';
import { createSecureAccessRouter } from '../src/gateway/routes/secure-access.router';
(async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'access-http-'));
 const broker=new SecureAccessBroker({directory:root,persistentAllowed:()=>false,store:{get:()=>null,set:()=>{throw Error('not allowed');},delete:()=>{}}});
 const app=express();app.use(express.json({limit:'32kb'}));
 app.use((req,res,next)=>{if(req.headers.authorization!=='Bearer FAKE_TEST_AUTH'){res.sendStatus(401);return;}next();});
 app.use(createSecureAccessRouter({getSecureAccess:()=>broker,secureAccessCredentials:()=>broker.list() as any,secureAccessStatus:async()=>({...broker.status(),browserSupported:false,message:'fixture'}),prepareProtectedLogin:async()=>{throw Error('CANARY_ERROR');},submitProtectedLogin:async()=>({phase:'submitted_outcome_unknown',transferred:false}),cancelProtectedLogin:async()=>{}}));
 const server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));
 const origin=`http://127.0.0.1:${(server.address() as any).port}`;
 const call=(route:string,body?:object,extra:Record<string,string>={})=>fetch(origin+'/api/secure-access'+route,{method:body?'POST':'GET',headers:{authorization:'Bearer FAKE_TEST_AUTH','content-type':'application/json',origin,...extra},body:body?JSON.stringify(body):undefined});
 try {
 assert.equal((await fetch(origin+'/api/secure-access/status')).status,401);
 const created=await call('/requests',{origin:'https://fixture.test',mode:'existing',sessionId:'web_fixture',identifier:'a@example.test'});const {request}=await created.json() as any;
 assert.equal((await call(`/requests/${request.id}/submit`,{secret:'CANARY_HTTP'}, {origin:'https://evil.test'})).status,403);
 const response=await call(`/requests/${request.id}/submit`,{secret:'CANARY_HTTP',identifier:'a@example.test',remember:false});
 assert.equal(response.headers.get('cache-control'),'no-store');const receipt=await response.text();assert(!receipt.includes('CANARY_HTTP'));assert.equal(response.status,200);
 assert.equal((await call(`/requests/${request.id}/submit`,{secret:'CANARY_REPLAY'})).status,400);
 const credential=JSON.parse(receipt).credential;
 const failed=await call(`/credentials/${credential.id}/login/prepare`,{url:'https://fixture.test/login'});assert(!(await failed.text()).includes('CANARY_ERROR'));
 for(const file of fs.readdirSync(root))assert(!fs.readFileSync(path.join(root,file),'utf8').includes('CANARY_HTTP'));
 console.log('PASS real HTTP route: authenticated, same-origin submit, no-store, replay denied, no secret in response/persistence/error.');
 }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));fs.rmSync(root,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
