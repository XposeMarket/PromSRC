const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');
const { uploadNativeFiles } = require('../electron/browser-upload.cjs');
(async () => {
 const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-upload-'));
 const file = path.join(dir, 'test.txt'); fs.writeFileSync(file, 'fixture');
 const browser = await chromium.launch({headless:true});
 try {
  const page = await browser.newPage();
  await page.setContent('<input id="file" type="file" hidden><div data-sc-ref="2"><input type="file" multiple></div><button id="wrong">Wrong</button>');
  const cdp = await page.context().newCDPSession(page);
  let attached = true;
  const wc = {debugger:{isAttached:()=>attached, attach:()=>{attached=true},detach:()=>{attached=false},sendCommand:(m,p)=>cdp.send(m,p)}};
  assert.equal((await uploadNativeFiles(wc,{selector:'#file',file_paths:[file]})).count,1);
  assert.equal(await page.$eval('#file',el=>el.files[0].name),'test.txt');
  assert.equal(attached,true,'existing debugger retained');
  await uploadNativeFiles(wc,{ref:2,file_path:file});
  assert.equal(await page.$eval('[data-sc-ref="2"] input',el=>el.files.length),1);
  await assert.rejects(uploadNativeFiles(wc,{selector:'#wrong',file_path:file}),/not a file input/);
  await assert.rejects(uploadNativeFiles(wc,{selector:'#missing',file_path:file}),/not found/);
  await assert.rejects(uploadNativeFiles(wc,{selector:'#file',file_path:dir}),/regular file/);
  await assert.rejects(uploadNativeFiles(wc,{selector:'#file',file_path:path.join(dir,'absent')}));
  await assert.rejects(uploadNativeFiles(wc,{selector:'#file'}),/required/);
  attached=false; await uploadNativeFiles(wc,{selector:'#file',file_path:file}); assert.equal(attached,false,'owned debugger cleaned up');
  const source=fs.readFileSync(path.join(__dirname,'../src/gateway/browser-tools.ts'),'utf8');
  const upload=source.slice(source.indexOf('export async function browserUploadFile'),source.indexOf('export async function browserClickAndDownload'));
  assert(upload.indexOf('getInHouseSession(resolved)') < upload.indexOf('sessions.get(resolved)'));
  console.log('PASS real Chromium hidden input, ref, invalid target/path, cleanup, native-first routing');
 } finally {await browser.close();fs.rmSync(dir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1});
