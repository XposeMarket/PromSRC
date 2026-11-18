import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const {getVault}=await import('../dist/security/vault.js');
const {bindPluginCredential,resolveBoundPluginCredential,deleteBoundPluginCredential}=await import('../dist/connections/plugin-credential-binding.js');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'prom-binding-fixture-'));
try {
  const vault=getVault(dir); const owners={};
  for(const id of ['personal','business','replacement']) {
    const key=`connection.credentials.${id}`; vault.set(key,JSON.stringify({token:`fixture-${id}`}), 'test');
    owners[`vault:${key}`]={serviceId:'fixture',attemptId:id,connectionId:id==='personal'?'account-personal':'account-business'};
  }
  fs.writeFileSync(path.join(dir,'connection-credential-owners.json'),JSON.stringify(owners));
  bindPluginCredential(dir,'fixture','vault:connection.credentials.personal','personal','account-personal');
  bindPluginCredential(dir,'fixture','vault:connection.credentials.business','business','account-business');
  assert.equal(resolveBoundPluginCredential(dir,'fixture','token','account-personal').value,'fixture-personal');
  assert.equal(resolveBoundPluginCredential(dir,'fixture','token','account-business').value,'fixture-business');
  assert.deepEqual(resolveBoundPluginCredential(dir,'fixture','token','unknown'),{handled:true});
  assert.throws(()=>bindPluginCredential(dir,'fixture','vault:connection.credentials.personal','personal','account-business'),/MISMATCH|ALREADY_BOUND/);
  bindPluginCredential(dir,'fixture','vault:connection.credentials.replacement','replacement','account-business');
  assert.equal(resolveBoundPluginCredential(dir,'fixture','token','account-personal').value,'fixture-personal');
  assert.equal(resolveBoundPluginCredential(dir,'fixture','token','account-business').value,'fixture-replacement');
  deleteBoundPluginCredential(dir,'fixture','account-business');
  assert.deepEqual(resolveBoundPluginCredential(dir,'fixture','token','account-business'),{handled:true});
  assert.equal(resolveBoundPluginCredential(dir,'fixture','token','account-personal').value,'fixture-personal');
  const {SecureInputService}=await import('../dist/connections/secure-input-service.js');
  const secure=new SecureInputService(dir,60000,()=>true);
  const session=secure.create({serviceId:'fixture',attemptId:'secure-attempt',connectionId:'secure-account',fields:[{key:'token',label:'Token',required:true}]});
  const submitted=secure.submit(session.id,{token:'fixture-secure'});
  assert.equal(secure.ownsReference(submitted.credentialRef,'fixture','secure-attempt'),false);
  assert.equal(secure.ownsReference(submitted.credentialRef,'fixture','secure-attempt','secure-account'),true);
  assert.equal(secure.readForConsumer(submitted.credentialRef,'fixture','secure-attempt'),undefined);
  assert.throws(()=>secure.clearReference(submitted.credentialRef,'fixture','secure-attempt',{persistedLegacy:true}),/does not belong/);
  bindPluginCredential(dir,'fixture',submitted.credentialRef,'secure-attempt','secure-account');
  assert.equal(resolveBoundPluginCredential(dir,'fixture','token','secure-account').value,'fixture-secure');
  secure.clearReference(submitted.credentialRef,'fixture','secure-attempt',{connectionId:'secure-account'});
  assert.deepEqual(resolveBoundPluginCredential(dir,'fixture','token','secure-account'),{handled:true});
  console.log('PASS protected account binding add/replace/disconnect and secure-input ownership isolation');
} finally {fs.rmSync(dir,{recursive:true,force:true});}
