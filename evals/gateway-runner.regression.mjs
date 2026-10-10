import assert from 'node:assert/strict';
import { parseRoute, inside, sseParser, summarize, runTurn } from './run-gateway-evals.mjs';
assert.deepEqual(parseRoute('openai_codex:gpt-6.1-sol:low'), { providerId:'openai_codex', model:'gpt-6.1-sol', reasoningEffort:'low' });
assert.deepEqual(parseRoute('ollama:qwen3.5:9b'), { providerId:'ollama', model:'qwen3.5:9b' });
assert.throws(()=>parseRoute('anthropic:claude')); assert.throws(()=>parseRoute('bad'));
assert.equal(inside('/tmp/run','/tmp/run/src'),true); assert.equal(inside('/tmp/run','/tmp/run-other'),false); assert.equal(inside('/tmp/run','/tmp/run/../escape'),false); assert.equal(inside('/tmp/run','/tmp/run'),false);
const events=[]; const parser=sseParser(e=>events.push(e));
for (const chunk of ['data: {"type":"to','ken",\r','\n','data: "text":"ok"}\r\n\r','\ndata: bad\n\ndata: {"type":"done"}']) parser.push(chunk);
parser.end(); assert.deepEqual(events,[{type:'token',text:'ok'},{type:'done'}]);
const stats=summarize([{model:'m',status:'pass',elapsedMs:10},{model:'m',status:'blocked',elapsedMs:30}]).m;
assert.equal(stats.medianMs,20);assert.equal(stats.runs,2);assert.equal(stats.blocked,1);assert.equal(stats.passRate,.5);
async function check(reason, mode) {
  const calls=[];
  const api=async(method,url,body)=>{ calls.push({method,url,body}); return method==='GET' ? url.endsWith('stop-targets') ? {success:true,targets:[]} : {approvals:mode==='approval'?[{sessionId:'eval_test',status:'pending'}]:[]} : {success:true}; };
  const fetchImpl=async(_url,options)=> {
    if(mode==='fetch-error') throw new Error('network');
    return {ok:true,headers:new Headers(),body:new ReadableStream({ start(c) { options.signal.addEventListener('abort',()=>c.error(new Error('abort'))); } })};
  };
  const r=await runTurn({gateway:'http://localhost',sessionId:'eval_test',message:'test',timeoutMs:30,pollMs:5,api,fetchImpl});
  assert.equal(r.error,reason);assert.equal(r.stop.success,true);
  assert.equal(calls.filter(c=>c.method==='POST').length,1);
  assert.equal(calls.find(c=>c.method==='POST').url,'/api/mobile/commands/stop-now');
  assert.equal(calls.find(c=>c.method==='POST').body.sessionId,'eval_test');
  assert.ok(calls.every(c=>!/(approve|deny)$/.test(c.url)));
}
await check('timeout','timeout'); await check('pending_user_approval','approval'); await check('network','fetch-error');
const completed=await runTurn({gateway:'http://localhost',sessionId:'eval_done',message:'test',timeoutMs:100,api:async()=>({approvals:[]}),fetchImpl:async()=>new Response('data: {"type":"tool_result","action":"workspace_read"}\n\ndata: {"type":"done","reply":"7"}\n\n')});
assert.equal(completed.error,''); assert.equal(completed.text,'7'); assert.equal(completed.toolResults.length,1);
console.log('PASS gateway runner: routing, path boundaries, fragmented CRLF/multiline/EOF SSE, timeout/fetch cleanup, pending user gates, metrics');
