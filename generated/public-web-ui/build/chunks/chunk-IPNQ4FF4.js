function h(r){return r?String(r).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"):""}var ee=h;function F(r){let e=Date.now()-r;return e<6e4?"just now":e<36e5?`${Math.floor(e/6e4)}m ago`:e<864e5?`${Math.floor(e/36e5)}h ago`:`${Math.floor(e/864e5)}d ago`}function P(r,e=0){let n=Number(r);return Number.isFinite(n)?`${n.toFixed(e)}%`:"--%"}function R(r,e){let n=Number(r),t=Number(e);return!Number.isFinite(n)||!Number.isFinite(t)||t<=0?"-- / -- GB":`${n.toFixed(1)} / ${t.toFixed(1)} GB`}function E(r){let e=Number(r);return Number.isFinite(e)?`${Math.max(0,Math.min(100,e))}%`:"0%"}function O(r,e){let n=document.getElementById(r);n&&(n.textContent=String(e||""))}function D(r,e){let n=document.getElementById(r);n&&(n.style.width=E(e))}function M(r,e,n="info",t=5e3,o={}){let i=typeof o?.key=="string"?o.key.trim():"";if(i)for(let u of document.querySelectorAll(".__sc-toast"))u.dataset.scToastKey===i&&u.remove();let a=n==="warn"?"warning":["info","success","error","warning"].includes(n)?n:"info",l={info:"\u2139\uFE0F",success:"\u2713",error:"\u26A0\uFE0F",warning:"\u26A0\uFE0F"},s=document.createElement("div"),c=24+[...document.querySelectorAll(".__sc-toast")].reduce((u,v)=>u+v.offsetHeight+8,0);if(s.className=`__sc-toast __sc-toast--${a}`,i&&(s.dataset.scToastKey=i),s.style.cssText=`position:fixed;bottom:${c}px;right:24px;z-index:99999;`,s.innerHTML=`
    <span class="__sc-toast-icon" aria-hidden="true">${l[a]}</span>
    <div class="__sc-toast-copy">
      <div class="__sc-toast-title">${h(r)}</div>
      ${e?`<div class="__sc-toast-body">${h(String(e))}</div>`:""}
    </div>
    <button class="__sc-toast-close" type="button" aria-label="Dismiss">&times;</button>
  `,!document.getElementById("__sc-toast-style")){let u=document.createElement("style");u.id="__sc-toast-style",u.textContent="@keyframes scToastIn{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}",document.head.appendChild(u)}document.body.appendChild(s);let d=Math.max(0,Math.min(5e3,Number.isFinite(Number(t))?Number(t):5e3));setTimeout(()=>{s.style.transition="opacity 0.3s",s.style.opacity="0",setTimeout(()=>s.remove(),300)},d),s.querySelector(".__sc-toast-close")?.addEventListener("click",()=>s.remove())}function H(r,e){M(r,e,"info")}function q(r,e,n,t={}){let{title:o="Confirm",confirmText:i="Confirm",cancelText:a="Cancel",danger:l=!1,details:s=""}=t,m=document.createElement("div");m.style.cssText="position:fixed;inset:0;z-index:99998;background:rgba(0,0,0,0.35);display:flex;align-items:center;justify-content:center;animation:scToastIn 0.15s ease";let c=document.createElement("div");c.style.cssText="background:var(--panel);border:1.5px solid var(--line);border-radius:14px;padding:24px 24px 18px;max-width:560px;width:92%;box-shadow:0 8px 40px rgba(0,0,0,0.18);font-family:var(--font)",c.innerHTML=`
    <div style="font-size:15px;font-weight:800;margin-bottom:10px">${h(o)}</div>
    <div style="font-size:13px;color:var(--muted);line-height:1.6;margin-bottom:18px">${h(r)}</div>
    ${s?`<pre style="margin:0 0 18px;padding:12px 14px;border-radius:10px;border:1px solid var(--line);background:var(--panel-2);font-size:11px;line-height:1.65;color:var(--text);white-space:pre-wrap;word-break:break-word;font-family:'Cascadia Code','Fira Code','Consolas',monospace">${h(s)}</pre>`:""}
    <div style="display:flex;gap:8px;justify-content:flex-end">
      <button id="__sc-confirm-cancel" style="border:1px solid var(--line);background:var(--panel-2);color:var(--muted);border-radius:8px;padding:7px 16px;font-size:12px;font-weight:700;cursor:pointer">${h(a)}</button>
      <button id="__sc-confirm-ok" style="border:none;background:${l?"#dc2626":"var(--brand)"};color:#fff;border-radius:8px;padding:7px 16px;font-size:12px;font-weight:700;cursor:pointer">${h(i)}</button>
    </div>
  `,m.appendChild(c),document.body.appendChild(m);let d=()=>m.remove();c.querySelector("#__sc-confirm-cancel").onclick=()=>{d(),n&&n()},c.querySelector("#__sc-confirm-ok").onclick=()=>{d(),e&&e()},m.addEventListener("click",u=>{u.target===m&&(d(),n&&n())})}var b=[];function j(r,e="log"){let n=new Date().toLocaleTimeString();b.push({text:`[${n}] ${String(r??"")}`,type:String(e||"log").replace(/[^a-z0-9_-]/gi,"")||"log"}),b.length>100&&b.shift();let t=document.getElementById("log-panel");t&&(t.replaceChildren(...b.map(o=>{let i=document.createElement("div");return i.className=`log-line ${o.type}`,i.textContent=o.text,i})),t.scrollTop=t.scrollHeight)}var p=Object.freeze({bg:"transparent",bgSoft:"transparent",surface:"transparent",surfaceSecondary:"transparent",border:"currentColor",borderStrong:"currentColor",text:"currentColor",muted:"currentColor",accent:"currentColor",accentStrong:"currentColor",success:"currentColor",warning:"currentColor",danger:"currentColor"});function B(r,e){return String(r||"").replace(/[<>{};\r\n]/g,"").trim()||e}function k(){let r=document.documentElement,e=typeof getComputedStyle=="function"?getComputedStyle(r):null,n=(o,i)=>{for(let a of o){let l=e?.getPropertyValue(a)?.trim();if(l)return B(l,i)}return i},t={isDark:r.getAttribute("data-theme")==="dark",bg:n(["--bg","--pm-chat-page-bg"],p.bg),bgSoft:n(["--bg-soft"],p.bgSoft),surface:n(["--panel","--composer-panel"],p.surface),surfaceSecondary:n(["--panel-2","--composer-bg"],p.surfaceSecondary),border:n(["--line","--composer-border"],p.border),borderStrong:n(["--line-strong"],p.borderStrong),text:n(["--text","--fg","--composer-text"],p.text),muted:n(["--muted","--composer-muted"],p.muted),accent:n(["--brand","--pm-custom-accent"],p.accent),accentStrong:n(["--brand-2"],p.accentStrong),success:n(["--ok"],p.success),warning:n(["--warn"],p.warning),danger:n(["--err"],p.danger)};return t.series=[t.accent,t.accentStrong,t.success,t.warning,t.danger,t.muted],t.vars={"--prom-bg":t.bg,"--prom-bg-soft":t.bgSoft,"--prom-surface":t.surface,"--prom-surface-secondary":t.surfaceSecondary,"--prom-border":t.border,"--prom-border-strong":t.borderStrong,"--prom-text":t.text,"--prom-muted":t.muted,"--prom-accent":t.accent,"--prom-accent-strong":t.accentStrong,"--prom-success":t.success,"--prom-warning":t.warning,"--prom-danger":t.danger,"--prom-series-1":t.series[0],"--prom-series-2":t.series[1],"--prom-series-3":t.series[2],"--prom-series-4":t.series[3],"--prom-series-5":t.series[4],"--prom-series-6":t.series[5],"--bg":t.bg,"--bg-soft":t.bgSoft,"--panel":t.surface,"--panel-2":t.surfaceSecondary,"--line":t.border,"--line-strong":t.borderStrong,"--text":t.text,"--fg":t.text,"--muted":t.muted,"--brand":t.accent,"--brand-2":t.accentStrong,"--ok":t.success,"--warn":t.warning,"--err":t.danger},t}function Y(r){if(r&&typeof r=="object"&&r.vars)return r;let e={isDark:typeof r=="boolean"?r:!!r?.isDark,...p};return e.series=[e.accent,e.accentStrong,e.success,e.warning,e.danger,e.muted],e.vars=Object.fromEntries([["--prom-bg",e.bg],["--prom-bg-soft",e.bgSoft],["--prom-surface",e.surface],["--prom-surface-secondary",e.surfaceSecondary],["--prom-border",e.border],["--prom-border-strong",e.borderStrong],["--prom-text",e.text],["--prom-muted",e.muted],["--prom-accent",e.accent],["--prom-accent-strong",e.accentStrong],["--prom-success",e.success],["--prom-warning",e.warning],["--prom-danger",e.danger],...e.series.map((n,t)=>[`--prom-series-${t+1}`,n]),["--bg",e.bg],["--bg-soft",e.bgSoft],["--panel",e.surface],["--panel-2",e.surfaceSecondary],["--line",e.border],["--line-strong",e.borderStrong],["--text",e.text],["--fg",e.text],["--muted",e.muted],["--brand",e.accent],["--brand-2",e.accentStrong],["--ok",e.success],["--warn",e.warning],["--err",e.danger]]),e}function U(r){let e=r?.vars&&typeof r.vars=="object"?r.vars:{};return Object.entries(e).map(([n,t])=>`${n}:${B(t,"transparent")}`).join(";")}function A(r,e,n){let t=Y(n),o=w({background:"transparent",primaryColor:t.surface,primaryTextColor:t.text,primaryBorderColor:t.borderStrong,lineColor:t.muted,secondaryColor:t.surfaceSecondary,secondaryTextColor:t.text,secondaryBorderColor:t.border,tertiaryColor:t.bgSoft,tertiaryTextColor:t.text,tertiaryBorderColor:t.border,textColor:t.text,mainBkg:t.surface,nodeBorder:t.borderStrong,clusterBkg:t.surfaceSecondary,clusterBorder:t.border,edgeLabelBackground:"transparent"}),i=w({text:t.text,muted:t.muted,border:t.border,series:t.series}),a=`:root{${U(t)}color-scheme:${t.isDark?"dark":"light"}}*{margin:0;padding:0;box-sizing:border-box}html,body{background:transparent!important;color:var(--prom-text);color-scheme:${t.isDark?"dark":"light"};max-width:100%;overflow-x:hidden}body{min-height:0;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}`;return r==="chart"?`<!DOCTYPE html><html><head><meta charset="UTF-8">
<script src="/vendor/chart/chart.umd.js"><\/script>
<style>${a}body{display:flex;align-items:center;justify-content:center;min-height:220px;padding:8px}canvas{width:100%!important;max-width:100%;max-height:100%}</style>
</head><body><canvas id="c"></canvas>
<script>try{const visualTheme=${i};Chart.defaults.color=visualTheme.text;Chart.defaults.borderColor=visualTheme.border;const cfg=(${e});if(cfg.options)cfg.options.responsive=true;else cfg.options={responsive:true};const datasets=cfg.data&&Array.isArray(cfg.data.datasets)?cfg.data.datasets:[];datasets.forEach((dataset,index)=>{const color=visualTheme.series[index%visualTheme.series.length];if(!dataset.backgroundColor)dataset.backgroundColor=color;if(!dataset.borderColor)dataset.borderColor=color;});const chart=new Chart(document.getElementById('c'),cfg);window.addEventListener('prometheus:visual-theme-change',(event)=>{const next=event.detail||{};if(next.text)Chart.defaults.color=next.text;if(next.border)Chart.defaults.borderColor=next.border;chart.update('none');});}catch(e){document.body.innerHTML='<pre style="color:var(--prom-danger);padding:8px;font-size:11px;white-space:pre-wrap">'+e.message+'<\\/pre>';}<\/script>
</body></html>`:r==="svg"?`<!DOCTYPE html><html><head><meta charset="UTF-8">
<style>${a}body{padding:0}.sv-shell{position:relative;min-height:200px;height:200px;overflow:hidden;background:transparent}.sv-viewport{position:absolute;inset:0;cursor:grab;touch-action:none;user-select:none}.sv-viewport.dragging{cursor:grabbing}.sv-stage{position:absolute;left:0;top:0;transform-origin:0 0;will-change:transform}.sv-stage svg{max-width:none!important;height:auto;display:block}.sv-controls{position:absolute;top:10px;right:10px;display:flex;gap:6px;z-index:5;opacity:0;transform:translateY(-4px);pointer-events:none;transition:opacity .2s ease,transform .2s ease}.sv-shell:hover .sv-controls,.sv-shell:focus-within .sv-controls{opacity:1;transform:translateY(0);pointer-events:auto}.sv-btn{border:1px solid var(--prom-border);background:var(--prom-surface);color:var(--prom-text);border-radius:8px;padding:4px 9px;font-weight:700;font-size:12px;line-height:1;cursor:pointer;backdrop-filter:blur(2px)}.sv-btn:hover{filter:brightness(1.08)}.sv-hint{position:absolute;left:10px;bottom:10px;font-size:11px;color:var(--prom-muted);opacity:0;transform:translateY(4px);background:var(--prom-surface);border:1px solid var(--prom-border);border-radius:999px;padding:4px 9px;pointer-events:none;transition:opacity .2s ease,transform .2s ease}.sv-shell:hover .sv-hint,.sv-shell:focus-within .sv-hint{opacity:.82;transform:translateY(0)}</style>
</head><body>
<div class="sv-shell">
  <div class="sv-controls">
    <button class="sv-btn" id="sv-out" type="button">-</button>
    <button class="sv-btn" id="sv-in" type="button">+</button>
    <button class="sv-btn" id="sv-reset" type="button">Reset</button>
  </div>
  <div class="sv-viewport" id="sv-vp">
    <div class="sv-stage" id="sv-stage">${e}</div>
  </div>
  <div class="sv-hint">Pinch to zoom \xB7 Drag to pan</div>
</div>
<script>
(function(){
  const viewport=document.getElementById('sv-vp');
  const stage=document.getElementById('sv-stage');
  const clamp=(v,lo,hi)=>Math.min(hi,Math.max(lo,v));
  let scale=1,tx=0,ty=0,minScale=0.2,maxScale=8;

  function applyTransform(){stage.style.transform='translate('+tx+'px,'+ty+'px) scale('+scale+')';}

  function normalizeSvgSize(){
    const svg=stage.querySelector('svg');if(!svg)return;
    const vb=svg.viewBox&&svg.viewBox.baseVal?svg.viewBox.baseVal:null;
    if(!vb||!vb.width||!vb.height)return;
    const rawW=String(svg.getAttribute('width')||''),rawH=String(svg.getAttribute('height')||'');
    if(!rawW||rawW.includes('%'))svg.setAttribute('width',String(vb.width));
    if(!rawH||rawH.includes('%'))svg.setAttribute('height',String(vb.height));
  }

  function svgBounds(){
    const svg=stage.querySelector('svg');
    if(!svg)return null;
    const w=Number(svg.getAttribute('width'))||(svg.viewBox&&svg.viewBox.baseVal?svg.viewBox.baseVal.width:0)||svg.getBoundingClientRect().width;
    const h=Number(svg.getAttribute('height'))||(svg.viewBox&&svg.viewBox.baseVal?svg.viewBox.baseVal.height:0)||svg.getBoundingClientRect().height;
    if(!Number.isFinite(w)||!Number.isFinite(h)||w<=0||h<=0)return null;
    return{width:w,height:h};
  }

  function fitToViewport(){
    const b=svgBounds();if(!b)return;
    const vw=Math.max(1,viewport.clientWidth),vh=Math.max(1,viewport.clientHeight),pad=28;
    const fit=Math.min((vw-pad)/b.width,(vh-pad)/b.height);
    scale=clamp(Number.isFinite(fit)&&fit>0?fit:1,0.15,2.4);
    minScale=Math.max(0.1,scale*0.35);maxScale=Math.max(2.5,scale*12);
    tx=(vw-b.width*scale)/2;ty=(vh-b.height*scale)/2;applyTransform();
  }

  function zoomAt(ns,cx,cy){
    const ts=clamp(ns,minScale,maxScale);
    if(Math.abs(ts-scale)<0.0001)return;
    const r=viewport.getBoundingClientRect();
    const ox=cx-r.left,oy=cy-r.top;
    const wx=(ox-tx)/scale,wy=(oy-ty)/scale;
    scale=ts;tx=ox-wx*scale;ty=oy-wy*scale;applyTransform();
  }

  viewport.addEventListener('wheel',(e)=>{e.preventDefault();zoomAt(scale*(e.deltaY>0?0.9:1.1),e.clientX,e.clientY);},{passive:false});

  const ptrs=new Map();let lpd=0,lpmx=0,lpmy=0;
  viewport.addEventListener('pointerdown',(e)=>{
    ptrs.set(e.pointerId,{x:e.clientX,y:e.clientY});viewport.setPointerCapture(e.pointerId);
    if(ptrs.size===1)viewport.classList.add('dragging');
    if(ptrs.size===2){
      viewport.classList.remove('dragging');
      const[a,b]=[...ptrs.values()];const dx=b.x-a.x,dy=b.y-a.y;
      lpd=Math.sqrt(dx*dx+dy*dy);lpmx=(a.x+b.x)/2;lpmy=(a.y+b.y)/2;
    }
  });
  viewport.addEventListener('pointermove',(e)=>{
    if(!ptrs.has(e.pointerId))return;
    const old=ptrs.get(e.pointerId);ptrs.set(e.pointerId,{x:e.clientX,y:e.clientY});
    if(ptrs.size===2){
      const[a,b]=[...ptrs.values()];const dx=b.x-a.x,dy=b.y-a.y;
      const d=Math.sqrt(dx*dx+dy*dy),mx=(a.x+b.x)/2,my=(a.y+b.y)/2;
      if(lpd>0){zoomAt(scale*(d/lpd),mx,my);tx+=mx-lpmx;ty+=my-lpmy;applyTransform();}
      lpd=d;lpmx=mx;lpmy=my;
    }else if(ptrs.size===1){tx+=e.clientX-old.x;ty+=e.clientY-old.y;applyTransform();}
  });
  function onUp(e){
    ptrs.delete(e.pointerId);
    if(viewport.hasPointerCapture(e.pointerId))viewport.releasePointerCapture(e.pointerId);
    if(ptrs.size===0)viewport.classList.remove('dragging');
    if(ptrs.size<2)lpd=0;
  }
  viewport.addEventListener('pointerup',onUp);viewport.addEventListener('pointercancel',onUp);

  document.getElementById('sv-in').addEventListener('click',()=>{const r=viewport.getBoundingClientRect();zoomAt(scale*1.18,r.left+r.width/2,r.top+r.height/2);});
  document.getElementById('sv-out').addEventListener('click',()=>{const r=viewport.getBoundingClientRect();zoomAt(scale/1.18,r.left+r.width/2,r.top+r.height/2);});
  document.getElementById('sv-reset').addEventListener('click',fitToViewport);
  window.addEventListener('resize',fitToViewport);
  requestAnimationFrame(()=>{normalizeSvgSize();fitToViewport();setTimeout(fitToViewport,80);});
})();
<\/script>
</body></html>`:r==="mermaid"?`<!DOCTYPE html><html><head><meta charset="UTF-8">
<script src="/vendor/mermaid/mermaid.min.js"><\/script>
<style>${a}body{padding:0}.mm-shell{position:relative;min-height:200px;height:200px;overflow:hidden;background:transparent}.mm-viewport{position:absolute;inset:0;cursor:grab;touch-action:none;user-select:none}.mm-viewport.dragging{cursor:grabbing}.mm-stage{position:absolute;left:0;top:0;transform-origin:0 0;will-change:transform}.mermaid svg{max-width:none!important;height:auto;background:transparent!important}.mermaid{background:transparent!important}.mm-controls{position:absolute;top:10px;right:10px;display:flex;gap:6px;z-index:5;opacity:0;transform:translateY(-4px);pointer-events:none;transition:opacity .2s ease,transform .2s ease}.mm-shell:hover .mm-controls{opacity:1;transform:translateY(0);pointer-events:auto}.mm-btn{border:1px solid var(--prom-border);background:var(--prom-surface);color:var(--prom-text);border-radius:8px;padding:4px 9px;font-weight:700;font-size:12px;line-height:1;cursor:pointer;backdrop-filter:blur(2px)}.mm-btn:hover{filter:brightness(1.08)}.mm-hint{position:absolute;left:10px;bottom:10px;font-size:11px;color:var(--prom-muted);opacity:0;transform:translateY(4px);background:var(--prom-surface);border:1px solid var(--prom-border);border-radius:999px;padding:4px 9px;pointer-events:none;transition:opacity .2s ease,transform .2s ease}.mm-shell:hover .mm-hint{opacity:.82;transform:translateY(0)}</style>
</head><body>
<div class="mm-shell">
  <div class="mm-controls">
    <button class="mm-btn" id="mm-zoom-out" type="button">-</button>
    <button class="mm-btn" id="mm-zoom-in" type="button">+</button>
    <button class="mm-btn" id="mm-reset" type="button">Reset</button>
  </div>
  <div class="mm-viewport" id="mm-viewport">
    <div class="mm-stage" id="mm-stage">
      <div class="mermaid" id="mm-graph">${e.replace(/</g,"&lt;").replace(/>/g,"&gt;")}</div>
    </div>
  </div>
  <div class="mm-hint">Pinch to zoom \xB7 Drag to pan</div>
</div>
<script>
(function(){
  const viewport = document.getElementById('mm-viewport');
  const stage = document.getElementById('mm-stage');
  const graphEl = document.getElementById('mm-graph');
  const mermaidSource = graphEl.textContent || '';
  const baseMermaidThemeVariables = ${o};
  const zoomInBtn = document.getElementById('mm-zoom-in');
  const zoomOutBtn = document.getElementById('mm-zoom-out');
  const resetBtn = document.getElementById('mm-reset');
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  let scale = 1;
  let tx = 0;
  let ty = 0;
  let minScale = 0.2;
  let maxScale = 8;
  function applyTransform() {
    stage.style.transform = 'translate(' + tx + 'px,' + ty + 'px) scale(' + scale + ')';
  }

  function normalizeSvgSize() {
    const svg = stage.querySelector('svg');
    const vb = svg && svg.viewBox && svg.viewBox.baseVal ? svg.viewBox.baseVal : null;
    if (!svg || !vb || !vb.width || !vb.height) return;
    svg.setAttribute('width', String(vb.width));
    svg.setAttribute('height', String(vb.height));
  }

  function graphBounds() {
    const svg = stage.querySelector('svg');
    if (!svg) return null;
    const width = Number(svg.getAttribute('width')) || (svg.viewBox && svg.viewBox.baseVal ? svg.viewBox.baseVal.width : 0) || svg.getBoundingClientRect().width;
    const height = Number(svg.getAttribute('height')) || (svg.viewBox && svg.viewBox.baseVal ? svg.viewBox.baseVal.height : 0) || svg.getBoundingClientRect().height;
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
    return { width, height };
  }

  function fitToViewport() {
    const bounds = graphBounds();
    if (!bounds) return;
    const vw = Math.max(1, viewport.clientWidth);
    const vh = Math.max(1, viewport.clientHeight);
    const padding = 28;
    const fitScale = Math.min((vw - padding) / bounds.width, (vh - padding) / bounds.height);
    scale = clamp(Number.isFinite(fitScale) && fitScale > 0 ? fitScale : 1, 0.15, 2.4);
    minScale = Math.max(0.1, scale * 0.35);
    maxScale = Math.max(2.5, scale * 12);
    tx = (vw - bounds.width * scale) / 2;
    ty = (vh - bounds.height * scale) / 2;
    applyTransform();
  }

  function zoomAt(nextScale, clientX, clientY) {
    const targetScale = clamp(nextScale, minScale, maxScale);
    if (Math.abs(targetScale - scale) < 0.0001) return;
    const rect = viewport.getBoundingClientRect();
    const cx = clientX - rect.left;
    const cy = clientY - rect.top;
    const worldX = (cx - tx) / scale;
    const worldY = (cy - ty) / scale;
    scale = targetScale;
    tx = cx - worldX * scale;
    ty = cy - worldY * scale;
    applyTransform();
  }

  viewport.addEventListener('wheel', (event) => {
    event.preventDefault();
    const direction = event.deltaY > 0 ? 0.9 : 1.1;
    zoomAt(scale * direction, event.clientX, event.clientY);
  }, { passive: false });

  // Multi-pointer: 1-finger pan + 2-finger pinch-to-zoom (works on both touch and mouse)
  const ptrs = new Map();
  let lpd = 0, lpmx = 0, lpmy = 0;

  viewport.addEventListener('pointerdown', (event) => {
    ptrs.set(event.pointerId, { x: event.clientX, y: event.clientY });
    viewport.setPointerCapture(event.pointerId);
    if (ptrs.size === 1) viewport.classList.add('dragging');
    if (ptrs.size === 2) {
      viewport.classList.remove('dragging');
      const [a, b] = [...ptrs.values()];
      const dx = b.x - a.x, dy = b.y - a.y;
      lpd = Math.sqrt(dx * dx + dy * dy);
      lpmx = (a.x + b.x) / 2; lpmy = (a.y + b.y) / 2;
    }
  });

  viewport.addEventListener('pointermove', (event) => {
    if (!ptrs.has(event.pointerId)) return;
    const old = ptrs.get(event.pointerId);
    ptrs.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (ptrs.size === 2) {
      const [a, b] = [...ptrs.values()];
      const dx = b.x - a.x, dy = b.y - a.y;
      const d = Math.sqrt(dx * dx + dy * dy), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      if (lpd > 0) { zoomAt(scale * (d / lpd), mx, my); tx += mx - lpmx; ty += my - lpmy; applyTransform(); }
      lpd = d; lpmx = mx; lpmy = my;
    } else if (ptrs.size === 1) {
      tx += event.clientX - old.x; ty += event.clientY - old.y; applyTransform();
    }
  });

  function onPointerUp(event) {
    ptrs.delete(event.pointerId);
    if (viewport.hasPointerCapture(event.pointerId)) viewport.releasePointerCapture(event.pointerId);
    if (ptrs.size === 0) viewport.classList.remove('dragging');
    if (ptrs.size < 2) lpd = 0;
  }
  viewport.addEventListener('pointerup', onPointerUp);
  viewport.addEventListener('pointercancel', onPointerUp);

  zoomInBtn.addEventListener('click', () => {
    const rect = viewport.getBoundingClientRect();
    zoomAt(scale * 1.18, rect.left + rect.width / 2, rect.top + rect.height / 2);
  });

  zoomOutBtn.addEventListener('click', () => {
    const rect = viewport.getBoundingClientRect();
    zoomAt(scale / 1.18, rect.left + rect.width / 2, rect.top + rect.height / 2);
  });

  resetBtn.addEventListener('click', fitToViewport);
  window.addEventListener('resize', fitToViewport);

  function showRenderError(err) {
    viewport.style.touchAction = 'auto';
    const msg = err && err.message ? err.message : String(err || 'Mermaid render failed');
    stage.innerHTML = '<pre style="color:var(--prom-danger);padding:12px;font-size:11px;white-space:pre-wrap">Mermaid render error: ' + msg + '</pre>';
  }

  function resolveMermaid() {
    return new Promise((resolve, reject) => {
      if (window.mermaid) return resolve(window.mermaid);
      try {
        if (window.parent && window.parent.mermaid) return resolve(window.parent.mermaid);
      } catch {}
      let waited = 0;
      const timer = setInterval(() => {
        if (window.mermaid) {
          clearInterval(timer);
          resolve(window.mermaid);
          return;
        }
        try {
          if (window.parent && window.parent.mermaid) {
            clearInterval(timer);
            resolve(window.parent.mermaid);
            return;
          }
        } catch {}
        waited += 50;
        if (waited >= 3000) {
          clearInterval(timer);
          reject(new Error('Mermaid library unavailable'));
        }
      }, 50);
    });
  }

  resolveMermaid()
    .then((mm) => {
      mm.initialize({startOnLoad:false,theme:'base',securityLevel:'strict',htmlLabels:false,themeVariables:baseMermaidThemeVariables});
      const run = mm.run
        ? mm.run({ querySelector: '#mm-graph' })
        : Promise.resolve(mm.init(undefined, graphEl));
      window.addEventListener('prometheus:visual-theme-change',(event)=>{
        const next=event.detail||{};
        graphEl.textContent=mermaidSource;
        mm.initialize({startOnLoad:false,theme:'base',securityLevel:'strict',htmlLabels:false,themeVariables:Object.assign({},baseMermaidThemeVariables,{
          primaryColor:next.surface||baseMermaidThemeVariables.primaryColor,
          primaryTextColor:next.text||baseMermaidThemeVariables.primaryTextColor,
          primaryBorderColor:next.borderStrong||baseMermaidThemeVariables.primaryBorderColor,
          lineColor:next.muted||baseMermaidThemeVariables.lineColor,
          secondaryColor:next.surfaceSecondary||baseMermaidThemeVariables.secondaryColor,
          secondaryTextColor:next.text||baseMermaidThemeVariables.secondaryTextColor,
          secondaryBorderColor:next.border||baseMermaidThemeVariables.secondaryBorderColor,
          tertiaryColor:next.bgSoft||baseMermaidThemeVariables.tertiaryColor,
          tertiaryTextColor:next.text||baseMermaidThemeVariables.tertiaryTextColor,
          tertiaryBorderColor:next.border||baseMermaidThemeVariables.tertiaryBorderColor,
          textColor:next.text||baseMermaidThemeVariables.textColor,
          mainBkg:next.surface||baseMermaidThemeVariables.mainBkg,
          nodeBorder:next.borderStrong||baseMermaidThemeVariables.nodeBorder,
          clusterBkg:next.surfaceSecondary||baseMermaidThemeVariables.clusterBkg,
          clusterBorder:next.border||baseMermaidThemeVariables.clusterBorder,
        })});
        const rerun=mm.run?mm.run({querySelector:'#mm-graph'}):Promise.resolve(mm.init(undefined,graphEl));
        Promise.resolve(rerun).then(()=>{normalizeSvgSize();fitToViewport();}).catch(showRenderError);
      });
      return Promise.resolve(run);
    })
    .then(() => {
      if (!stage.querySelector('svg')) throw new Error('No SVG output');
      requestAnimationFrame(() => {
        normalizeSvgSize();
        fitToViewport();
        setTimeout(fitToViewport, 80);
      });
    })
    .catch(showRenderError);
})();
<\/script>
</body></html>`:`<!DOCTYPE html><html><head><meta charset="UTF-8">
<style>${a}body{font-family:inherit;color:var(--prom-text);min-height:0;width:100%;overflow-x:hidden}</style>
</head><body>${e}</body></html>`}function x(r){return String(r||"").replace(/&/g,"&amp;").replace(/"/g,"&quot;")}function w(r){return JSON.stringify(r??null).replace(/</g,"\\u003c")}function W(r,e={}){let n=String(e.visualId||""),t=e.state&&typeof e.state=="object"?e.state:{},o=`<script>(function(){
var visualId=${w(n)},last=0,state=${w(t)}||{};
function post(type,extra){try{parent.postMessage(Object.assign({type:type,visualId:visualId},extra||{}),'*')}catch(e){}}
function send(){try{var d=document.documentElement,b=document.body;var viewport=Math.max(120,window.innerHeight||0);var measured=Math.max(d?d.scrollHeight:0,b?b.scrollHeight:0,d?d.offsetHeight:0,b?b.offsetHeight:0);var h=measured<=viewport+24?viewport:measured;h=Math.min(10000,Math.max(120,h));if(Math.abs(h-last)>1){last=h;post('prometheus:visual-resize',{height:h})}}catch(e){}}
function keyFor(el,index){return el.getAttribute('data-state-key')||el.id||el.name||('control-'+index)}
function captureControls(){var controls={};document.querySelectorAll('input,select,textarea').forEach(function(el,index){var key=keyFor(el,index);controls[key]={value:el.value};if(el.type==='checkbox'||el.type==='radio')controls[key].checked=!!el.checked});var details={};document.querySelectorAll('details').forEach(function(el,index){details[el.id||('details-'+index)]=!!el.open});state=Object.assign({},state,{controls:controls,details:details});if(window.openai)window.openai.widgetState=state;post('prometheus:visual-state',{state:state});return state}
function restoreControls(){var controls=state&&state.controls||{};document.querySelectorAll('input,select,textarea').forEach(function(el,index){var saved=controls[keyFor(el,index)];if(!saved)return;if(Object.prototype.hasOwnProperty.call(saved,'value'))el.value=saved.value;if(Object.prototype.hasOwnProperty.call(saved,'checked'))el.checked=!!saved.checked});var details=state&&state.details||{};document.querySelectorAll('details').forEach(function(el,index){var key=el.id||('details-'+index);if(Object.prototype.hasOwnProperty.call(details,key))el.open=!!details[key]})}
function applyTheme(theme){try{if(!theme||typeof theme!=='object')return;var vars=theme.vars||{};Object.keys(vars).forEach(function(name){if(/^--[a-z0-9-]+$/i.test(name))document.documentElement.style.setProperty(name,String(vars[name]||''))});window.dispatchEvent(new CustomEvent('prometheus:visual-theme-change',{detail:theme}));send()}catch(e){}}
window.addEventListener('message',function(event){var data=event&&event.data;if(!data||data.type!=='prometheus:visual-theme'||String(data.visualId||'')!==String(visualId))return;applyTheme(data.theme)});
window.prometheusVisual={id:visualId,getState:function(){return state},setState:function(next){state=next&&typeof next==='object'?next:{};restoreControls();if(window.openai)window.openai.widgetState=state;post('prometheus:visual-state',{state:state});send()},sendFollowUpMessage:function(input){post('prometheus:visual-followup',{prompt:String(input&&input.prompt||''),title:String(input&&input.title||'')})}};
window.openai=window.openai||{};window.openai.widgetState=state;window.openai.setWidgetState=function(next){window.prometheusVisual.setState(next)};window.openai.sendFollowUpMessage=function(input){window.prometheusVisual.sendFollowUpMessage(input);return Promise.resolve()};
restoreControls();document.addEventListener('input',captureControls,true);document.addEventListener('change',captureControls,true);document.addEventListener('toggle',captureControls,true);
if('ResizeObserver'in window){var ro=new ResizeObserver(send);if(document.documentElement)ro.observe(document.documentElement);if(document.body)ro.observe(document.body)}addEventListener('load',function(){restoreControls();send();post('prometheus:visual-ready')});setTimeout(send,50);setTimeout(send,250);setTimeout(send,1000)})();<\/script>`,i=String(r||"");return/<head\b[^>]*>/i.test(i)?i.replace(/<head\b[^>]*>/i,a=>`${a}${o}`):`${o}${i}`}function X(){if(window.__PROM_VISUAL_MESSAGE_BRIDGE_INSTALLED__)return;window.__PROM_VISUAL_MESSAGE_BRIDGE_INSTALLED__=!0;let r=()=>{let e=k();document.querySelectorAll('iframe[data-prom-visual="true"]').forEach(n=>{let t=String(n.getAttribute("data-visual-id")||"");if(!(!t||!n.contentWindow))try{n.contentWindow.postMessage({type:"prometheus:visual-theme",visualId:t,theme:e},"*")}catch{}})};document.addEventListener("prom-theme-change",()=>setTimeout(r,0)),document.addEventListener("prom-appearance-change",()=>setTimeout(r,0)),window.addEventListener("message",e=>{let n=e?.data;if(!n||!String(n.type||"").startsWith("prometheus:visual-"))return;let t=Array.from(document.querySelectorAll('iframe[data-prom-visual="true"]')).find(i=>i.contentWindow===e.source);if(!t)return;let o=String(t.getAttribute("data-visual-id")||"");if(String(n.visualId||"")===o){if(n.type==="prometheus:visual-resize"){let i=Number(n.height);if(!Number.isFinite(i))return;let a=Math.min(1e4,Math.max(120,Math.ceil(i))),l=Math.ceil(t.getBoundingClientRect().height||0);if(Math.abs(l-a)<=1)return;t.style.height=`${a}px`,t.style.minHeight=`${a}px`;return}if(n.type==="prometheus:visual-state"&&n.state&&typeof n.state=="object"){window.dispatchEvent(new CustomEvent("prometheus:visual-state-change",{detail:{visualId:o,state:n.state}}));return}n.type==="prometheus:visual-followup"&&n.prompt&&window.dispatchEvent(new CustomEvent("prometheus:visual-followup",{detail:{visualId:o,prompt:String(n.prompt),title:String(n.title||"")}}))}})}function S(r){if(!r?.getAttribute)return"";let e=r.closest?.(".visual-block"),n=String(r.getAttribute("data-visual-id")||"").trim();return n?[n,String(r.getAttribute("data-visual-version")||"1"),String(e?.getAttribute("data-vis-lang")||""),String(e?.getAttribute("data-vis-code")||"")].join("\0"):""}function y(r){if(!r?.querySelector&&!r?.matches)return"";let e=r.matches?.('iframe[data-prom-visual="true"]')?r:r.querySelector?.('iframe[data-prom-visual="true"]');return S(e)}function G(r,e){return!r||!e||r.nodeType!==e.nodeType?!1:r.nodeType!==1?!0:String(r.tagName||"").toLowerCase()===String(e.tagName||"").toLowerCase()}function K(r,e){let t=r.matches?.('iframe[data-prom-visual="true"]')?new Set(["srcdoc","style"]):new Set;Array.from(r.attributes||[]).forEach(o=>{t.has(o.name)||e.hasAttribute(o.name)||r.removeAttribute(o.name)}),Array.from(e.attributes||[]).forEach(o=>{t.has(o.name)||r.getAttribute(o.name)!==o.value&&r.setAttribute(o.name,o.value)})}function f(r,e,n,t=null){let o=Array.from(e||[]),i=Array.from(n||[]),a=Math.min(o.length,i.length),l=0;for(let s=0;s<a;s+=1){let m=o[s],c=i[s],d=I(m,c);if(d){l+=d.reused;continue}let u=c.cloneNode(!0);r.replaceChild(u,m)}for(let s=a;s<i.length;s+=1)r.insertBefore(i[s].cloneNode(!0),t);for(let s=a;s<o.length;s+=1)o[s].remove();return l}function J(r,e){return r.length===e.length&&r.every((n,t)=>n===e[t])}function z(r,e){let n=Array.from(r.childNodes||[]),t=Array.from(e.childNodes||[]),o=n.map(y).filter(Boolean),i=t.map(y).filter(Boolean);if(o.length&&J(o,i)){let a=0,l=0,s=0;for(let m of i){let c=n.findIndex((v,g)=>g>=a&&y(v)===m),d=t.findIndex((v,g)=>g>=l&&y(v)===m);if(c<0||d<0)return f(r,n,t);s+=f(r,n.slice(a,c),t.slice(l,d),n[c]);let u=I(n[c],t[d]);if(!u)return f(r,n,t);s+=u.reused,a=c+1,l=d+1}return s+=f(r,n.slice(a),t.slice(l)),s}return f(r,n,t)}function I(r,e){return G(r,e)?r.nodeType===3||r.nodeType===8?(r.nodeValue!==e.nodeValue&&(r.nodeValue=e.nodeValue),{reused:0}):r.matches?.('iframe[data-prom-visual="true"]')?S(r)===S(e)?{reused:1}:null:(K(r,e),{reused:z(r,e)}):null}function V(r,e){return!r?.childNodes||!e?.childNodes?0:z(r,e)}function Q(r,e){if(!r)return 0;let n=String(e||"");if(typeof document>"u"||typeof document.createElement!="function"||typeof r.appendChild!="function")return r.innerHTML=n,0;let t=document.createElement("template");t.innerHTML=n;let o=!!r.querySelector?.('iframe[data-prom-visual="true"]'),i=!!t.content.querySelector?.('iframe[data-prom-visual="true"]');return!o&&!i?(r.innerHTML=n,0):V(r,t.content)}function Z(r,e,n=0){let t=`${r}\0${n}\0${e}`,o=2166136261;for(let i=0;i<t.length;i+=1)o^=t.charCodeAt(i),o=Math.imul(o,16777619);return`visual_local_${(o>>>0).toString(36)}`}function L(r,e,n={}){X();let t=n.artifact&&typeof n.artifact=="object"?n.artifact:null,o=String(t?.id||n.visualId||Z(r,e,n.ordinal||0)),i=`vis_${o.replace(/[^a-z0-9_-]/gi,"_")}`,a=k(),l=W(A(r,e,a),{visualId:o,state:t?.state||n.state||{}}),s=x(l),m=r.replace(/"/g,""),c=x(e),d=r==="chart"?240:r==="html"?180:220;return`<div class="visual-block visual-block--inline" id="${i}-wrap" data-vis-lang="${m}" data-vis-code="${c}" data-vis-surface="inline">
  <iframe
    id="${i}"
    data-prom-visual="true"
    data-visual-id="${x(o)}"
    data-visual-version="${x(t?.version||1)}"
    srcdoc="${s}"
    sandbox="allow-scripts allow-downloads"
    style="width:100%;height:${d}px;min-height:${d}px;border:none;display:block;background:transparent;color-scheme:${a.isDark?"dark":"light"}"
    loading="lazy"
  ></iframe>
</div>`}function $(r){let e=String(r||""),n=typeof window<"u"?window.DOMPurify:null;return!n||typeof n.sanitize!="function"?h(e):n.sanitize(e,{USE_PROFILES:{html:!0},FORBID_TAGS:["script","style","iframe","object","embed","form","input","button","textarea","select","option","svg","math","link","meta","base"],FORBID_ATTR:["style","srcdoc","formaction","xlink:href"],ALLOW_DATA_ATTR:!1,ALLOW_ARIA_ATTR:!0,RETURN_TRUSTED_TYPE:!1})}function _(r,e={}){if(!r)return"";try{let n=[],t=`PROMVISUAL${Math.random().toString(36).slice(2)}X`,o=/```(chart|svg|html|mermaid)\n([\s\S]*?)```/g,i=0,a=Array.isArray(e.visualArtifacts)?e.visualArtifacts.filter(d=>d?.type==="visual"):[],l=String(r).replace(o,(d,u,v)=>{let g=n.length,T=u.toLowerCase(),N=a.find(C=>Number(C.ordinal)===i&&String(C.renderer||"")===T)||null;return n.push({lang:T,code:v.trim(),partial:!1,artifact:N,ordinal:i}),i+=1,`${t}${g}END`}),s=/```(chart|svg|html|mermaid)\n([\s\S]*)$/,m=l.match(s);if(m){let d=n.length;n.push({lang:m[1].toLowerCase(),code:m[2],partial:!0}),l=l.slice(0,m.index)+`${t}${d}END`}let c=$(marked.parse(l,{breaks:!0,gfm:!0,mangle:!1,headerIds:!1}));if(n.length){let d=new RegExp(`${t}(\\d+)END`,"g");c=c.replace(d,(u,v)=>{let g=n[+v];return g?g.partial?"":L(g.lang,g.code,{artifact:g.artifact,ordinal:g.ordinal}):""}),c=c.replace(/<p>\s*(<div class="visual-block"[\s\S]*?<\/div>)\s*<\/p>/g,"$1")}return c}catch{return h(r)}}window.escHtml=h;window.escapeHtml=h;window.sanitizeHtml=$;window.renderMd=_;window.timeAgo=F;window.fmtPercent=P;window.fmtMemoryGb=R;window.meterWidth=E;window.setText=O;window.setMeter=D;window.showToast=M;window.bgtToast=H;window.showConfirm=q;window.log=j;window.buildVisualSrcdoc=A;window.buildVisualIframe=L;window.preserveVisualIframes=V;window.setInnerHTMLPreservingVisuals=Q;window.renderMd=_;export{h as a,ee as b,F as c,P as d,R as e,E as f,O as g,D as h,M as i,H as j,q as k,j as l,A as m,V as n,Q as o,L as p,$ as q,_ as r};
