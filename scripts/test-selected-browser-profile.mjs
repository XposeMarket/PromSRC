import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import http from 'node:http';import {createRequire} from 'node:module';import {spawn} from 'node:child_process';
const require=createRequire(import.meta.url), root=fs.mkdtempSync(path.join(os.tmpdir(),'prom-selected-'));
const server=http.createServer((req,res)=>{if(req.url==='/complete'){res.writeHead(302,{'Set-Cookie':'fixture=yes; Max-Age=3600; HttpOnly; SameSite=Strict',Location:'/site'});return res.end();}res.end(req.url==='/site'?(req.headers.cookie?.includes('fixture=yes')?'Signed in':'Sign in required'):'App fixture');});
try {
 await new Promise(r=>server.listen(0,'127.0.0.1',r)); const url=`http://127.0.0.1:${server.address().port}`;
 const chrome=path.join(root,'Google','Chrome','User Data');fs.mkdirSync(path.join(chrome,'Default'),{recursive:true});fs.writeFileSync(path.join(chrome,'Default','History'),'fixture');
 const options={userDataCandidates:[chrome]}, catalog=require('../electron/chrome-profile.js'), imported=catalog.copyChromeProfile(root,catalog.detectChromeProfiles(options)[0].id,options);
 const entry=path.join(root,'main.cjs');fs.writeFileSync(entry,`const {app,BrowserWindow,session}=require('electron');const assert=require('node:assert/strict'),{readSelectedBrowserProfile}=require(${JSON.stringify(require.resolve('../electron/selected-browser-profile.cjs'))}),lookup=id=>require(${JSON.stringify(require.resolve('../electron/chrome-profile.js'))}).getImportedChromeProfile(${JSON.stringify(root)},id),url=${JSON.stringify(url)},id=${JSON.stringify(imported.id)};
 app.whenReady().then(async()=>{const shell=new BrowserWindow({show:false});await shell.loadURL(url);const choose=()=>readSelectedBrowserProfile(shell,url,lookup);
 if(process.env.TEST_PHASE==='1'){assert.equal(await choose(),'main');await shell.webContents.executeJavaScript('localStorage.setItem("prometheus.inhouse.profile",'+JSON.stringify(id)+')');}
 assert.equal(await choose(),id);const store=session.fromPath(lookup(await choose()).importedPath),tab=new BrowserWindow({show:false,webPreferences:{session:store}});await tab.loadURL(url+'/site');const page=()=>tab.webContents.executeJavaScript('document.body.innerText');
 if(process.env.TEST_PHASE==='1'){assert.equal(await page(),'Sign in required');await tab.loadURL(url+'/complete');}assert.equal(await page(),'Signed in');await store.cookies.flushStore();
 if(process.env.TEST_PHASE==='2'){await shell.webContents.executeJavaScript('localStorage.setItem("prometheus.inhouse.profile","imported-missing")');await assert.rejects(choose,/unavailable/);await shell.webContents.executeJavaScript('localStorage.removeItem("prometheus.inhouse.profile")');assert.equal(await choose(),'main');}
 app.quit();}).catch(e=>{console.error(e);app.exit(1)});`);
 for(const phase of ['1','2']) await new Promise((resolve,reject)=>{const env={...process.env,TEST_PHASE:phase};delete env.ELECTRON_RUN_AS_NODE;const child=spawn(require('electron'),['--user-data-dir='+path.join(root,'desktop'),entry],{env,stdio:'inherit'});const timer=setTimeout(()=>{child.kill();reject(Error('Electron fixture timed out'));},25000);child.on('error',reject);child.on('exit',code=>{clearTimeout(timer);code===0?resolve():reject(Error('fixture exit '+code));});});
 console.log('PASS two real Electron launches: imported selection, same-tab sign-in, persisted site session, missing profile and reset.');
}finally{server.close();fs.rmSync(root,{recursive:true,force:true,maxRetries:6,retryDelay:200});}
