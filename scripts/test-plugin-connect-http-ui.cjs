// Isolated route integration: real router/card/store/vault/adapter, synthetic owner and safe-read provider.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const express=require('express');const {chromium}=require('playwright');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'plugin-e2e-'));
const load=p=>require('../dist/'+p);
const {ConnectionAttemptStore}=load('connections/attempt-store.js');
const {ConnectionStore}=load('connections/connection-store.js');
const {ConnectionActivityStore}=load('connections/activity-store.js');
const {ConnectionAdapterRegistry}=load('connections/adapter-registry.js');
const {ConnectionOrchestrator}=load('connections/orchestrator.js');
const {ConnectionStartService}=load('connections/start-service.js');
const {PluginConnectionPlanResolver}=load('connections/plugin-plan-resolver.js');
const {SecureInputService}=load('connections/secure-input-service.js');
const {ApiKeyConnectionAdapter}=load('connections/adapters/api-key.js');
const owner=load('gateway/routes/secure-access.router.js');
const consent=load('security/secure-access-consent.js');
const OWNER='e'.repeat(64),CANARY='synthetic-only-fixture-value';let reads=0;
consent.setConsentKeySourceForTests(()=>OWNER);
const proof={ownerToken:()=>OWNER,deviceTrusted:()=>true,verifyDevice:v=>v==='fixture-device',verifyConsent:req=>consent.verifyConsent(req.headers[consent.OWNER_CONSENT_HEADER],req.method,req.originalUrl,req.rawBody).ok};
const requireOwner=owner.requireProtectedOwner;
owner.requireProtectedOwner=(req,res,next)=>requireOwner(req,res,next,proof,()=>true);
load('config/config.js').getConfig=()=>({getConfigDir:()=>root});
const secureInput=new SecureInputService(root,600000,()=>true);
const adapters=new ConnectionAdapterRegistry();
adapters.register(new ApiKeyConnectionAdapter({createCredentialSession:async(ctx,fields)=>secureInput.create({serviceId:ctx.attempt.serviceId,attemptId:ctx.attempt.id,fields}),verifyCredential:async(ref,ctx)=>{reads++;const value=JSON.parse(secureInput.readForConsumer(ref,ctx.attempt.serviceId,ctx.attempt.id)||'{}');return{ok:Object.values(value).includes(CANARY),message:'Synthetic fixed read verified'};}}));
let runtime;
function restore(){const orchestrator=new ConnectionOrchestrator({attempts:new ConnectionAttemptStore(root),connections:new ConnectionStore(root),activity:new ConnectionActivityStore(root),adapters,plans:new PluginConnectionPlanResolver(()=>[]),validateCredentialReference:(ref,s,a)=>secureInput.ownsReference(ref,s,a)});runtime={orchestrator,secureInput,adapters,start:new ConnectionStartService(orchestrator)};}
restore();load('connections/runtime.js').getConnectionRuntime=()=>runtime;
const app=express();app.use(express.json({verify:(req,res,b)=>req.rawBody=Buffer.from(b)}));
app.use((req,res,next)=>{const json=res.json.bind(res);res.json=value=>{assert(!JSON.stringify(value).includes(CANARY),'secret echoed');return json(value)};next()});
app.get('/api/secure-access/status',(req,res)=>res.json({owner:owner.ownerSurfaceState(req,proof)}));
app.get('/api/protected-plugins',(req,res)=>res.json({owner:owner.ownerSurfaceState(req,proof),storageAvailable:true,services:[{id:'stripe',name:'Synthetic Stripe fixture'}]}));
app.use(load('gateway/routes/connections-v2.router.js').router);
app.use('/src',express.static(path.resolve('web-ui/src')));
app.get('/',(req,res)=>res.type('html').send(`<!doctype html><meta name="viewport" content="width=device-width"><style>body{font:15px system-ui;background:#151719;color:#eee;--panel:#242729;--text:#eee}button{padding:10px;margin:5px}h1{font-size:20px}</style><h1>Isolated protected connection test</h1><button id="connect">Connect fixture</button><script type="module">import{openConnectFlow}from'/src/features/connectors/connect-flow.js';window.calls=[];window.prometheusOwnerConsent={request:args=>window.fixtureConsent(args)};async function api(p,o={}){window.calls.push(p);const r=await fetch(p,{...o,headers:{'Content-Type':'application/json',...o.headers}});const v=await r.json();if(!r.ok)throw Error(v.error);return v;}document.querySelector('#connect').onclick=()=>openConnectFlow(api,{serviceId:'stripe',kind:'connector',attemptId:new URLSearchParams(location.search).get('attemptId')||undefined});</script>`));
(async()=>{let browser,server;try{
server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const url=`http://127.0.0.1:${server.address().port}`;
browser=await chromium.launch({headless:true});
for(const [label,width,height]of[['desktop',1440,960],['mobile',390,844]]){
 const ctx=await browser.newContext({viewport:{width,height}});await ctx.addCookies([{name:'prom_sa_owner',value:OWNER,url}]);
 const page=await ctx.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.exposeFunction('fixtureConsent',args=>({approved:true,header:consent.mintConsent(OWNER,args.method,args.path,consent.sha256Hex(args.body))}));
 await page.goto(url);await page.click('#connect');await page.getByRole('button',{name:'Approve connection',exact:true}).click();
 await page.getByRole('button',{name:'Open protected entry',exact:true}).click();
 const input=page.locator('input[type=password]');await input.waitFor();await input.fill(CANARY);
 await page.getByRole('button',{name:/Save/}).click();await page.getByText('Stored, not verified.',{exact:false}).waitFor();
 assert.equal(await page.locator('input[type=password]').count(),0);
 await page.getByRole('button',{name:'Cancel',exact:true}).click();
 await page.getByRole('button',{name:'Verify connection',exact:true}).click();
 await page.getByText('connected',{exact:true}).waitFor();
 assert(!(await page.content()).includes(CANARY));assert.equal(errors.length,0,errors.join('\n'));
 assert(!(await page.evaluate(()=>JSON.stringify(window.calls))).includes('chat'));
 await page.screenshot({path:path.join(root,label+'-protected-e2e.png')});
 const a=runtime.orchestrator.listAttempts(1)[0];assert.equal(a.state,'connected');restore();assert.equal(runtime.orchestrator.getAttempt(a.id).state,'connected');
 await page.goto(url+'?attemptId='+encodeURIComponent(a.id));await page.click('#connect');await page.getByText('connected',{exact:true}).waitFor();
 await ctx.close();
 // Use fresh persisted service state for the second viewport, not live user data.
 if(label==='desktop'){for(const f of ['connection-attempts.json','connections.json']){try{fs.unlinkSync(path.join(root,f))}catch{}}restore();}
}
assert(reads>=2);console.log('PASS real connections router + shared card + protected save + vault binding + synthetic fixed read + reload on desktop/mobile; native proof/storage and external provider remain fixtures.');
}finally{if(browser)await browser.close();if(server)await new Promise(r=>server.close(r));fs.rmSync(root,{recursive:true,force:true});}})().catch(e=>{console.error(e.stack);process.exitCode=1});
