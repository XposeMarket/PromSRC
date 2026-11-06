import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mergeHistoryWithExistingMessageMetadata as merge } from '../src/gateway/history-reconciliation';
const source=fs.readFileSync('web-ui/src/features/chat/runtime/desktop-send-chat-runtime.js','utf8');
const start=source.indexOf('    const userTurnMessage =');
const end=source.indexOf('    if (realtimeAgentVoiceHandoff)',start);
assert(start>=0&&end>start);
const make=new Function('sessionHistoryRef','reuseExistingUserIndex','messageWithFiles','uploadedAttachmentPreviews','clientRequestId',source.slice(start,end)+'return userTurnMessage;');
const row=make([],-1,'same message',[{name:'image.png',workspacePath:'uploads/image.png'}],'request-a');
assert.equal(row.clientRequestId,'request-a','actual desktop optimistic row carries request identity BEFORE steer/history sync');
const stored={role:'user',content:'same message',timestamp:row.timestamp+1000,clientRequestId:'request-a',attachmentPreviews:row.attachmentPreviews};
for(const preserveAllExisting of [false,true]){
 const merged=merge([stored],[row],{preserveAllExisting});
 assert.equal(merged.length,1);assert.equal(merged[0].clientRequestId,'request-a');
 const again={...row,clientRequestId:'request-b',timestamp:row.timestamp+2000};
 const distinct=merge([stored],[row,again],{preserveAllExisting});
 assert.equal(distinct.filter(x=>x.role==='user').length,2,'intentional identical sends remain distinct');
 assert.deepEqual(distinct.map(x=>x.clientRequestId),['request-a','request-b']);
}
console.log('actual desktop optimistic identity + real server sync, attachments, repeated identical sends PASS');
