import assert from 'node:assert/strict';
import fs from 'node:fs';
import { webkit } from 'playwright';
const browser = await webkit.launch();
try {
 const page = await browser.newPage({viewport:{width:390,height:844}});
 const home='https://home.example', office='https://office.example';
 const fixture={gatewayId:'test-office',origin:office,name:'Office PC'};
 let polls=0,claims=0;
 const modules={
  'mobile-shell.js':`export const renderMobileHeader=()=>'',wireHeaderActions=()=>{};`,
  'state.js':`export const API='';`,
  'account.js':`export const getAccount=()=>({accessActive:true}),checkSessionDetailed=()=>{},mountLoginScreen=()=>{};`,
  'mobile-api.js':`export const getDeviceToken=()=>localStorage.getItem('pm_device_token'), setDeviceToken=()=>{},clearDeviceToken=()=>{},claimPairing=()=>{},pollPairing=()=>{},verifyPairingMe=()=>{};`
 };
 const prod=['mobile-gateway-catalog.js','mobile-pairing-page.js'];
 await page.route('**/*', async route=>{
  const url=new URL(route.request().url()),name=url.pathname.split('/').pop();
  if(url.origin===home && url.pathname==='/')return route.fulfill({contentType:'text/html',body:'<main id="p"></main>'});
  if(url.origin===home && (modules[name]||prod.includes(name)))return route.fulfill({contentType:'text/javascript',body:modules[name]||fs.readFileSync('web-ui/src/mobile/'+name,'utf8')});
  if(url.origin===office && url.pathname.startsWith('/api/pairing/')){
   const hdr={'Access-Control-Allow-Origin':home,'Access-Control-Allow-Methods':'GET,POST,OPTIONS','Access-Control-Allow-Headers':'Content-Type,X-Pairing-Device-Fingerprint'};
   if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers:hdr});
   const result=url.pathname.endsWith('claim')?(claims++,{success:true,requestId:'test'}):(++polls===1?{status:'approved',deviceToken:'fixture-office',deviceId:'phone',gateway:fixture}:{status:'approved_already_collected'});
   return route.fulfill({headers:hdr,json:result});
  }
  return route.abort();
 });
 await page.goto(home);
 await page.evaluate(async ({fixture})=>{
  localStorage.setItem('pm_device_token','fixture-home');
  const c=await import('/mobile/mobile-gateway-catalog.js');c.upsertGateway({gatewayId:'home',origin:location.origin,name:'Home PC'},{token:'fixture-home'});
  const orig=Storage.prototype.setItem;window.restore=()=>{Storage.prototype.setItem=orig};Storage.prototype.setItem=function(k,v){if(k==='pm_mobile_gateway_catalog_v1')return;orig.call(this,k,v)};
  const payload=btoa(JSON.stringify({...fixture,audience:'prometheus-mobile-pairing',expiresAt:Date.now()+60000,challenge:'test-challenge'}));
  const {renderPairPage}=await import('/mobile/mobile-pairing-page.js');void renderPairPage(document.querySelector('main'),{code:payload,navigate:()=>{},addMode:true});
 },{fixture});
 await page.locator('#pm-pair-confirm').click({timeout:7000});
 await page.locator('#pm-pair-retry-save').waitFor({timeout:3000});
 assert.equal(await page.locator('#pm-pair-title').textContent(),'Approved, but not saved on this phone');
 assert.equal(await page.evaluate(()=>localStorage.getItem('pm_mobile_gateway_token_v1:test-office')),null);
 if(process.env.SHOTDIR){fs.mkdirSync(process.env.SHOTDIR,{recursive:true});await page.screenshot({path:process.env.SHOTDIR+'/retry.png'});}
 await page.evaluate(()=>window.restore());await page.locator('#pm-pair-retry-save').click();await page.locator('#pm-pair-done').waitFor();
 await page.reload();const rows=await page.evaluate(async()=>{const c=await import('/mobile/mobile-gateway-catalog.js');return c.loadGatewayCatalog().map(g=>[g.name,c.getGatewayToken(g.gatewayId)]);});
 assert.deepEqual(rows,[['Home PC','fixture-home'],['Office PC','fixture-office']]);assert.equal(polls,1);assert.equal(claims,1);
 console.log('PASS: WebKit mobile; blocked catalog write rolled back, no false success, retry used one approval, both PCs and scoped credentials survived reload.');
} finally {await browser.close();}
