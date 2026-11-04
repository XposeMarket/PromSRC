import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { SecureInputService } from '../src/connections/secure-input-service';
import { SecretVault } from '../src/security/vault';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'connection-ownership-'));
try {
 const service=new SecureInputService(dir); const vault=new SecretVault(dir);
 const session=service.create({serviceId:'fixture',attemptId:'attempt-1',fields:[{key:'api_key',label:'Key',secret:true,required:true}]});
 const result=service.submit(session.id,{api_key:'  CANARY_KEY  '});
 assert(service.ownsReference(result.credentialRef,'fixture','attempt-1'));
 assert(!service.ownsReference(result.credentialRef,'different','attempt-1'));
 assert(!service.ownsReference('vault:openai.oauth_tokens','fixture','attempt-1'));
 assert.throws(()=>service.clearReference('vault:openai.oauth_tokens','fixture','attempt-1'));
 assert.throws(()=>service.clearReference(result.credentialRef,'fixture','wrong-attempt'));
 const read=new SecretVault(dir).get(result.credentialRef.replace('vault:',''))?.expose(); assert.equal(JSON.parse(read!).api_key,'  CANARY_KEY  ');
 const restarted=new SecureInputService(dir);assert(restarted.ownsReference(result.credentialRef,'fixture','attempt-1'));
 restarted.clearReference(result.credentialRef,'fixture','attempt-1');assert(!restarted.ownsReference(result.credentialRef,'fixture','attempt-1'));
 console.log('PASS connector secure input: exact preservation, scoped ref/delete, persisted ownership, no raw vault path reuse.');
}finally{fs.rmSync(dir,{recursive:true,force:true});}
