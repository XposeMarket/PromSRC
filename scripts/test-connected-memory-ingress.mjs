import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {createRequire} from 'node:module';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'reference-ingress-'));const workspace=path.join(root,'workspace');fs.mkdirSync(workspace);
Object.assign(process.env,{PROMETHEUS_CONFIG_DIR:path.join(root,'config'),PROMETHEUS_WORKSPACE:workspace,PROMETHEUS_DATA_DIR:path.join(root,'data')});
const require=createRequire(import.meta.url);require('tsx/cjs');const {autoAttachChatInputResources}=require('../src/gateway/resources/resource-store.ts');const {getReferenceService}=require('../src/gateway/resources/reference-service.ts');
const service=getReferenceService(workspace);
try{
 const file=path.join(workspace,'design.txt');fs.writeFileSync(file,'Warm lamps and deliberate whitespace.');
 const input={workspacePath:workspace,threadId:'chat-ingress',message:'Keep the atmosphere, not this exact furniture.',attachments:[{path:file,name:'design.txt',mimeType:'text/plain'}]};
 await autoAttachChatInputResources(input);assert.equal(service.metadata.list().length,0);
 service.metadata.setSettings({capture:true});await autoAttachChatInputResources(input);let refs=service.metadata.list();assert.equal(refs.length,1);assert.equal(refs[0].userQuote,input.message);assert.match(refs[0].searchText,/Warm lamps/);
 await autoAttachChatInputResources(input);assert.equal(service.metadata.list().length,1);
 service.metadata.update(refs[0].id,{excluded:true});await autoAttachChatInputResources(input);assert.equal(service.metadata.list().length,0);assert.equal(service.resources.listThreadResources(input.threadId).length,1);
 await autoAttachChatInputResources({...input,threadId:'team_hidden',attachments:[{name:'other.txt',mimeType:'text/plain',base64:Buffer.from('private team document').toString('base64')}]});assert.equal(service.metadata.list({includeExcluded:true}).length,1);
 console.log('CONNECTED_MEMORY_INGRESS_PASS: off/opt-in/document-purpose/idempotency/exclusion/team-denial; original registration survives capture refusal');
}finally{service.resources.flushSync();service.metadata.close();fs.rmSync(root,{recursive:true,force:true});}
