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
console.log('stream grouping contracts PASS');
