function g(n){return n?String(n).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"):""}var le=g;function D(n){let e=Date.now()-n;return e<6e4?"just now":e<36e5?`${Math.floor(e/6e4)}m ago`:e<864e5?`${Math.floor(e/36e5)}h ago`:`${Math.floor(e/864e5)}d ago`}function P(n,e=0){let r=Number(n);return Number.isFinite(r)?`${r.toFixed(e)}%`:"--%"}function O(n,e){let r=Number(n),t=Number(e);return!Number.isFinite(r)||!Number.isFinite(t)||t<=0?"-- / -- GB":`${r.toFixed(1)} / ${t.toFixed(1)} GB`}function M(n){let e=Number(n);return Number.isFinite(e)?`${Math.max(0,Math.min(100,e))}%`:"0%"}function q(n,e){let r=document.getElementById(n);r&&(r.textContent=String(e||""))}function de(n){let e=String(n||"").trim(),r=g(e);return`<span class="t-think-sizer" aria-hidden="true">${r}</span><span class="t-think-text" data-text="${r}">${r}</span>`}function me(n,e){let r=String(e||"").trim(),t=n?.querySelector?.(".t-think-text");if(!t||!r)return!1;let o=String(t.textContent||"").trim();if(!o||o===r)return!1;n.querySelectorAll?.(".t-think-text").forEach(a=>{a!==t&&a.remove()});let i=t.cloneNode(!0);i.classList.remove("is-enter-start"),i.classList.add("is-exit"),i.textContent=r,i.setAttribute("data-text",r),t.classList.remove("is-exit"),t.classList.add("is-enter-start");let s=n.querySelector?.(".t-think-sizer");s&&r.length>String(s.textContent||"").length&&(s.textContent=r),n.appendChild(i),t.offsetWidth;let c=()=>{t.isConnected!==!1&&t.classList.remove("is-enter-start")};return typeof requestAnimationFrame=="function"?requestAnimationFrame(c):typeof setTimeout=="function"&&setTimeout(c,0),typeof setTimeout=="function"&&setTimeout(()=>{i.isConnected!==!1&&i.remove(),t.isConnected!==!1&&t.classList.remove("is-enter-start")},420),!0}function H(n,e){let r=document.getElementById(n);r&&(r.style.width=M(e))}function A(n,e,r="info",t=5e3,o={}){let i=typeof o?.key=="string"?o.key.trim():"";if(i)for(let u of document.querySelectorAll(".__sc-toast"))u.dataset.scToastKey===i&&u.remove();let s=r==="warn"?"warning":["info","success","error","warning"].includes(r)?r:"info",c={info:"\u2139\uFE0F",success:"\u2713",error:"\u26A0\uFE0F",warning:"\u26A0\uFE0F"},a=document.createElement("div"),l=24+[...document.querySelectorAll(".__sc-toast")].reduce((u,h)=>u+h.offsetHeight+8,0);if(a.className=`__sc-toast __sc-toast--${s}`,i&&(a.dataset.scToastKey=i),a.style.cssText=`position:fixed;bottom:${l}px;right:24px;z-index:99999;`,a.innerHTML=`
    <span class="__sc-toast-icon" aria-hidden="true">${c[s]}</span>
    <div class="__sc-toast-copy">
      <div class="__sc-toast-title">${g(n)}</div>
      ${e?`<div class="__sc-toast-body">${g(String(e))}</div>`:""}
    </div>
    <button class="__sc-toast-close" type="button" aria-label="Dismiss">&times;</button>
  `,!document.getElementById("__sc-toast-style")){let u=document.createElement("style");u.id="__sc-toast-style",u.textContent="@keyframes scToastIn{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}",document.head.appendChild(u)}document.body.appendChild(a);let d=Math.max(0,Math.min(5e3,Number.isFinite(Number(t))?Number(t):5e3));setTimeout(()=>{a.style.transition="opacity 0.3s",a.style.opacity="0",setTimeout(()=>a.remove(),300)},d),a.querySelector(".__sc-toast-close")?.addEventListener("click",()=>a.remove())}function j(n,e){A(n,e,"info")}function Y(n,e,r,t={}){let{title:o="Confirm",confirmText:i="Confirm",cancelText:s="Cancel",danger:c=!1,details:a=""}=t,m=document.createElement("div");m.style.cssText="position:fixed;inset:0;z-index:99998;background:rgba(0,0,0,0.35);display:flex;align-items:center;justify-content:center;animation:scToastIn 0.15s ease";let l=document.createElement("div");l.style.cssText="background:var(--panel);border:1.5px solid var(--line);border-radius:14px;padding:24px 24px 18px;max-width:560px;width:92%;box-shadow:0 8px 40px rgba(0,0,0,0.18);font-family:var(--font)",l.innerHTML=`
    <div style="font-size:15px;font-weight:800;margin-bottom:10px">${g(o)}</div>
    <div style="font-size:13px;color:var(--muted);line-height:1.6;margin-bottom:18px">${g(n)}</div>
    ${a?`<pre style="margin:0 0 18px;padding:12px 14px;border-radius:10px;border:1px solid var(--line);background:var(--panel-2);font-size:11px;line-height:1.65;color:var(--text);white-space:pre-wrap;word-break:break-word;font-family:'Cascadia Code','Fira Code','Consolas',monospace">${g(a)}</pre>`:""}
    <div style="display:flex;gap:8px;justify-content:flex-end">
      <button id="__sc-confirm-cancel" style="border:1px solid var(--line);background:var(--panel-2);color:var(--muted);border-radius:8px;padding:7px 16px;font-size:12px;font-weight:700;cursor:pointer">${g(s)}</button>
      <button id="__sc-confirm-ok" style="border:none;background:${c?"#dc2626":"var(--brand)"};color:#fff;border-radius:8px;padding:7px 16px;font-size:12px;font-weight:700;cursor:pointer">${g(i)}</button>
    </div>
  `,m.appendChild(l),document.body.appendChild(m);let d=()=>m.remove();l.querySelector("#__sc-confirm-cancel").onclick=()=>{d(),r&&r()},l.querySelector("#__sc-confirm-ok").onclick=()=>{d(),e&&e()},m.addEventListener("click",u=>{u.target===m&&(d(),r&&r())})}var x=[];function U(n,e="log"){let r=new Date().toLocaleTimeString();x.push({text:`[${r}] ${String(n??"")}`,type:String(e||"log").replace(/[^a-z0-9_-]/gi,"")||"log"}),x.length>100&&x.shift();let t=document.getElementById("log-panel");t&&(t.replaceChildren(...x.map(o=>{let i=document.createElement("div");return i.className=`log-line ${o.type}`,i.textContent=o.text,i})),t.scrollTop=t.scrollHeight)}var p=Object.freeze({bg:"transparent",bgSoft:"transparent",surface:"transparent",surfaceSecondary:"transparent",border:"currentColor",borderStrong:"currentColor",text:"currentColor",muted:"currentColor",accent:"currentColor",accentStrong:"currentColor",success:"currentColor",warning:"currentColor",danger:"currentColor"});function I(n,e){return String(n||"").replace(/[<>{};\r\n]/g,"").trim()||e}function B(){let n=document.documentElement,e=typeof getComputedStyle=="function"?getComputedStyle(n):null,r=(o,i)=>{for(let s of o){let c=e?.getPropertyValue(s)?.trim();if(c)return I(c,i)}return i},t={isDark:n.getAttribute("data-theme")==="dark",bg:r(["--bg","--pm-chat-page-bg"],p.bg),bgSoft:r(["--bg-soft"],p.bgSoft),surface:r(["--panel","--composer-panel"],p.surface),surfaceSecondary:r(["--panel-2","--composer-bg"],p.surfaceSecondary),border:r(["--line","--composer-border"],p.border),borderStrong:r(["--line-strong"],p.borderStrong),text:r(["--text","--fg","--composer-text"],p.text),muted:r(["--muted","--composer-muted"],p.muted),accent:r(["--brand","--pm-custom-accent"],p.accent),accentStrong:r(["--brand-2"],p.accentStrong),success:r(["--ok"],p.success),warning:r(["--warn"],p.warning),danger:r(["--err"],p.danger)};return t.series=[t.accent,t.accentStrong,t.success,t.warning,t.danger,t.muted],t.vars={"--prom-bg":t.bg,"--prom-bg-soft":t.bgSoft,"--prom-surface":t.surface,"--prom-surface-secondary":t.surfaceSecondary,"--prom-border":t.border,"--prom-border-strong":t.borderStrong,"--prom-text":t.text,"--prom-muted":t.muted,"--prom-accent":t.accent,"--prom-accent-strong":t.accentStrong,"--prom-success":t.success,"--prom-warning":t.warning,"--prom-danger":t.danger,"--prom-series-1":t.series[0],"--prom-series-2":t.series[1],"--prom-series-3":t.series[2],"--prom-series-4":t.series[3],"--prom-series-5":t.series[4],"--prom-series-6":t.series[5],"--bg":t.bg,"--bg-soft":t.bgSoft,"--panel":t.surface,"--panel-2":t.surfaceSecondary,"--line":t.border,"--line-strong":t.borderStrong,"--text":t.text,"--fg":t.text,"--muted":t.muted,"--brand":t.accent,"--brand-2":t.accentStrong,"--ok":t.success,"--warn":t.warning,"--err":t.danger},t}function W(n){if(n&&typeof n=="object"&&n.vars)return n;let e={isDark:typeof n=="boolean"?n:!!n?.isDark,...p};return e.series=[e.accent,e.accentStrong,e.success,e.warning,e.danger,e.muted],e.vars=Object.fromEntries([["--prom-bg",e.bg],["--prom-bg-soft",e.bgSoft],["--prom-surface",e.surface],["--prom-surface-secondary",e.surfaceSecondary],["--prom-border",e.border],["--prom-border-strong",e.borderStrong],["--prom-text",e.text],["--prom-muted",e.muted],["--prom-accent",e.accent],["--prom-accent-strong",e.accentStrong],["--prom-success",e.success],["--prom-warning",e.warning],["--prom-danger",e.danger],...e.series.map((r,t)=>[`--prom-series-${t+1}`,r]),["--bg",e.bg],["--bg-soft",e.bgSoft],["--panel",e.surface],["--panel-2",e.surfaceSecondary],["--line",e.border],["--line-strong",e.borderStrong],["--text",e.text],["--fg",e.text],["--muted",e.muted],["--brand",e.accent],["--brand-2",e.accentStrong],["--ok",e.success],["--warn",e.warning],["--err",e.danger]]),e}function X(n){let e=n?.vars&&typeof n.vars=="object"?n.vars:{};return Object.entries(e).map(([r,t])=>`${r}:${I(t,"transparent")}`).join(";")}function L(n,e,r){let t=W(r),o=S({background:"transparent",primaryColor:t.surface,primaryTextColor:t.text,primaryBorderColor:t.borderStrong,lineColor:t.muted,secondaryColor:t.surfaceSecondary,secondaryTextColor:t.text,secondaryBorderColor:t.border,tertiaryColor:t.bgSoft,tertiaryTextColor:t.text,tertiaryBorderColor:t.border,textColor:t.text,mainBkg:t.surface,nodeBorder:t.borderStrong,clusterBkg:t.surfaceSecondary,clusterBorder:t.border,edgeLabelBackground:"transparent"}),i=S({text:t.text,muted:t.muted,border:t.border,series:t.series}),s=`:root{${X(t)}color-scheme:${t.isDark?"dark":"light"}}*{margin:0;padding:0;box-sizing:border-box}html,body{background:transparent!important;color:var(--prom-text);color-scheme:${t.isDark?"dark":"light"};max-width:100%;overflow-x:hidden}body{min-height:0;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}`;return n==="chart"?`<!DOCTYPE html><html><head><meta charset="UTF-8">
<script src="/vendor/chart/chart.umd.js"><\/script>
<style>${s}body{display:flex;align-items:center;justify-content:center;min-height:220px;padding:8px}canvas{width:100%!important;max-width:100%;max-height:100%}</style>
</head><body><canvas id="c"></canvas>
<script>try{const visualTheme=${i};Chart.defaults.color=visualTheme.text;Chart.defaults.borderColor=visualTheme.border;const cfg=(${e});if(cfg.options)cfg.options.responsive=true;else cfg.options={responsive:true};const datasets=cfg.data&&Array.isArray(cfg.data.datasets)?cfg.data.datasets:[];datasets.forEach((dataset,index)=>{const color=visualTheme.series[index%visualTheme.series.length];if(!dataset.backgroundColor)dataset.backgroundColor=color;if(!dataset.borderColor)dataset.borderColor=color;});const chart=new Chart(document.getElementById('c'),cfg);window.addEventListener('prometheus:visual-theme-change',(event)=>{const next=event.detail||{};if(next.text)Chart.defaults.color=next.text;if(next.border)Chart.defaults.borderColor=next.border;chart.update('none');});}catch(e){document.body.innerHTML='<pre style="color:var(--prom-danger);padding:8px;font-size:11px;white-space:pre-wrap">'+e.message+'<\\/pre>';}<\/script>
</body></html>`:n==="svg"?`<!DOCTYPE html><html><head><meta charset="UTF-8">
<style>${s}body{padding:0}.sv-shell{position:relative;min-height:200px;height:200px;overflow:hidden;background:transparent}.sv-viewport{position:absolute;inset:0;cursor:grab;touch-action:none;user-select:none}.sv-viewport.dragging{cursor:grabbing}.sv-stage{position:absolute;left:0;top:0;transform-origin:0 0;will-change:transform}.sv-stage svg{max-width:none!important;height:auto;display:block}.sv-controls{position:absolute;top:10px;right:10px;display:flex;gap:6px;z-index:5;opacity:0;transform:translateY(-4px);pointer-events:none;transition:opacity .2s ease,transform .2s ease}.sv-shell:hover .sv-controls,.sv-shell:focus-within .sv-controls{opacity:1;transform:translateY(0);pointer-events:auto}.sv-btn{border:1px solid var(--prom-border);background:var(--prom-surface);color:var(--prom-text);border-radius:8px;padding:4px 9px;font-weight:700;font-size:12px;line-height:1;cursor:pointer;backdrop-filter:blur(2px)}.sv-btn:hover{filter:brightness(1.08)}.sv-hint{position:absolute;left:10px;bottom:10px;font-size:11px;color:var(--prom-muted);opacity:0;transform:translateY(4px);background:var(--prom-surface);border:1px solid var(--prom-border);border-radius:999px;padding:4px 9px;pointer-events:none;transition:opacity .2s ease,transform .2s ease}.sv-shell:hover .sv-hint,.sv-shell:focus-within .sv-hint{opacity:.82;transform:translateY(0)}</style>
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
</body></html>`:n==="mermaid"?`<!DOCTYPE html><html><head><meta charset="UTF-8">
<script src="/vendor/mermaid/mermaid.min.js"><\/script>
<style>${s}body{padding:0}.mm-shell{position:relative;min-height:200px;height:200px;overflow:hidden;background:transparent}.mm-viewport{position:absolute;inset:0;cursor:grab;touch-action:none;user-select:none}.mm-viewport.dragging{cursor:grabbing}.mm-stage{position:absolute;left:0;top:0;transform-origin:0 0;will-change:transform}.mermaid svg{max-width:none!important;height:auto;background:transparent!important}.mermaid{background:transparent!important}.mm-controls{position:absolute;top:10px;right:10px;display:flex;gap:6px;z-index:5;opacity:0;transform:translateY(-4px);pointer-events:none;transition:opacity .2s ease,transform .2s ease}.mm-shell:hover .mm-controls{opacity:1;transform:translateY(0);pointer-events:auto}.mm-btn{border:1px solid var(--prom-border);background:var(--prom-surface);color:var(--prom-text);border-radius:8px;padding:4px 9px;font-weight:700;font-size:12px;line-height:1;cursor:pointer;backdrop-filter:blur(2px)}.mm-btn:hover{filter:brightness(1.08)}.mm-hint{position:absolute;left:10px;bottom:10px;font-size:11px;color:var(--prom-muted);opacity:0;transform:translateY(4px);background:var(--prom-surface);border:1px solid var(--prom-border);border-radius:999px;padding:4px 9px;pointer-events:none;transition:opacity .2s ease,transform .2s ease}.mm-shell:hover .mm-hint{opacity:.82;transform:translateY(0)}</style>
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
<style>${s}body{font-family:inherit;color:var(--prom-text);min-height:0;width:100%;overflow-x:hidden}</style>
</head><body>${e}</body></html>`}function b(n){return String(n||"").replace(/&/g,"&amp;").replace(/"/g,"&quot;")}function S(n){return JSON.stringify(n??null).replace(/</g,"\\u003c")}function G(n,e={}){let r=String(e.visualId||""),t=e.state&&typeof e.state=="object"?e.state:{},o=`<script>(function(){
var visualId=${S(r)},last=0,state=${S(t)}||{};
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
if('ResizeObserver'in window){var ro=new ResizeObserver(send);if(document.documentElement)ro.observe(document.documentElement);if(document.body)ro.observe(document.body)}addEventListener('load',function(){restoreControls();send();post('prometheus:visual-ready')});setTimeout(send,50);setTimeout(send,250);setTimeout(send,1000)})();<\/script>`,i=String(n||"");return/<head\b[^>]*>/i.test(i)?i.replace(/<head\b[^>]*>/i,s=>`${s}${o}`):`${o}${i}`}function K(){if(window.__PROM_VISUAL_MESSAGE_BRIDGE_INSTALLED__)return;window.__PROM_VISUAL_MESSAGE_BRIDGE_INSTALLED__=!0;let n=()=>{let e=B();document.querySelectorAll('iframe[data-prom-visual="true"]').forEach(r=>{let t=String(r.getAttribute("data-visual-id")||"");if(!(!t||!r.contentWindow))try{r.contentWindow.postMessage({type:"prometheus:visual-theme",visualId:t,theme:e},"*")}catch{}})};document.addEventListener("prom-theme-change",()=>setTimeout(n,0)),document.addEventListener("prom-appearance-change",()=>setTimeout(n,0)),window.addEventListener("message",e=>{let r=e?.data;if(!r||!String(r.type||"").startsWith("prometheus:visual-"))return;let t=Array.from(document.querySelectorAll('iframe[data-prom-visual="true"]')).find(i=>i.contentWindow===e.source);if(!t)return;let o=String(t.getAttribute("data-visual-id")||"");if(String(r.visualId||"")===o){if(r.type==="prometheus:visual-resize"){let i=Number(r.height);if(!Number.isFinite(i))return;let s=Math.min(1e4,Math.max(120,Math.ceil(i))),c=Math.ceil(t.getBoundingClientRect().height||0);if(Math.abs(c-s)<=1)return;t.style.height=`${s}px`,t.style.minHeight=`${s}px`;return}if(r.type==="prometheus:visual-state"&&r.state&&typeof r.state=="object"){window.dispatchEvent(new CustomEvent("prometheus:visual-state-change",{detail:{visualId:o,state:r.state}}));return}r.type==="prometheus:visual-followup"&&r.prompt&&window.dispatchEvent(new CustomEvent("prometheus:visual-followup",{detail:{visualId:o,prompt:String(r.prompt),title:String(r.title||"")}}))}})}function E(n){if(!n?.getAttribute)return"";let e=n.closest?.(".visual-block"),r=String(n.getAttribute("data-visual-id")||"").trim();return r?[r,String(n.getAttribute("data-visual-version")||"1"),String(e?.getAttribute("data-vis-lang")||""),String(e?.getAttribute("data-vis-code")||"")].join("\0"):""}function w(n){if(!n?.querySelector&&!n?.matches)return"";let e=n.matches?.('iframe[data-prom-visual="true"]')?n:n.querySelector?.('iframe[data-prom-visual="true"]');return E(e)}function J(n,e){return!n||!e||n.nodeType!==e.nodeType?!1:n.nodeType!==1?!0:String(n.tagName||"").toLowerCase()===String(e.tagName||"").toLowerCase()}function Q(n,e){let t=n.matches?.('iframe[data-prom-visual="true"]')?new Set(["srcdoc","style"]):new Set;Array.from(n.attributes||[]).forEach(o=>{t.has(o.name)||e.hasAttribute(o.name)||n.removeAttribute(o.name)}),Array.from(e.attributes||[]).forEach(o=>{t.has(o.name)||n.getAttribute(o.name)!==o.value&&n.setAttribute(o.name,o.value)})}function y(n,e,r,t=null){let o=Array.from(e||[]),i=Array.from(r||[]),s=Math.min(o.length,i.length),c=0;for(let a=0;a<s;a+=1){let m=o[a],l=i[a],d=_(m,l);if(d){c+=d.reused;continue}let u=l.cloneNode(!0);n.replaceChild(u,m)}for(let a=s;a<i.length;a+=1)n.insertBefore(i[a].cloneNode(!0),t);for(let a=s;a<o.length;a+=1)o[a].remove();return c}function Z(n,e){return n.length===e.length&&n.every((r,t)=>r===e[t])}function z(n,e){let r=Array.from(n.childNodes||[]),t=Array.from(e.childNodes||[]),o=r.map(w).filter(Boolean),i=t.map(w).filter(Boolean);if(o.length&&Z(o,i)){let s=0,c=0,a=0;for(let m of i){let l=r.findIndex((h,f)=>f>=s&&w(h)===m),d=t.findIndex((h,f)=>f>=c&&w(h)===m);if(l<0||d<0)return y(n,r,t);a+=y(n,r.slice(s,l),t.slice(c,d),r[l]);let u=_(r[l],t[d]);if(!u)return y(n,r,t);a+=u.reused,s=l+1,c=d+1}return a+=y(n,r.slice(s),t.slice(c)),a}return y(n,r,t)}function _(n,e){return J(n,e)?n.nodeType===3||n.nodeType===8?(n.nodeValue!==e.nodeValue&&(n.nodeValue=e.nodeValue),{reused:0}):n.matches?.('iframe[data-prom-visual="true"]')?E(n)===E(e)?{reused:1}:null:(Q(n,e),{reused:z(n,e)}):null}function $(n,e){return!n?.childNodes||!e?.childNodes?0:z(n,e)}function ee(n,e){if(!n)return 0;let r=String(e||"");if(typeof document>"u"||typeof document.createElement!="function"||typeof n.appendChild!="function")return n.innerHTML=r,0;let t=document.createElement("template");t.innerHTML=r;let o=!!n.querySelector?.('iframe[data-prom-visual="true"]'),i=!!t.content.querySelector?.('iframe[data-prom-visual="true"]');return!o&&!i?(n.innerHTML=r,0):$(n,t.content)}function te(n,e,r=0){let t=`${n}\0${r}\0${e}`,o=2166136261;for(let i=0;i<t.length;i+=1)o^=t.charCodeAt(i),o=Math.imul(o,16777619);return`visual_local_${(o>>>0).toString(36)}`}function V(n,e,r={}){K();let t=r.artifact&&typeof r.artifact=="object"?r.artifact:null,o=String(t?.id||r.visualId||te(n,e,r.ordinal||0)),i=`vis_${o.replace(/[^a-z0-9_-]/gi,"_")}`,s=B(),c=G(L(n,e,s),{visualId:o,state:t?.state||r.state||{}}),a=b(c),m=n.replace(/"/g,""),l=b(e),d=n==="chart"?240:n==="html"?180:220;return`<div class="visual-block visual-block--inline" id="${i}-wrap" data-vis-lang="${m}" data-vis-code="${l}" data-vis-surface="inline">
  <iframe
    id="${i}"
    data-prom-visual="true"
    data-visual-id="${b(o)}"
    data-visual-version="${b(t?.version||1)}"
    srcdoc="${a}"
    sandbox="allow-scripts allow-downloads"
    style="width:100%;height:${d}px;min-height:${d}px;border:none;display:block;background:transparent;color-scheme:${s.isDark?"dark":"light"}"
    loading="lazy"
  ></iframe>
</div>`}function N(n){let e=String(n||""),r=typeof window<"u"?window.DOMPurify:null;return!r||typeof r.sanitize!="function"?g(e):r.sanitize(e,{USE_PROFILES:{html:!0},FORBID_TAGS:["script","style","iframe","object","embed","form","input","button","textarea","select","option","svg","math","link","meta","base"],FORBID_ATTR:["style","srcdoc","formaction","xlink:href"],ALLOW_DATA_ATTR:!1,ALLOW_ARIA_ATTR:!0,RETURN_TRUSTED_TYPE:!1})}function re(n){let e=String(n||"").trim();if(!e)return"";if(/^file:\/\//i.test(e))try{e=decodeURIComponent(e.replace(/^file:\/\/\/?/i,""))}catch{e=e.replace(/^file:\/\/\/?/i,"")}e=e.replace(/^\.\//,"");let r=typeof window<"u"?window.__promResolveWorkspaceMediaUrl:null;if(typeof r=="function")try{let t=r(e);if(t)return String(t)}catch{}return`/api/canvas/inline?path=${encodeURIComponent(e)}`}function ne(n){let e=String(n||"").trim();return!e||e.startsWith("#")?!1:/^file:\/\//i.test(e)||/^[a-z]:[\\/]/i.test(e)?!0:!(/^[a-z][a-z0-9+.-]*:/i.test(e)||e.startsWith("/")||e.startsWith("\\"))}var oe=/\.(mp4|webm|mov|m4v)(?:$|[?#])/i;function ie(n){let e=String(n||"");return e.includes("<img")?e.replace(/<img\b([^>]*?)\ssrc="([^"]*)"([^>]*)>/gi,(r,t,o,i)=>{let s=o.replace(/&amp;/g,"&");if(!ne(s))return r;let c=re(s),a=`${t}${i}`,m=a.match(/\salt="([^"]*)"/i),l=m?m[1]:"",d=b(s),u=l?`<span class="prom-inline-caption">${l}</span>`:"";return oe.test(s)?`<span class="prom-inline-figure is-video"><video class="prom-inline-media" src="${b(c)}" controls playsinline preload="metadata" data-workspace-path="${d}"></video>${u}</span>`:`<span class="prom-inline-figure"><img${a.replace(/\s(?:loading|class)="[^"]*"/gi,"")} src="${b(c)}" class="prom-inline-media" loading="lazy" decoding="async" data-workspace-path="${d}" role="button" tabindex="0">${u}</span>`}):e}function se({src:n,name:e}){document.getElementById("prom-inline-lightbox")?.remove();let r=document.createElement("div");r.id="prom-inline-lightbox",r.className="prom-inline-lightbox",r.setAttribute("role","dialog"),r.setAttribute("aria-modal","true");let t=document.createElement("img");t.src=n,t.alt=e||"";let o=document.createElement("button");o.type="button",o.className="prom-inline-lightbox-close",o.setAttribute("aria-label","Close"),o.textContent="\xD7",r.append(t,o);let i=()=>{r.remove(),document.removeEventListener("keydown",s)},s=c=>{c.key==="Escape"&&i()};r.addEventListener("click",c=>{c.target!==t&&i()}),document.addEventListener("keydown",s),document.body.appendChild(r)}if(typeof document<"u"&&!window.__promInlineMediaWired){window.__promInlineMediaWired=!0;let n=e=>{let r=e.target?.closest?.("img.prom-inline-media");if(!r||e.type==="keydown"&&e.key!=="Enter"&&e.key!==" ")return;e.preventDefault();let t=r.getAttribute("data-workspace-path")||"",o={kind:"image",src:r.currentSrc||r.src,path:t,name:r.getAttribute("alt")||t.split(/[\\/]/).pop()||"Image"},i=window.__promOpenInlineMedia;if(typeof i=="function")try{i(o);return}catch{}se(o)};document.addEventListener("click",n),document.addEventListener("keydown",n)}var ae=600,ce=2e5,v=new Map;function R(n,e={}){if(!n)return"";let r=String(n);if(r.length<=ce&&!/```(chart|svg|html|mermaid)\n/.test(r)&&!(Array.isArray(e.visualArtifacts)&&e.visualArtifacts.length)){let o=v.get(r);if(o!==void 0)return v.delete(r),v.set(r,o),o;let i=k(r,e);return v.set(r,i),v.size>ae&&v.delete(v.keys().next().value),i}return k(r,e)}function k(n,e={}){try{let r=[],t=`PROMVISUAL${Math.random().toString(36).slice(2)}X`,o=/```(chart|svg|html|mermaid)\n([\s\S]*?)```/g,i=0,s=Array.isArray(e.visualArtifacts)?e.visualArtifacts.filter(d=>d?.type==="visual"):[],c=String(n).replace(o,(d,u,h)=>{let f=r.length,C=u.toLowerCase(),F=s.find(T=>Number(T.ordinal)===i&&String(T.renderer||"")===C)||null;return r.push({lang:C,code:h.trim(),partial:!1,artifact:F,ordinal:i}),i+=1,`${t}${f}END`}),a=/```(chart|svg|html|mermaid)\n([\s\S]*)$/,m=c.match(a);if(m){let d=r.length;r.push({lang:m[1].toLowerCase(),code:m[2],partial:!0}),c=c.slice(0,m.index)+`${t}${d}END`}let l=ie(N(marked.parse(c,{breaks:!0,gfm:!0,mangle:!1,headerIds:!1})));if(r.length){let d=new RegExp(`${t}(\\d+)END`,"g");l=l.replace(d,(u,h)=>{let f=r[+h];return f?f.partial?"":V(f.lang,f.code,{artifact:f.artifact,ordinal:f.ordinal}):""}),l=l.replace(/<p>\s*(<div class="visual-block"[\s\S]*?<\/div>)\s*<\/p>/g,"$1")}return l}catch{return g(n)}}window.escHtml=g;window.escapeHtml=g;window.sanitizeHtml=N;window.renderMd=R;window.timeAgo=D;window.fmtPercent=P;window.fmtMemoryGb=O;window.meterWidth=M;window.setText=q;window.setMeter=H;window.showToast=A;window.bgtToast=j;window.showConfirm=Y;window.log=U;window.buildVisualSrcdoc=L;window.buildVisualIframe=V;window.preserveVisualIframes=$;window.setInnerHTMLPreservingVisuals=ee;window.renderMd=R;export{g as a,le as b,D as c,P as d,O as e,M as f,q as g,de as h,me as i,H as j,A as k,j as l,Y as m,U as n,L as o,$ as p,ee as q,V as r,N as s,re as t,R as u};
