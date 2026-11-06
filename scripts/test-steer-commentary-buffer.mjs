import assert from 'node:assert/strict';
import {appendChatSteerWorkflowSplit} from '../web-ui/src/features/chat/runtime/chat-steer-events.js';
const session={history:[],processLog:[]};const state={streamingAIText:'First visible paragraph',finalResponseStarted:true,liveTraceEntries:[{type:'reasoning_summary',text:'Summary1',extra:{source:'reasoning_summary',visibility:'summary'}}],currentTurnStartIndex:0};
const split=(n)=>appendChatSteerWorkflowSplit({sessionId:'dummy',steerText:'steer'+n,data:{messageId:'steer'+n,beforeMessageId:'before'+n,workflowGroupId:'chat_steer_'+n},getSession:()=>session,getStreamState:()=>state,workflowGroupIds:()=>[],addProcessEntry:()=>{}});
split(1);assert.equal(state.streamingAIText,'');assert.equal(state.finalResponseStarted,false);assert.equal(session.history[0].liveTraceEntries.filter(e=>e.text==='First visible paragraph').length,1);
state.streamingAIText='Second paragraph';state.finalResponseStarted=true;state.liveTraceEntries=[{type:'reasoning_summary',text:'Summary2',extra:{source:'reasoning_summary',visibility:'summary'}}];
split(2);assert.equal(state.streamingAIText,'');assert.equal(session.history[2].liveTraceEntries.filter(e=>e.text==='Second paragraph').length,1);assert(session.history[2].liveTraceEntries.some(e=>e.text==='Summary2'));
state.streamingAIText='New continuation';split(2);assert.equal(state.streamingAIText,'New continuation','duplicate steer delivery must not consume current text');assert.equal(session.history.length,4);
// Duplicate apply of the same steer event (history sync/replay) must not duplicate rows or captured text.
{
  const before=session.history.length;const commentaryBefore=session.history[2].liveTraceEntries.length;
  state.streamingAIText='Replay text';split(2);
  assert.equal(session.history.length,before,'duplicate steer must not add rows');
  assert.equal(session.history[2].liveTraceEntries.length,commentaryBefore,'duplicate steer must not add trace entries');
  assert.equal(state.streamingAIText,'Replay text','duplicate steer must not consume current text');
  const ids=session.history[2].liveTraceEntries.map(e=>e.id);assert.equal(new Set(ids).size,ids.length);
}
console.log('real desktop steer splitter captures unflushed commentary once, preserves summaries, resets continuation PASS');
