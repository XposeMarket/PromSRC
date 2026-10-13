import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const api = fs.readFileSync('web-ui/src/mobile/mobile-api.js','utf8');
const functionText = api.slice(api.indexOf('async function mfetch('),api.indexOf('async function mfetchWithRetry('));
async function run(fetchImpl, opts={}) {
 let clock=0,timers=new Map(),next=0,attempts=0;
 const context={Headers,FormData,AbortController,Error,Event,JSON,Math,Number,String,Date:{now:()=>clock},
 _assertMobileRequestTarget(){},_mobileRequestToken:()=>'',_buildUrl:x=>x,_isCurrentMobileRequestTarget:()=>true,clearDeviceToken(){},window:{dispatchEvent(){}},
 setTimeout(fn,ms){const id=++next;timers.set(id,{fn,ms});if(ms<1000){clock+=ms;queueMicrotask(()=>{if(timers.delete(id))fn()})}return id},clearTimeout:id=>timers.delete(id),
 fetch:async(...args)=>{attempts++;return fetchImpl({args,timers,advance:ms=>clock+=ms})}};
 vm.createContext(context);vm.runInContext(functionText+';globalThis.call=mfetch;',context);
 return {promise:context.call('/api/status',{timeoutMs:1000,...opts}),attempts:()=>attempts,timers};
}
let r=await run(({args,timers})=>({ok:true,status:200,text:async()=>{assert.equal(timers.size,1,'body must retain timer');return '{"ok":true}'}}));assert.equal((await r.promise).ok,true);assert.equal(r.timers.size,0);
r=await run(()=>{const e=new Error('timeout');e.name='AbortError';throw e});await assert.rejects(r.promise,/timed out/);assert.equal(r.attempts(),1,'timeouts must not repeat');
r=await run(()=>{throw new Error('network')});await assert.rejects(r.promise,/network/);assert.equal(r.attempts(),2,'one network retry only');
r=await run(({advance})=>{advance(750);return {ok:false,status:503,headers:{get:()=> 'restarting'},text:async()=>'{"code":"GATEWAY_RESTARTING"}'}});await assert.rejects(r.promise,/timed out/);assert.equal(r.attempts(),1,'restart delay cannot grant new deadline');
r=await run(()=>{throw new Error('network')},{method:'POST'});await assert.rejects(r.promise,/network/);assert.equal(r.attempts(),1,'mutations never replay');
const ws=fs.readFileSync('web-ui/src/ws.js','utf8');
let delays=[],events=[],idx=0;const schedule=ws.slice(ws.indexOf('function _wsScheduleReconnect('),ws.indexOf('export function connectWS('));
const ctx={_wsReconnectTimer:null,_wsWaitingForOnline:false,navigator:{onLine:true},Number,Math,Date,wsEventBus:{_dispatch:x=>events.push(x)},_wsNextDelay:()=>[1000,2000,4000][idx++],_wsBackoffIdx:0,setTimeout:(f,ms)=>{delays.push(ms);return 1},clearTimeout(){}};
vm.createContext(ctx);vm.runInContext(schedule+';_wsScheduleReconnect();_wsScheduleReconnect(null);_wsScheduleReconnect(0);',ctx);assert.deepEqual(delays,[1000,2000,0]);
assert.match(ws,/_wsScheduleReconnect\(\);/);assert.doesNotMatch(ws,/_wsScheduleReconnect\(options\.reconnectDelayMs\)/);assert.match(ws,/_wsResumeGraceUntil = now \+ 12000/);
console.log('PASS: body deadline, timeout/no mutation retry, one network retry, shared restart deadline, websocket backoff, resume grace');
// A headers-only response whose body stalls must abort at the same deadline.
r=await run(({args})=>({ok:true,status:200,text:()=>new Promise((resolve,reject)=>args[1].signal.addEventListener('abort',()=>{const e=new Error('body deadline');e.name='AbortError';reject(e)},{once:true}))}));
await new Promise(resolve=>setImmediate(resolve));
for(const timer of r.timers.values())timer.fn();
await assert.rejects(r.promise,/timed out/);assert.equal(r.attempts(),1);assert.equal(r.timers.size,0);
console.log('PASS: stalled response body aborts without replay');
