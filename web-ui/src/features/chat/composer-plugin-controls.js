import {getConnectorLogoUrl} from '../connectors/connector-logo-runtime.js';

export function pluginLabel(item, esc) {
  const src = getConnectorLogoUrl(item.pluginId);
  return `<span class="composer-plugin-label" style="display:inline-flex;align-items:center;gap:.3em">${src ? `<span aria-hidden="true" style="width:1em;height:1em;background:currentColor;mask:url('${src}') center/contain no-repeat"></span>` : '<span aria-hidden="true">◇</span>'}${esc(item.label)}</span>`;
}

export function installComposerControls(tag, commands, request, advanced, refresh) {
  if (customElements.get(tag)) return;
  let updated = 0, pending;
  function catalog() {
    if (pending || Date.now()-updated < 30000) return;
    pending = request('/api/chat/plugin-references').then(({plugins})=>{
      const rows = (plugins || []).filter(p=>/^[a-z0-9][a-z0-9_-]{0,63}$/.test(p.id)).map(p=>({command:`/${p.id}`,pluginId:p.id,label:String(p.title)}));
      const base = commands.filter(c=>!c.pluginId);
      commands.splice(0,commands.length,...base,...rows.filter(r=>!base.some(b=>b.command===r.command)));
      updated = Date.now(); refresh?.();
    }).catch(()=>{}).finally(()=>{pending=null;});
  }
  customElements.define(tag,class extends HTMLElement {
    connectedCallback() {
      if (this.button) return;
      const root=this.attachShadow({mode:'open'});
      root.innerHTML=`<style>:host{display:inline-flex;align-items:center}button{font:inherit;color:inherit;cursor:pointer}#trigger{border:0;background:transparent;font-size:12px;color:inherit;white-space:nowrap;padding:5px}dialog{color:var(--text,CanvasText);background:var(--surface,Canvas);border:1px solid color-mix(in srgb,currentColor 22%,transparent);border-radius:12px;padding:14px;width:min(280px,80vw);box-shadow:0 8px 35px #0005}dialog::backdrop{background:#0004}p{font-size:12px;margin:6px 0 12px}dialog button{display:block;width:100%;padding:9px 10px;border:0;border-radius:6px;text-align:left;background:transparent}dialog button[aria-pressed=true],dialog button:hover{background:color-mix(in srgb,currentColor 10%,transparent)}button:disabled{opacity:.6}</style><button id="trigger" type="button" aria-haspopup="dialog">♢ Permissions</button><dialog aria-label="Composer permissions"><strong>Permissions</strong><p>Applies to all chats on this installation.</p><button data-mode="default">Default Permissions</button><button data-mode="lite">Lite Permissions</button><p>Lite skips routine approval prompts. Explicit approvals still apply.</p><button id="advanced">Advanced → Security settings</button><button id="close">Close</button><small role="status"></small></dialog>`;
      const dialog=root.querySelector('dialog'), modes=[...root.querySelectorAll('[data-mode]')], status=root.querySelector('[role=status]');
      const show=mode=>{ this.button.textContent=mode==='lite'?'♢ Lite Permissions':'♢ Default Permissions'; modes.forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.mode===mode))); };
      let revision=0;
      const read=async()=>{const token=++revision; modes.forEach(b=>b.disabled=true); try{const data=await request('/api/settings/security'); if(token!==revision)return; if(!['default','lite'].includes(data.toolPermissionMode)) throw Error(); show(data.toolPermissionMode);status.textContent='';modes.forEach(b=>b.disabled=false);}catch{if(token===revision){status.textContent='Could not load permissions. Reopen to retry.';this.button.textContent='♢ Permissions';}}};
      this.button=root.querySelector('#trigger'); this.button.onclick=()=>{dialog.showModal();read();};
      modes.forEach(b=>b.onclick=async()=>{++revision;modes.forEach(x=>x.disabled=true); try{const data=await request('/api/settings/security',{method:'POST',body:JSON.stringify({toolPermissionMode:b.dataset.mode})});if(!data.success||data.toolPermissionMode!==b.dataset.mode)throw Error();show(data.toolPermissionMode);dialog.close();}catch{await read();status.textContent='Change not confirmed. Check the current setting.';}});
      root.querySelector('#close').onclick=()=>dialog.close();root.querySelector('#advanced').onclick=()=>{dialog.close();advanced();};
      this.onFocus=()=>{catalog();if(!dialog.open)read();}; catalog();read();window.addEventListener('focus',this.onFocus);
    }
    disconnectedCallback(){window.removeEventListener('focus',this.onFocus);}
  });
}

export function decoratePluginMarkdown(html,commands,esc) {
  if (!html.includes('/')) return html;
  const plugins=new Map(commands.filter(x=>x.pluginId).map(x=>[x.command,x]));
  if (!plugins.size) return html;
  const tpl=document.createElement('template');tpl.innerHTML=html;
  const walker=document.createTreeWalker(tpl.content,NodeFilter.SHOW_TEXT), nodes=[];
  while(walker.nextNode()) nodes.push(walker.currentNode);
  for(const node of nodes){
    if(node.parentElement?.closest('a,code,pre,button,.pm-inline-command-token'))continue;
    const text=node.textContent;let start=0;const out=document.createDocumentFragment();
    for(const match of text.matchAll(/(^|\s)(\/[a-z0-9][a-z0-9_-]{0,63})(?=\s|$)/gi)){
      const plugin=plugins.get(match[2].toLowerCase());if(!plugin)continue;
      out.append(text.slice(start,match.index+match[1].length));const chip=document.createElement('span');chip.className='pm-inline-command-token';chip.innerHTML=pluginLabel(plugin,esc);out.append(chip);start=match.index+match[0].length;
    }
    if(start){out.append(text.slice(start));node.replaceWith(out);}
  }
  return tpl.innerHTML;
}
