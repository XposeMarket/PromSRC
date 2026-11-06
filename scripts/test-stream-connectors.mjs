import assert from 'node:assert/strict';
import fs from 'node:fs';
import { foldMobileReasoningSummaryGroups as fold, mobileReasoningSummaryTitle as title } from '../web-ui/src/mobile/mobile-reasoning-summary-fold.js';
const mobile=fs.readFileSync('web-ui/src/mobile/mobile-chat-renderer-runtime.js','utf8');
const desktop=fs.readFileSync('web-ui/src/pages/ChatPage.js','utf8');
function extract(s,start,end){const a=s.indexOf(start),b=s.indexOf(end,a);assert(a>=0&&b>a);return s.slice(a,b);}
const classify=e=>['preamble','reasoning_summary'].includes(e.type);
const kind=e=>e.type==='reasoning_summary'?'summary':'full_thought';
const key=(g,i)=>g.entries[0]?.id||`g${i}`;
const mobileGroup=new Function('_mobileVisibleTraceEntries','_isMobileTraceCompactionEntry','_renderMobileLiveTracePreview','_isMobileTraceThoughtEntry','_mobileTraceThoughtKind','_mobileTraceGroupStableKey',extract(mobile,'  function _mobileTraceGroups(entries) {','  function _mobileTraceHasToolGroup(')+'return _mobileTraceGroups;')(x=>x,()=>false,()=>'',classify,kind,key);
const desktopGroup=new Function('visibleLiveTraceEntries','isLiveTraceCompactionEntry','renderLiveTracePreview','isLiveTraceThoughtEntry','desktopTraceThoughtKind','liveTraceGroupStableKey',extract(desktop,'function liveTraceGroups(entries) {','function liveTraceHasToolGroup(')+'return liveTraceGroups;')(x=>x,()=>false,()=>'',classify,kind,key);
const p=id=>({id,type:'preamble',text:'Public commentary',extra:{source:'agent_thought',visibility:'user'}});
const r=(id,text)=>({id,type:'reasoning_summary',text,extra:{source:'reasoning_summary',visibility:'summary'}});
const t=id=>({id,type:'tool',text:id,activity:{kind:'operation',callId:id}});
for(const [surface,group] of [['mobile',mobileGroup],['desktop',desktopGroup]]){
  for(const streaming of [true,false]){
    const entries=[p('p1'),t('t1'),r('r1','**Read**'),t('t2'),r('r2','**Checked**'),t('t3')];
    const before=fold(group(entries.slice(0,2)),{streaming});
    const result=fold(group(entries),{streaming});
    assert.equal(result.filter(g=>g.kind==='tools').length,1,surface);
    assert.equal(result.some(g=>g.kind==='reasoning-live'),false);
    const tools=result.find(g=>g.kind==='tools');
    assert.equal(tools.id,before.find(g=>g.kind==='tools').id);
    assert.equal(tools.entries.length,3);assert.equal(title(tools.reasoningEntries),'Checked');
    const next=fold(group([...entries,p('p2'),t('t4'),r('r3','**Next**')]),{streaming});
    assert.equal(next.filter(g=>g.kind==='tools').length,2,surface+' commentary is the boundary');
    assert.equal(title(next.filter(g=>g.kind==='tools')[0].reasoningEntries),'Checked');
    assert.equal(title(next.filter(g=>g.kind==='tools')[1].reasoningEntries),'Next');
  }
  console.log(surface+': actual grouping + shared header reducer PASS');
}
{
  // Summary->tools promotion keeps tool-group fields and the stable phase id/reasoning header.
  const promoted=fold([{kind:'thought-summary',id:'s0',entries:[r('r1','**Read**')]},{kind:'tools',id:'tg1',entries:[t('t1')],status:'running',live:true,extra:{k:1}}],{streaming:true});
  const pt=promoted.find(g=>g.kind==='tools');
  assert.equal(pt.status,'running');assert.equal(pt.live,true);assert.deepEqual(pt.extra,{k:1});
  assert.equal(pt.id.startsWith('reasoning_phase_'),true);assert.equal(title(pt.reasoningEntries),'Read');assert.equal(pt.entries.length,1);
  // Non-streaming trailing summary after a boundary is static thought-summary, never live thinking.
  const restored=fold([{kind:'commentary',id:'c',entries:[p('p1')]},{kind:'thought-summary',id:'s',entries:[r('r1','**Read**')]}],{streaming:false});
  assert.equal(restored.some(g=>g.kind==='reasoning-live'),false);
  assert.equal(restored[restored.length-1].kind,'thought-summary');
  const live=fold([{kind:'commentary',id:'c',entries:[p('p1')]},{kind:'thought-summary',id:'s',entries:[r('r1','**Read**')]}],{streaming:true});
  assert.equal(live[live.length-1].kind,'reasoning-live');
  console.log('promotion field preservation + static trailing summary PASS');
}
console.log('stream grouping contracts PASS');

// The extracted label helper keeps the legacy desktop selection and normalization.
const {desktopTraceProgressSummary,liveTraceSummaryKey}=await import('../web-ui/src/features/chat/trace-summary-presentation.js');
const normalize=text=>String(text).replace('duplicate duplicate','duplicate');
assert.equal(desktopTraceProgressSummary([{text:'older',extra:{source:'agent_progress'}},{text:'ignored',extra:{source:'agent_thought'}},{text:' duplicate duplicate  latest ',extra:{source:'agent_progress'}}],normalize),'duplicate latest');
assert.equal(desktopTraceProgressSummary([],normalize),'');
assert.equal(desktopTraceProgressSummary([{text:'x'.repeat(240),extra:{source:'agent_progress'}}],normalize).length,220);
assert.equal(liveTraceSummaryKey('  Mixed\n CASE  '),'mixed case');
console.log('extracted desktop summary presentation PASS');
