import assert from 'node:assert/strict';
import { OpenAICodexAdapter } from './openai-codex-adapter';
import { PROMPT_CACHE_MARKER } from './LLMProvider';
import { OllamaClient } from '../agents/ollama-client';
import { runInTrace } from '../gateway/observability/turn-trace';
async function main() {
 const adapter = new OpenAICodexAdapter(process.cwd());
 (adapter as any).getHeaders = async () => ({'Content-Type':'application/json'});
 const original = globalThis.fetch;
 const requests: any[] = [];
 globalThis.fetch = (async (_url: any, init: any) => {
  requests.push({body:JSON.parse(init.body), headers:init.headers});
  return new Response('data: '+JSON.stringify({type:'response.completed',response:{output:[{type:'message',content:[{type:'output_text',text:'OK'}]}],usage:{input_tokens:5000,output_tokens:1,input_tokens_details:{cached_tokens:4096}}}})+'\n\n',{status:200});
 }) as typeof fetch;
 try {
  const messages = (tail:string): any[] => [{role:'system',content:'Stable policy'+PROMPT_CACHE_MARKER+tail},{role:'user',content:'Earlier question'},{role:'assistant',content:'Earlier answer'},{role:'user',content:[{type:'text',text:'Current question'},{type:'image_url',image_url:{url:'data:image/png;base64,AAAA'}}]}];
  const a=messages('Now Monday'), b=messages('Now Tuesday'), originalMessages=JSON.stringify(a);
  const result=await adapter.chat(a,'gpt-5.4-mini',{think:'low',sessionId:'session-a'});
  await adapter.chat(b,'gpt-5.4-mini',{think:'low',sessionId:'session-a'});
  assert.equal(requests[0].body.instructions,requests[1].body.instructions,'volatile context must not change instructions');
  assert.equal(requests[0].body.instructions,'Stable policy');
  assert.equal(requests[0].body.prompt_cache_key,requests[1].body.prompt_cache_key);
  assert.match(requests[0].body.prompt_cache_key,/^prom-[a-f0-9]{48}$/);
  assert.equal(requests[0].headers['session_id'],requests[0].body.prompt_cache_key);
  assert.equal(result.usage?.cacheReadTokens,4096);
  assert.equal(JSON.stringify(a),originalMessages,'no input mutation');
  const input=requests[0].body.input;
  assert.equal(input.at(-2).role,'developer');assert.equal(input.at(-2).content,'Now Monday');
  assert.equal(input.at(-1).content[1].type,'input_image');
  assert.deepEqual(input.slice(0,-2),requests[1].body.input.slice(0,-2),'history prefix unchanged');
  await adapter.chat([{role:'system',content:'Stable policy'+PROMPT_CACHE_MARKER+'No user context'},{role:'assistant',content:'Only assistant'}],'gpt-5.4-mini');
  assert.equal(requests[2].body.instructions,'Stable policy\n\nNo user context','no latest user must preserve context inline');
  await adapter.chat([{role:'system',content:'Unmarked policy'},{role:'user',content:'Hi'}],'gpt-5.4-mini');
  assert.equal(requests[3].body.instructions,'Unmarked policy');assert.equal(requests[3].body.input.length,1);
  assert.notEqual(requests[0].body.prompt_cache_key,requests[3].body.prompt_cache_key);
  await adapter.chat([...messages('Tool context'),{role:'assistant',content:'',tool_calls:[{id:'call-1',type:'function',function:{name:'lookup',arguments:{}}}]},{role:'tool',tool_call_id:'call-1',content:'Tool output'}] as any,'gpt-5.4-mini');
  assert.deepEqual(requests[4].body.input.slice(-2).map((x:any)=>x.type),['function_call','function_call_output']);
  assert.ok(!JSON.stringify(requests).includes(PROMPT_CACHE_MARKER));
  await adapter.chat(messages('Now Monday'),'gpt-5.4-mini',{sessionId:'session-b'});
  assert.notEqual(requests.at(-1).body.prompt_cache_key,requests[0].body.prompt_cache_key,'session isolation');
  requests.pop();
  (adapter as any).getHeaders = async () => ({'Content-Type':'application/json','ChatGPT-Account-ID':'other-account'});
  await adapter.chat(messages('Now Monday'),'gpt-5.4-mini',{sessionId:'session-a'});
  assert.notEqual(requests[5].body.prompt_cache_key,requests[0].body.prompt_cache_key,'account isolation');
  await adapter.chat(messages('Now Monday'),'gpt-5.4',{sessionId:'session-a'});
  assert.notEqual(requests[6].body.prompt_cache_key,requests[5].body.prompt_cache_key,'model isolation');
  await adapter.chat([{role:'system',content:PROMPT_CACHE_MARKER+'Only volatile'},{role:'user',content:'Hi'}],'gpt-5.4-mini');
  assert.equal(requests[7].body.instructions,'Only volatile');assert.equal(requests[7].body.input.length,1);
  await adapter.chat([{role:'system',content:'Changed tools, memory and date'}, {role:'user',content:'Hi'}], 'gpt-5.4-mini', {sessionId:'session-a'});
  assert.equal(requests.at(-1).body.prompt_cache_key,requests[5].body.prompt_cache_key,'system changes must never churn session affinity');
  await adapter.chat(messages('anonymous one'),'gpt-5.4-mini');
  await adapter.chat(messages('anonymous two'),'gpt-5.4-mini');
  assert.notEqual(requests.at(-1).body.prompt_cache_key,requests.at(-2).body.prompt_cache_key,'anonymous calls must not share affinity');

  const received: any[] = [];
  const fake = {id:'__cache_test__',chat:async (_m:any,_model:any,o:any)=>{received.push(o.sessionId);return {};}} as any;
  const client = new OllamaClient();
  await runInTrace({sessionId:'traced-session'},()=>client.callProviderChatRaw(fake,[],'m'));
  await client.callProviderChatRaw(fake,[],'m',{usageContext:{sessionId:'usage-session'}});
  for (const sessionId of ['background_run-a','team_member-a','subagent_task-a','cron_job-run-a']) {
    await runInTrace({sessionId}, async () => {
      await client.callProviderChatRaw(fake,[],'m');
      await client.callProviderChatRaw(fake,[],'m');
    });
  }
  await runInTrace({sessionId:'parent'},()=>client.callProviderChatRaw(fake,[],'m',{sessionId:'explicit-child'}));
  assert.deepEqual(received,['traced-session','usage-session','background_run-a','background_run-a','team_member-a','team_member-a','subagent_task-a','subagent_task-a','cron_job-run-a','cron_job-run-a','explicit-child']);
  console.log('PASS captured HTTP: stable instructions/key, volatile developer tail, no mutation, images/tool ordering, missing-marker/user fallback, cached-token usage');
 } finally {globalThis.fetch=original;}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
