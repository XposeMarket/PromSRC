import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const root=path.resolve('web-ui');
const server=http.createServer((req,res)=>{
 const file=path.resolve(root,'.'+decodeURIComponent(req.url.split('?')[0]));
 if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
 if(req.url==='/fixture.html'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><html><body><button id="open">Open accounts</button><script type="module">import {openPluginAccountManager} from "/src/features/connectors/account-manager.js";window.calls=[];const rows=[{id:"personal",serviceId:"gmail",canAddAccount:true,label:"Personal",account:{email:"personal@example.invalid"},authState:"healthy"},{id:"business",serviceId:"gmail",canAddAccount:true,label:"Xpose business",account:{email:"business@example.invalid"},authState:"healthy"}];window.fetchFixture=async(url,options)=>{window.calls.push({url,body:JSON.parse(options.body||"{}")});if(url.endsWith("/list"))return {success:true,accounts:rows};return {success:true};};document.querySelector("#open").onclick=()=>openPluginAccountManager(window.fetchFixture,"gmail",{onSelect:id=>window.selected=id});</script></body></html>');return;}
 try{res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':'text/plain');res.end(fs.readFileSync(file));}catch{res.writeHead(404).end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true});
const out=path.resolve('.pr/account-ui-proof');fs.mkdirSync(out,{recursive:true});
try{
 for(const [name,width,height] of [['desktop',1280,900],['mobile',390,844]]){
  const page=await browser.newPage({viewport:{width,height}});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/fixture.html`);
  await page.click('#open');await page.getByRole('heading',{name:'Connected accounts'}).waitFor();
  assert.equal(await page.locator('.sa-account-row').count(),2);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.getByRole('button',{name:'Add account',exact:true}).click();
  await page.getByRole('button',{name:'Add account',exact:true}).click();
  assert.equal(await page.locator('[data-account-add-form]').count(),1);
  await page.getByRole('button',{name:'Cancel',exact:true}).click();
  assert.equal(await page.locator('[data-account-add-form]').count(),0);
  await page.screenshot({path:path.join(out,`${name}.png`),fullPage:true});
  await page.getByRole('button',{name:'Disconnect',exact:true}).nth(1).click();
  assert.equal(await page.evaluate(()=>window.calls.filter(c=>c.url.endsWith('/disconnect')).length),0);
  await page.getByRole('button',{name:'Confirm disconnect Xpose business'}).click();
  await page.waitForFunction(()=>window.calls.some(c=>c.url==='/api/plugin-accounts/business/disconnect'));
  await page.getByRole('button',{name:'Select',exact:true}).nth(1).click();
  assert.equal(await page.evaluate(()=>window.selected),'business');
  assert.equal(await page.locator('[role=dialog]').count(),0);
  await page.evaluate(async()=>{
    const {openExistingPluginAccounts}=await import('/src/features/connectors/account-manager.js');
    window.adopted=false;
    window.onboardingFetch=async(url)=>{
      if(url.endsWith('/legacy-list'))return {accounts:[{id:'old',serviceId:'gmail',label:'Personal',account:{email:'old@example.invalid'}}]};
      if(url.endsWith('/adopt')){window.adopted=true;return {success:true};}
      return {accounts:window.adopted?[{id:'old',serviceId:'gmail',label:'Personal',canAddAccount:true}]:[]};
    };
    await openExistingPluginAccounts(window.onboardingFetch,'gmail');
  });
  assert.equal(await page.evaluate(()=>window.adopted),false);
  await page.getByRole('button',{name:'Keep account and continue'}).click();
  await page.getByRole('heading',{name:'Connected accounts'}).waitFor();
  assert.equal(await page.evaluate(()=>window.adopted),true);
  await page.getByRole('button',{name:'Done',exact:true}).click();
  await page.evaluate(async()=>{
    const {openExistingPluginAccounts}=await import('/src/features/connectors/account-manager.js');
    window.freshCalls=[];
    const fresh=async(url,options={})=>{
      window.freshCalls.push({url,body:JSON.parse(options.body||'{}')});
      if(url==='/api/protected-plugins')return {setup:{canConfigure:true}};
      if(url.endsWith('/create'))return {account:{id:'fresh'},attempt:{id:'attempt-fresh'}};
      if(url.endsWith('/reauth'))return {attempt:{id:'attempt-fresh',serviceId:'gmail',state:'connected'}};
      return {accounts:[],creatableServices:['gmail'],canManageLegacyAccounts:false};
    };
    await openExistingPluginAccounts(fresh,'gmail');
  });
  await page.getByRole('button',{name:'Add account',exact:true}).click();
  await page.getByRole('textbox',{name:'New account name'}).fill('Work');
  await page.getByRole('button',{name:'Continue to sign in'}).click();
  await page.waitForFunction(()=>window.freshCalls.some(call=>call.url==='/api/plugin-accounts/fresh/reauth'));
  assert.deepEqual(await page.evaluate(()=>window.freshCalls.find(call=>call.url.endsWith('/create')).body),{label:'Work',serviceId:'gmail'});
  assert.deepEqual(await page.evaluate(()=>window.freshCalls.find(call=>call.url.endsWith('/reauth')).body),{attemptId:'attempt-fresh'});
  assert.equal(await page.evaluate(()=>window.freshCalls.some(call=>call.url==='/api/connection-attempts/start')),false);
  await page.evaluate(async()=>{
     document.querySelectorAll('.sa-connect-overlay').forEach(node=>node.remove());
     const {openConnectFlow}=await import('/src/features/connectors/connect-flow.js');
     window.resourceCalls=[];
     const fetcher=async(url,options={})=>{
       const body=JSON.parse(options.body||'{}');window.resourceCalls.push({url,body});
       if(url==='/api/protected-plugins')return {setup:{canConfigure:true}};
       return {attempt:{id:'vault-attempt',serviceId:'obsidian',state:body.path?'connected':'awaiting_approval',requiredUserAction:{type:'local-resource'}}};
     };
     await openConnectFlow(fetcher,{serviceId:'obsidian',connectionId:'vault-selected',attemptId:'vault-attempt'});
   });
   await page.getByRole('textbox',{name:'Vault folder'}).fill('/fixture/vault');
   await page.getByRole('button',{name:'Connect this vault',exact:true}).click();
   await page.waitForFunction(()=>window.resourceCalls.some(call=>call.body.path));
   const submitted=await page.evaluate(()=>window.resourceCalls.find(call=>call.body.path));
   assert.equal(submitted.url,'/api/connection-attempts/vault-attempt/connect');
   assert.equal(submitted.body.path,'/fixture/vault');
   assert.deepEqual(errors,[]);
  await page.close();console.log(`PASS ${name} production account controller fixture: rendering, overflow, exact selection, disconnect confirmation`);
 }
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
