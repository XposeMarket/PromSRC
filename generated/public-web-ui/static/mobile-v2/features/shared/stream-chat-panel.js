import { renderMd } from '../../../utils.js';
import { ensureMobileV2Markdown } from '../../core/markdown.js';
import { escapeHtml, normalizeText } from '../../ui/page-kit.js';

function roleOf(row){return String(row?.role||row?.senderRole||row?.authorRole||'assistant').toLowerCase()==='user'?'user':'assistant';}
function renderPanelText(row){
  const text=normalizeText(row)||row?.summary||'';
  if(roleOf(row)==='user')return escapeHtml(text).replace(/\n/g,'<br>');
  try{return renderMd(String(text));}catch{return escapeHtml(text).replace(/\n/g,'<br>');}
}

export function mountStreamChatPanel({ host, loadMessages, streamMessage, placeholder='Message…', emptyLabel='Start a conversation.' }){
  let rows=[]; let controller=null; let disposed=false;

  function paint(){
    if(disposed)return;
    host.innerHTML=`<div class="pm-v2-mini-chat"><div class="pm-chat-thread pm-v2-mini-chat-thread">${rows.length?rows.map((row)=>`<div class="pm-msg ${roleOf(row)==='user'?'from-user':'from-ai'}"><div class="pm-bubble"><div class="markdown-body">${renderPanelText(row)}</div></div></div>`).join(''):`<div class="pm-v2-empty"><span>${escapeHtml(emptyLabel)}</span></div>`}</div><form class="pm-composer pm-v2-mini-composer"><div class="pm-composer-row"><div class="pm-v2-input-wrap"><textarea rows="1" placeholder="${escapeHtml(placeholder)}"></textarea></div><button class="pm-send" type="submit" aria-label="Send">↑</button></div></form></div>`;
    const thread=host.querySelector('.pm-v2-mini-chat-thread'); if(thread)thread.scrollTop=thread.scrollHeight;
    host.querySelector('form')?.addEventListener('submit',send);
  }

  async function hydrate(){
    host.innerHTML='<div class="pm-v2-page-loading">Loading conversation…</div>';
    try{rows=await loadMessages(); paint();}catch(error){host.innerHTML=`<div class="pm-v2-error-card"><span>${escapeHtml(error?.message||'Could not load conversation.')}</span></div>`;}
  }

  async function send(event){
    event.preventDefault(); const input=event.currentTarget.querySelector('textarea'); const text=input.value.trim(); if(!text||controller)return;
    input.value=''; rows.push({role:'user',text}); const assistant={role:'assistant',text:''}; rows.push(assistant); paint(); controller=new AbortController();
    try{
      await streamMessage(text,{signal:controller.signal,onEvent:(event)=>{
        if(event.type==='assistant.delta') assistant.text+=event.text||'';
        else if(event.type==='assistant.done'&&event.text&&!assistant.text) assistant.text=event.text;
        else if(event.type==='reasoning.summary.delta') assistant.reasoning=(assistant.reasoning||'')+(event.text||'');
        else if(event.type==='tool.activity') assistant.toolStatus=`${event.name}${event.message?`: ${event.message}`:''}`;
        paint();
      }});
    }catch(error){if(error?.name!=='AbortError')assistant.text+=(assistant.text?'\n\n':'')+`Error: ${error?.message||error}`;}finally{controller=null;paint();}
  }

  hydrate();
  ensureMobileV2Markdown().then((ready)=>{if(ready&&!disposed)paint();});
  return()=>{disposed=true;controller?.abort();};
}
