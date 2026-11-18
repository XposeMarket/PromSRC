import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'prom-account-admission-'));
process.env.PROMETHEUS_DATA_DIR=root;
process.env.PROMETHEUS_WORKSPACE_DIR=path.join(root,'workspace');
fs.mkdirSync(process.env.PROMETHEUS_WORKSPACE_DIR,{recursive:true});
let code=0;
try {
 const token=randomBytes(32).toString('hex');
 const secrets=await import('../dist/security/secure-access-owner.js');
 secrets.captureGatewayOwnerSecrets({PROMETHEUS_SECURE_ACCESS_OWNER_TOKEN:token});
 const {bindInteractivePluginAccountAuthority:bind}=await import('../dist/gateway/routes/plugin-account-authority.js');
 const authority=await import('../dist/connections/account-session-authority.js');
 const req={headers:{host:'localhost:12345',origin:'http://localhost:12345',cookie:`prom_sa_owner=${token}`},socket:{remoteAddress:'127.0.0.1'},is:type=>type==='application/json'};
 assert.equal(bind(req,'fixture-chat'),true);
 assert.equal(authority.getAccountSessionAuthority('fixture-chat').kind,'owner');
 assert.equal(bind({...req,headers:{...req.headers,origin:'https://evil.invalid'}},'fixture-chat'),false);
 assert.throws(()=>authority.getAccountSessionAuthority('fixture-chat'),/PRINCIPAL_UNAVAILABLE/);
 assert.equal(bind(req,'fixture-chat'),true);
 assert.equal(bind({...req,headers:{...req.headers,cookie:''}},'fixture-chat'),false);
 assert.throws(()=>authority.getAccountSessionAuthority('fixture-chat'),/PRINCIPAL_UNAVAILABLE/);
 assert.equal(bind(req,'background_fixture'),false);
 assert.throws(()=>authority.getAccountSessionAuthority('background_fixture'),/PRINCIPAL_UNAVAILABLE/);
 authority.clearAllAccountSessionAuthorities();
 console.log('PASS actual interactive admission accepts owner proof and rejects cross-origin, missing proof and worker namespace');
} catch(error){console.error(error);code=1;}
finally{fs.rmSync(root,{recursive:true,force:true});}
process.exit(code);
