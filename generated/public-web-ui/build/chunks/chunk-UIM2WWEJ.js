var ee="prom-vp-card-style",be=".prom-vp-card[data-vp-project]:not([data-vp-mounted])",te=new Map,S=(r,t="")=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"${t}>${r}</svg>`,y={film:S('<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 3v18M17 3v18M3 8h4M3 16h4M17 8h4M17 16h4"/>'),check:S('<path d="M5 12l5 5L20 7"/>'),x:S('<path d="M18 6L6 18M6 6l12 12"/>'),reroll:S('<path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/>'),refresh:S('<path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/>'),spark:S('<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/>'),layers:S('<path d="M12 3l9 5-9 5-9-5 9-5z"/><path d="M3 13l9 5 9-5"/>'),play:S('<path d="M7 4v16l13-8z"/>'),seq:S('<rect x="2" y="6" width="6" height="12" rx="1"/><rect x="9" y="6" width="6" height="12" rx="1"/><rect x="16" y="6" width="6" height="12" rx="1"/>'),undo:S('<path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 010 10h-3"/>'),redo:S('<path d="M15 14l5-5-5-5"/><path d="M20 9H9a5 5 0 000 10h3"/>'),chevron:S('<path d="M6 9l6 6 6-6"/>'),user:S('<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0116 0"/>'),download:S('<path d="M12 3v12M7 10l5 5 5-5"/><path d="M5 21h14"/>'),stop:S('<rect x="6" y="6" width="12" height="12" rx="2"/>')};function l(r){return String(r??"").replace(/[&<>"']/g,t=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[t])}function V(r){return`$${(Number(r)||0).toFixed(2)}`}function J(r){return/\.(mp4|webm|mov|m4v)(?:$|[?#])/i.test(String(r||""))}function G(r){return String(r||"").replace(/^[a-z]+\//,"").replace(/^grok-imagine-/,"grok-")}function F(r){let t=String(r||"").trim();if(!t)return"";if(/^(https?:|data:|blob:)/i.test(t))return t;let n=typeof window<"u"?window.__promResolveWorkspaceMediaUrl:null;if(typeof n=="function")try{let e=n(t);if(e)return String(e)}catch{}return`/api/canvas/inline?path=${encodeURIComponent(t)}`}async function R(r,t,n=2e4){let e={method:t===void 0?"GET":"POST",headers:{"Content-Type":"application/json"},body:t===void 0?void 0:JSON.stringify(t),timeoutMs:n},o=`/api/video-projects${r}`,a=window.__promVideoProjectFetch||window.api,i;if(typeof a=="function")i=await a(o,e);else{let p=await fetch(o,e);i=await p.json().catch(()=>({success:!1,error:`HTTP ${p.status}`}))}if(i&&i.success===!1)throw new Error(i.error||"Request failed");return i||{}}function re(r){let t=r?.takes||[];return t.length?t.find(n=>n.id===r.selectedTakeId)||t[t.length-1]:null}function X(r,t="vpc-thumb"){if(!r)return`<span class="${t} is-empty">${y.film}</span>`;let n=l(F(r));return J(r)?`<video class="${t}" src="${n}#t=0.1" muted playsinline preload="metadata"></video>`:`<img class="${t}" src="${n}" alt="" loading="lazy" decoding="async">`}function B(r,t,n,e="",o=""){return`<button type="button" class="vpc-icon${o?` ${o}`:""}" data-vpa="${r}" title="${l(n)}" aria-label="${l(n)}" ${e}>${t}</button>`}function xe(r){r.dataset.vpMounted="1";let t=String(r.dataset.vpProject||""),n=te.get(t),e={project:n?.project||null,history:n?.history||{undo:0,redo:0},busy:"",error:"",openShot:"",pending:null,estimate:null,estimateKey:"",rendering:!1},o=null,a=()=>r.isConnected;function i(s){s?.project&&(e.project=s.project),s?.history&&(e.history=s.history),e.project&&te.set(t,{project:e.project,history:e.history,at:Date.now()})}async function p(){if(a()){try{i(await R(`/${encodeURIComponent(t)}`)),e.error=""}catch(s){e.error=String(s?.message||s)}await f(),L(),b()}}function c(){return(e.project?.jobs||[]).filter(s=>s.state==="queued"||s.state==="running")}function b(){clearTimeout(o),a()&&(c().length||e.rendering)&&(o=setTimeout(p,3500))}function g(){let s=new Set(c().map(d=>d.target?.shotId).filter(Boolean));return(e.project?.shots||[]).filter(d=>!(d.takes||[]).length&&!s.has(d.id))}async function f(){let s=g(),d=s.map(m=>`${m.id}:${m.modelId||""}:${m.durationSec}:${(m.characterIds||[]).join(",")}`).join("|")+`#${(e.project?.characters||[]).map(m=>(m.anchors||[]).length).join(",")}`;if(!s.length){e.estimate=null,e.estimateKey="";return}if(!(d===e.estimateKey&&e.estimate))try{e.estimate=await R(`/${encodeURIComponent(t)}/estimate`,{shotIds:s.map(m=>m.id)}),e.estimateKey=d}catch(m){e.estimate=null,e.error=String(m?.message||m)}}async function h(s,d){e.busy=s,e.error="",L();try{let m=await d();return i(m),m}catch(m){return e.error=String(m?.message||m),null}finally{e.busy="",L()}}async function w(s,d){await h(d,()=>R(`/${encodeURIComponent(t)}/ops`,{ops:s})),await p()}async function k(s,d,m){let u=await h(m,()=>R(`/${encodeURIComponent(t)}${s}`,d,12e4));if(u){if(u.needsApproval){e.pending={path:s,body:{...d,approved:!0},label:m,reason:u.reason,estimate:u.estimate},L();return}e.pending=null,e.estimateKey="",await p()}}async function j(){let s=e.project;if(!s)return;let d=(s.clips||[]).some(m=>m.source&&"shotId"in m.source);if(e.rendering=!0,!d&&!await h("Assembling",()=>R(`/${encodeURIComponent(t)}/ops`,{ops:[{op:"timeline.assemble"}]}))){e.rendering=!1,L();return}await h("Rendering",()=>R(`/${encodeURIComponent(t)}/render`,{},900*1e3)),e.rendering=!1,await p()}function A(s,d){let m=F(s);if(typeof window.__promOpenInlineMedia=="function")try{window.__promOpenInlineMedia({src:m,path:s,name:d||s.split("/").pop(),kind:J(s)?"video":"image"});return}catch{}window.open(m,"_blank","noopener")}function D(s){if(!(s.characters||[]).length)return"";let d=c().filter(u=>u.target?.characterId);return`<section class="vpc-sec"><h4>Characters</h4>${s.characters.map(u=>{let v=d.some(x=>x.target.characterId===u.id),T=(u.anchors||[])[0],I=u.candidates||[],z=T?"Anchor approved":I.length?"Pick an anchor":v?"Generating anchor":"No anchor yet",C=[T?`<div class="vpc-tile is-approved"><button type="button" class="vpc-tile-media" data-vpa="view" data-path="${l(T)}" aria-label="View anchor">${X(T,"vpc-tile-img")}</button><span class="vpc-badge">${y.check}</span></div>`:"",...I.map(x=>`<div class="vpc-tile">
          <button type="button" class="vpc-tile-media" data-vpa="view" data-path="${l(x)}" aria-label="View candidate">${X(x,"vpc-tile-img")}</button>
          <div class="vpc-tile-actions">
            ${B("approve-anchor",y.check,"Approve as anchor",`data-c="${l(u.id)}" data-path="${l(x)}"`,"is-go")}
            ${B("reject-anchor",y.x,"Reject",`data-c="${l(u.id)}" data-path="${l(x)}"`)}
          </div>
        </div>`),v?'<div class="vpc-tile is-loading"><span class="vpc-spin"></span></div>':""].join("");return`<div class="vpc-char">
        <div class="vpc-row">
          <span class="vpc-char-name">${y.user}<strong>${l(u.name)}</strong></span>
          <span class="vpc-muted">${l(z)}</span>
          <span class="vpc-grow"></span>
          ${u.anchorPrompt?B("reroll",y.reroll,"Generate another anchor",`data-c="${l(u.id)}"`):""}
        </div>
        ${C?`<div class="vpc-strip">${C}</div>`:""}
      </div>`}).join("")}</section>`}function W(s){let d=s.shots||[];if(!d.length)return'<section class="vpc-sec"><p class="vpc-muted">No shots planned yet. Ask Prom to plan the shot list.</p></section>';let m=new Set(c().map(v=>v.target?.shotId).filter(Boolean)),u=d.map((v,T)=>{let I=re(v),z=m.has(v.id),C=e.openShot===v.id,x=(v.takes||[]).length,_=C?(v.takes||[]).slice().reverse().map($=>`
        <div class="vpc-take${$.id===I?.id?" is-selected":""}">
          ${J($.path)?`<video src="${l(F($.path))}#t=0.1" controls playsinline preload="metadata"></video>`:`<img src="${l(F($.path))}" alt="" loading="lazy">`}
          <div class="vpc-row">
            <span class="vpc-muted">${l(G($.modelId))} \xB7 ${V($.costUsd)}</span>
            <span class="vpc-grow"></span>
            ${$.id===I?.id?`<span class="vpc-inuse">${y.check}In cut</span>`:B("use-take",y.check,"Use this take",`data-s="${l(v.id)}" data-t="${l($.id)}"`,"is-go")}
          </div>
        </div>`).join(""):"";return`<div class="vpc-shot${C?" is-open":""}">
        <button type="button" class="vpc-shot-head" data-vpa="toggle" data-s="${l(v.id)}" aria-expanded="${C}">
          ${z&&!I?'<span class="vpc-thumb is-empty"><span class="vpc-spin"></span></span>':X(I?.path)}
          <span class="vpc-shot-meta">
            <strong>${T+1}. ${l(v.title||"Shot")}</strong>
            <small>${l(String(v.prompt||"").slice(0,110))}</small>
            <span class="vpc-status is-${z?"generating":l(v.status)}">${z?"generating":l(v.status)} \xB7 ${v.durationSec}s \xB7 ${x} take${x===1?"":"s"}</span>
          </span>
          <span class="vpc-chev">${y.chevron}</span>
        </button>
        ${C?`<div class="vpc-shot-body">
          <p class="vpc-prompt">${l(v.prompt||"")}${v.camera?`<br><span class="vpc-muted">Camera: ${l(v.camera)}</span>`:""}</p>
          <div class="vpc-row">
            <button type="button" class="vpc-btn" data-vpa="redo-shot" data-s="${l(v.id)}" data-n="1" ${z?"disabled":""}>${y.reroll}<span>${x?"Redo":"Generate"}</span></button>
            <button type="button" class="vpc-btn" data-vpa="redo-shot" data-s="${l(v.id)}" data-n="3" ${z?"disabled":""}>${y.layers}<span>3 variations</span></button>
          </div>
          ${_?`<div class="vpc-takes">${_}</div>`:""}
        </div>`:""}
      </div>`}).join("");return`<section class="vpc-sec"><h4>Shots <span class="vpc-muted">${d.length}</span></h4>${u}</section>`}function U(s){let d=[];if(e.pending){let x=(e.pending.estimate?.shots||[]).map(_=>`<li>${l(_.title||"Item")}: ${_.count}\xD7 ${l(G(_.modelId))} \xB7 ${V(_.usd)}</li>`).join("");d.push(`<div class="vpc-approve">
        <strong>Approve ${V(e.pending.estimate?.total)}?</strong>
        <p class="vpc-muted">${l(e.pending.reason||"")}</p>
        ${x?`<ul>${x}</ul>`:""}
        <div class="vpc-row">
          <button type="button" class="vpc-btn is-primary" data-vpa="approve-pending">${y.check}<span>Approve & run</span></button>
          <button type="button" class="vpc-btn" data-vpa="cancel-pending">${y.x}<span>Cancel</span></button>
        </div>
      </div>`)}let m=g(),u=e.estimate;if(!e.pending&&m.length&&u){let x=(u.shots||[]).flatMap($=>($.problems||[]).map(fe=>`${$.title}: ${fe}`)),_=(s.characters||[]).some($=>!($.anchors||[]).length&&($.candidates||[]).length);d.push(`<div class="vpc-gen">
        <div class="vpc-row"><strong>${m.length} shot${m.length===1?"":"s"} to generate</strong><span class="vpc-grow"></span><strong>~${V(u.total)}</strong></div>
        ${_?'<p class="vpc-warn">Approve a character anchor first so every shot keeps the same face.</p>':""}
        ${x.length?`<ul class="vpc-warn">${x.map($=>`<li>${l($)}</li>`).join("")}</ul>`:""}
        <button type="button" class="vpc-btn is-primary is-wide" data-vpa="gen-all" ${_?"disabled":""}>${y.spark}<span>${u.total>(s.budget?.autoApproveUsd??1)?"Approve & generate":"Generate"} \xB7 ${V(u.total)}</span></button>
      </div>`)}let v=c();v.length&&d.push(`<div class="vpc-jobs"><span class="vpc-spin"></span><span>Generating ${v.length} job${v.length===1?"":"s"}. Takes land here as they finish.</span></div>`);let T=(s.jobs||[]).filter(x=>x.state==="failed").slice(-2);T.length&&!v.length&&d.push(`<ul class="vpc-warn">${T.map(x=>`<li>${l(G(x.modelId))} failed: ${l(String(x.error||"unknown").slice(0,160))}</li>`).join("")}</ul>`);let I=s.shots||[],z=I.length&&I.every(x=>re(x)),C=(s.exports||[]).slice(-1)[0];return(z||C)&&d.push(`<div class="vpc-final">
        ${C?`<video src="${l(F(C.path))}" controls playsinline preload="metadata"></video>
          <div class="vpc-row"><span class="vpc-muted">Final cut \xB7 ${Number(C.durationSec||0).toFixed(1)}s</span><span class="vpc-grow"></span>
          ${B("view",y.download,"Open video",`data-path="${l(C.path)}"`)}</div>`:""}
        ${z?`<div class="vpc-row">
          <button type="button" class="vpc-btn is-primary" data-vpa="render" ${e.rendering||v.length?"disabled":""}>${e.rendering?'<span class="vpc-spin"></span>':y.play}<span>${C?"Re-render":"Render video"}</span></button>
          ${B("assemble",y.seq,"Rebuild the cut from the selected takes")}
        </div>`:""}
      </div>`),d.length?`<section class="vpc-sec vpc-actions">${d.join("")}</section>`:""}function L(){if(!a())return;let s=e.project;if(!s){r.innerHTML=`<div class="vpc"><div class="vpc-head"><span class="vpc-kicker">${y.film}Video project</span></div>
        <p class="vpc-muted">${e.error?l(e.error):"Loading\u2026"}</p></div>`;return}let d=s.budget||{};r.innerHTML=`<div class="vpc">
      <div class="vpc-head">
        <div class="vpc-headtext">
          <span class="vpc-kicker">${y.film}Video project \xB7 ${l(s.target?.aspect||"")}</span>
          <strong class="vpc-title">${l(s.title||s.id)}</strong>
          <span class="vpc-muted">${V(d.spentUsd)} spent${d.capUsd!=null?` of ${V(d.capUsd)}`:""} \xB7 auto-approve under ${V(d.autoApproveUsd??1)}</span>
        </div>
        <div class="vpc-tools">
          ${B("undo",y.undo,"Undo",e.history?.undo?"":"disabled")}
          ${B("redo",y.redo,"Redo",e.history?.redo?"":"disabled")}
          ${B("refresh",y.refresh,"Refresh")}
        </div>
      </div>
      ${e.busy?`<div class="vpc-busy"><span class="vpc-spin"></span>${l(e.busy)}\u2026</div>`:""}
      ${e.error?`<p class="vpc-err">${l(e.error)}</p>`:""}
      ${D(s)}
      ${W(s)}
      ${U(s)}
    </div>`}r.addEventListener("click",async s=>{let d=s.target.closest("[data-vpa]");if(!d||!r.contains(d)||d.disabled||(s.preventDefault(),s.stopPropagation(),e.busy&&d.dataset.vpa!=="toggle"&&d.dataset.vpa!=="view"))return;let m=d.dataset.vpa,u=d.dataset;switch(m){case"toggle":e.openShot=e.openShot===u.s?"":u.s,L();return;case"view":u.path&&A(u.path);return;case"refresh":e.estimateKey="",await p();return;case"undo":case"redo":await h(m==="undo"?"Undoing":"Redoing",()=>R(`/${encodeURIComponent(t)}/${m}`,{})),e.estimateKey="",await p();return;case"approve-anchor":await w([{op:"character.approveAnchor",id:u.c,path:u.path}],"Approving anchor");return;case"reject-anchor":await w([{op:"character.rejectAnchor",id:u.c,path:u.path}],"Removing");return;case"reroll":await k(`/characters/${encodeURIComponent(u.c)}/anchor`,{count:1},"Generating anchor");return;case"use-take":await w([{op:"take.select",shotId:u.s,takeId:u.t}],"Swapping take");return;case"redo-shot":await k("/generate",{shotIds:[u.s],count:Number(u.n)||1},"Estimating");return;case"gen-all":{let v=g().map(T=>T.id);if(!v.length)return;await k("/generate",{shotIds:v,count:1,approved:!0},"Submitting");return}case"approve-pending":{let v=e.pending;if(!v)return;e.pending=null,await k(v.path,v.body,"Submitting");return}case"cancel-pending":e.pending=null,L();return;case"assemble":await w([{op:"timeline.assemble"}],"Assembling");return;case"render":await j();return;default:}}),L(),n&&Date.now()-n.at<3e3?f().then(()=>{L(),b()}):p()}var K=null,Z=!1;function ne(r=document){Z=!1,r.querySelectorAll?.(be).forEach(t=>{try{xe(t)}catch(n){console.warn("[video-project-card] mount failed",n)}})}function oe(){if(!(typeof document>"u")){if(!document.getElementById(ee)){let r=document.createElement("style");r.id=ee,r.textContent=ye,document.head.appendChild(r)}ne(),!K&&(K=new MutationObserver(()=>{Z||(Z=!0,requestAnimationFrame(()=>ne()))}),K.observe(document.documentElement,{childList:!0,subtree:!0}))}}var ye=`
.prom-vp-card{--vpc-text:var(--prom-text,var(--pm-text,var(--text,currentColor)));--vpc-muted:var(--prom-muted,var(--pm-muted,var(--muted,#8a8a8a)));--vpc-line:var(--prom-border,var(--pm-border,var(--line,rgba(127,127,127,.25))));--vpc-surface:var(--prom-surface,var(--pm-surface,var(--panel,rgba(127,127,127,.06))));--vpc-soft:var(--prom-surface-secondary,var(--pm-bg-soft,var(--panel-2,rgba(127,127,127,.1))));--vpc-accent:var(--prom-accent,var(--pm-orange,var(--brand,#ff7a1a)));display:block;margin:10px 0;max-width:100%;color:var(--vpc-text);font-size:14px;line-height:1.4}
.prom-vp-card .vpc{border:1px solid var(--vpc-line);border-radius:14px;background:var(--vpc-surface);overflow:hidden}
.prom-vp-card svg{width:16px;height:16px;flex:none}
.prom-vp-card .vpc-head{display:flex;gap:10px;align-items:flex-start;padding:12px 12px 10px;border-bottom:1px solid var(--vpc-line)}
.prom-vp-card .vpc-headtext{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1}
.prom-vp-card .vpc-kicker{display:inline-flex;gap:6px;align-items:center;font-size:11px;letter-spacing:.04em;text-transform:uppercase;color:var(--vpc-muted)}
.prom-vp-card .vpc-kicker svg{width:13px;height:13px}
.prom-vp-card .vpc-title{font-size:15px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.prom-vp-card .vpc-muted{color:var(--vpc-muted);font-size:12px}
.prom-vp-card .vpc-tools{display:flex;gap:2px}
.prom-vp-card .vpc-icon{display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:9px;border:0;background:transparent;color:var(--vpc-text);cursor:pointer;padding:0}
.prom-vp-card .vpc-icon:hover{background:var(--vpc-soft)}
.prom-vp-card .vpc-icon:disabled{opacity:.35;cursor:default}
.prom-vp-card .vpc-icon.is-go{color:var(--vpc-accent)}
.prom-vp-card .vpc-sec{padding:10px 12px;border-bottom:1px solid var(--vpc-line)}
.prom-vp-card .vpc-sec:last-child{border-bottom:0}
.prom-vp-card h4{margin:0 0 8px;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;color:var(--vpc-muted);display:flex;gap:6px}
.prom-vp-card .vpc-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.prom-vp-card .vpc-grow{flex:1}
.prom-vp-card .vpc-char+.vpc-char{margin-top:10px}
.prom-vp-card .vpc-char-name{display:inline-flex;gap:6px;align-items:center}
.prom-vp-card .vpc-strip{display:flex;gap:8px;overflow-x:auto;padding:8px 0 2px;scrollbar-width:thin}
.prom-vp-card .vpc-tile{position:relative;flex:none;width:112px;border-radius:10px;overflow:hidden;border:1px solid var(--vpc-line);background:var(--vpc-soft)}
.prom-vp-card .vpc-tile.is-approved{border-color:var(--vpc-accent);box-shadow:0 0 0 1px var(--vpc-accent)}
.prom-vp-card .vpc-tile.is-loading{height:140px;display:flex;align-items:center;justify-content:center}
.prom-vp-card .vpc-tile-media{display:block;width:100%;padding:0;border:0;background:none;cursor:zoom-in}
.prom-vp-card .vpc-tile-img{display:block;width:100%;height:140px;object-fit:cover}
.prom-vp-card .vpc-tile-actions{display:flex;justify-content:space-around;border-top:1px solid var(--vpc-line)}
.prom-vp-card .vpc-badge{position:absolute;top:6px;right:6px;width:22px;height:22px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:var(--vpc-accent);color:#fff}
.prom-vp-card .vpc-badge svg{width:13px;height:13px}
.prom-vp-card .vpc-shot{border:1px solid var(--vpc-line);border-radius:11px;overflow:hidden}
.prom-vp-card .vpc-shot+.vpc-shot{margin-top:8px}
.prom-vp-card .vpc-shot-head{display:flex;gap:10px;align-items:center;width:100%;padding:8px;border:0;background:transparent;color:inherit;text-align:left;cursor:pointer;font:inherit}
.prom-vp-card .vpc-thumb{flex:none;width:72px;height:48px;border-radius:7px;object-fit:cover;background:var(--vpc-soft);display:flex;align-items:center;justify-content:center;color:var(--vpc-muted)}
.prom-vp-card .vpc-shot-meta{display:flex;flex-direction:column;gap:1px;min-width:0;flex:1}
.prom-vp-card .vpc-shot-meta small{color:var(--vpc-muted);font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.prom-vp-card .vpc-status{font-size:11px;color:var(--vpc-muted)}
.prom-vp-card .vpc-status.is-ready{color:var(--prom-success,#2eaa5c)}
.prom-vp-card .vpc-status.is-failed{color:var(--prom-danger,#e5484d)}
.prom-vp-card .vpc-status.is-generating{color:var(--vpc-accent)}
.prom-vp-card .vpc-chev{color:var(--vpc-muted);transition:transform .15s}
.prom-vp-card .vpc-shot.is-open .vpc-chev{transform:rotate(180deg)}
.prom-vp-card .vpc-shot-body{padding:0 8px 10px}
.prom-vp-card .vpc-prompt{margin:0 0 8px;font-size:13px}
.prom-vp-card .vpc-takes{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px;margin-top:8px}
.prom-vp-card .vpc-take{border:1px solid var(--vpc-line);border-radius:9px;overflow:hidden;padding-bottom:2px}
.prom-vp-card .vpc-take.is-selected{border-color:var(--vpc-accent)}
.prom-vp-card .vpc-take video,.prom-vp-card .vpc-take img{display:block;width:100%;max-height:220px;background:#000;object-fit:contain}
.prom-vp-card .vpc-take .vpc-row{padding:4px 6px 2px}
.prom-vp-card .vpc-inuse{display:inline-flex;gap:4px;align-items:center;font-size:12px;color:var(--vpc-accent)}
.prom-vp-card .vpc-inuse svg{width:13px;height:13px}
.prom-vp-card .vpc-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:34px;padding:0 12px;border-radius:10px;border:1px solid var(--vpc-line);background:var(--vpc-soft);color:var(--vpc-text);font:inherit;font-size:13px;cursor:pointer}
.prom-vp-card .vpc-btn:disabled{opacity:.45;cursor:default}
.prom-vp-card .vpc-btn.is-primary{background:var(--vpc-accent);border-color:transparent;color:#fff;font-weight:600}
.prom-vp-card .vpc-btn.is-wide{width:100%;margin-top:8px;min-height:40px}
.prom-vp-card .vpc-actions>*+*{margin-top:10px}
.prom-vp-card .vpc-approve{border:1px solid var(--vpc-accent);border-radius:11px;padding:10px}
.prom-vp-card .vpc-approve p{margin:4px 0}
.prom-vp-card ul{margin:6px 0;padding-left:18px;font-size:12px}
.prom-vp-card .vpc-warn{color:var(--prom-warning,#d9822b);font-size:12px;margin:6px 0}
.prom-vp-card .vpc-err{margin:0;padding:8px 12px;color:var(--prom-danger,#e5484d);font-size:12px;border-bottom:1px solid var(--vpc-line)}
.prom-vp-card .vpc-busy,.prom-vp-card .vpc-jobs{display:flex;gap:8px;align-items:center;font-size:12px;color:var(--vpc-muted)}
.prom-vp-card .vpc-busy{padding:6px 12px;border-bottom:1px solid var(--vpc-line)}
.prom-vp-card .vpc-final video{display:block;width:100%;max-height:420px;border-radius:10px;background:#000}
.prom-vp-card .vpc-final .vpc-row{margin-top:6px}
.prom-vp-card .vpc-spin{width:14px;height:14px;border-radius:50%;border:2px solid var(--vpc-line);border-top-color:var(--vpc-accent);animation:vpc-spin .8s linear infinite;flex:none}
@keyframes vpc-spin{to{transform:rotate(360deg)}}
`;function M(r){return r?String(r).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"):""}var Je=M;function we(r){let t=Date.now()-r;return t<6e4?"just now":t<36e5?`${Math.floor(t/6e4)}m ago`:t<864e5?`${Math.floor(t/36e5)}h ago`:`${Math.floor(t/864e5)}d ago`}function $e(r,t=0){let n=Number(r);return Number.isFinite(n)?`${n.toFixed(t)}%`:"--%"}function Se(r,t){let n=Number(r),e=Number(t);return!Number.isFinite(n)||!Number.isFinite(e)||e<=0?"-- / -- GB":`${n.toFixed(1)} / ${e.toFixed(1)} GB`}function se(r){let t=Number(r);return Number.isFinite(t)?`${Math.max(0,Math.min(100,t))}%`:"0%"}function ke(r,t){let n=document.getElementById(r);n&&(n.textContent=String(t||""))}function Ze(r){let t=String(r||"").trim(),n=M(t);return`<span class="t-think-sizer" aria-hidden="true">${n}</span><span class="t-think-text" data-text="${n}">${n}</span>`}function Qe(r,t){let n=String(t||"").trim(),e=r?.querySelector?.(".t-think-text");if(!e||!n)return!1;let o=String(e.textContent||"").trim();if(!o||o===n)return!1;r.querySelectorAll?.(".t-think-text").forEach(c=>{c!==e&&c.remove()});let a=e.cloneNode(!0);a.classList.remove("is-enter-start"),a.classList.add("is-exit"),a.textContent=n,a.setAttribute("data-text",n),e.classList.remove("is-exit"),e.classList.add("is-enter-start");let i=r.querySelector?.(".t-think-sizer");i&&n.length>String(i.textContent||"").length&&(i.textContent=n),r.appendChild(a),e.offsetWidth;let p=()=>{e.isConnected!==!1&&e.classList.remove("is-enter-start")};return typeof requestAnimationFrame=="function"?requestAnimationFrame(p):typeof setTimeout=="function"&&setTimeout(p,0),typeof setTimeout=="function"&&setTimeout(()=>{a.isConnected!==!1&&a.remove(),e.isConnected!==!1&&e.classList.remove("is-enter-start")},420),!0}function Ce(r,t){let n=document.getElementById(r);n&&(n.style.width=se(t))}function ie(r,t,n="info",e=5e3,o={}){let a=typeof o?.key=="string"?o.key.trim():"";if(a)for(let h of document.querySelectorAll(".__sc-toast"))h.dataset.scToastKey===a&&h.remove();let i=n==="warn"?"warning":["info","success","error","warning"].includes(n)?n:"info",p={info:"\u2139\uFE0F",success:"\u2713",error:"\u26A0\uFE0F",warning:"\u26A0\uFE0F"},c=document.createElement("div"),g=24+[...document.querySelectorAll(".__sc-toast")].reduce((h,w)=>h+w.offsetHeight+8,0);if(c.className=`__sc-toast __sc-toast--${i}`,a&&(c.dataset.scToastKey=a),c.style.cssText=`position:fixed;bottom:${g}px;right:24px;z-index:99999;`,c.innerHTML=`
    <span class="__sc-toast-icon" aria-hidden="true">${p[i]}</span>
    <div class="__sc-toast-copy">
      <div class="__sc-toast-title">${M(r)}</div>
      ${t?`<div class="__sc-toast-body">${M(String(t))}</div>`:""}
    </div>
    <button class="__sc-toast-close" type="button" aria-label="Dismiss">&times;</button>
  `,!document.getElementById("__sc-toast-style")){let h=document.createElement("style");h.id="__sc-toast-style",h.textContent="@keyframes scToastIn{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}",document.head.appendChild(h)}document.body.appendChild(c);let f=Math.max(0,Math.min(5e3,Number.isFinite(Number(e))?Number(e):5e3));setTimeout(()=>{c.style.transition="opacity 0.3s",c.style.opacity="0",setTimeout(()=>c.remove(),300)},f),c.querySelector(".__sc-toast-close")?.addEventListener("click",()=>c.remove())}function Ee(r,t){ie(r,t,"info")}function Me(r,t,n,e={}){let{title:o="Confirm",confirmText:a="Confirm",cancelText:i="Cancel",danger:p=!1,details:c=""}=e,b=document.createElement("div");b.style.cssText="position:fixed;inset:0;z-index:99998;background:rgba(0,0,0,0.35);display:flex;align-items:center;justify-content:center;animation:scToastIn 0.15s ease";let g=document.createElement("div");g.style.cssText="background:var(--panel);border:1.5px solid var(--line);border-radius:14px;padding:24px 24px 18px;max-width:560px;width:92%;box-shadow:0 8px 40px rgba(0,0,0,0.18);font-family:var(--font)",g.innerHTML=`
    <div style="font-size:15px;font-weight:800;margin-bottom:10px">${M(o)}</div>
    <div style="font-size:13px;color:var(--muted);line-height:1.6;margin-bottom:18px">${M(r)}</div>
    ${c?`<pre style="margin:0 0 18px;padding:12px 14px;border-radius:10px;border:1px solid var(--line);background:var(--panel-2);font-size:11px;line-height:1.65;color:var(--text);white-space:pre-wrap;word-break:break-word;font-family:'Cascadia Code','Fira Code','Consolas',monospace">${M(c)}</pre>`:""}
    <div style="display:flex;gap:8px;justify-content:flex-end">
      <button id="__sc-confirm-cancel" style="border:1px solid var(--line);background:var(--panel-2);color:var(--muted);border-radius:8px;padding:7px 16px;font-size:12px;font-weight:700;cursor:pointer">${M(i)}</button>
      <button id="__sc-confirm-ok" style="border:none;background:${p?"#dc2626":"var(--brand)"};color:#fff;border-radius:8px;padding:7px 16px;font-size:12px;font-weight:700;cursor:pointer">${M(a)}</button>
    </div>
  `,b.appendChild(g),document.body.appendChild(b);let f=()=>b.remove();g.querySelector("#__sc-confirm-cancel").onclick=()=>{f(),n&&n()},g.querySelector("#__sc-confirm-ok").onclick=()=>{f(),t&&t()},b.addEventListener("click",h=>{h.target===b&&(f(),n&&n())})}var q=[];function Te(r,t="log"){let n=new Date().toLocaleTimeString();q.push({text:`[${n}] ${String(r??"")}`,type:String(t||"log").replace(/[^a-z0-9_-]/gi,"")||"log"}),q.length>100&&q.shift();let e=document.getElementById("log-panel");e&&(e.replaceChildren(...q.map(o=>{let a=document.createElement("div");return a.className=`log-line ${o.type}`,a.textContent=o.text,a})),e.scrollTop=e.scrollHeight)}var E=Object.freeze({bg:"transparent",bgSoft:"transparent",surface:"transparent",surfaceSecondary:"transparent",border:"currentColor",borderStrong:"currentColor",text:"currentColor",muted:"currentColor",accent:"currentColor",accentStrong:"currentColor",success:"currentColor",warning:"currentColor",danger:"currentColor"});function ce(r,t){return String(r||"").replace(/[<>{};\r\n]/g,"").trim()||t}function de(){let r=document.documentElement,t=typeof getComputedStyle=="function"?getComputedStyle(r):null,n=(o,a)=>{for(let i of o){let p=t?.getPropertyValue(i)?.trim();if(p)return ce(p,a)}return a},e={isDark:r.getAttribute("data-theme")==="dark",bg:n(["--bg","--pm-chat-page-bg"],E.bg),bgSoft:n(["--bg-soft"],E.bgSoft),surface:n(["--panel","--composer-panel"],E.surface),surfaceSecondary:n(["--panel-2","--composer-bg"],E.surfaceSecondary),border:n(["--line","--composer-border"],E.border),borderStrong:n(["--line-strong"],E.borderStrong),text:n(["--text","--fg","--composer-text"],E.text),muted:n(["--muted","--composer-muted"],E.muted),accent:n(["--brand","--pm-custom-accent"],E.accent),accentStrong:n(["--brand-2"],E.accentStrong),success:n(["--ok"],E.success),warning:n(["--warn"],E.warning),danger:n(["--err"],E.danger)};return e.series=[e.accent,e.accentStrong,e.success,e.warning,e.danger,e.muted],e.vars={"--prom-bg":e.bg,"--prom-bg-soft":e.bgSoft,"--prom-surface":e.surface,"--prom-surface-secondary":e.surfaceSecondary,"--prom-border":e.border,"--prom-border-strong":e.borderStrong,"--prom-text":e.text,"--prom-muted":e.muted,"--prom-accent":e.accent,"--prom-accent-strong":e.accentStrong,"--prom-success":e.success,"--prom-warning":e.warning,"--prom-danger":e.danger,"--prom-series-1":e.series[0],"--prom-series-2":e.series[1],"--prom-series-3":e.series[2],"--prom-series-4":e.series[3],"--prom-series-5":e.series[4],"--prom-series-6":e.series[5],"--bg":e.bg,"--bg-soft":e.bgSoft,"--panel":e.surface,"--panel-2":e.surfaceSecondary,"--line":e.border,"--line-strong":e.borderStrong,"--text":e.text,"--fg":e.text,"--muted":e.muted,"--brand":e.accent,"--brand-2":e.accentStrong,"--ok":e.success,"--warn":e.warning,"--err":e.danger},e}function Ae(r){if(r&&typeof r=="object"&&r.vars)return r;let t={isDark:typeof r=="boolean"?r:!!r?.isDark,...E};return t.series=[t.accent,t.accentStrong,t.success,t.warning,t.danger,t.muted],t.vars=Object.fromEntries([["--prom-bg",t.bg],["--prom-bg-soft",t.bgSoft],["--prom-surface",t.surface],["--prom-surface-secondary",t.surfaceSecondary],["--prom-border",t.border],["--prom-border-strong",t.borderStrong],["--prom-text",t.text],["--prom-muted",t.muted],["--prom-accent",t.accent],["--prom-accent-strong",t.accentStrong],["--prom-success",t.success],["--prom-warning",t.warning],["--prom-danger",t.danger],...t.series.map((n,e)=>[`--prom-series-${e+1}`,n]),["--bg",t.bg],["--bg-soft",t.bgSoft],["--panel",t.surface],["--panel-2",t.surfaceSecondary],["--line",t.border],["--line-strong",t.borderStrong],["--text",t.text],["--fg",t.text],["--muted",t.muted],["--brand",t.accent],["--brand-2",t.accentStrong],["--ok",t.success],["--warn",t.warning],["--err",t.danger]]),t}function Ie(r){let t=r?.vars&&typeof r.vars=="object"?r.vars:{};return Object.entries(t).map(([n,e])=>`${n}:${ce(e,"transparent")}`).join(";")}function pe(r,t,n){let e=Ae(n),o=Y({background:"transparent",primaryColor:e.surface,primaryTextColor:e.text,primaryBorderColor:e.borderStrong,lineColor:e.muted,secondaryColor:e.surfaceSecondary,secondaryTextColor:e.text,secondaryBorderColor:e.border,tertiaryColor:e.bgSoft,tertiaryTextColor:e.text,tertiaryBorderColor:e.border,textColor:e.text,mainBkg:e.surface,nodeBorder:e.borderStrong,clusterBkg:e.surfaceSecondary,clusterBorder:e.border,edgeLabelBackground:"transparent"}),a=Y({text:e.text,muted:e.muted,border:e.border,series:e.series}),i=`:root{${Ie(e)}color-scheme:${e.isDark?"dark":"light"}}*{margin:0;padding:0;box-sizing:border-box}html,body{background:transparent!important;color:var(--prom-text);color-scheme:${e.isDark?"dark":"light"};max-width:100%;overflow-x:hidden}body{min-height:0;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}`;return r==="chart"?`<!DOCTYPE html><html><head><meta charset="UTF-8">
<script src="/vendor/chart/chart.umd.js"><\/script>
<style>${i}body{display:flex;align-items:center;justify-content:center;min-height:220px;padding:8px}canvas{width:100%!important;max-width:100%;max-height:100%}</style>
</head><body><canvas id="c"></canvas>
<script>try{const visualTheme=${a};Chart.defaults.color=visualTheme.text;Chart.defaults.borderColor=visualTheme.border;const cfg=(${t});if(cfg.options)cfg.options.responsive=true;else cfg.options={responsive:true};const datasets=cfg.data&&Array.isArray(cfg.data.datasets)?cfg.data.datasets:[];datasets.forEach((dataset,index)=>{const color=visualTheme.series[index%visualTheme.series.length];if(!dataset.backgroundColor)dataset.backgroundColor=color;if(!dataset.borderColor)dataset.borderColor=color;});const chart=new Chart(document.getElementById('c'),cfg);window.addEventListener('prometheus:visual-theme-change',(event)=>{const next=event.detail||{};if(next.text)Chart.defaults.color=next.text;if(next.border)Chart.defaults.borderColor=next.border;chart.update('none');});}catch(e){document.body.innerHTML='<pre style="color:var(--prom-danger);padding:8px;font-size:11px;white-space:pre-wrap">'+e.message+'<\\/pre>';}<\/script>
</body></html>`:r==="svg"?`<!DOCTYPE html><html><head><meta charset="UTF-8">
<style>${i}body{padding:0}.sv-shell{position:relative;min-height:200px;height:200px;overflow:hidden;background:transparent}.sv-viewport{position:absolute;inset:0;cursor:grab;touch-action:none;user-select:none}.sv-viewport.dragging{cursor:grabbing}.sv-stage{position:absolute;left:0;top:0;transform-origin:0 0;will-change:transform}.sv-stage svg{max-width:none!important;height:auto;display:block}.sv-controls{position:absolute;top:10px;right:10px;display:flex;gap:6px;z-index:5;opacity:0;transform:translateY(-4px);pointer-events:none;transition:opacity .2s ease,transform .2s ease}.sv-shell:hover .sv-controls,.sv-shell:focus-within .sv-controls{opacity:1;transform:translateY(0);pointer-events:auto}.sv-btn{border:1px solid var(--prom-border);background:var(--prom-surface);color:var(--prom-text);border-radius:8px;padding:4px 9px;font-weight:700;font-size:12px;line-height:1;cursor:pointer;backdrop-filter:blur(2px)}.sv-btn:hover{filter:brightness(1.08)}.sv-hint{position:absolute;left:10px;bottom:10px;font-size:11px;color:var(--prom-muted);opacity:0;transform:translateY(4px);background:var(--prom-surface);border:1px solid var(--prom-border);border-radius:999px;padding:4px 9px;pointer-events:none;transition:opacity .2s ease,transform .2s ease}.sv-shell:hover .sv-hint,.sv-shell:focus-within .sv-hint{opacity:.82;transform:translateY(0)}</style>
</head><body>
<div class="sv-shell">
  <div class="sv-controls">
    <button class="sv-btn" id="sv-out" type="button">-</button>
    <button class="sv-btn" id="sv-in" type="button">+</button>
    <button class="sv-btn" id="sv-reset" type="button">Reset</button>
  </div>
  <div class="sv-viewport" id="sv-vp">
    <div class="sv-stage" id="sv-stage">${t}</div>
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
<style>${i}body{padding:0}.mm-shell{position:relative;min-height:200px;height:200px;overflow:hidden;background:transparent}.mm-viewport{position:absolute;inset:0;cursor:grab;touch-action:none;user-select:none}.mm-viewport.dragging{cursor:grabbing}.mm-stage{position:absolute;left:0;top:0;transform-origin:0 0;will-change:transform}.mermaid svg{max-width:none!important;height:auto;background:transparent!important}.mermaid{background:transparent!important}.mm-controls{position:absolute;top:10px;right:10px;display:flex;gap:6px;z-index:5;opacity:0;transform:translateY(-4px);pointer-events:none;transition:opacity .2s ease,transform .2s ease}.mm-shell:hover .mm-controls{opacity:1;transform:translateY(0);pointer-events:auto}.mm-btn{border:1px solid var(--prom-border);background:var(--prom-surface);color:var(--prom-text);border-radius:8px;padding:4px 9px;font-weight:700;font-size:12px;line-height:1;cursor:pointer;backdrop-filter:blur(2px)}.mm-btn:hover{filter:brightness(1.08)}.mm-hint{position:absolute;left:10px;bottom:10px;font-size:11px;color:var(--prom-muted);opacity:0;transform:translateY(4px);background:var(--prom-surface);border:1px solid var(--prom-border);border-radius:999px;padding:4px 9px;pointer-events:none;transition:opacity .2s ease,transform .2s ease}.mm-shell:hover .mm-hint{opacity:.82;transform:translateY(0)}</style>
</head><body>
<div class="mm-shell">
  <div class="mm-controls">
    <button class="mm-btn" id="mm-zoom-out" type="button">-</button>
    <button class="mm-btn" id="mm-zoom-in" type="button">+</button>
    <button class="mm-btn" id="mm-reset" type="button">Reset</button>
  </div>
  <div class="mm-viewport" id="mm-viewport">
    <div class="mm-stage" id="mm-stage">
      <div class="mermaid" id="mm-graph">${t.replace(/</g,"&lt;").replace(/>/g,"&gt;")}</div>
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
<style>${i}body{font-family:inherit;color:var(--prom-text);min-height:0;width:100%;overflow-x:hidden}</style>
</head><body>${t}</body></html>`}function P(r){return String(r||"").replace(/&/g,"&amp;").replace(/"/g,"&quot;")}function Y(r){return JSON.stringify(r??null).replace(/</g,"\\u003c")}function ze(r,t={}){let n=String(t.visualId||""),e=t.state&&typeof t.state=="object"?t.state:{},o=`<script>(function(){
var visualId=${Y(n)},last=0,state=${Y(e)}||{};
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
if('ResizeObserver'in window){var ro=new ResizeObserver(send);if(document.documentElement)ro.observe(document.documentElement);if(document.body)ro.observe(document.body)}addEventListener('load',function(){restoreControls();send();post('prometheus:visual-ready')});setTimeout(send,50);setTimeout(send,250);setTimeout(send,1000)})();<\/script>`,a=String(r||"");return/<head\b[^>]*>/i.test(a)?a.replace(/<head\b[^>]*>/i,i=>`${i}${o}`):`${o}${a}`}function _e(){if(window.__PROM_VISUAL_MESSAGE_BRIDGE_INSTALLED__)return;window.__PROM_VISUAL_MESSAGE_BRIDGE_INSTALLED__=!0;let r=()=>{let t=de();document.querySelectorAll('iframe[data-prom-visual="true"]').forEach(n=>{let e=String(n.getAttribute("data-visual-id")||"");if(!(!e||!n.contentWindow))try{n.contentWindow.postMessage({type:"prometheus:visual-theme",visualId:e,theme:t},"*")}catch{}})};document.addEventListener("prom-theme-change",()=>setTimeout(r,0)),document.addEventListener("prom-appearance-change",()=>setTimeout(r,0)),window.addEventListener("message",t=>{let n=t?.data;if(!n||!String(n.type||"").startsWith("prometheus:visual-"))return;let e=Array.from(document.querySelectorAll('iframe[data-prom-visual="true"]')).find(a=>a.contentWindow===t.source);if(!e)return;let o=String(e.getAttribute("data-visual-id")||"");if(String(n.visualId||"")===o){if(n.type==="prometheus:visual-resize"){let a=Number(n.height);if(!Number.isFinite(a))return;let i=Math.min(1e4,Math.max(120,Math.ceil(a))),p=Math.ceil(e.getBoundingClientRect().height||0);if(Math.abs(p-i)<=1)return;e.style.height=`${i}px`,e.style.minHeight=`${i}px`;return}if(n.type==="prometheus:visual-state"&&n.state&&typeof n.state=="object"){window.dispatchEvent(new CustomEvent("prometheus:visual-state-change",{detail:{visualId:o,state:n.state}}));return}n.type==="prometheus:visual-followup"&&n.prompt&&window.dispatchEvent(new CustomEvent("prometheus:visual-followup",{detail:{visualId:o,prompt:String(n.prompt),title:String(n.title||"")}}))}})}function Q(r){if(!r?.getAttribute)return"";let t=r.closest?.(".visual-block"),n=String(r.getAttribute("data-visual-id")||"").trim();return n?[n,String(r.getAttribute("data-visual-version")||"1"),String(t?.getAttribute("data-vis-lang")||""),String(t?.getAttribute("data-vis-code")||"")].join("\0"):""}function H(r){if(!r?.querySelector&&!r?.matches)return"";let t=r.matches?.('iframe[data-prom-visual="true"]')?r:r.querySelector?.('iframe[data-prom-visual="true"]');return Q(t)}function Le(r,t){return!r||!t||r.nodeType!==t.nodeType?!1:r.nodeType!==1?!0:String(r.tagName||"").toLowerCase()===String(t.tagName||"").toLowerCase()}function Be(r,t){let e=r.matches?.('iframe[data-prom-visual="true"]')?new Set(["srcdoc","style"]):new Set;Array.from(r.attributes||[]).forEach(o=>{e.has(o.name)||t.hasAttribute(o.name)||r.removeAttribute(o.name)}),Array.from(t.attributes||[]).forEach(o=>{e.has(o.name)||r.getAttribute(o.name)!==o.value&&r.setAttribute(o.name,o.value)})}function O(r,t,n,e=null){let o=Array.from(t||[]),a=Array.from(n||[]),i=Math.min(o.length,a.length),p=0;for(let c=0;c<i;c+=1){let b=o[c],g=a[c],f=me(b,g);if(f){p+=f.reused;continue}let h=g.cloneNode(!0);r.replaceChild(h,b)}for(let c=i;c<a.length;c+=1)r.insertBefore(a[c].cloneNode(!0),e);for(let c=i;c<o.length;c+=1)o[c].remove();return p}function Ve(r,t){return r.length===t.length&&r.every((n,e)=>n===t[e])}function le(r,t){let n=Array.from(r.childNodes||[]),e=Array.from(t.childNodes||[]),o=n.map(H).filter(Boolean),a=e.map(H).filter(Boolean);if(o.length&&Ve(o,a)){let i=0,p=0,c=0;for(let b of a){let g=n.findIndex((w,k)=>k>=i&&H(w)===b),f=e.findIndex((w,k)=>k>=p&&H(w)===b);if(g<0||f<0)return O(r,n,e);c+=O(r,n.slice(i,g),e.slice(p,f),n[g]);let h=me(n[g],e[f]);if(!h)return O(r,n,e);c+=h.reused,i=g+1,p=f+1}return c+=O(r,n.slice(i),e.slice(p)),c}return O(r,n,e)}function me(r,t){return Le(r,t)?r.nodeType===3||r.nodeType===8?(r.nodeValue!==t.nodeValue&&(r.nodeValue=t.nodeValue),{reused:0}):r.matches?.('iframe[data-prom-visual="true"]')?Q(r)===Q(t)?{reused:1}:null:(Be(r,t),{reused:le(r,t)}):null}function ue(r,t){return!r?.childNodes||!t?.childNodes?0:le(r,t)}function je(r,t){if(!r)return 0;let n=String(t||"");if(typeof document>"u"||typeof document.createElement!="function"||typeof r.appendChild!="function")return r.innerHTML=n,0;let e=document.createElement("template");e.innerHTML=n;let o=!!r.querySelector?.('iframe[data-prom-visual="true"]'),a=!!e.content.querySelector?.('iframe[data-prom-visual="true"]');return!o&&!a?(r.innerHTML=n,0):ue(r,e.content)}function Re(r,t,n=0){let e=`${r}\0${n}\0${t}`,o=2166136261;for(let a=0;a<e.length;a+=1)o^=e.charCodeAt(a),o=Math.imul(o,16777619);return`visual_local_${(o>>>0).toString(36)}`}function ve(r,t,n={}){_e();let e=n.artifact&&typeof n.artifact=="object"?n.artifact:null,o=String(e?.id||n.visualId||Re(r,t,n.ordinal||0)),a=`vis_${o.replace(/[^a-z0-9_-]/gi,"_")}`,i=de(),p=ze(pe(r,t,i),{visualId:o,state:e?.state||n.state||{}}),c=P(p),b=r.replace(/"/g,""),g=P(t),f=r==="chart"?240:r==="html"?180:220;return`<div class="visual-block visual-block--inline" id="${a}-wrap" data-vis-lang="${b}" data-vis-code="${g}" data-vis-surface="inline">
  <iframe
    id="${a}"
    data-prom-visual="true"
    data-visual-id="${P(o)}"
    data-visual-version="${P(e?.version||1)}"
    srcdoc="${c}"
    sandbox="allow-scripts allow-downloads"
    style="width:100%;height:${f}px;min-height:${f}px;border:none;display:block;background:transparent;color-scheme:${i.isDark?"dark":"light"}"
    loading="lazy"
  ></iframe>
</div>`}function he(r){let t=String(r||""),n=typeof window<"u"?window.DOMPurify:null;return!n||typeof n.sanitize!="function"?M(t):n.sanitize(t,{USE_PROFILES:{html:!0},FORBID_TAGS:["script","style","iframe","object","embed","form","input","button","textarea","select","option","svg","math","link","meta","base"],FORBID_ATTR:["style","srcdoc","formaction","xlink:href"],ALLOW_DATA_ATTR:!1,ALLOW_ARIA_ATTR:!0,RETURN_TRUSTED_TYPE:!1})}function Ne(r){let t=String(r||"").trim();if(!t)return"";if(/^file:\/\//i.test(t))try{t=decodeURIComponent(t.replace(/^file:\/\/\/?/i,""))}catch{t=t.replace(/^file:\/\/\/?/i,"")}t=t.replace(/^\.\//,"");let n=typeof window<"u"?window.__promResolveWorkspaceMediaUrl:null;if(typeof n=="function")try{let e=n(t);if(e)return String(e)}catch{}return`/api/canvas/inline?path=${encodeURIComponent(t)}`}function Pe(r){let t=String(r||"").trim();return!t||t.startsWith("#")?!1:/^file:\/\//i.test(t)||/^[a-z]:[\\/]/i.test(t)?!0:!(/^[a-z][a-z0-9+.-]*:/i.test(t)||t.startsWith("/")||t.startsWith("\\"))}var Fe=/\.(mp4|webm|mov|m4v)(?:$|[?#])/i;function Oe(r){let t=String(r||"");return t.includes("<img")?t.replace(/<img\b([^>]*?)\ssrc="([^"]*)"([^>]*)>/gi,(n,e,o,a)=>{let i=o.replace(/&amp;/g,"&");if(!Pe(i))return n;let p=Ne(i),c=`${e}${a}`,b=c.match(/\salt="([^"]*)"/i),g=b?b[1]:"",f=P(i),h=g?`<span class="prom-inline-caption">${g}</span>`:"";return Fe.test(i)?`<span class="prom-inline-figure is-video"><video class="prom-inline-media" src="${P(p)}" controls playsinline preload="metadata" data-workspace-path="${f}"></video>${h}</span>`:`<span class="prom-inline-figure"><img${c.replace(/\s(?:loading|class)="[^"]*"/gi,"")} src="${P(p)}" class="prom-inline-media" loading="lazy" decoding="async" data-workspace-path="${f}" role="button" tabindex="0">${h}</span>`}):t}function De({src:r,name:t}){document.getElementById("prom-inline-lightbox")?.remove();let n=document.createElement("div");n.id="prom-inline-lightbox",n.className="prom-inline-lightbox",n.setAttribute("role","dialog"),n.setAttribute("aria-modal","true");let e=document.createElement("img");e.src=r,e.alt=t||"";let o=document.createElement("button");o.type="button",o.className="prom-inline-lightbox-close",o.setAttribute("aria-label","Close"),o.textContent="\xD7",n.append(e,o);let a=()=>{n.remove(),document.removeEventListener("keydown",i)},i=p=>{p.key==="Escape"&&a()};n.addEventListener("click",p=>{p.target!==e&&a()}),document.addEventListener("keydown",i),document.body.appendChild(n)}if(typeof document<"u"&&!window.__promInlineMediaWired){window.__promInlineMediaWired=!0;let r=t=>{let n=t.target?.closest?.("img.prom-inline-media");if(!n||t.type==="keydown"&&t.key!=="Enter"&&t.key!==" ")return;t.preventDefault();let e=n.getAttribute("data-workspace-path")||"",o={kind:"image",src:n.currentSrc||n.src,path:e,name:n.getAttribute("alt")||e.split(/[\\/]/).pop()||"Image"},a=window.__promOpenInlineMedia;if(typeof a=="function")try{a(o);return}catch{}De(o)};document.addEventListener("click",r),document.addEventListener("keydown",r)}var Ue=600,qe=2e5,N=new Map;function ge(r,t={}){if(!r)return"";let n=String(r);if(n.length<=qe&&!/```(chart|svg|html|mermaid)\n/.test(n)&&!(Array.isArray(t.visualArtifacts)&&t.visualArtifacts.length)){let o=N.get(n);if(o!==void 0)return N.delete(n),N.set(n,o),o;let a=ae(n,t);return N.set(n,a),N.size>Ue&&N.delete(N.keys().next().value),a}return ae(n,t)}var He=/```video-project[ \t]*\n([\s\S]*?)```/g,Ye=/```video-project[ \t]*\n[\s\S]*$/;function We(r){let t="";try{t=String(JSON.parse(String(r||"").trim())?.projectId||"")}catch{t=(String(r||"").match(/vp_[A-Za-z0-9_-]+/)||[""])[0]}return/^vp_[A-Za-z0-9_-]{3,64}$/.test(t)?`<div class="prom-vp-card" data-vp-project="${t}"></div>`:""}function ae(r,t={}){try{let n=[],e=`PROMVISUAL${Math.random().toString(36).slice(2)}X`,o=[],a=`PROMVPCARD${Math.random().toString(36).slice(2)}X`;r=String(r).replace(He,(w,k)=>(o.push(We(k)),`

${a}${o.length-1}END

`)).replace(Ye,"");let i=/```(chart|svg|html|mermaid)\n([\s\S]*?)```/g,p=0,c=Array.isArray(t.visualArtifacts)?t.visualArtifacts.filter(w=>w?.type==="visual"):[],b=String(r).replace(i,(w,k,j)=>{let A=n.length,D=k.toLowerCase(),W=c.find(U=>Number(U.ordinal)===p&&String(U.renderer||"")===D)||null;return n.push({lang:D,code:j.trim(),partial:!1,artifact:W,ordinal:p}),p+=1,`${e}${A}END`}),g=/```(chart|svg|html|mermaid)\n([\s\S]*)$/,f=b.match(g);if(f){let w=n.length;n.push({lang:f[1].toLowerCase(),code:f[2],partial:!0}),b=b.slice(0,f.index)+`${e}${w}END`}let h=Oe(he(marked.parse(b,{breaks:!0,gfm:!0,mangle:!1,headerIds:!1})));if(n.length){let w=new RegExp(`${e}(\\d+)END`,"g");h=h.replace(w,(k,j)=>{let A=n[+j];return A?A.partial?"":ve(A.lang,A.code,{artifact:A.artifact,ordinal:A.ordinal}):""}),h=h.replace(/<p>\s*(<div class="visual-block"[\s\S]*?<\/div>)\s*<\/p>/g,"$1")}if(o.length){let w=new RegExp(`(?:<p>\\s*)?${a}(\\d+)END(?:\\s*<\\/p>)?`,"g");h=h.replace(w,(k,j)=>o[+j]||"")}return h}catch{return M(r)}}window.escHtml=M;window.escapeHtml=M;window.sanitizeHtml=he;window.renderMd=ge;oe();window.timeAgo=we;window.fmtPercent=$e;window.fmtMemoryGb=Se;window.meterWidth=se;window.setText=ke;window.setMeter=Ce;window.showToast=ie;window.bgtToast=Ee;window.showConfirm=Me;window.log=Te;window.buildVisualSrcdoc=pe;window.buildVisualIframe=ve;window.preserveVisualIframes=ue;window.setInnerHTMLPreservingVisuals=je;window.renderMd=ge;export{M as a,Je as b,we as c,$e as d,Se as e,se as f,ke as g,Ze as h,Qe as i,Ce as j,ie as k,Ee as l,Me as m,Te as n,pe as o,ue as p,je as q,ve as r,he as s,Ne as t,ge as u};
