// Exercise the actual trusted IPC callback without launching the owner window.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { consentAction } = require('../electron/owner-consent');
const source = fs.readFileSync(require.resolve('../electron/main.js'), 'utf8');
const ipc = source.slice(source.indexOf("handleTrustedMain('owner-consent:request'"), source.indexOf("handleTrustedMain('owner-consent:status'"));
let handle; const calls = [];
vm.runInNewContext(ipc, { Buffer, handleTrustedMain: (_, fn) => { handle = fn; }, ownerConsent: { request: async p => { assert.ok(consentAction(p.method,p.path)); calls.push(p); return null; } } });
(async()=>{
 for (const path of ['/api/connection-attempts/fixture/connect','/api/connection-secure-input/fixture']) {
  const body = JSON.stringify({fixture:true}); const result = await handle(null,{method:'POST',path,body});
  assert.equal(result.approved,false); assert.equal(calls.at(-1).body,body);
 }
 const count=calls.length;
 for (const path of ['/api/unrelated','/api/pairing/devices/fixture/owner-approval']) await assert.rejects(handle(null,{path}));
 assert.equal(calls.length,count); console.log('PASS desktop plugin requests reach human consent, denial preserved; unrelated routes not dispatched');
})().catch(e=>{console.error(e.message);process.exitCode=1});
