const { app, BrowserWindow, session } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const { createProtectedAccess } = require('../electron/protected-access');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'protected-login-fixture-'));
app.setPath('userData', root);
app.on('window-all-closed', () => {});
const canary = 'CANARY_FAKE_PASSWORD_9c7a';
let submissions = 0, transfers = 0, contexts = [];
const origin = 'https://fixture.test';
app.whenReady().then(async () => {
 try {
 const isolatedSession = { fromPartition(name, opts) {
  const s = session.fromPartition(name, opts); contexts.push(s);
  s.protocol.handle('https', async request => {
   const url = new URL(request.url);
   if (url.pathname === '/signin' && request.method === 'POST') {
    const body = await request.text(); assert(body.includes(canary)); submissions++;
    await s.cookies.set({url:origin,name:'session',value:'FAKE_COOKIE',secure:true,httpOnly:true});
    return new Response('<h1>Signed in</h1>',{headers:{'Content-Type':'text/html'}});
   }
   const field = url.pathname === '/wrong' ? '<textarea name=password></textarea>' : '<input type=password name=password>';
   return new Response(`<form method=post action=/signin><input type=email name=email>${field}<button>Sign in</button></form>`,{headers:{'Content-Type':'text/html'}});
  }); return s;
 }};
 const service = createProtectedAccess({BrowserWindow,session:isolatedSession,app,transferCookies: async (sid, site, cookies) => {assert.equal(sid,'owner-test');assert.equal(site,origin);assert.equal(cookies[0].value,'FAKE_COOKIE'); transfers++;}});
 assert(service.supported());
 await assert.rejects(()=>service.prepare({credentialId:'wrong-origin',origin,url:'https://elsewhere.test',secret:canary,identifier:'a@example.test'}));
 await assert.rejects(()=>service.prepare({credentialId:'bad-field',origin,url:origin+'/wrong',secret:canary,identifier:'a@example.test'}));
 const result = await service.prepare({credentialId:'one',origin,url:origin+'/login',secret:canary,identifier:'a@example.test',sessionId:'owner-test'});
 assert.deepEqual(result.filled,['identifier','password']); assert(!JSON.stringify(result).includes(canary)); assert.equal(submissions,0);
 await assert.rejects(()=>service.prepare({credentialId:'one',origin,url:origin+'/login',secret:canary,identifier:'a@example.test'}));
 const receipt=await service.submit({credentialId:'one'}); assert.equal(receipt.phase,'submitted_outcome_unknown');assert.equal(submissions,1);assert.equal(transfers,1); assert(!JSON.stringify(receipt).includes('FAKE_COOKIE'));
 await assert.rejects(()=>service.submit({credentialId:'one'})); assert.equal(BrowserWindow.getAllWindows().length,0);
 await service.prepare({credentialId:'cancel',origin,url:origin+'/login',secret:canary,identifier:'a@example.test'});service.cancel({credentialId:'cancel'}); await assert.rejects(()=>service.submit({credentialId:'cancel'})); assert.equal(submissions,1);
 console.log('PASS real Electron protected login: hidden fresh contexts, exact origin, real form, no automatic submit, one dispatch, runtime-only cookies, cancel, no value receipts.');
 app.exit(0);
 } catch(e) {console.error(e.message);app.exit(1);}
});
