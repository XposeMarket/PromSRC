import {colorLogoStyle, getConnectorLogoUrl} from '../connectors/connector-logo-runtime.js';

const shieldPath = 'm12 3 8 3v6c0 4-4 7.5-8 9-4-1.5-8-5-8-9V6z';
function shield(mode) {
  const lite = mode === 'lite';
  return `<svg class="shield ${lite ? 'lite' : 'outline'}" aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" stroke-linejoin="round"><path d="${shieldPath}" fill="${lite ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="${lite ? 2.5 : 1.7}"/></svg>`;
}


export function pluginLabel(item, esc) {
  const src = getConnectorLogoUrl(item.pluginId);
  return `<span class="composer-plugin-label" style="display:inline-flex;align-items:center;gap:.3em">${src ? `<span aria-hidden="true" style="width:1em;height:1em;background:currentColor;mask:url('${src}') center/contain no-repeat${colorLogoStyle(item.pluginId)}"></span>` : '<span aria-hidden="true">◇</span>'}${esc(item.label)}</span>`;
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
      // Follow the adjacent paperclip, including mobile focus, haptic wrapping and theme sizing.
      const attach=this.parentElement?.querySelector('.chat-attach-btn,#pm-attach-btn');
      const glyph=attach?.querySelector('svg');
      if (attach && glyph) {
        this.sizeWatch=new ResizeObserver(()=>{
          for (const [el,prefix] of [[attach,'button'],[glyph,'icon']]) {
            const css=getComputedStyle(el);
            if (parseFloat(css.width)>0 && parseFloat(css.height)>0) {
              this.style.setProperty(`--clip-${prefix}-w`,css.width);
              this.style.setProperty(`--clip-${prefix}-h`,css.height);
            }
          }
        });
        this.sizeWatch.observe(attach,{box:'border-box'});this.sizeWatch.observe(glyph);
      }
      if (this.button) return;
      const root=this.attachShadow({mode:'open'});
      root.innerHTML=`<style>
        :host{display:inline-flex;align-items:center;flex:none}button{font:inherit;color:inherit;cursor:pointer}
        #trigger{box-sizing:border-box;width:var(--clip-button-w,32px);height:var(--clip-button-h,32px);display:grid;place-items:center;border:0;border-radius:8px;background:transparent;color:inherit;padding:0}
        .shield{flex:none;color:#919497}.shield.lite{color:var(--t-accent,var(--brand,Highlight))}#panel button[data-mode]{display:flex;align-items:center;gap:9px}#panel button[data-mode]::after{margin-inline-start:auto}
        #trigger .shield{width:var(--clip-icon-w,15px);height:var(--clip-icon-h,15px)}
        button:hover,button:focus-visible,#trigger[aria-expanded=true],button[aria-pressed=true]{background:color-mix(in srgb,currentColor 12%,transparent)}
        #panel{position:fixed;inset:auto;margin:0;box-sizing:border-box;width:min(248px,calc(100vw - 16px));max-height:80dvh;overflow:auto;color:var(--pm-text,var(--text,CanvasText));background:var(--pm-surface,var(--surface,Canvas));border:1px solid color-mix(in srgb,currentColor 22%,transparent);border-radius:12px;padding:10px;box-shadow:0 8px 30px #0004;font:14px system-ui}
        p{font-size:12px;margin:4px 0 8px}#panel button{display:block;width:100%;padding:9px;border:0;border-radius:6px;text-align:left;background-color:transparent}#panel button[aria-pressed=true]::after{content:'✓';float:right}#panel button:hover{background-color:color-mix(in srgb,currentColor 9%,transparent)}button:disabled{opacity:.6}
      </style><button id="trigger" type="button" aria-label="Permissions" title="Permissions" aria-haspopup="dialog" aria-expanded="false" popovertarget="panel">${shield()}</button>
      <section id="panel" popover="auto" role="dialog" aria-label="Composer permissions"><strong>Permissions</strong><p>Applies to all chats on this installation.</p><button data-mode="default">${shield('default')}Default Permissions</button><button data-mode="lite">${shield('lite')}Lite Permissions</button><button id="advanced">Advanced → Security settings</button><small role="status"></small></section>`;
      this.button=root.querySelector('#trigger');
      const panel=root.querySelector('#panel'), modes=[...root.querySelectorAll('[data-mode]')], status=root.querySelector('[role=status]');
      const label=text=>{this.button.title=text;this.button.setAttribute('aria-label',text);};
      const show=mode=>{this.button.innerHTML=shield(mode);label(mode ? `Permissions: ${mode==='lite'?'Lite':'Default'}` : 'Permissions');modes.forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.mode===mode)));};
      let revision=0;
      const read=async()=>{const token=++revision;modes.forEach(b=>b.disabled=true);try{const data=await request('/api/settings/security');if(token!==revision)return;if(!['default','lite'].includes(data.toolPermissionMode))throw Error();show(data.toolPermissionMode);status.textContent='';modes.forEach(b=>b.disabled=false);}catch{if(token===revision){status.textContent='Could not load permissions. Reopen to retry.';show(null);}}};
      const place=()=>{const r=this.button.getBoundingClientRect();panel.style.left=Math.max(8,Math.min(r.left,innerWidth-panel.offsetWidth-8))+'px';panel.style.top=Math.max(8,r.top-panel.offsetHeight-6)+'px';};
      panel.addEventListener('toggle',()=>{const open=panel.matches(':popover-open');this.button.setAttribute('aria-expanded',String(open));this.positionWatch?.disconnect();if(open){place();this.positionWatch=new ResizeObserver(place);this.positionWatch.observe(panel);read();}});
      modes.forEach(b=>b.onclick=async()=>{++revision;modes.forEach(x=>x.disabled=true);try{const data=await request('/api/settings/security',{method:'POST',body:JSON.stringify({toolPermissionMode:b.dataset.mode})});if(!data.success||data.toolPermissionMode!==b.dataset.mode)throw Error();show(data.toolPermissionMode);panel.hidePopover();}catch{await read();status.textContent='Change not confirmed. Check the current setting.';}});
      root.querySelector('#advanced').onclick=()=>{panel.hidePopover();advanced();};
      this.onFocus=()=>{catalog();if(!panel.matches(':popover-open'))read();};catalog();read();window.addEventListener('focus',this.onFocus);
    }
    disconnectedCallback(){this.sizeWatch?.disconnect();this.positionWatch?.disconnect();window.removeEventListener('focus',this.onFocus);}
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
