import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';
import { _electron } from 'playwright';
const require = createRequire(import.meta.url);
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-native-qa-'));
const spool = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-download-'));
const bytes = Buffer.from('local signed-in fixture\n');
const server = http.createServer((req, res) => {
  if (req.url === '/file') {
    if (req.headers.cookie !== 'qa=yes') { res.writeHead(403); return res.end(); }
    res.writeHead(200, { 'Content-Disposition': 'attachment; filename="fixture.txt"' }); return res.end(bytes);
  }
  res.setHeader('Set-Cookie', 'qa=yes; HttpOnly; SameSite=Strict'); res.end('<a href="/file">Save fixture</a>');
});
let app;
try {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const entry = path.join(root, 'main.cjs');
  fs.writeFileSync(entry, `global.testRequire=require;const {app,BrowserWindow}=require('electron'); app.whenReady().then(()=>{global.win=new BrowserWindow({show:false});win.loadURL('http://127.0.0.1:${server.address().port}/')});`);
  app = await _electron.launch({args:[`--user-data-dir=${root}/profile`, entry]});
  const page = await app.firstWindow(); await page.getByRole('link').waitFor();
  const cfg = { helper:require.resolve('../electron/browser-download.cjs'), spool:path.basename(spool) };
  await app.evaluate(({BrowserWindow}, {helper,spool}) => {
    const wc = BrowserWindow.getAllWindows()[0].webContents;
    global.pendingDownload = global.testRequire(helper).captureClickedDownload(wc,{spool,timeoutMs:10000},()=>{});
    global.pendingDownload.catch(()=>{});
  }, cfg);
  await page.getByRole('link').click();
  assert.equal((await app.evaluate(()=>global.pendingDownload)).filename,'fixture.txt');
  assert.deepEqual(fs.readFileSync(path.join(spool,'payload')), bytes);
  const result = await app.evaluate(async ({BrowserWindow}, {helper,spool})=>{
    const wc=BrowserWindow.getAllWindows()[0].webContents;
    const n=wc.session.listenerCount('will-download');
    const wait=global.testRequire(helper).captureClickedDownload(wc,{spool,timeoutMs:1000},()=>{});
    let busy=false; try{ global.testRequire(helper).captureClickedDownload(wc,{spool},()=>{}); } catch(e){busy=/pending/.test(e.message);}
    let timed=false;try{await wait;}catch(e){timed=/Timed out/.test(e.message);}
    return busy && timed && wc.session.listenerCount('will-download')===n;
  }, cfg);
  assert.ok(result); console.log('PASS real Electron: same-tab signed-in download, exact bytes, duplicate guard, timeout and listener cleanup.');
} finally { if(app) await app.close(); server.close(); for(const dir of [root,spool]) fs.rmSync(dir,{recursive:true,force:true,maxRetries:5,retryDelay:200}); }
