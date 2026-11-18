import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const ui=fs.readFileSync('web-ui/src/mobile/mobile-chat-page-runtime.js','utf8');
const fn=ui.slice(ui.indexOf('async function requestMobileMainChatAbort'),ui.indexOf('  function screenshotRootActions',ui.indexOf('async function requestMobileMainChatAbort')));
const api=fs.readFileSync('src/gateway/routes/chat/mobile.ts','utf8');
const route=api.slice(api.indexOf("router.post('/api/mobile/commands/stop-now'"),api.indexOf('\n});',api.indexOf("router.post('/api/mobile/commands/stop-now'"))+4);
let handler; const effects=[]; const runs=['A','B'].map(x=>({id:'run'+x,sessionId:x,abortable:true,kind:'main_chat'}));
vm.runInNewContext(ts.transpile(route),{router:{post:(_,f)=>handler=f},assertSafeStorageId:x=>x,listLiveRuntimes:()=>runs,isLiveRunningRuntime:()=>true,stopMainChatGoalByUser:id=>effects.push('goal'+id),listActiveBackgroundIdsForSession:id=>['worker'+id],backgroundAbort:id=>(effects.push(id),{ok:true}),abortLiveRuntime:id=>(effects.push(id),{ok:true}),summarizeMobileRuntime:x=>x});
function send(body){let code=200,data;handler({body},{status(c){code=c;return this},json(v){data=v}});return {code,...data};}
for(const [body,code] of [[{},400],[{sessionId:'B',runtimeId:'runA'},409],[{sessionId:'B',runtimeId:'previous'},409]]) {assert.equal(send(body).code,code); assert.deepEqual(effects,[]);}
const shared={abort(){throw Error('wrong chat handle invoked')}}; const pm={activeSessionId:'B',abort:shared,activeRuns:{A:{abort:shared,runtimeId:'runA'},B:{runtimeId:'runB'}}};let requests=0;
const ctx={__pmChat:pm,requestedSession:'B',mobileChatRuntimeAdapter:{requestInterruption(){}},stopMobileMainChat:async(s,o)=>{requests++;return send({sessionId:s,...o})},_activeMobileThread:()=>[],_findLatestAssistantTurn:()=>null,_clearMobileActiveRun(){},_markMobileSessionRunning(){},setBusy(){},pmToast(){},_readMobileActiveRun(){}};
const stop=vm.runInNewContext('('+fn+')',ctx);assert.equal((await stop('A')).success,false);assert.equal(requests,0);assert.equal((await stop('B')).success,true);assert.equal(requests,1);assert.deepEqual(effects,['workerB','goalB','runB']);
let own=0;pm.activeRuns.B.abort={abort(o){assert.equal(o.backendStopRequested,true);own++}}; await stop('B');assert.equal(own,1);assert.equal(requests,2);pm.activeRuns.B.runtimeId='runA';assert.equal((await stop('B')).success,false);assert.equal(own,1);assert(!effects.includes('runA'));
console.log('PASS: two disposable chats; missing, stale and foreign IDs rejected; A stays running; B receives exactly one request per tap');
