var ye="prom-gp-card-style",pt=".prom-gp-card[data-gp-project]:not([data-gp-mounted])",V=["design","art","audio","code","playable","published"],M=e=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${e}</svg>`,w={pad:M('<rect x="2" y="7" width="20" height="10" rx="5"/><path d="M7 10v4M5 12h4M15.5 11h.01M18 13h.01"/>'),check:M('<path d="M5 12l5 5L20 7"/>'),x:M('<path d="M18 6L6 18M6 6l12 12"/>'),reroll:M('<path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/>'),spark:M('<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/>'),play:M('<path d="M7 4v16l13-8z"/>'),stop:M('<rect x="6" y="6" width="12" height="12" rx="2"/>'),ext:M('<path d="M14 3h7v7"/><path d="M10 14L21 3"/><path d="M21 14v5a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h5"/>'),copy:M('<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 012-2h10"/>'),refresh:M('<path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/>'),music:M('<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>'),wand:M('<path d="M15 4V2M15 16v-2M8 9h2M20 9h2M17.8 11.8L19 13M17.8 6.2L19 5M3 21l9-9M12.2 6.2L11 5"/>'),code:M('<path d="M16 18l6-6-6-6M8 6l-6 6 6 6"/>'),rocket:M('<path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 00-2.91-.09z"/><path d="M12 15l-3-3a22 22 0 012-3.95A12.88 12.88 0 0122 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 01-4 2z"/>'),phone:M('<rect x="7" y="2" width="10" height="20" rx="2"/>')};function y(e){return String(e??"").replace(/[&<>"']/g,t=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[t])}function G(e){return`$${(Number(e)||0).toFixed(2)}`}function we(e,t,r){let n=String(t||"").trim();if(!n)return"";let a=typeof window<"u"?window.__promResolveWorkspaceMediaUrl:null;if(typeof a=="function")try{let o=a(n);if(o)return String(o)}catch{}return`/api/canvas/inline?path=${encodeURIComponent(n)}${r?`&v=${r}`:""}`}function oe(e){return`${typeof window<"u"&&typeof window.__promGatewayBase=="string"?window.__promGatewayBase.replace(/\/$/,""):""}/api/game-projects/${encodeURIComponent(e)}/play/`}async function $e(e,t,r=3e4){let n={method:t===void 0?"GET":"POST",headers:{"Content-Type":"application/json"},body:t===void 0?void 0:JSON.stringify(t),timeoutMs:r},a=`/api/game-projects${e}`,o=window.__promVideoProjectFetch||window.api,i;if(typeof o=="function")i=await o(a,n);else{let p=await fetch(a,n);i=await p.json().catch(()=>({success:!1,error:`HTTP ${p.status}`}))}if(i&&i.success===!1)throw new Error(i.error||"Request failed");return i}function z(e,t,r,n="",a=""){return`<button type="button" class="gpc-icon${a?` ${a}`:""}" data-gpa="${e}" title="${y(r)}" aria-label="${y(r)}" ${n}>${t}</button>`}function lt(e){e.dataset.gpMounted="1";let t=String(e.dataset.gpProject||""),r={project:null,error:"",busy:"",pending:null,timer:0,playing:null,portrait:!1,showPlay:!0},n=u=>u.kind!=="sfx"&&u.kind!=="music",a=()=>(r.project?.assets||[]).some(u=>u.status==="generating");async function o(){try{let u=await $e(`/${encodeURIComponent(t)}`);r.project=u.project,r.error=""}catch(u){r.error=String(u?.message||u)}f(),i()}function i(){clearTimeout(r.timer),e.isConnected&&(a()||r.busy)&&(r.timer=setTimeout(o,3e3))}async function p(u,h={}){r.busy=u,r.error="",f();try{let g=await $e(`/${encodeURIComponent(t)}/action`,{action:u,...h});g.needsApproval||g.blocked?r.pending={action:u,args:h,usd:g.usd,reason:g.reason,blocked:!!g.blocked,estimate:g.estimate}:r.pending=null,u==="publish"&&g.note&&(r.error=g.note)}catch(g){r.error=String(g?.message||g)}r.busy="",await o()}function c(u){let h=V.indexOf(u.stage);return`<ol class="gpc-steps">${V.map((g,v)=>`<li class="${v<h?"is-done":v===h?"is-cur":""}"><span class="gpc-dot"></span><span class="gpc-step-l">${g}</span></li>`).join("")}</ol>`}function l(u){let h=u.design||{},g=[["Setting",h.setting],["Controls",h.controls],["Core loop",h.coreLoop],["Win/lose",h.winLose],["Engine",h.engine]].filter(([,S])=>S).map(([S,O])=>`<div class="gpc-kv"><span>${y(S)}</span><span>${y(O)}</span></div>`).join(""),v=(u.questions||[]).filter(S=>S.answer),$=(u.questions||[]).filter(S=>!S.answer).length;return`<div class="gpc-sec"><h4>${w.wand} Design</h4>${u.pitch?`<p class="gpc-pitch">${y(u.pitch)}</p>`:""}${g}
      ${v.length?`<div class="gpc-answers">${v.map(S=>`<span class="gpc-chip" title="${y(S.q)}">${y(S.answer)}</span>`).join("")}</div>`:""}
      ${$?`<div class="gpc-muted">${$} design question${$>1?"s":""} still open</div>`:""}</div>`}function d(u){let h=(u.assets||[]).filter(n);if(!h.length)return`<div class="gpc-sec"><h4>${w.spark} Art</h4><div class="gpc-row"><span class="gpc-muted gpc-grow">No asset plan yet.</span>${z("plan",w.wand,"Plan assets for this genre",r.busy?"disabled":"","is-go")}</div></div>`;let g=h.filter(k=>["planned","rejected","failed"].includes(k.status)).length,v=h.map(k=>{let st=k.path?`<img src="${y(we(t,k.path,u.version))}" alt="${y(k.name)}" loading="lazy" class="${k.transparent?"is-alpha":""}">`:`<span class="gpc-ph">${k.status==="generating"?'<span class="gpc-spin"></span>':w.spark}</span>`,ct=k.path&&k.status!=="generating";return`<div class="gpc-tile is-${y(k.status)}" title="${y(k.prompt)}">
        <div class="gpc-img">${st}</div>
        <div class="gpc-tile-foot"><span class="gpc-tname">${y(k.name)}</span><span class="gpc-badge">${y(k.status)}</span></div>
        <div class="gpc-tile-acts">
          ${z("approve",w.check,`Approve ${k.name}`,`data-asset="${y(k.id)}" ${ct&&k.status!=="approved"?"":"disabled"}`,"is-go")}
          ${z("reject",w.x,`Reject ${k.name}`,`data-asset="${y(k.id)}" ${k.status==="generating"||k.status==="rejected"?"disabled":""}`)}
          ${z("reroll",w.reroll,`Reroll ${k.name} (paid)`,`data-asset="${y(k.id)}" ${k.status==="generating"?"disabled":""}`)}
        </div></div>`}).join(""),$=u.budget?.spentUsd||0,S=u.budget?.capUsd,O=S?Math.min(100,$/S*100):0,U=r.pending;return`<div class="gpc-sec"><h4>${w.spark} Art <span class="gpc-muted">${h.filter(k=>k.status==="approved").length}/${h.length} approved</span></h4>
      <div class="gpc-grid">${v}</div>
      <div class="gpc-cost">
        <div class="gpc-row"><span class="gpc-grow gpc-muted">Spent ${G($)}${S?` of ${G(S)} cap`:""} \xB7 auto-approve ${G(u.budget?.autoApproveUsd)}</span>
        ${g?z("generate",w.spark,`Generate ${g} asset(s)`,r.busy||a()?"disabled":"","is-go"):""}</div>
        ${S?`<div class="gpc-bar"><span style="width:${O.toFixed(1)}%"></span></div>`:""}
        ${U?`<div class="gpc-approve ${U.blocked?"is-blocked":""}"><span class="gpc-grow">${y(U.reason||"")}</span>
          ${U.blocked?"":`<button type="button" class="gpc-go" data-gpa="approve-cost">${w.check}<span>Approve &amp; generate ${G(U.usd)}</span></button>`}
          ${z("dismiss",w.x,"Dismiss")}</div>`:""}
      </div></div>`}function m(u){let g=(u.assets||[]).filter(v=>!n(v)).map(v=>`<div class="gpc-aud">${z(r.playing===v.id?"stop":"listen",r.playing===v.id?w.stop:w.play,`${r.playing===v.id?"Stop":"Play"} ${v.name}`,`data-asset="${y(v.id)}" data-src="${y(we(t,v.path,u.version))}"`)}<span class="gpc-grow">${y(v.name)}</span><span class="gpc-muted">${v.durationSec?`${Number(v.durationSec).toFixed(1)}s`:""}</span></div>`).join("");return`<div class="gpc-sec"><h4>${w.music} Audio</h4>${g||'<div class="gpc-muted">No audio yet (free, generated locally).</div>'}
      <div class="gpc-row gpc-mt">${z("sfx",w.spark,"Generate sound effects (free)",r.busy?"disabled":"")}${z("music",w.music,"Generate music bed (free)",r.busy?"disabled":"")}${z("scaffold",w.code,"Write playable scaffold",r.busy?"disabled":"")}</div></div>`}function x(u){if(V.indexOf(u.stage)<V.indexOf("playable"))return"";let h=u.publish?.url||oe(t);return`<div class="gpc-sec"><h4>${w.pad} Play</h4>
      <div class="gpc-row gpc-mb"><span class="gpc-grow gpc-muted gpc-url">${y(h)}</span>
        ${z("orient",w.phone,r.portrait?"Landscape preview":"Portrait preview")}
        ${z("reload",w.refresh,"Reload game")}
        ${z("open",w.ext,"Open in new tab",`data-url="${y(h)}"`)}
        ${z("copy",w.copy,"Copy link",`data-url="${y(h)}"`)}
        ${z("publish",w.rocket,u.publish?.url?"Republish":"Publish",r.busy?"disabled":"","is-go")}</div>
      <div class="gpc-frame ${r.portrait?"is-portrait":""}"><iframe src="${y(oe(t))}" sandbox="allow-scripts allow-same-origin" allow="autoplay; fullscreen; gamepad" loading="lazy" title="${y(u.title)}"></iframe></div>
      ${u.publish?.note?`<div class="gpc-muted gpc-mt">${y(u.publish.note)}</div>`:""}</div>`}function f(){let u=r.project;if(!u){e.innerHTML=`<div class="gpc"><div class="gpc-head"><span class="gpc-kicker">${w.pad} Game</span><span class="gpc-muted">${y(r.error||"Loading\u2026")}</span></div></div>`;return}let h=u.design||{},g=e.querySelector(".gpc-frame iframe"),v=g&&V.indexOf(u.stage)>=V.indexOf("playable")?g:null;if(e.innerHTML=`<div class="gpc">
      <div class="gpc-head"><div class="gpc-headtext">
        <span class="gpc-kicker">${w.pad} Game project${r.busy?` \xB7 ${y(r.busy)}\u2026`:""}</span>
        <strong class="gpc-title">${y(u.title)}</strong>
        <div class="gpc-row"><span class="gpc-chip">${y(h.genre)}</span><span class="gpc-chip">${y(h.style)}</span>${h.multiplayer?'<span class="gpc-chip">multiplayer</span>':""}</div>
      </div>${z("refresh",w.refresh,"Refresh")}</div>
      ${c(u)}
      ${r.error?`<div class="gpc-err">${y(r.error)}</div>`:""}
      ${l(u)}${d(u)}${m(u)}${x(u)}
    </div>`,v){let $=e.querySelector(".gpc-frame iframe");$&&$.replaceWith(v)}}let b=null;e.addEventListener("click",async u=>{let h=u.target.closest("[data-gpa]");if(!h||h.disabled)return;u.preventDefault();let g=h.dataset.gpa,v=h.dataset.asset;if(g==="refresh")return o();if(g==="plan")return p("plan_assets");if(g==="generate")return p("generate_assets");if(g==="approve")return p("approve_asset",{assetId:v});if(g==="reject")return p("reject_asset",{assetId:v});if(g==="reroll")return p("reroll_asset",{assetId:v});if(g==="approve-cost"&&r.pending)return p(r.pending.action,{...r.pending.args,approved:!0});if(g==="dismiss")return r.pending=null,f();if(g==="sfx")return p("sfx",{force:!0});if(g==="music")return p("music",{force:!0});if(g==="scaffold")return p("scaffold");if(g==="publish")return p("publish");if(g==="orient"){r.portrait=!r.portrait;let $=e.querySelector(".gpc-frame");$&&$.classList.toggle("is-portrait",r.portrait),h.title=r.portrait?"Landscape preview":"Portrait preview";return}if(g==="reload"){let $=e.querySelector(".gpc-frame iframe");$&&($.src=oe(t));return}if(g==="open"){window.open(new URL(h.dataset.url,location.href).href,"_blank","noopener");return}if(g==="copy"){try{await navigator.clipboard.writeText(new URL(h.dataset.url,location.href).href),h.title="Copied"}catch{}return}if(g==="listen"||g==="stop")return b&&(b.pause(),b=null),g==="stop"?(r.playing=null,f()):(b=new Audio(h.dataset.src),r.playing=v,b.onended=()=>{r.playing=null,f()},b.play().catch(()=>{r.playing=null,f()}),f())}),f(),o()}var ie=null,se=!1;function ke(){se=!1,document.querySelectorAll(pt).forEach(e=>{try{lt(e)}catch(t){console.warn("[game-project-card]",t)}})}function Se(){if(!(typeof document>"u")){if(!document.getElementById(ye)){let e=document.createElement("style");e.id=ye,e.textContent=dt,document.head.appendChild(e)}ke(),!(ie||typeof MutationObserver>"u")&&(ie=new MutationObserver(()=>{if(se)return;se=!0,(typeof requestAnimationFrame=="function"?requestAnimationFrame:t=>setTimeout(t,16))(()=>ke())}),ie.observe(document.documentElement,{childList:!0,subtree:!0}))}}var dt=`
.prom-gp-card{--gpc-text:var(--prom-text,var(--pm-text,var(--text,currentColor)));--gpc-muted:var(--prom-muted,var(--pm-muted,var(--muted,#8a8a8a)));--gpc-line:var(--prom-border,var(--pm-border,var(--line,rgba(127,127,127,.25))));--gpc-surface:var(--prom-surface,var(--pm-surface,var(--panel,rgba(127,127,127,.06))));--gpc-soft:var(--prom-surface-secondary,var(--pm-bg-soft,var(--panel-2,rgba(127,127,127,.1))));--gpc-accent:var(--prom-accent,var(--pm-orange,var(--brand,#ff7a1a)));--gpc-ok:var(--prom-success,#2fa86b);--gpc-bad:var(--prom-danger,#d9534f);display:block;margin:10px 0;max-width:100%;color:var(--gpc-text);font-size:14px;line-height:1.4}
.prom-gp-card .gpc{border:1px solid var(--gpc-line);border-radius:14px;background:var(--gpc-surface);overflow:hidden}
.prom-gp-card svg{width:16px;height:16px;flex:none}
.prom-gp-card .gpc-head{display:flex;gap:10px;align-items:flex-start;padding:12px 12px 10px;border-bottom:1px solid var(--gpc-line)}
.prom-gp-card .gpc-headtext{display:flex;flex-direction:column;gap:4px;min-width:0;flex:1}
.prom-gp-card .gpc-kicker{display:inline-flex;gap:6px;align-items:center;font-size:11px;letter-spacing:.04em;text-transform:uppercase;color:var(--gpc-muted)}
.prom-gp-card .gpc-title{font-size:15px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.prom-gp-card .gpc-muted{color:var(--gpc-muted);font-size:12px}
.prom-gp-card .gpc-row{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.prom-gp-card .gpc-grow{flex:1;min-width:0}
.prom-gp-card .gpc-mt{margin-top:8px}.prom-gp-card .gpc-mb{margin-bottom:8px}
.prom-gp-card .gpc-chip{display:inline-block;padding:1px 8px;border-radius:999px;background:var(--gpc-soft);font-size:11px;text-transform:capitalize}
.prom-gp-card .gpc-icon{display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:9px;border:0;background:transparent;color:var(--gpc-text);cursor:pointer;padding:0}
.prom-gp-card .gpc-icon:hover{background:var(--gpc-soft)}
.prom-gp-card .gpc-icon:disabled{opacity:.35;cursor:default}
.prom-gp-card .gpc-icon.is-go{color:var(--gpc-accent)}
.prom-gp-card .gpc-go{display:inline-flex;gap:6px;align-items:center;border:0;border-radius:9px;padding:6px 10px;background:var(--gpc-accent);color:#fff;cursor:pointer;font-size:13px}
.prom-gp-card .gpc-steps{display:flex;list-style:none;margin:0;padding:10px 12px;gap:4px;border-bottom:1px solid var(--gpc-line);overflow-x:auto}
.prom-gp-card .gpc-steps li{flex:1;min-width:44px;display:flex;flex-direction:column;align-items:center;gap:4px;font-size:10px;text-transform:uppercase;letter-spacing:.03em;color:var(--gpc-muted);position:relative}
.prom-gp-card .gpc-dot{width:10px;height:10px;border-radius:50%;border:2px solid var(--gpc-line);background:transparent}
.prom-gp-card .gpc-steps li.is-done .gpc-dot{background:var(--gpc-ok);border-color:var(--gpc-ok)}
.prom-gp-card .gpc-steps li.is-cur{color:var(--gpc-text)}
.prom-gp-card .gpc-steps li.is-cur .gpc-dot{border-color:var(--gpc-accent);background:var(--gpc-accent)}
.prom-gp-card .gpc-sec{padding:10px 12px;border-bottom:1px solid var(--gpc-line)}
.prom-gp-card .gpc-sec:last-child{border-bottom:0}
.prom-gp-card h4{margin:0 0 8px;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;color:var(--gpc-muted);display:flex;gap:6px;align-items:center}
.prom-gp-card .gpc-pitch{margin:0 0 6px}
.prom-gp-card .gpc-kv{display:grid;grid-template-columns:80px 1fr;gap:8px;font-size:12px;padding:2px 0}
.prom-gp-card .gpc-kv span:first-child{color:var(--gpc-muted)}
.prom-gp-card .gpc-answers{display:flex;flex-wrap:wrap;gap:4px;margin-top:6px}
.prom-gp-card .gpc-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(112px,1fr));gap:8px}
.prom-gp-card .gpc-tile{border:1px solid var(--gpc-line);border-radius:10px;overflow:hidden;background:var(--gpc-soft);display:flex;flex-direction:column}
.prom-gp-card .gpc-tile.is-approved{border-color:var(--gpc-ok)}
.prom-gp-card .gpc-tile.is-rejected{opacity:.55}
.prom-gp-card .gpc-tile.is-failed{border-color:var(--gpc-bad)}
.prom-gp-card .gpc-img{aspect-ratio:1/1;display:flex;align-items:center;justify-content:center;background:repeating-conic-gradient(rgba(127,127,127,.18) 0% 25%,transparent 0% 50%) 50%/14px 14px}
.prom-gp-card .gpc-img img{width:100%;height:100%;object-fit:contain;image-rendering:auto}
.prom-gp-card .gpc-ph{color:var(--gpc-muted)}
.prom-gp-card .gpc-tile-foot{display:flex;gap:4px;align-items:center;padding:4px 6px;font-size:11px}
.prom-gp-card .gpc-tname{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.prom-gp-card .gpc-badge{font-size:10px;color:var(--gpc-muted)}
.prom-gp-card .gpc-tile-acts{display:flex;justify-content:space-around;border-top:1px solid var(--gpc-line)}
.prom-gp-card .gpc-tile-acts .gpc-icon{width:30px;height:28px}
.prom-gp-card .gpc-cost{margin-top:8px}
.prom-gp-card .gpc-bar{height:4px;border-radius:2px;background:var(--gpc-soft);overflow:hidden;margin-top:4px}
.prom-gp-card .gpc-bar span{display:block;height:100%;background:var(--gpc-accent)}
.prom-gp-card .gpc-approve{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:8px;padding:8px;border-radius:10px;border:1px solid var(--gpc-accent);font-size:12px}
.prom-gp-card .gpc-approve.is-blocked{border-color:var(--gpc-bad)}
.prom-gp-card .gpc-aud{display:flex;align-items:center;gap:6px;font-size:13px}
.prom-gp-card .gpc-url{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.prom-gp-card .gpc-frame{position:relative;width:100%;aspect-ratio:16/9;border-radius:10px;overflow:hidden;border:1px solid var(--gpc-line);background:#000}
.prom-gp-card .gpc-frame.is-portrait{aspect-ratio:9/16;max-width:min(100%,360px);margin:0 auto}
.prom-gp-card .gpc-frame iframe{position:absolute;inset:0;width:100%;height:100%;border:0}
.prom-gp-card .gpc-err{margin:8px 12px 0;padding:6px 8px;border-radius:8px;background:color-mix(in srgb,var(--gpc-bad) 14%,transparent);font-size:12px}
.prom-gp-card .gpc-spin{width:18px;height:18px;border-radius:50%;border:2px solid var(--gpc-line);border-top-color:var(--gpc-accent);animation:gpc-spin 1s linear infinite}
@keyframes gpc-spin{to{transform:rotate(360deg)}}
@media (max-width:420px){.prom-gp-card .gpc-grid{grid-template-columns:repeat(2,1fr)}.prom-gp-card .gpc-steps .gpc-step-l{font-size:9px}.prom-gp-card .gpc-kv{grid-template-columns:64px 1fr}}
`;var ut={"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"};function s(e){return String(e??"").replace(/[&<>"']/g,t=>ut[t])}function C(e){let t=String(e??"").trim();return t&&(/^https?:\/\//i.test(t)||t.startsWith("/")&&!t.startsWith("//"))?t:""}function I(e){try{return new URL(e).hostname.replace(/^www\./,"")}catch{return""}}function Ce(e){let t=I(e);return t?`https://www.google.com/s2/favicons?domain=${encodeURIComponent(t)}&sz=64`:""}function R(e){return s(JSON.stringify(e??null))}function P(e){try{return JSON.parse(e?.getAttribute?.("data-card-json")||"null")}catch{return null}}function Ee(e){let t=String(e??"").trim();if(!t)return null;try{return JSON.parse(t)}catch{}try{let r=t.replace(/[\u201C\u201D]/g,'"').replace(/[\u2018\u2019]/g,"'").replace(/,\s*([}\]])/g,"$1");return JSON.parse(r)}catch{}return null}function ce(e,t=2){let r=Number(e);return Number.isFinite(r)?r.toLocaleString(void 0,{maximumFractionDigits:t,minimumFractionDigits:0}):""}function J(e){let t=Number(e);return!Number.isFinite(t)||t<=0?"":`<span class="pc-stars" aria-label="${s(t.toFixed(1))} out of 5">\u2605 ${s(t.toFixed(1))}</span>`}function K(e){let t=String(e||"").trim();if(!t||typeof window>"u")return!1;try{if(typeof window.__pmMobileSendMessage=="function")return window.__pmMobileSendMessage(t),!0;if(typeof window.sendChat=="function")return window.sendChat(t),!0}catch(r){console.warn("[prom-cards] follow-up send failed",r)}return!1}function E(e,t){let r=String(t||"The card data was malformed."),n=`The ${e} card you sent failed to render (${r}). Please resend it with a valid ${e} body.`;return`<div class="pcx pc-error" role="note"><div class="pc-error-title">Couldn't render ${s(e)} card</div><div class="pc-muted">${s(r)}</div><div class="pc-actions"><button type="button" class="pc-chip" data-pc-act="send" data-prompt="${s(n)}">Ask Prom to fix it</button></div></div>`}var _={arrowL:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',arrowR:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',copy:'<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M5 15V5a2 2 0 012-2h8" fill="none" stroke="currentColor" stroke-width="2"/></svg>',play:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z" fill="currentColor"/></svg>',pin:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7-6.2-7-11a7 7 0 0114 0c0 4.8-7 11-7 11z" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="10" r="2.5" fill="currentColor"/></svg>',phone:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 005 5L15 13l5 2v4a2 2 0 01-2 2A16 16 0 013 6a2 2 0 012-2z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>',globe:'<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18" fill="none" stroke="currentColor" stroke-width="2"/></svg>',route:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2l9 9-9 9-9-9z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M9 13v-2h5l-2-2m2 2l-2 2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',swap:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7h12l-3-3M17 17H5l3 3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',bell:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 16V11a6 6 0 0112 0v5l2 2H4z M10 20a2 2 0 004 0" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>'};var H={length:{m:1,km:1e3,cm:.01,mm:.001,mi:1609.344,yd:.9144,ft:.3048,in:.0254,nmi:1852},mass:{kg:1,g:.001,mg:1e-6,lb:.45359237,oz:.028349523125,st:6.35029318,t:1e3},volume:{l:1,ml:.001,m3:1e3,gal:3.785411784,qt:.946352946,pt:.473176473,cup:.2365882365,floz:.0295735295625,tbsp:.01478676478125,tsp:.00492892159375},speed:{"m/s":1,"km/h":1/3.6,mph:.44704,kn:.514444,"ft/s":.3048},area:{m2:1,km2:1e6,ha:1e4,acre:4046.8564224,ft2:.09290304,in2:64516e-8,mi2:2589988110336e-6},time:{ms:.001,s:1,min:60,h:3600,day:86400,week:604800,yr:31557600},data:{B:1,KB:1e3,MB:1e6,GB:1e9,TB:1e12,KiB:1024,MiB:1048576,GiB:1073741824},energy:{J:1,kJ:1e3,cal:4.184,kcal:4184,Wh:3600,kWh:36e5,BTU:1055.06},temperature:{C:1,F:1,K:1}},mt={meter:"m",meters:"m",metre:"m",metres:"m",kilometer:"km",kilometers:"km",kilometre:"km",kilometres:"km",centimeter:"cm",centimeters:"cm",millimeter:"mm",millimeters:"mm",mile:"mi",miles:"mi",yard:"yd",yards:"yd",foot:"ft",feet:"ft",inch:"in",inches:"in",'"':"in","'":"ft","nautical mile":"nmi","nautical miles":"nmi",kilogram:"kg",kilograms:"kg",kilo:"kg",kilos:"kg",gram:"g",grams:"g",milligram:"mg",milligrams:"mg",pound:"lb",pounds:"lb",lbs:"lb",ounce:"oz",ounces:"oz",stone:"st",tonne:"t",tonnes:"t",ton:"t",liter:"l",liters:"l",litre:"l",litres:"l",milliliter:"ml",milliliters:"ml",gallon:"gal",gallons:"gal",quart:"qt",quarts:"qt",pint:"pt",pints:"pt",cups:"cup","fl oz":"floz","fluid ounce":"floz","fluid ounces":"floz",tablespoon:"tbsp",tablespoons:"tbsp",teaspoon:"tsp",teaspoons:"tsp",kph:"km/h",kmh:"km/h",knots:"kn",knot:"kn","sq m":"m2","m\xB2":"m2","sq ft":"ft2","ft\xB2":"ft2",acres:"acre",hectare:"ha",hectares:"ha","sq mi":"mi2","km\xB2":"km2",second:"s",seconds:"s",sec:"s",minute:"min",minutes:"min",hour:"h",hours:"h",hr:"h",days:"day",weeks:"week",year:"yr",years:"yr",bytes:"B",celsius:"C","\xB0c":"C",fahrenheit:"F","\xB0f":"F",kelvin:"K",calories:"kcal",kilocalories:"kcal",joules:"J",joule:"J"};function ze(e){let t=String(e??"").trim();if(!t)return null;for(let[o,i]of Object.entries(H))if(Object.prototype.hasOwnProperty.call(i,t))return{category:o,unit:t};let r=t.toLowerCase(),a=mt[r]||r;for(let[o,i]of Object.entries(H)){let p=Object.keys(i).find(c=>c.toLowerCase()===a.toLowerCase());if(p)return{category:o,unit:p}}return null}function gt(e,t){return t==="C"?e+273.15:t==="F"?(e-32)*(5/9)+273.15:e}function ft(e,t){return t==="C"?e-273.15:t==="F"?(e-273.15)*(9/5)+32:e}function Te(e,t,r,n){let a=Number(e);if(!Number.isFinite(a))return NaN;if(n==="temperature")return ft(gt(a,t),r);let o=H[n];return!o||!o[t]||!o[r]?NaN:a*o[t]/o[r]}function pe(e){if(!Number.isFinite(e))return"\u2014";let t=Math.abs(e);return t!==0&&(t>=1e12||t<1e-6)?e.toExponential(4):Number(e.toPrecision(10)).toLocaleString(void 0,{maximumFractionDigits:t<1?8:6})}function ht(e,t){let r=ze(t?.from),n=ze(t?.to),a=r?.category||n?.category||(H[t?.category]?t.category:"");if(!a)return E("convert","Unknown units. Try mi/km, lb/kg, F/C, gal/l, mph/km/h.");let o=Object.keys(H[a]),i=r?.category===a?r.unit:o[0],p=n?.category===a&&n.unit!==i?n.unit:o.find(m=>m!==i),c=Number.isFinite(Number(t?.value))?Number(t.value):1,l=(m,x)=>`<select class="pc-select" data-pc-unit="${m}">${o.map(f=>`<option value="${s(f)}" ${f===x?"selected":""}>${s(f)}</option>`).join("")}</select>`,d=pe(Te(c,i,p,a));return`<div class="pcx pc-convert" data-pc-kind="convert" data-pc-id="${s(e)}" data-card-json="${R({category:a})}"><div class="pc-head"><span class="pc-kicker">Convert</span><span class="pcx-title">${s(a[0].toUpperCase()+a.slice(1))}</span></div>
  <div class="pc-fx-row"><input class="pc-input" type="number" inputmode="decimal" step="any" value="${s(c)}" data-pc-unit="value" aria-label="Value">${l("from",i)}</div>
  <button type="button" class="pc-icon-btn pc-fx-swap" data-pc-act="unit-swap" title="Swap"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7h12l-3-3M17 17H5l3 3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
  <div class="pc-fx-row"><output class="pc-fx-out" data-pc-unit="out">${s(d)}</output>${l("to",p)}</div></div>`}function le(e){if(!e)return;let t=P(e)?.category||"",r=a=>e.querySelector(`[data-pc-unit="${a}"]`),n=r("out");n&&(n.textContent=pe(Te(r("value")?.value,r("from")?.value,r("to")?.value,t)))}var Me={sqrt:Math.sqrt,cbrt:Math.cbrt,abs:Math.abs,round:Math.round,floor:Math.floor,ceil:Math.ceil,ln:Math.log,log:Math.log10,log2:Math.log2,exp:Math.exp,sin:Math.sin,cos:Math.cos,tan:Math.tan,asin:Math.asin,acos:Math.acos,atan:Math.atan},Ae={pi:Math.PI,e:Math.E,tau:Math.PI*2};function vt(e){let t=String(e??"").replace(/[×x](?=\s*[\d(.])/g,"*").replace(/÷/g,"/").replace(/[−–]/g,"-").replace(/(\d),(?=\d{3}\b)/g,"$1").trim();if(!t||t.length>300)throw new Error("empty");let r=t.match(/\d*\.?\d+(?:e[+-]?\d+)?|[a-z]+\d?|\*\*|[-+*/^%()]|\S/gi)||[],n=0,a=()=>r[n],o=f=>{if(r[n]!==f)throw new Error(`expected ${f}`);n+=1},i=()=>{let f=r[n++];if(f==null)throw new Error("incomplete");if(/^\d*\.?\d+(e[+-]?\d+)?$/i.test(f))return Number(f);if(f==="("){let u=m();return o(")"),u}if(f==="-")return-c();if(f==="+")return c();let b=f.toLowerCase();if(Object.prototype.hasOwnProperty.call(Ae,b))return Ae[b];if(Object.prototype.hasOwnProperty.call(Me,b)){o("(");let u=m();return o(")"),Me[b](u)}throw new Error(`unknown "${f}"`)},p=()=>{let f=i();for(;a()==="%"&&!/^[\d(a-z]/i.test(r[n+1]||"");)n+=1,f/=100;return f},c=()=>{let f=p();return a()==="^"||a()==="**"?(n+=1,f**l()):f},l=()=>a()==="-"?(n+=1,-l()):a()==="+"?(n+=1,l()):c(),d=()=>{let f=l();for(;;){let b=a();if(b==="*")n+=1,f*=l();else if(b==="/")n+=1,f/=l();else if(b==="%")n+=1,f%=l();else if(b==="("||b&&/^[a-z]/i.test(b))f*=l();else return f}};function m(){let f=d();for(;;){let b=a();if(b==="+")n+=1,f+=d();else if(b==="-")n+=1,f-=d();else return f}}let x=m();if(n!==r.length)throw new Error(`unexpected "${r[n]}"`);if(!Number.isFinite(x))throw new Error("not a finite number");return x}function de(e){try{return{ok:!0,text:pe(vt(e))}}catch{return{ok:!1,text:String(e||"").trim()?"\u2026":""}}}var bt=["7","8","9","\xF7","4","5","6","\xD7","1","2","3","\u2212","0",".","(",")","C","\u232B","^","+"];function xt(e,t){let r=String(t?.expression??t?.expr??t?.input??(typeof t=="string"?t:"")??""),n=de(r),a=bt.map(o=>`<button type="button" class="pc-key ${/[÷×−+^]/.test(o)?"op":""}" data-pc-act="calc-key" data-k="${s(o)}">${s(o)}</button>`).join("");return`<div class="pcx pc-calc" data-pc-kind="calculator" data-pc-id="${s(e)}"><div class="pc-head"><span class="pc-kicker">Calculator</span>${t?.title?`<span class="pcx-title">${s(t.title)}</span>`:""}</div>
  <input class="pc-input pc-calc-expr" type="text" inputmode="decimal" spellcheck="false" autocomplete="off" value="${s(r)}" data-pc-calc="expr" aria-label="Expression">
  <output class="pc-calc-out ${n.ok?"":"pending"}" data-pc-calc="out">${n.ok?`= ${s(n.text)}`:s(n.text)}</output>
  <div class="pc-keypad">${a}<button type="button" class="pc-key eq" data-pc-act="calc-key" data-k="=">=</button></div></div>`}function ue(e){let t=e?.querySelector('[data-pc-calc="expr"]'),r=e?.querySelector('[data-pc-calc="out"]');if(!t||!r)return;let n=de(t.value);r.textContent=n.ok?`= ${n.text}`:n.text,r.classList.toggle("pending",!n.ok)}function _e(e,t){let r=e?.querySelector('[data-pc-calc="expr"]');if(!r)return!1;if(t==="C")r.value="";else if(t==="\u232B")r.value=r.value.slice(0,-1);else if(t==="="){let n=de(r.value);n.ok&&(r.value=n.text.replace(/,/g,""))}else r.value+=t;return ue(e),!0}var me=["convert","calculator"];function je(e,t,r){return e==="convert"?ht(t,r):e==="calculator"?xt(t,r):""}function B(e,t,r,n,a=""){return`<div class="pcx pc-${e} ${a}" data-pc-kind="${e}" data-pc-id="${s(t)}" data-card-json="${R(r)}">${n}</div>`}function D(e,t){return`<div class="pc-head"><span class="pc-kicker">${s(e)}</span>${t?`<span class="pcx-title">${s(t)}</span>`:""}</div>`}function Le(e){let r=(Array.isArray(e)?e:e?.questions||e?.items||[]).map(n=>{let a=(n?.options||n?.choices||n?.answers||[]).map(i=>typeof i=="string"?i:String(i?.text??i?.label??"")),o=n?.answer??n?.correct??n?.correctIndex??n?.correct_answer;if(typeof o=="string"&&!/^\d+$/.test(o)){let i=/^[A-Za-z]$/.test(o.trim())?o.trim().toUpperCase().charCodeAt(0)-65:-1;o=i>=0&&i<a.length?i:a.findIndex(p=>p.trim().toLowerCase()===o.trim().toLowerCase())}return{question:String(n?.question??n?.q??n?.prompt??""),options:a,answer:Number(o),hint:n?.hint?String(n.hint):"",explanation:String(n?.explanation??n?.why??"")}}).filter(n=>n.question&&n.options.length>=2&&Number.isInteger(n.answer)&&n.answer>=0&&n.answer<n.options.length);return{title:String(e?.title||""),questions:r}}function Ne(e){let r=(Array.isArray(e)?e:e?.cards||e?.items||[]).map(n=>({front:String(n?.front??n?.term??n?.q??n?.question??""),back:String(n?.back??n?.definition??n?.a??n?.answer??"")})).filter(n=>n.front&&n.back);return{title:String(e?.title||""),cards:r}}function yt(e){return String(e||"").split(`
`).map(t=>t.replace(/^\s*(?:[-*•]|\d+[.)])\s*/,"").trim()).filter(Boolean)}function wt(e,t,r){let n=t.questions;if(!n.length)return E("quiz","A quiz needs questions with options and an answer index.");let a=r.picks||{},o=r.locked||{},i=r.hints||{};if(r.done){let g=n.filter(($,S)=>a[S]===$.answer).length,v=n.map(($,S)=>`<li class="${a[S]===$.answer?"ok":"bad"}"><span>${a[S]===$.answer?"\u2713":"\u2717"}</span>${s($.question)}</li>`).join("");return B("quiz",e,t,`${D("Quiz",t.title)}<div class="pc-score"><strong>${g}/${n.length}</strong><span>${g===n.length?"Perfect score":g>=n.length/2?"Nice work":"Keep practicing"}</span></div><ol class="pc-review">${v}</ol><div class="pc-actions"><button type="button" class="pc-btn" data-pc-act="quiz-retry">Retry quiz</button></div>`)}let p=Math.min(r.i||0,n.length-1),c=n[p],l=a[p],d=!!o[p],m=c.options.map((g,v)=>`<button type="button" class="pc-opt ${d?v===c.answer?"correct":v===l?"wrong":"dim":v===l?"picked":""}" data-pc-act="quiz-pick" data-k="${v}" ${d?"disabled":""}><span class="pc-opt-key">${String.fromCharCode(65+v)}</span><span>${s(g)}</span></button>`).join(""),x=d?`<div class="pc-feedback ${l===c.answer?"ok":"bad"}"><strong>${l===c.answer?"Correct!":`Not quite. The answer is ${String.fromCharCode(65+c.answer)}.`}</strong>${c.explanation?`<span>${s(c.explanation)}</span>`:""}</div>`:"",f=i[p]&&c.hint?`<div class="pc-hint">\u{1F4A1} ${s(c.hint)}</div>`:"",b=p===n.length-1,u=d?`<button type="button" class="pc-btn primary" data-pc-act="${b?"quiz-finish":"quiz-next"}">${b?"See results":"Next question"}</button>`:`${c.hint&&!i[p]?'<button type="button" class="pc-btn" data-pc-act="quiz-hint">Hint</button>':""}<button type="button" class="pc-btn primary" data-pc-act="quiz-lock" ${l==null?"disabled":""}>Lock in</button>`,h=n.map((g,v)=>`<span class="${v===p?"on":o[v]?a[v]===n[v].answer?"ok":"bad":""}"></span>`).join("");return B("quiz",e,t,`${D("Quiz",t.title)}<div class="pc-progress-row"><span>Question ${p+1} of ${n.length}</span><span class="pc-dots">${h}</span></div><div class="pc-question">${s(c.question)}</div><div class="pc-opts">${m}</div>${f}${x}<div class="pc-actions">${u}</div>`)}function $t(e,t,r){let n=t.cards;if(!n.length)return E("flashcards","Flashcards need cards with a front and a back.");let a=Array.isArray(r.order)&&r.order.length?r.order:n.map((d,m)=>m),o=r.known||[],i=r.missed||[],p=r.pos||0;if(p>=a.length)return B("flashcards",e,t,`${D("Flashcards",t.title)}<div class="pc-score"><strong>${o.length}/${a.length}</strong><span>known this round</span></div><div class="pc-actions">${i.length?`<button type="button" class="pc-btn primary" data-pc-act="fc-missed">Review ${i.length} missed</button>`:""}<button type="button" class="pc-btn" data-pc-act="fc-restart">Start over</button></div>`);let c=n[a[p]],l=Math.round(p/a.length*100);return B("flashcards",e,t,`${D("Flashcards",t.title)}<div class="pc-bar"><span style="width:${l}%"></span></div><button type="button" class="pc-flip ${r.flipped?"flipped":""}" data-pc-act="fc-flip" aria-label="Flip card"><span class="pc-flip-side">${r.flipped?"Answer":"Term"}</span><span class="pc-flip-text">${s(r.flipped?c.back:c.front)}</span><span class="pc-muted">${r.flipped?"":"Tap to flip"}</span></button><div class="pc-progress-row"><span>${p+1} / ${a.length}</span><span>\u2713 ${o.length} \xB7 \u2717 ${i.length}</span></div><div class="pc-actions split"><button type="button" class="pc-btn bad" data-pc-act="fc-miss">Still learning</button><button type="button" class="pc-btn good" data-pc-act="fc-know">Got it</button></div>`)}function kt(e,t,r){let n=String(t?.question||t?.title||""),a=(t?.options||[]).map(String).filter(Boolean);if(!n||a.length<2)return E("poll","A poll needs a question and at least two options.");let o=r.picks||[],i=!!t.multiple;if(r.sent){let c=a.map((l,d)=>`<div class="pc-poll-row ${o.includes(d)?"mine":""}"><span>${s(l)}</span><span>${o.includes(d)?"Your answer":""}</span></div>`).join("");return B("poll",e,t,`${D("Poll","")}<div class="pc-question">${s(n)}</div>${c}<div class="pc-muted">Sent to Prom.</div>`)}let p=a.map((c,l)=>`<button type="button" class="pc-opt ${o.includes(l)?"picked":""}" data-pc-act="poll-pick" data-k="${l}"><span class="pc-check">${o.includes(l)?"\u25CF":"\u25CB"}</span><span>${s(c)}</span></button>`).join("");return B("poll",e,t,`${D("Poll",i?"Pick any":"")}<div class="pc-question">${s(n)}</div><div class="pc-opts">${p}</div><div class="pc-actions"><button type="button" class="pc-btn primary" data-pc-act="poll-send" ${o.length?"":"disabled"}>Send answer</button></div>`)}function St(e,t,r){let n=String(t?.text??t?.body??t?.content??"");if(!n.trim())return E("writing","Nothing to show.");let a=n.trim().split(/\s+/).length,o=String(t?.kind||"Draft"),i=t?.subject?`<div class="pc-writing-subject"><span>Subject</span>${s(t.subject)}</div>`:"";return B("writing",e,t,`<div class="pc-head"><span class="pc-kicker">${s(o)}</span>${t?.title?`<span class="pcx-title">${s(t.title)}</span>`:""}<button type="button" class="pc-icon-btn" data-pc-act="copy" title="Copy">${_.copy}<span>${r.copied?"Copied":"Copy"}</span></button></div>${i}<div class="pc-writing-body">${s(n)}</div><div class="pc-writing-foot"><span class="pc-muted">${a} words \xB7 ${n.length} characters</span><span class="pc-chips"><button type="button" class="pc-chip" data-pc-act="send" data-prompt="Make that ${s(o.toLowerCase())} shorter.">Shorter</button><button type="button" class="pc-chip" data-pc-act="send" data-prompt="Make that ${s(o.toLowerCase())} more casual.">More casual</button><button type="button" class="pc-chip" data-pc-act="send" data-prompt="Make that ${s(o.toLowerCase())} more formal.">More formal</button></span></div>`)}function Ct(e,t){let r=(Array.isArray(t)?t:t?.items||[]).map(n=>String(typeof n=="string"?n:n?.prompt||n?.label||"")).filter(Boolean).slice(0,6);return r.length?`<div class="pc-followups" data-pc-id="${s(e)}">${r.map(n=>`<button type="button" class="pc-followup" data-pc-act="send" data-prompt="${s(n)}"><span>${s(n)}</span><span aria-hidden="true">\u2197</span></button>`).join("")}</div>`:""}function Et(e,t,r){let n=String(t?.title||t?.text||""),a=String(t?.when||t?.time||t?.at||"");if(!n)return E("reminder","A reminder needs a title.");let o=r.status==="set"?'<div class="pc-feedback ok"><strong>Asked Prom to set it.</strong></div>':r.status==="dismissed"?'<div class="pc-muted">Dismissed.</div>':"",i=r.status?"":'<div class="pc-actions"><button type="button" class="pc-btn" data-pc-act="rem-dismiss">Not now</button><button type="button" class="pc-btn primary" data-pc-act="rem-set">Set reminder</button></div>';return B("reminder",e,t,`<div class="pc-rem"><span class="pc-rem-icon">${_.bell}</span><div><div class="pcx-title">${s(n)}</div>${a?`<div class="pc-muted">${s(a)}</div>`:""}${t?.details?`<div class="pc-muted">${s(t.details)}</div>`:""}</div></div>${o}${i}`)}var X=["quiz","flashcards","poll","writing","followups","reminder",...me];function zt(e){let t=String(e||"").trim().match(/^(-?[\d.,]+)\s*([^\d\s][^]*?)\s+(?:to|in|->|=)\s+(.+)$/i);return t?{value:Number(t[1].replace(/,/g,"")),from:t[2].trim(),to:t[3].trim()}:null}function Z(e,t,r,n={}){let a=Ee(r);if(e==="followups"&&!a&&(a={items:yt(r)}),e==="writing"&&!a&&(a={text:String(r||"").trim()}),e==="calculator"&&(a==null||typeof a!="object")&&(a={expression:String(r||"").trim()}),e==="convert"&&(a==null||typeof a!="object")&&(a=zt(r)),me.includes(e))return a?je(e,t,a):E(e,'Use {"value":5,"from":"mi","to":"km"}.');if(!a)return E(e,"The card body is not valid JSON.");switch(e){case"quiz":return wt(t,Le(a),n);case"flashcards":return $t(t,Ne(a),n);case"poll":return kt(t,a,n);case"writing":return St(t,a,n);case"followups":return Ct(t,a);case"reminder":return Et(t,a,n);default:return""}}function Ie(e,t,r,n,a={}){let o={...r||{}},i=Number(a.k);if(e==="quiz"){let p=Le(t).questions,c=o.i||0;if(n==="quiz-pick"&&(o.picks={...o.picks||{},[c]:i}),n==="quiz-hint"&&(o.hints={...o.hints||{},[c]:!0}),n==="quiz-lock"&&o.picks?.[c]!=null&&(o.locked={...o.locked||{},[c]:!0}),n==="quiz-next"&&(o.i=Math.min(p.length-1,c+1)),n==="quiz-finish"&&(o.done=!0),n==="quiz-retry")return{}}else if(e==="flashcards"){let p=Ne(t).cards.length,c=Array.isArray(o.order)&&o.order.length?o.order:Array.from({length:p},(d,m)=>m),l=c[o.pos||0];if(n==="fc-flip"&&(o.flipped=!o.flipped),n==="fc-know"||n==="fc-miss"){let d=n==="fc-know"?"known":"missed";o[d]=[...o[d]||[],l],o.pos=(o.pos||0)+1,o.flipped=!1,o.order=c}if(n==="fc-missed")return{order:[...o.missed||[]]};if(n==="fc-restart")return{}}else if(e==="poll"){if(n==="poll-pick"){let p=new Set(o.picks||[]);t?.multiple?(p.has(i)?p.delete(i):p.add(i),o.picks=[...p]):o.picks=[i]}n==="poll-send"&&(o.sent=!0)}else e==="writing"?n==="copy"&&(o.copied=!0):e==="reminder"&&(n==="rem-set"&&(o.status="set"),n==="rem-dismiss"&&(o.status="dismissed"));return o}var N=(e,t,r="")=>{let n=C(e);return n?`<img class="${r}" src="${s(n)}" alt="${s(t||"")}" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="this.style.visibility='hidden'">`:""},Q=(e,t="")=>`<div class="pc-scroller-wrap"><button type="button" class="pc-nav prev" data-pc-act="scroll" data-dir="-1" aria-label="Previous">${_.arrowL}</button><div class="pc-scroller ${t}">${e}</div><button type="button" class="pc-nav next" data-pc-act="scroll" data-dir="1" aria-label="Next">${_.arrowR}</button></div>`;function j(e,t,r,n=""){return`<div class="pcx pc-${e} ${n}" data-pc-kind="${e}" data-pc-id="${s(t.id||"")}">${r}</div>`}function L(e,t,r=""){return`<div class="pc-head"><span class="pc-kicker">${s(e)}</span>${t?`<span class="pcx-title">${s(t)}</span>`:""}${r}</div>`}function Mt(e){let t=e.rates&&typeof e.rates=="object"?e.rates:null;if(!t||!e.base)return E("currency","Exchange rates were unavailable.");let r=[...new Set([e.base,...Object.keys(t)])].sort(),n=e.from||e.base,a=e.to||r.find(p=>p!==n)||n,o=Number(e.amount)||1,i=(p,c)=>`<select class="pc-select" data-pc-fx="${p}">${r.map(l=>`<option value="${s(l)}" ${l===c?"selected":""}>${s(l)}${e.names?.[l]?` \xB7 ${s(e.names[l])}`:""}</option>`).join("")}</select>`;return`<div class="pcx pc-currency" data-pc-kind="currency" data-pc-id="${s(e.id||"")}" data-card-json="${R({base:e.base,rates:t})}">${L("Currency",e.date?`Rates as of ${e.date}`:"")}
  <div class="pc-fx-row"><input class="pc-input" type="number" inputmode="decimal" step="any" value="${s(o)}" data-pc-fx="amount" aria-label="Amount">${i("from",n)}</div>
  <button type="button" class="pc-icon-btn pc-fx-swap" data-pc-act="fx-swap" title="Swap">${_.swap}</button>
  <div class="pc-fx-row"><output class="pc-fx-out" data-pc-fx="out">\u2026</output>${i("to",a)}</div>
  <div class="pc-muted" data-pc-fx="rate"></div><div class="pc-source">${s(e.source||"European Central Bank via Frankfurter")}</div></div>`}function At(e){let t=(e.zones||[]).filter(n=>n?.timeZone).slice(0,8);if(!t.length)return E("clock","No time zones resolved.");let r=t.map(n=>`<div class="pc-clock-cell" data-tz="${s(n.timeZone)}"><div class="pc-clock-label">${s(n.label||n.timeZone)}</div><div class="pc-clock-time" data-pc-clock="time">--:--</div><div class="pc-muted" data-pc-clock="date"></div><div class="pc-muted">${s(n.timeZone)}</div></div>`).join("");return j("clock",e,`${L("World clock",e.title||"")}<div class="pc-clock-grid">${r}</div>`)}function Tt(e){let t=String(e||"").match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/);return t?t[1]:""}function ge(e,t){let r=Tt(e.url),n=e.thumbnail||(r?`https://i.ytimg.com/vi/${r}/hqdefault.jpg`:""),a=r?`data-pc-act="video-play" data-yt="${s(r)}"`:`data-pc-act="open" data-url="${s(C(e.url))}"`;return`<div class="pc-video-tile ${t?"big":""}"><button type="button" class="pc-video-thumb" ${a} aria-label="Play ${s(e.title||"video")}">${N(n,e.title)}<span class="pc-play">${_.play}</span>${e.duration?`<span class="pc-badge">${s(e.duration)}</span>`:""}</button><div class="pc-video-meta"><a class="pc-link-title" href="${s(C(e.url))}" target="_blank" rel="noopener noreferrer">${s(e.title||e.url)}</a><div class="pc-muted">${s([e.creator||e.publisher||I(e.url),e.age].filter(Boolean).join(" \xB7 "))}</div></div></div>`}function _t(e){let t=(e.items||[]).filter(r=>C(r?.url)).slice(0,8);return t.length?t.length===1?j("video",e,`${e.title?L("Video",e.title):""}${ge(t[0],!0)}`):j("video",e,`${L("Videos",e.title||"")}${ge(t[0],!0)}${Q(t.slice(1).map(r=>ge(r,!1)).join(""))}`):E("video","No playable videos were found.")}function jt(e){let t=(e.items||[]).filter(a=>C(a?.thumbnail||a?.url)).slice(0,24);if(!t.length)return E("gallery","No images were found.");let r=t.map((a,o)=>`<button type="button" class="pc-gallery-tile ${o===0?"hero":""}" data-pc-act="lightbox" data-i="${o}" aria-label="${s(a.title||"Image")}">${N(a.thumbnail||a.url,a.title)}</button>`).join(""),n=t.map(a=>({src:C(a.url||a.thumbnail),thumb:C(a.thumbnail||a.url),title:a.title||"",page:C(a.pageUrl||""),source:a.source||I(a.pageUrl||a.url)}));return`<div class="pcx pc-gallery" data-pc-kind="gallery" data-pc-id="${s(e.id||"")}" data-card-json="${R(n)}">${L("Images",e.title||"",`<span class="pc-count">${t.length}</span>`)}<div class="pc-gallery-grid">${r}</div></div>`}function Lt(e){let t=(e.items||[]).filter(n=>C(n?.url)).slice(0,12);if(!t.length)return E("news","No stories were found.");let r=n=>`<a class="pc-news-tile" href="${s(C(n.url))}" target="_blank" rel="noopener noreferrer"><div class="pc-news-img">${N(n.imageUrl||n.thumbnail,n.title)}</div><div class="pc-news-body"><div class="pc-news-src">${N(Ce(n.url),"","pc-fav")}<span>${s(n.publisher||I(n.url))}</span>${n.age?`<span>\xB7 ${s(n.age)}</span>`:""}</div><div class="pc-news-title">${s(n.title||n.url)}</div>${n.snippet?`<div class="pc-muted pc-clamp2">${s(n.snippet)}</div>`:""}</div></a>`;return j("news",e,`${L("News",e.title||"")}${Q(t.map(r).join(""),"news")}`)}function Be(e,t){return`<div class="pc-team ${t}">${N(e.logo,e.name,"pc-logo")}<div class="pc-team-name">${s(e.name||e.abbr||"")}</div>${e.record?`<div class="pc-muted">${s(e.record)}</div>`:""}</div>`}function Re(e){let t=e.away||{},r=e.home||{},n=e.state||"pre",a=n==="pre"?`<div class="pc-game-mid"><div class="pc-game-status">${s(e.statusText||"")}</div></div>`:`<div class="pc-game-mid"><span class="pc-game-score ${Number(t.score)>Number(r.score)?"win":""}">${s(t.score??"")}</span><div class="pc-game-status ${n==="in"?"live":""}">${n==="in"?'<span class="pc-live-dot"></span>':""}${s(e.statusText||"")}</div><span class="pc-game-score ${Number(r.score)>Number(t.score)?"win":""}">${s(r.score??"")}</span></div>`,o=Math.max((t.linescores||[]).length,(r.linescores||[]).length),i=Array.from({length:o},(c,l)=>e.periodLabel==="inning"?l+1:l<4?`Q${l+1}`:`OT${l-3||""}`),p=o?`<table class="pc-table pc-linescore"><thead><tr><th></th>${i.map(c=>`<th>${s(c)}</th>`).join("")}<th>T</th></tr></thead><tbody>${[t,r].map(c=>`<tr><td>${s(c.abbr||c.name||"")}</td>${i.map((l,d)=>`<td>${s(c.linescores?.[d]??"-")}</td>`).join("")}<td><strong>${s(c.score??"")}</strong></td></tr>`).join("")}</tbody></table>`:"";return`<div class="pc-game">${e.venue?`<div class="pc-muted pc-center">${s(e.venue)}</div>`:""}<div class="pc-game-row">${Be(t,"away")}${a}${Be(r,"home")}</div>${p}${e.link?`<a class="pc-more" href="${s(C(e.link))}" target="_blank" rel="noopener noreferrer">Game details \u2197</a>`:""}</div>`}function Nt(e){let t=(e.games||[]).slice(0,12);return t.length?t.length===1?j("sports-game",e,`${L(e.league||"Game",e.title||"")}${Re(t[0])}`):j("sports-game",e,`${L(e.league||"Scores",e.title||"")}${Q(t.map(r=>`<div class="pc-game-tile">${Re(r)}</div>`).join(""))}`):E("sports","No games found for that query.")}function It(e){let t=e.player||{};if(!t.name)return E("sports","Player not found.");let r=(t.stats||[]).slice(0,6).map(a=>`<div class="pc-stat"><div class="pc-stat-v">${s(a.value)}</div><div class="pc-stat-k">${s(a.label)}</div>${a.rank?`<div class="pc-muted">${s(a.rank)}</div>`:""}</div>`).join(""),n=[t.team,t.jersey?`#${t.jersey}`:"",t.position].filter(Boolean).map(s).join(" \u2022 ");return j("sports-player",e,`<div class="pc-player">${N(t.headshot,t.name,"pc-headshot")}<div><div class="pcx-title big">${s(t.name)}</div><div class="pc-muted">${n}</div>${t.bio?`<div class="pc-muted">${s(t.bio)}</div>`:""}</div>${N(t.teamLogo,t.team,"pc-logo")}</div>${r?`<div class="pc-subhead">${s(t.statsLabel||"Season stats")}</div><div class="pcx-stats">${r}</div>`:""}${t.link?`<a class="pc-more" href="${s(C(t.link))}" target="_blank" rel="noopener noreferrer">Full profile \u2197</a>`:""}`)}function Bt(e){let t=(e.groups||[]).filter(o=>(o.rows||[]).length);if(!t.length)return E("sports","Standings unavailable.");let r=e.columns||["W","L","PCT","GB","L10","STRK"],n=t.length>1?`<div class="pc-tabs" role="tablist">${t.map((o,i)=>`<button type="button" role="tab" class="pc-tab ${i===0?"on":""}" data-pc-act="tab" data-i="${i}">${s(o.name)}</button>`).join("")}</div>`:"",a=t.map((o,i)=>`<div class="pc-tabpane" data-i="${i}" ${i?"hidden":""}><div class="pc-table-scroll"><table class="pc-table"><thead><tr><th>#</th><th class="l">Team</th>${r.map(p=>`<th>${s(p)}</th>`).join("")}</tr></thead><tbody>${o.rows.map((p,c)=>`<tr><td>${s(p.seed||c+1)}</td><td class="l"><span class="pc-team-inline">${N(p.logo,"","pc-logo-sm")}${s(p.team)}</span></td>${r.map(l=>`<td>${s(p.stats?.[l]??"")}</td>`).join("")}</tr>`).join("")}</tbody></table></div></div>`).join("");return j("sports-standings",e,`${L(e.league||"Standings",e.title||"")}${n}${a}`)}function Rt(e,t){let r=C(e.directionsUrl)||`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(Number.isFinite(e.lat)?`${e.lat},${e.lng}`:`${e.name} ${e.address||""}`)}`,n=e.openNow===!0?'<span class="pc-open">Open now</span>':e.openNow===!1?'<span class="pc-closed">Closed</span>':"",a=[`<a class="pc-chip" href="${s(r)}" target="_blank" rel="noopener noreferrer">${_.route}Directions</a>`,C(e.website)?`<a class="pc-chip" href="${s(C(e.website))}" target="_blank" rel="noopener noreferrer">${_.globe}Website</a>`:"",e.phone?`<a class="pc-chip" href="tel:${s(String(e.phone).replace(/[^+\d]/g,""))}">${_.phone}Call</a>`:"",C(e.reserveUrl)?`<a class="pc-chip primary" href="${s(C(e.reserveUrl))}" target="_blank" rel="noopener noreferrer">Reserve</a>`:""].join("");return`<div class="pc-place" data-i="${t}">${e.imageUrl?`<div class="pc-place-img">${N(e.imageUrl,e.name)}</div>`:""}<div class="pc-place-body"><div class="pc-place-top"><span class="pc-num">${t+1}</span><strong>${s(e.name)}</strong></div><div class="pc-muted">${[J(e.rating),e.reviews?`(${s(ce(e.reviews,0))})`:"",s(e.price||""),s(e.category||"")].filter(Boolean).join(" \xB7 ")}</div>${e.address?`<div class="pc-muted">${_.pin}${s(e.address)}</div>`:""}<div class="pc-place-hours">${n}${e.hours?`<span class="pc-muted">${s(e.hours)}</span>`:""}</div><div class="pc-chips">${a}</div></div></div>`}function qt(e){let t=(e.places||[]).map((n,a)=>({i:a,name:n.name,lat:Number(n.lat),lng:Number(n.lng),rating:n.rating})).filter(n=>Number.isFinite(n.lat)&&Number.isFinite(n.lng));return t.length?`<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/vendor/maplibre/maplibre-gl.css"><style>html,body,#m{margin:0;height:100%;background:#0b141b}.maplibregl-canvas{filter:brightness(.78) saturate(.85)}.pin{display:flex;align-items:center;gap:4px;padding:3px 8px 3px 4px;border-radius:999px;background:#151f27;color:#fff;font:600 12px system-ui;box-shadow:0 2px 8px rgba(0,0,0,.45);border:1px solid rgba(255,255,255,.18);cursor:pointer;white-space:nowrap}.pin b{width:18px;height:18px;border-radius:50%;background:#ff7a1a;display:grid;place-items:center;font-size:11px}.pin span{color:#f5c04a}.maplibregl-ctrl-attrib{font:10px system-ui!important;background:rgba(8,20,28,.7)!important;color:#9eb4bd!important}.maplibregl-ctrl-attrib a{color:#c2d6dc!important}</style></head><body><div id="m"></div><script src="/vendor/maplibre/maplibre-gl.js"><\/script><script>const d=${JSON.stringify({pts:t,zoom:Number(e.zoom)||0,id:String(e.id||"")}).replace(/</g,"\\u003c")};const map=new maplibregl.Map({container:'m',style:{version:8,sources:{c:{type:'raster',tiles:['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],tileSize:256,attribution:'\xA9 OpenStreetMap \xA9 CARTO'}},layers:[{id:'c',type:'raster',source:'c'}]},center:[d.pts[0].lng,d.pts[0].lat],zoom:13,attributionControl:{compact:true},cooperativeGestures:true});const b=new maplibregl.LngLatBounds();d.pts.forEach(p=>{b.extend([p.lng,p.lat]);const el=document.createElement('div');el.className='pin';el.innerHTML='<b>'+(p.i+1)+'</b>'+(p.rating?'<span>\u2605 '+Number(p.rating).toFixed(1)+'</span>':'');el.onclick=()=>parent.postMessage({type:'prom-places-pin',id:d.id,i:p.i},'*');new maplibregl.Marker({element:el}).setLngLat([p.lng,p.lat]).addTo(map)});if(d.pts.length>1)map.fitBounds(b,{padding:48,maxZoom:15,duration:0});else map.setZoom(d.zoom||14);<\/script></body></html>`:""}function Ft(e){let t=qt(e);return t?`<div class="pc-map-slot"><iframe class="pc-map-frame" title="Map of places" srcdoc="${s(t)}" loading="lazy"></iframe></div>`:""}function Ot(e,t=""){let r=(e.places||[]).filter(n=>n?.name).slice(0,12);return r.length?j("places",e,`${L("Places",e.title||"")}${t}${Q(r.map(Rt).join(""),"places")}`):E("places","No places found.")}function Vt(e){let t=e.item||(e.items||[])[0];if(!t?.title)return E("product","Product details unavailable.");let r=C(t.productUrl||t.url),n=(t.offers||[]).slice(0,4).map(i=>`<a class="pc-offer" href="${s(C(i.url)||r)}" target="_blank" rel="noopener noreferrer"><span>${s(i.merchant||I(i.url))}</span><strong>${s(i.price||"")}</strong></a>`).join(""),a=(t.pros||[]).slice(0,4).map(i=>`<li>${s(i)}</li>`).join(""),o=e.variant==="hero";return j("product",e,`${o?`<div class="pc-head"><span class="pc-kicker pc-badge-pick">${s(e.badge||"Top pick")}</span></div>`:""}<div class="pc-product ${o?"hero":""}">${C(t.imageUrl)?`<a class="pc-product-img" href="${s(r)}" target="_blank" rel="noopener noreferrer"><img src="${s(C(t.imageUrl))}" alt="${s(t.title)}" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="this.parentNode.style.display='none'"></a>`:""}<div class="pc-product-body"><a class="pc-link-title" href="${s(r)}" target="_blank" rel="noopener noreferrer">${s(t.title)}</a><div class="pc-product-price"><strong>${s(t.price||"")}</strong>${t.merchant||r?`<span class="pc-muted">${s(t.merchant||I(r))}</span>`:""}</div><div class="pc-muted">${[J(t.rating),t.reviewCount?`${s(ce(t.reviewCount,0))} reviews`:""].filter(Boolean).join(" \xB7 ")}</div>${t.description?`<div class="pc-muted pc-clamp3">${s(t.description)}</div>`:""}${a?`<ul class="pc-pros">${a}</ul>`:""}${n?`<div class="pc-offers">${n}</div>`:""}${r?`<a class="pc-btn primary pc-buy" href="${s(r)}" target="_blank" rel="noopener noreferrer">View at ${s(t.merchant||I(r))}</a>`:""}</div></div>`)}function Pt(e){let t=(e.products||[]).filter(i=>i?.title).slice(0,5);if(t.length<2)return E("comparison","Need at least two products.");let r=(e.specs||[]).slice(0,20),n=i=>i===!0?"\u2713":i===!1?"\u2014":i==null||i===""?'<span class="pc-muted">\u2014</span>':s(i),a=t.map(i=>{let p=C(i.url),c=p?`<a class="pc-link-title" href="${s(p)}" target="_blank" rel="noopener noreferrer">${s(i.title)}</a>`:`<strong>${s(i.title)}</strong>`;return`<th><div class="pc-cmp-prod">${i.badge?`<span class="pc-badge-pick">${s(i.badge)}</span>`:""}${i.imageUrl?`<div class="pc-cmp-img">${N(i.imageUrl,i.title)}</div>`:""}${c}${i.price?`<span class="pc-cmp-price">${s(i.price)}</span>`:""}${J(i.rating)}</div></th>`}).join(""),o=r.map(i=>`<tr><th scope="row">${s(i)}</th>${t.map(p=>`<td>${n(p.specs?.[i])}</td>`).join("")}</tr>`).join("");return j("compare",e,`${L("Compare",e.title||"")}<div class="pc-cmp-scroll"><table class="pc-cmp"><thead><tr><th></th>${a}</tr></thead><tbody>${o}</tbody></table></div>`)}function ee(e,t={}){try{switch(e?.type){case"currency":return Mt(e);case"clock":return At(e);case"video":return _t(e);case"gallery":return jt(e);case"news":return Lt(e);case"sports_game":return Nt(e);case"sports_player":return It(e);case"sports_standings":return Bt(e);case"places":return Ot(e,typeof t.mapHtml=="function"?t.mapHtml(e):Ft(e));case"product":return Vt(e);case"product_comparison":return Pt(e);default:return""}}catch(r){return E(String(e?.type||"card"),r?.message||String(r))}}var qe=`
.pcx,.pc-followups{--pc-text:var(--prom-text,var(--pm-text,var(--text,currentColor)));--pc-muted:var(--prom-muted,var(--pm-muted,var(--muted,#8a8a8a)));--pc-line:var(--prom-border,var(--pm-border,var(--line,rgba(127,127,127,.25))));--pc-surface:var(--prom-surface,var(--pm-surface,var(--panel,rgba(127,127,127,.06))));--pc-soft:var(--prom-surface-secondary,var(--pm-bg-soft,var(--panel-2,rgba(127,127,127,.11))));--pc-accent:var(--prom-accent,var(--pm-orange,var(--brand,#ff7a1a)));--pc-ok:var(--prom-success,#22a06b);--pc-bad:var(--prom-danger,#e5484d)}
.pc-inline-card{margin:12px 0}.pc-inline-card>.pcx,.pc-inline-card>*:first-child{margin-top:0}.pcx{display:block;margin:10px 0;max-width:100%;border:1px solid var(--pc-line);border-radius:16px;background:var(--pc-surface);color:var(--pc-text);padding:14px;font-size:14px;line-height:1.45;overflow:hidden;box-sizing:border-box}
.pcx *{box-sizing:border-box}
.pcx svg{width:16px;height:16px;flex:none;vertical-align:-3px}
.pc-head{display:flex;align-items:center;gap:8px;margin-bottom:10px;min-width:0}
.pc-kicker{font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--pc-muted)}
.pcx-title{font-weight:600;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pcx-title.big{font-size:18px;white-space:normal}
.pc-head .pc-icon-btn,.pc-head .pc-count{margin-left:auto}
.pc-count{font-size:12px;color:var(--pc-muted)}
.pc-muted{color:var(--pc-muted);font-size:12.5px}
.pc-center{text-align:center}
.pc-source{margin-top:8px;font-size:11px;color:var(--pc-muted)}
.pc-error{border-style:dashed}.pc-error-title{font-weight:600;margin-bottom:2px}
.pc-btn{appearance:none;border:1px solid var(--pc-line);background:var(--pc-soft);color:var(--pc-text);border-radius:999px;padding:8px 14px;font:inherit;font-weight:600;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center;justify-content:center;gap:6px}
.pc-btn:hover:not([disabled]){border-color:var(--pc-accent)}
.pc-btn.primary{background:var(--pc-accent);border-color:var(--pc-accent);color:#fff}
.pc-btn.good{border-color:color-mix(in srgb,var(--pc-ok) 50%,transparent);color:var(--pc-ok)}
.pc-btn.bad{border-color:color-mix(in srgb,var(--pc-bad) 50%,transparent);color:var(--pc-bad)}
.pc-btn[disabled]{opacity:.45;cursor:default}
.pc-icon-btn{appearance:none;border:1px solid var(--pc-line);background:transparent;color:var(--pc-text);border-radius:999px;padding:4px 10px;font:inherit;font-size:12px;cursor:pointer;display:inline-flex;gap:5px;align-items:center}
.pc-actions{display:flex;gap:8px;justify-content:flex-end;margin-top:12px;flex-wrap:wrap}
.pc-actions.split{justify-content:stretch}.pc-actions.split .pc-btn{flex:1}
.pc-chips{display:flex;flex-wrap:wrap;gap:6px}
.pc-chip{appearance:none;display:inline-flex;align-items:center;gap:5px;border:1px solid var(--pc-line);background:transparent;color:var(--pc-text);border-radius:999px;padding:5px 10px;font:inherit;font-size:12.5px;cursor:pointer;text-decoration:none;white-space:nowrap}
.pc-chip:hover{border-color:var(--pc-accent)}.pc-chip.primary{background:var(--pc-accent);border-color:var(--pc-accent);color:#fff}
.pc-chip.sent,.pc-followup.sent{opacity:.55}
/* quiz / poll */
.pc-progress-row{display:flex;justify-content:space-between;align-items:center;font-size:12px;color:var(--pc-muted);margin-bottom:8px}
.pc-dots{display:flex;gap:4px}.pc-dots span{width:7px;height:7px;border-radius:50%;background:var(--pc-line)}.pc-dots .on{background:var(--pc-accent)}.pc-dots .ok{background:var(--pc-ok)}.pc-dots .bad{background:var(--pc-bad)}
.pc-question{font-size:16px;font-weight:600;margin-bottom:10px}
.pc-opts{display:grid;gap:8px}
.pc-opt{appearance:none;display:flex;align-items:center;gap:10px;width:100%;text-align:left;border:1px solid var(--pc-line);background:transparent;color:var(--pc-text);border-radius:12px;padding:10px 12px;font:inherit;cursor:pointer;transition:border-color .12s,background .12s}
.pc-opt:hover:not([disabled]){border-color:var(--pc-accent)}
.pc-opt.picked{border-color:var(--pc-accent);background:color-mix(in srgb,var(--pc-accent) 12%,transparent)}
.pc-opt.correct{border-color:var(--pc-ok);background:color-mix(in srgb,var(--pc-ok) 14%,transparent)}
.pc-opt.wrong{border-color:var(--pc-bad);background:color-mix(in srgb,var(--pc-bad) 12%,transparent)}
.pc-opt.dim{opacity:.55}.pc-opt[disabled]{cursor:default}
.pc-opt-key{flex:none;width:24px;height:24px;border-radius:50%;display:grid;place-items:center;font-size:12px;font-weight:700;background:var(--pc-soft)}
.pc-check{flex:none;width:18px;text-align:center;color:var(--pc-accent)}
.pc-hint{margin-top:10px;padding:8px 10px;border-radius:10px;background:var(--pc-soft);font-size:13px}
.pc-feedback{margin-top:10px;padding:10px 12px;border-radius:10px;display:grid;gap:3px;font-size:13.5px}
.pc-feedback.ok{background:color-mix(in srgb,var(--pc-ok) 14%,transparent)}.pc-feedback.bad{background:color-mix(in srgb,var(--pc-bad) 12%,transparent)}
.pc-score{display:flex;align-items:baseline;gap:10px;margin:4px 0 10px}.pc-score strong{font-size:30px}
.pc-review{margin:0;padding-left:0;list-style:none;display:grid;gap:6px}.pc-review li{display:flex;gap:8px}.pc-review .ok span{color:var(--pc-ok)}.pc-review .bad span{color:var(--pc-bad)}
.pc-poll-row{display:flex;justify-content:space-between;padding:8px 10px;border:1px solid var(--pc-line);border-radius:10px;margin-bottom:6px}.pc-poll-row.mine{border-color:var(--pc-accent);font-weight:600}
/* flashcards */
.pc-bar{height:4px;border-radius:4px;background:var(--pc-soft);overflow:hidden;margin-bottom:10px}.pc-bar span{display:block;height:100%;background:var(--pc-accent);transition:width .2s}
.pc-flip{appearance:none;width:100%;min-height:150px;border:1px solid var(--pc-line);border-radius:14px;background:var(--pc-soft);color:var(--pc-text);font:inherit;display:grid;place-items:center;align-content:center;gap:6px;padding:20px;cursor:pointer;text-align:center;animation:pc-flip-in .25s ease}
.pc-flip.flipped{background:color-mix(in srgb,var(--pc-accent) 10%,var(--pc-soft))}
.pc-flip-side{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--pc-muted)}.pc-flip-text{font-size:18px;font-weight:600}
@keyframes pc-flip-in{from{transform:rotateX(70deg);opacity:.3}to{transform:none;opacity:1}}
/* writing */
.pc-writing-subject{padding:8px 0;border-bottom:1px solid var(--pc-line);margin-bottom:8px}.pc-writing-subject span{color:var(--pc-muted);margin-right:8px;font-size:12px}
.pc-writing-body{white-space:pre-wrap;font-family:Georgia,'Iowan Old Style',serif;font-size:15px;line-height:1.6}
.pc-writing-foot{display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-top:12px;padding-top:10px;border-top:1px solid var(--pc-line)}
/* follow-ups */
.pc-followups{display:grid;gap:0;margin:12px 0 4px;border-top:1px solid var(--pc-line)}
.pc-followup{appearance:none;display:flex;justify-content:space-between;align-items:center;gap:10px;width:100%;text-align:left;background:transparent;border:0;border-bottom:1px solid var(--pc-line);color:var(--pc-text);font:inherit;padding:10px 2px;cursor:pointer}
.pc-followup:hover{color:var(--pc-accent)}.pc-followup span:last-child{color:var(--pc-muted)}
/* reminder */
.pc-rem{display:flex;gap:12px;align-items:flex-start}.pc-rem-icon{flex:none;width:36px;height:36px;border-radius:10px;display:grid;place-items:center;background:var(--pc-soft);color:var(--pc-accent)}
/* scroller */
.pc-scroller-wrap{position:relative}
.pc-scroller{display:flex;gap:10px;overflow-x:auto;scroll-snap-type:x mandatory;scrollbar-width:none;padding:2px 0 4px;-webkit-overflow-scrolling:touch}.pc-scroller::-webkit-scrollbar{display:none}
.pc-scroller>*{scroll-snap-align:start;flex:none}
.pc-nav{position:absolute;top:40%;z-index:2;width:30px;height:30px;border-radius:50%;border:1px solid var(--pc-line);background:var(--pc-surface);color:var(--pc-text);display:grid;place-items:center;cursor:pointer;opacity:0;transition:opacity .15s;backdrop-filter:blur(8px)}
.pc-nav.prev{left:-4px}.pc-nav.next{right:-4px}.pc-scroller-wrap:hover .pc-nav{opacity:.95}
@media (hover:none){.pc-nav{display:none}}
/* currency */
.pc-currency{max-width:440px}
.pc-fx-row{display:flex;gap:8px;align-items:center}
.pc-input,.pc-select,.pc-fx-out{font:inherit;color:var(--pc-text);background:var(--pc-soft);border:1px solid var(--pc-line);border-radius:12px;padding:10px 12px;min-width:0}
.pc-input,.pc-fx-out{flex:1;font-size:20px;font-weight:600}.pc-select{flex:none;max-width:52%}
.pc-fx-swap{margin:6px auto;display:flex}
.pc-fx-out{display:block}
/* clock */
.pc-clock-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px}
.pc-clock-cell{padding:12px;border-radius:12px;background:var(--pc-soft)}
.pc-clock-label{font-weight:600}.pc-clock-time{font-size:24px;font-weight:700;font-variant-numeric:tabular-nums;margin:2px 0}
/* video */
.pc-video-tile{width:240px}.pc-video-tile.big{width:100%;margin-bottom:10px}
.pc-video-thumb{appearance:none;position:relative;display:block;width:100%;aspect-ratio:16/9;border:0;padding:0;border-radius:12px;overflow:hidden;background:var(--pc-soft);cursor:pointer}
.pc-video-thumb img{width:100%;height:100%;object-fit:cover;display:block}
.pc-play{position:absolute;inset:0;margin:auto;width:54px;height:54px;border-radius:50%;display:grid;place-items:center;background:rgba(0,0,0,.6);color:#fff}.pc-play svg{width:24px;height:24px}
.pc-badge{position:absolute;right:8px;bottom:8px;background:rgba(0,0,0,.72);color:#fff;font-size:11px;padding:2px 6px;border-radius:6px}
.pc-video-frame{width:100%;aspect-ratio:16/9;border:0;border-radius:12px;display:block;background:#000}
.pc-video-meta{padding:6px 2px 0}
.pc-link-title{color:var(--pc-text);font-weight:600;text-decoration:none;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}.pc-link-title:hover{color:var(--pc-accent)}
/* gallery */
.pc-gallery-grid{display:grid;grid-template-columns:repeat(4,1fr);grid-auto-rows:96px;gap:6px}
.pc-gallery-tile{appearance:none;border:0;padding:0;border-radius:10px;overflow:hidden;background:var(--pc-soft);cursor:zoom-in}.pc-gallery-tile.hero{grid-column:span 2;grid-row:span 2}
.pc-gallery-tile img{width:100%;height:100%;object-fit:cover;display:block;transition:transform .2s}.pc-gallery-tile:hover img{transform:scale(1.04)}
@media (max-width:520px){.pc-gallery-grid{grid-template-columns:repeat(3,1fr);grid-auto-rows:84px}}
.pc-lightbox{position:fixed;inset:0;z-index:100000;background:rgba(0,0,0,.88);display:flex;align-items:center;justify-content:center;padding:24px}
.pc-lightbox figure{margin:0;max-width:min(1100px,92vw);display:grid;gap:8px}.pc-lightbox img{max-width:100%;max-height:80vh;object-fit:contain;border-radius:8px}
.pc-lightbox figcaption{color:#ddd;font-size:13px;display:flex;justify-content:space-between;gap:12px}.pc-lightbox a{color:#fff}
.pc-lb-close,.pc-lb-nav{position:absolute;background:rgba(255,255,255,.12);color:#fff;border:0;border-radius:50%;width:42px;height:42px;font-size:24px;cursor:pointer}
.pc-lb-close{top:16px;right:16px}.pc-lb-nav.prev{left:16px}.pc-lb-nav.next{right:16px}
/* news */
.pc-news-tile{width:250px;border:1px solid var(--pc-line);border-radius:12px;overflow:hidden;text-decoration:none;color:var(--pc-text);background:var(--pc-soft);display:flex;flex-direction:column}
.pc-news-img{aspect-ratio:16/9;background:var(--pc-line);overflow:hidden}.pc-news-img img{width:100%;height:100%;object-fit:cover;display:block}
.pc-news-body{padding:10px;display:grid;gap:4px}.pc-news-title{font-weight:600;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.pc-news-src{display:flex;gap:5px;align-items:center;font-size:12px;color:var(--pc-muted)}.pc-fav{width:14px;height:14px;border-radius:3px}
.pc-clamp2{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}.pc-clamp3{display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
/* sports */
.pc-game-row{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:8px;margin:8px 0}
.pc-team{display:grid;justify-items:center;text-align:center;gap:3px}.pc-team-name{font-weight:600}
.pc-logo{width:48px;height:48px;object-fit:contain}.pc-logo-sm{width:18px;height:18px;object-fit:contain}
.pc-game-mid{display:flex;align-items:center;gap:14px}.pc-game-score{font-size:30px;font-weight:700;font-variant-numeric:tabular-nums;color:var(--pc-muted)}.pc-game-score.win{color:var(--pc-text)}
.pc-game-status{font-size:12px;color:var(--pc-muted);text-align:center;display:flex;align-items:center;gap:5px}.pc-game-status.live{color:var(--pc-bad);font-weight:600}
.pc-live-dot{width:7px;height:7px;border-radius:50%;background:var(--pc-bad);animation:pc-pulse 1.4s infinite}@keyframes pc-pulse{50%{opacity:.25}}
.pc-game-tile{width:320px;border:1px solid var(--pc-line);border-radius:12px;padding:10px}
.pc-table-scroll{overflow-x:auto}
.pc-table{width:100%;border-collapse:collapse;font-size:13px;font-variant-numeric:tabular-nums}
.pc-table th,.pc-table td{padding:6px 8px;text-align:center;border-bottom:1px solid var(--pc-line);white-space:nowrap}.pc-table th{color:var(--pc-muted);font-weight:600;font-size:12px}
.pc-table .l,.pc-linescore td:first-child{text-align:left}.pc-team-inline{display:inline-flex;gap:6px;align-items:center}
.pc-tabs{display:flex;gap:4px;margin-bottom:8px;background:var(--pc-soft);border-radius:999px;padding:3px;width:max-content;max-width:100%;overflow-x:auto}
.pc-tab{appearance:none;border:0;background:transparent;color:var(--pc-muted);font:inherit;font-size:13px;padding:5px 12px;border-radius:999px;cursor:pointer;white-space:nowrap}.pc-tab.on{background:var(--pc-surface);color:var(--pc-text);font-weight:600}
.pc-player{display:grid;grid-template-columns:auto 1fr auto;gap:12px;align-items:center}
.pc-headshot{width:72px;height:72px;border-radius:50%;object-fit:cover;background:var(--pc-soft)}
.pc-subhead{margin:12px 0 6px;font-size:12px;color:var(--pc-muted);text-transform:uppercase;letter-spacing:.05em}
.pcx-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(70px,1fr));gap:6px}
.pc-stat{background:var(--pc-soft);border-radius:10px;padding:8px;text-align:center}.pc-stat-v{font-size:20px;font-weight:700}.pc-stat-k{font-size:11px;color:var(--pc-muted);font-weight:600}
.pc-more{display:inline-block;margin-top:10px;font-size:13px;color:var(--pc-accent);text-decoration:none}
/* places */
.pc-place{width:280px;border:1px solid var(--pc-line);border-radius:12px;overflow:hidden;background:var(--pc-soft);display:flex;flex-direction:column}
.pc-place-img{aspect-ratio:16/9;overflow:hidden}.pc-place-img img{width:100%;height:100%;object-fit:cover;display:block}
.pc-place-body{padding:10px;display:grid;gap:5px}.pc-place-top{display:flex;gap:8px;align-items:center}
.pc-num{flex:none;width:22px;height:22px;border-radius:50%;display:grid;place-items:center;background:var(--pc-accent);color:#fff;font-size:12px;font-weight:700}
.pc-place-hours{display:flex;gap:6px;align-items:baseline;flex-wrap:wrap}.pc-open{color:var(--pc-ok);font-weight:600;font-size:12.5px}.pc-closed{color:var(--pc-bad);font-weight:600;font-size:12.5px}
.pc-stars{color:#f5a524;font-weight:600}
.pc-places .pc-map-slot{margin:-2px 0 10px;border-radius:12px;overflow:hidden;height:260px;background:#0b141b}
.pc-map-frame{width:100%;height:100%;border:0;display:block}
.pc-place.flash{outline:2px solid var(--pc-accent);outline-offset:-2px}
/* product */
.pc-product{display:grid;grid-template-columns:160px 1fr;gap:14px}.pc-product.hero{grid-template-columns:220px 1fr}
.pc-product-img{display:block;aspect-ratio:1;border-radius:12px;background:#fff;overflow:hidden}.pc-product-img img{width:100%;height:100%;object-fit:contain;display:block}
.pc-product-body{display:grid;gap:6px;align-content:start;min-width:0}.pc-product-price{display:flex;gap:8px;align-items:baseline}.pc-product-price strong{font-size:20px}
.pc-badge-pick{color:var(--pc-accent)}
.pc-pros{margin:2px 0;padding-left:18px;font-size:13px}
.pc-offers{display:grid;gap:4px}.pc-offer{display:flex;justify-content:space-between;padding:6px 10px;border:1px solid var(--pc-line);border-radius:8px;color:var(--pc-text);text-decoration:none;font-size:13px}
.pc-buy{justify-self:start;margin-top:4px}
@media (max-width:520px){.pc-product,.pc-product.hero{grid-template-columns:1fr}.pc-product-img{max-height:240px;aspect-ratio:auto;height:220px}.pcx{padding:12px;border-radius:14px}.pc-game-score{font-size:24px}.pc-logo{width:38px;height:38px}}
/* product comparison: products as columns */
.pc-cmp-scroll{overflow-x:auto;margin:0 -14px;padding:0 14px;-webkit-overflow-scrolling:touch}
.pc-cmp{border-collapse:collapse;width:100%;min-width:max-content;font-size:13px}
.pc-cmp th,.pc-cmp td{padding:8px 10px;border-bottom:1px solid var(--pc-line);text-align:left;vertical-align:top;min-width:140px;max-width:220px}
.pc-cmp tbody th{color:var(--pc-muted);font-weight:600;min-width:96px;position:sticky;left:0;background:var(--pc-surface)}
.pc-cmp thead th{border-bottom:2px solid var(--pc-line)}
.pc-cmp-prod{display:grid;gap:4px}.pc-cmp-img{height:96px;border-radius:10px;background:#fff;overflow:hidden}.pc-cmp-img img{width:100%;height:100%;object-fit:contain}
.pc-cmp-price{font-weight:700;font-size:15px}
/* calculator + unit converter */
.pc-calc-expr{width:100%;font-size:18px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.pc-calc-out{display:block;text-align:right;font-size:26px;font-weight:700;margin:8px 2px 10px;min-height:34px;font-variant-numeric:tabular-nums}.pc-calc-out.pending{color:var(--pc-muted)}
.pc-keypad{display:grid;grid-template-columns:repeat(4,1fr);gap:6px}
.pc-key{appearance:none;font:inherit;font-size:16px;font-weight:600;padding:10px 0;border-radius:10px;border:1px solid var(--pc-line);background:var(--pc-soft);color:var(--pc-text);cursor:pointer;touch-action:manipulation}
.pc-key:active{transform:scale(.97)}.pc-key.op{color:var(--pc-accent)}.pc-key.eq{grid-column:1/-1;background:var(--pc-accent);border-color:transparent;color:#fff}
.pc-error .pc-actions{margin-top:8px}
.pc-visual-error{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:6px 0 10px;padding:8px 10px;border:1px dashed var(--prom-danger,#e5484d);border-radius:12px;font-size:13px;color:var(--prom-muted,var(--pm-muted,var(--muted,#8a8a8a)))}
/* inline citation chips */
.pc-cite{display:inline-flex;align-items:center;gap:3px;vertical-align:1px;margin:0 2px;padding:1px 7px;border-radius:999px;background:var(--pc-soft,rgba(127,127,127,.12));color:var(--pc-muted,inherit);font-size:11.5px;font-weight:600;text-decoration:none;white-space:nowrap}
.pc-cite:hover{color:var(--pc-accent,inherit)}.pc-cite img{width:12px;height:12px;border-radius:3px}
`;var Ue="prom-card-state:",Fe="prom-cards-style",Oe=!1,fe=globalThis.__promCardState||=new Map;function he(e){if(fe.has(e))return fe.get(e);try{return JSON.parse(localStorage.getItem(Ue+e)||"{}")||{}}catch{return{}}}function Dt(e,t){fe.set(e,t||{});try{localStorage.setItem(Ue+e,JSON.stringify(t||{}))}catch{}}function Ut(e,t,r,n){let a=e.getAttribute("data-pc-id"),o=document.createElement("template");o.innerHTML=Z(t,a,JSON.stringify(r),n).trim();let i=o.content.firstElementChild;i&&e.replaceWith(i)}function ve(e){let t=P(e);if(!t?.rates)return;let r=m=>e.querySelector(`[data-pc-fx="${m}"]`),n=Number(r("amount")?.value||0),a=r("from")?.value,o=r("to")?.value,i=m=>m===t.base?1:Number(t.rates[m]),p=i(o)/i(a),c=r("out"),l=r("rate");if(!Number.isFinite(p)){c&&(c.textContent="\u2014");return}let d=(m,x)=>{try{return new Intl.NumberFormat(void 0,{style:"currency",currency:x,maximumFractionDigits:m<1?4:2}).format(m)}catch{return`${m.toFixed(2)} ${x}`}};c&&(c.textContent=d(n*p,o)),l&&(l.textContent=`1 ${a} = ${p.toFixed(p<1?4:3)} ${o}`)}var te=null;function Ve(){let e=document.querySelectorAll(".pc-clock-cell[data-tz]");if(!e.length){clearInterval(te),te=null;return}let t=new Date;e.forEach(r=>{let n=r.getAttribute("data-tz");try{r.querySelector('[data-pc-clock="time"]').textContent=t.toLocaleTimeString([],{timeZone:n,hour:"numeric",minute:"2-digit",second:"2-digit"}),r.querySelector('[data-pc-clock="date"]').textContent=t.toLocaleDateString([],{timeZone:n,weekday:"short",month:"short",day:"numeric"})}catch{}})}function Ht(e,t){let r=t,n=document.createElement("div");n.className="pc-lightbox";let a=()=>{let c=e[r]||{};n.innerHTML=`<button type="button" class="pc-lb-close" aria-label="Close">\xD7</button><button type="button" class="pc-lb-nav prev" aria-label="Previous">\u2039</button><figure><img src="${s(c.src||c.thumb)}" alt="${s(c.title)}" referrerpolicy="no-referrer"><figcaption>${s(c.title)}${c.page?` \xB7 <a href="${s(c.page)}" target="_blank" rel="noopener noreferrer">${s(c.source||"Source")} \u2197</a>`:""}<span>${r+1} / ${e.length}</span></figcaption></figure><button type="button" class="pc-lb-nav next" aria-label="Next">\u203A</button>`},o=()=>{n.remove(),document.removeEventListener("keydown",p)},i=c=>{r=(r+c+e.length)%e.length,a()},p=c=>{c.key==="Escape"&&o(),c.key==="ArrowLeft"&&i(-1),c.key==="ArrowRight"&&i(1)};n.addEventListener("click",c=>{c.target===n||c.target.closest(".pc-lb-close")?o():c.target.closest(".pc-lb-nav.prev")?i(-1):c.target.closest(".pc-lb-nav.next")&&i(1)}),document.addEventListener("keydown",p),a(),document.body.appendChild(n)}async function Wt(e){try{return await navigator.clipboard.writeText(e),!0}catch{}let t=document.createElement("textarea");t.value=e,t.style.position="fixed",t.style.opacity="0",document.body.appendChild(t),t.select();try{return document.execCommand("copy"),!0}catch{return!1}finally{t.remove()}}function Yt(e){if(e.__pcHandled)return;let t=e.target.closest?.("[data-pc-act]");if(!t||!t.isConnected)return;e.__pcHandled=!0;let r=t.closest("[data-pc-id]"),n=t.getAttribute("data-pc-act");if(n==="send"){e.preventDefault(),K(t.getAttribute("data-prompt")),t.classList.add("sent");return}if(n==="open"){let l=t.getAttribute("data-url");l&&window.open(l,"_blank","noopener");return}if(n==="scroll"){let l=t.parentElement?.querySelector(".pc-scroller");l&&l.scrollBy({left:Number(t.getAttribute("data-dir"))*Math.max(220,l.clientWidth*.85),behavior:"smooth"});return}if(n==="tab"&&r){let l=t.getAttribute("data-i");r.querySelectorAll(".pc-tab").forEach(d=>d.classList.toggle("on",d===t)),r.querySelectorAll(".pc-tabpane").forEach(d=>{d.hidden=d.getAttribute("data-i")!==l});return}if(n==="video-play"){let l=t.getAttribute("data-yt");if(!/^[A-Za-z0-9_-]{11}$/.test(l||""))return;let d=document.createElement("iframe");d.className="pc-video-frame",d.src=`https://www.youtube-nocookie.com/embed/${l}?autoplay=1&rel=0`,d.allow="autoplay; encrypted-media; picture-in-picture; fullscreen",d.allowFullscreen=!0,d.title="Video player",t.replaceWith(d);return}if(n==="calc-key"&&r){_e(r,t.getAttribute("data-k"));return}if(n==="unit-swap"&&r){let l=r.querySelector('[data-pc-unit="from"]'),d=r.querySelector('[data-pc-unit="to"]');if(l&&d){let m=l.value;l.value=d.value,d.value=m,le(r)}return}if(n==="lightbox"&&r){let l=P(r)||[];l.length&&Ht(l,Number(t.getAttribute("data-i"))||0);return}if(n==="fx-swap"&&r){let l=r.querySelector('[data-pc-fx="from"]'),d=r.querySelector('[data-pc-fx="to"]');if(l&&d){let m=l.value;l.value=d.value,d.value=m,ve(r)}return}if(!r)return;let a=r.getAttribute("data-pc-kind"),o=r.getAttribute("data-pc-id"),i=P(r);if(!a||!o||!i)return;if(n==="copy"){let l=String(i.text??i.body??i.content??"");Wt(i.subject?`Subject: ${i.subject}

${l}`:l)}let p=he(o),c=Ie(a,i,p,n,{k:t.getAttribute("data-k")});if(Dt(o,c),a==="poll"&&n==="poll-send"){let l=(i.options||[]).map(String),d=(c.picks||[]).map(m=>l[m]).filter(Boolean);K(`${i.question}: ${d.join(", ")}`)}a==="reminder"&&n==="rem-set"&&K(`Set a reminder: ${i.title}${i.when?` (${i.when})`:""}`),Ut(r,a,i,c)}function Pe(e){let t=e.target.closest?.("[data-pc-fx]");if(t){ve(t.closest(".pc-currency"));return}if(e.target.closest?.("[data-pc-unit]")){le(e.target.closest(".pc-convert"));return}e.target.closest?.("[data-pc-calc]")&&ue(e.target.closest(".pc-calc"))}function De(e=document){e.querySelectorAll?.(".pc-currency:not([data-pc-ready])").forEach(t=>{t.setAttribute("data-pc-ready","1"),ve(t)}),e.querySelector?.(".pc-clock-cell[data-tz]")&&(Ve(),te||(te=setInterval(Ve,1e3)))}function be(){if(Oe||typeof document>"u"||window.__promCardsInstalled)return;if(Oe=!0,window.__promCardsInstalled=!0,!document.getElementById(Fe)){let t=document.createElement("style");t.id=Fe,t.textContent=qe,document.head.appendChild(t)}if(document.addEventListener("click",Yt),window.addEventListener("message",t=>{let r=t?.data;if(!r||r.type!=="prom-places-pin")return;let a=[...document.querySelectorAll(".pc-places[data-pc-id]")].find(o=>o.getAttribute("data-pc-id")===String(r.id))?.querySelector(`.pc-place[data-i="${Number(r.i)}"]`);a&&(a.scrollIntoView({behavior:"smooth",block:"nearest",inline:"center"}),a.classList.add("flash"),setTimeout(()=>a.classList.remove("flash"),1200))}),document.addEventListener("input",Pe),document.addEventListener("change",Pe),De(),typeof MutationObserver>"u")return;let e=!1;new MutationObserver(()=>{e||(e=!0,requestAnimationFrame(()=>{e=!1,De()}))}).observe(document.documentElement,{childList:!0,subtree:!0})}var Gt=new RegExp("```("+X.join("|")+")[ \\t]*\\n([\\s\\S]*?)```","g"),Jt=new RegExp("```("+X.join("|")+")[ \\t]*\\n[\\s\\S]*$"),Kt=new RegExp("```("+X.join("|")+")[ \\t]*\\n");function Xt(e,t,r){let n=`${e}\0${r}\0${t}`,a=2166136261;for(let o=0;o<n.length;o+=1)a^=n.charCodeAt(o),a=Math.imul(a,16777619);return`${e}_${(a>>>0).toString(36)}`}function He(e,t){let r=[],n=0,a=String(e||"").replace(Gt,(i,p,c)=>{let l=p.toLowerCase(),d=Xt(l,c.trim(),n++),m={};try{m=typeof localStorage<"u"?he(d):{}}catch{}return r.push(Z(l,d,c,m)),`

${t}${r.length-1}END

`}),o=a.match(Jt);return o&&(a=a.slice(0,o.index)+`

<div class="pcx pc-pending"><span class="pc-muted">Building ${o[1]}\u2026</span></div>

`),{text:a,cards:r}}var W=/\{\{\s*card\s*:\s*([A-Za-z0-9_-]{2,48})\s*\}\}/g;function Zt(e){if(!e||typeof e!="object")return"";for(let t of[e.content,e.text,e.body?.text,e.message])if(typeof t=="string"&&t)return t;return""}function Qt(e){let t=new Set;return String(e||"").replace(W,(r,n)=>(t.add(n),"")),t}function er(e){let t=Array.isArray(e?.richArtifacts)?e.richArtifacts:[];if(!t.length)return t;let r=Qt(Zt(e));return r.size?t.filter(n=>!(n?.ref&&r.has(n.ref))):t}function We(e,t,r,n){let a=[],o=Array.isArray(r)?r:[];return{text:String(e||"").replace(W,(p,c)=>{let l=o.find(m=>m&&(m.ref===c||m.id===c));if(!l)return"";let d="";try{d=(typeof n=="function"?n(l):"")||ee(l)||""}catch{}return d?(a.push(`<div class="pc-inline-card" data-card-ref="${c}">${d}</div>`),`

${t}${a.length-1}END

`):""}),cards:a}}function Ye(e){return Kt.test(String(e||""))}var tr=/^(?:\[?\d{1,2}\]?|source|src|ref|link)$/i;function Ge(e){return!e||e.indexOf("<a ")===-1?e:e.replace(/<a ([^>]*?)href="(https?:\/\/[^"]+)"([^>]*)>([^<]{1,48})<\/a>/g,(t,r,n,a,o)=>{let i=o.trim(),p="";try{p=new URL(n.replace(/&amp;/g,"&")).hostname.replace(/^www\./,"")}catch{return t}if(!(tr.test(i)||i.toLowerCase().replace(/^www\./,"")===p))return t;let l=p.split(".").slice(-2).join(".");return`<a class="pc-cite" href="${n}" target="_blank" rel="noopener noreferrer" title="${n}"><img src="https://www.google.com/s2/favicons?domain=${encodeURIComponent(p)}&amp;sz=32" alt="" loading="lazy" referrerpolicy="no-referrer">${l}</a>`})}function T(e){return e?String(e).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"):""}var en=T;function rr(e){let t=Date.now()-e;return t<6e4?"just now":t<36e5?`${Math.floor(t/6e4)}m ago`:t<864e5?`${Math.floor(t/36e5)}h ago`:`${Math.floor(t/864e5)}d ago`}function nr(e,t=0){let r=Number(e);return Number.isFinite(r)?`${r.toFixed(t)}%`:"--%"}function ar(e,t){let r=Number(e),n=Number(t);return!Number.isFinite(r)||!Number.isFinite(n)||n<=0?"-- / -- GB":`${r.toFixed(1)} / ${n.toFixed(1)} GB`}function Ke(e){let t=Number(e);return Number.isFinite(t)?`${Math.max(0,Math.min(100,t))}%`:"0%"}function or(e,t){let r=document.getElementById(e);r&&(r.textContent=String(t||""))}function tn(e){let t=String(e||"").trim(),r=T(t);return`<span class="t-think-sizer" aria-hidden="true">${r}</span><span class="t-think-text" data-text="${r}">${r}</span>`}function rn(e,t){let r=String(t||"").trim(),n=e?.querySelector?.(".t-think-text");if(!n||!r)return!1;let a=String(n.textContent||"").trim();if(!a||a===r)return!1;e.querySelectorAll?.(".t-think-text").forEach(c=>{c!==n&&c.remove()});let o=n.cloneNode(!0);o.classList.remove("is-enter-start"),o.classList.add("is-exit"),o.textContent=r,o.setAttribute("data-text",r),n.classList.remove("is-exit"),n.classList.add("is-enter-start");let i=e.querySelector?.(".t-think-sizer");i&&r.length>String(i.textContent||"").length&&(i.textContent=r),e.appendChild(o),n.offsetWidth;let p=()=>{n.isConnected!==!1&&n.classList.remove("is-enter-start")};return typeof requestAnimationFrame=="function"?requestAnimationFrame(p):typeof setTimeout=="function"&&setTimeout(p,0),typeof setTimeout=="function"&&setTimeout(()=>{o.isConnected!==!1&&o.remove(),n.isConnected!==!1&&n.classList.remove("is-enter-start")},420),!0}function ir(e,t){let r=document.getElementById(e);r&&(r.style.width=Ke(t))}function Xe(e,t,r="info",n=5e3,a={}){let o=typeof a?.key=="string"?a.key.trim():"";if(o)for(let x of document.querySelectorAll(".__sc-toast"))x.dataset.scToastKey===o&&x.remove();let i=r==="warn"?"warning":["info","success","error","warning"].includes(r)?r:"info",p={info:"\u2139\uFE0F",success:"\u2713",error:"\u26A0\uFE0F",warning:"\u26A0\uFE0F"},c=document.createElement("div"),d=24+[...document.querySelectorAll(".__sc-toast")].reduce((x,f)=>x+f.offsetHeight+8,0);if(c.className=`__sc-toast __sc-toast--${i}`,o&&(c.dataset.scToastKey=o),c.style.cssText=`position:fixed;bottom:${d}px;right:24px;z-index:99999;`,c.innerHTML=`
    <span class="__sc-toast-icon" aria-hidden="true">${p[i]}</span>
    <div class="__sc-toast-copy">
      <div class="__sc-toast-title">${T(e)}</div>
      ${t?`<div class="__sc-toast-body">${T(String(t))}</div>`:""}
    </div>
    <button class="__sc-toast-close" type="button" aria-label="Dismiss">&times;</button>
  `,!document.getElementById("__sc-toast-style")){let x=document.createElement("style");x.id="__sc-toast-style",x.textContent="@keyframes scToastIn{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}",document.head.appendChild(x)}document.body.appendChild(c);let m=Math.max(0,Math.min(5e3,Number.isFinite(Number(n))?Number(n):5e3));setTimeout(()=>{c.style.transition="opacity 0.3s",c.style.opacity="0",setTimeout(()=>c.remove(),300)},m),c.querySelector(".__sc-toast-close")?.addEventListener("click",()=>c.remove())}function sr(e,t){Xe(e,t,"info")}function cr(e,t,r,n={}){let{title:a="Confirm",confirmText:o="Confirm",cancelText:i="Cancel",danger:p=!1,details:c=""}=n,l=document.createElement("div");l.style.cssText="position:fixed;inset:0;z-index:99998;background:rgba(0,0,0,0.35);display:flex;align-items:center;justify-content:center;animation:scToastIn 0.15s ease";let d=document.createElement("div");d.style.cssText="background:var(--panel);border:1.5px solid var(--line);border-radius:14px;padding:24px 24px 18px;max-width:560px;width:92%;box-shadow:0 8px 40px rgba(0,0,0,0.18);font-family:var(--font)",d.innerHTML=`
    <div style="font-size:15px;font-weight:800;margin-bottom:10px">${T(a)}</div>
    <div style="font-size:13px;color:var(--muted);line-height:1.6;margin-bottom:18px">${T(e)}</div>
    ${c?`<pre style="margin:0 0 18px;padding:12px 14px;border-radius:10px;border:1px solid var(--line);background:var(--panel-2);font-size:11px;line-height:1.65;color:var(--text);white-space:pre-wrap;word-break:break-word;font-family:'Cascadia Code','Fira Code','Consolas',monospace">${T(c)}</pre>`:""}
    <div style="display:flex;gap:8px;justify-content:flex-end">
      <button id="__sc-confirm-cancel" style="border:1px solid var(--line);background:var(--panel-2);color:var(--muted);border-radius:8px;padding:7px 16px;font-size:12px;font-weight:700;cursor:pointer">${T(i)}</button>
      <button id="__sc-confirm-ok" style="border:none;background:${p?"#dc2626":"var(--brand)"};color:#fff;border-radius:8px;padding:7px 16px;font-size:12px;font-weight:700;cursor:pointer">${T(o)}</button>
    </div>
  `,l.appendChild(d),document.body.appendChild(l);let m=()=>l.remove();d.querySelector("#__sc-confirm-cancel").onclick=()=>{m(),r&&r()},d.querySelector("#__sc-confirm-ok").onclick=()=>{m(),t&&t()},l.addEventListener("click",x=>{x.target===l&&(m(),r&&r())})}var re=[];function pr(e,t="log"){let r=new Date().toLocaleTimeString();re.push({text:`[${r}] ${String(e??"")}`,type:String(t||"log").replace(/[^a-z0-9_-]/gi,"")||"log"}),re.length>100&&re.shift();let n=document.getElementById("log-panel");n&&(n.replaceChildren(...re.map(a=>{let o=document.createElement("div");return o.className=`log-line ${a.type}`,o.textContent=a.text,o})),n.scrollTop=n.scrollHeight)}var A=Object.freeze({bg:"transparent",bgSoft:"transparent",surface:"transparent",surfaceSecondary:"transparent",border:"currentColor",borderStrong:"currentColor",text:"currentColor",muted:"currentColor",accent:"currentColor",accentStrong:"currentColor",success:"currentColor",warning:"currentColor",danger:"currentColor"});function Ze(e,t){return String(e||"").replace(/[<>{};\r\n]/g,"").trim()||t}function Qe(){let e=document.documentElement,t=typeof getComputedStyle=="function"?getComputedStyle(e):null,r=(a,o)=>{for(let i of a){let p=t?.getPropertyValue(i)?.trim();if(p)return Ze(p,o)}return o},n={isDark:e.getAttribute("data-theme")==="dark",bg:r(["--bg","--pm-chat-page-bg"],A.bg),bgSoft:r(["--bg-soft"],A.bgSoft),surface:r(["--panel","--composer-panel"],A.surface),surfaceSecondary:r(["--panel-2","--composer-bg"],A.surfaceSecondary),border:r(["--line","--composer-border"],A.border),borderStrong:r(["--line-strong"],A.borderStrong),text:r(["--text","--fg","--composer-text"],A.text),muted:r(["--muted","--composer-muted"],A.muted),accent:r(["--brand","--pm-custom-accent"],A.accent),accentStrong:r(["--brand-2"],A.accentStrong),success:r(["--ok"],A.success),warning:r(["--warn"],A.warning),danger:r(["--err"],A.danger)};return n.series=[n.accent,n.accentStrong,n.success,n.warning,n.danger,n.muted],n.vars={"--prom-bg":n.bg,"--prom-bg-soft":n.bgSoft,"--prom-surface":n.surface,"--prom-surface-secondary":n.surfaceSecondary,"--prom-border":n.border,"--prom-border-strong":n.borderStrong,"--prom-text":n.text,"--prom-muted":n.muted,"--prom-accent":n.accent,"--prom-accent-strong":n.accentStrong,"--prom-success":n.success,"--prom-warning":n.warning,"--prom-danger":n.danger,"--prom-series-1":n.series[0],"--prom-series-2":n.series[1],"--prom-series-3":n.series[2],"--prom-series-4":n.series[3],"--prom-series-5":n.series[4],"--prom-series-6":n.series[5],"--bg":n.bg,"--bg-soft":n.bgSoft,"--panel":n.surface,"--panel-2":n.surfaceSecondary,"--line":n.border,"--line-strong":n.borderStrong,"--text":n.text,"--fg":n.text,"--muted":n.muted,"--brand":n.accent,"--brand-2":n.accentStrong,"--ok":n.success,"--warn":n.warning,"--err":n.danger},n}function lr(e){if(e&&typeof e=="object"&&e.vars)return e;let t={isDark:typeof e=="boolean"?e:!!e?.isDark,...A};return t.series=[t.accent,t.accentStrong,t.success,t.warning,t.danger,t.muted],t.vars=Object.fromEntries([["--prom-bg",t.bg],["--prom-bg-soft",t.bgSoft],["--prom-surface",t.surface],["--prom-surface-secondary",t.surfaceSecondary],["--prom-border",t.border],["--prom-border-strong",t.borderStrong],["--prom-text",t.text],["--prom-muted",t.muted],["--prom-accent",t.accent],["--prom-accent-strong",t.accentStrong],["--prom-success",t.success],["--prom-warning",t.warning],["--prom-danger",t.danger],...t.series.map((r,n)=>[`--prom-series-${n+1}`,r]),["--bg",t.bg],["--bg-soft",t.bgSoft],["--panel",t.surface],["--panel-2",t.surfaceSecondary],["--line",t.border],["--line-strong",t.borderStrong],["--text",t.text],["--fg",t.text],["--muted",t.muted],["--brand",t.accent],["--brand-2",t.accentStrong],["--ok",t.success],["--warn",t.warning],["--err",t.danger]]),t}function dr(e){let t=e?.vars&&typeof e.vars=="object"?e.vars:{};return Object.entries(t).map(([r,n])=>`${r}:${Ze(n,"transparent")}`).join(";")}function et(e,t,r){let n=lr(r),a=(l,d,m)=>!l||/^(currentColor|transparent|inherit)$/i.test(String(l).trim())||/var\(/.test(String(l))?n.isDark?d:m:l,o=a(n.text,"#e6edf3","#1f2328"),i=ae({background:"transparent",primaryColor:a(n.surface,"#1b2733","#f3f5f8"),primaryTextColor:o,primaryBorderColor:a(n.borderStrong,"#4a5a6b","#9aa7b4"),lineColor:a(n.muted,"#8b98a5","#57606a"),secondaryColor:a(n.surfaceSecondary,"#22303d","#e9edf2"),secondaryTextColor:o,secondaryBorderColor:a(n.border,"#33424f","#c9d1d9"),tertiaryColor:a(n.bgSoft,"#15202a","#f6f8fa"),tertiaryTextColor:o,tertiaryBorderColor:a(n.border,"#33424f","#c9d1d9"),textColor:o,mainBkg:a(n.surface,"#1b2733","#f3f5f8"),nodeBorder:a(n.borderStrong,"#4a5a6b","#9aa7b4"),clusterBkg:a(n.surfaceSecondary,"#22303d","#e9edf2"),clusterBorder:a(n.border,"#33424f","#c9d1d9"),edgeLabelBackground:"transparent"}),p=ae({text:n.text,muted:n.muted,border:n.border,series:n.series}),c=`:root{${dr(n)}color-scheme:${n.isDark?"dark":"light"}}*{margin:0;padding:0;box-sizing:border-box}html,body{background:transparent!important;color:var(--prom-text);color-scheme:${n.isDark?"dark":"light"};max-width:100%;overflow-x:hidden}body{min-height:0;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}`;return e==="chart"?`<!DOCTYPE html><html><head><meta charset="UTF-8">
<script src="/vendor/chart/chart.umd.js"><\/script>
<style>${c}body{display:flex;align-items:center;justify-content:center;min-height:220px;padding:8px}canvas{width:100%!important;max-width:100%;max-height:100%}</style>
</head><body><canvas id="c"></canvas>
<script>try{const visualTheme=${p};Chart.defaults.color=visualTheme.text;Chart.defaults.borderColor=visualTheme.border;const cfg=(${t});if(cfg.options)cfg.options.responsive=true;else cfg.options={responsive:true};const datasets=cfg.data&&Array.isArray(cfg.data.datasets)?cfg.data.datasets:[];datasets.forEach((dataset,index)=>{const color=visualTheme.series[index%visualTheme.series.length];if(!dataset.backgroundColor)dataset.backgroundColor=color;if(!dataset.borderColor)dataset.borderColor=color;});const chart=new Chart(document.getElementById('c'),cfg);window.addEventListener('prometheus:visual-theme-change',(event)=>{const next=event.detail||{};if(next.text)Chart.defaults.color=next.text;if(next.border)Chart.defaults.borderColor=next.border;chart.update('none');});}catch(e){document.body.innerHTML='<pre style="color:var(--prom-danger);padding:8px;font-size:11px;white-space:pre-wrap">'+e.message+'<\\/pre>';}<\/script>
</body></html>`:e==="svg"?`<!DOCTYPE html><html><head><meta charset="UTF-8">
<style>${c}body{padding:0}.sv-shell{position:relative;min-height:200px;height:200px;overflow:hidden;background:transparent}.sv-viewport{position:absolute;inset:0;cursor:grab;touch-action:none;user-select:none}.sv-viewport.dragging{cursor:grabbing}.sv-stage{position:absolute;left:0;top:0;transform-origin:0 0;will-change:transform}.sv-stage svg{max-width:none!important;height:auto;display:block}.sv-controls{position:absolute;top:10px;right:10px;display:flex;gap:6px;z-index:5;opacity:0;transform:translateY(-4px);pointer-events:none;transition:opacity .2s ease,transform .2s ease}.sv-shell:hover .sv-controls,.sv-shell:focus-within .sv-controls{opacity:1;transform:translateY(0);pointer-events:auto}.sv-btn{border:1px solid var(--prom-border);background:var(--prom-surface);color:var(--prom-text);border-radius:8px;padding:4px 9px;font-weight:700;font-size:12px;line-height:1;cursor:pointer;backdrop-filter:blur(2px)}.sv-btn:hover{filter:brightness(1.08)}.sv-hint{position:absolute;left:10px;bottom:10px;font-size:11px;color:var(--prom-muted);opacity:0;transform:translateY(4px);background:var(--prom-surface);border:1px solid var(--prom-border);border-radius:999px;padding:4px 9px;pointer-events:none;transition:opacity .2s ease,transform .2s ease}.sv-shell:hover .sv-hint,.sv-shell:focus-within .sv-hint{opacity:.82;transform:translateY(0)}</style>
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
</body></html>`:e==="mermaid"?`<!DOCTYPE html><html><head><meta charset="UTF-8">
<script src="/vendor/mermaid/mermaid.min.js"><\/script>
<style>${c}body{padding:0}.mm-shell{position:relative;min-height:200px;height:200px;overflow:hidden;background:transparent}.mm-viewport{position:absolute;inset:0;cursor:grab;touch-action:none;user-select:none}.mm-viewport.dragging{cursor:grabbing}.mm-stage{position:absolute;left:0;top:0;transform-origin:0 0;will-change:transform}.mermaid svg{max-width:none!important;height:auto;background:transparent!important}.mermaid{background:transparent!important}.mm-controls{position:absolute;top:10px;right:10px;display:flex;gap:6px;z-index:5;opacity:0;transform:translateY(-4px);pointer-events:none;transition:opacity .2s ease,transform .2s ease}.mm-shell:hover .mm-controls{opacity:1;transform:translateY(0);pointer-events:auto}.mm-btn{border:1px solid var(--prom-border);background:var(--prom-surface);color:var(--prom-text);border-radius:8px;padding:4px 9px;font-weight:700;font-size:12px;line-height:1;cursor:pointer;backdrop-filter:blur(2px)}.mm-btn:hover{filter:brightness(1.08)}.mm-hint{position:absolute;left:10px;bottom:10px;font-size:11px;color:var(--prom-muted);opacity:0;transform:translateY(4px);background:var(--prom-surface);border:1px solid var(--prom-border);border-radius:999px;padding:4px 9px;pointer-events:none;transition:opacity .2s ease,transform .2s ease}.mm-shell:hover .mm-hint{opacity:.82;transform:translateY(0)}</style>
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
  const baseMermaidThemeVariables = ${i};
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
<style>${c}body{font-family:inherit;color:var(--prom-text);min-height:0;width:100%;overflow-x:hidden}</style>
</head><body>${t}</body></html>`}function F(e){return String(e||"").replace(/&/g,"&amp;").replace(/"/g,"&quot;")}function ae(e){return JSON.stringify(e??null).replace(/</g,"\\u003c")}function ur(e,t={}){let r=String(t.visualId||""),n=t.state&&typeof t.state=="object"?t.state:{},a=`<script>(function(){
var visualId=${ae(r)},last=0,state=${ae(n)}||{};
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
if('ResizeObserver'in window){var ro=new ResizeObserver(send);if(document.documentElement)ro.observe(document.documentElement);if(document.body)ro.observe(document.body)}addEventListener('load',function(){restoreControls();send();post('prometheus:visual-ready')});var errs=0;addEventListener('error',function(e){if(errs++>2)return;post('prometheus:visual-error',{message:String(e&&e.message||'Script error').slice(0,240)})});addEventListener('unhandledrejection',function(e){if(errs++>2)return;post('prometheus:visual-error',{message:String(e&&e.reason&&e.reason.message||e&&e.reason||'Unhandled promise rejection').slice(0,240)})});setTimeout(send,50);setTimeout(send,250);setTimeout(send,1000)})();<\/script>`,o=String(e||"");return/<head\b[^>]*>/i.test(o)?o.replace(/<head\b[^>]*>/i,i=>`${i}${a}`):`${a}${o}`}function mr(){if(window.__PROM_VISUAL_MESSAGE_BRIDGE_INSTALLED__)return;window.__PROM_VISUAL_MESSAGE_BRIDGE_INSTALLED__=!0;let e=()=>{let t=Qe();document.querySelectorAll('iframe[data-prom-visual="true"]').forEach(r=>{let n=String(r.getAttribute("data-visual-id")||"");if(!(!n||!r.contentWindow))try{r.contentWindow.postMessage({type:"prometheus:visual-theme",visualId:n,theme:t},"*")}catch{}})};document.addEventListener("prom-theme-change",()=>setTimeout(e,0)),document.addEventListener("prom-appearance-change",()=>setTimeout(e,0)),window.addEventListener("message",t=>{let r=t?.data;if(!r||!String(r.type||"").startsWith("prometheus:visual-"))return;let n=Array.from(document.querySelectorAll('iframe[data-prom-visual="true"]')).find(o=>o.contentWindow===t.source);if(!n)return;let a=String(n.getAttribute("data-visual-id")||"");if(String(r.visualId||"")===a){if(r.type==="prometheus:visual-resize"){let o=Number(r.height);if(!Number.isFinite(o))return;let i=Math.min(1e4,Math.max(120,Math.ceil(o))),p=Math.ceil(n.getBoundingClientRect().height||0);if(Math.abs(p-i)<=1)return;n.style.height=`${i}px`,n.style.minHeight=`${i}px`;return}if(r.type==="prometheus:visual-state"&&r.state&&typeof r.state=="object"){window.dispatchEvent(new CustomEvent("prometheus:visual-state-change",{detail:{visualId:a,state:r.state}}));return}if(r.type==="prometheus:visual-error"){let o=n.closest(".visual-block")||n;if(o.nextElementSibling?.classList?.contains("pc-visual-error"))return;let i=String(r.message||"Script error").slice(0,240),p=document.createElement("div");p.className="pc-visual-error";let c=document.createElement("span");c.textContent=`This visual hit an error: ${i}`;let l=document.createElement("button");l.type="button",l.className="pc-chip",l.setAttribute("data-pc-act","send"),l.setAttribute("data-prompt",`The interactive visual you made crashed with: ${i}. Please fix it and resend the whole visual.`),l.textContent="Ask Prom to fix it",p.append(c,l),o.insertAdjacentElement("afterend",p);return}r.type==="prometheus:visual-followup"&&r.prompt&&window.dispatchEvent(new CustomEvent("prometheus:visual-followup",{detail:{visualId:a,prompt:String(r.prompt),title:String(r.title||"")}}))}})}function xe(e){if(!e?.getAttribute)return"";let t=e.closest?.(".visual-block"),r=String(e.getAttribute("data-visual-id")||"").trim();return r?[r,String(e.getAttribute("data-visual-version")||"1"),String(t?.getAttribute("data-vis-lang")||""),String(t?.getAttribute("data-vis-code")||"")].join("\0"):""}function ne(e){if(!e?.querySelector&&!e?.matches)return"";let t=e.matches?.('iframe[data-prom-visual="true"]')?e:e.querySelector?.('iframe[data-prom-visual="true"]');return xe(t)}function gr(e,t){return!e||!t||e.nodeType!==t.nodeType?!1:e.nodeType!==1?!0:String(e.tagName||"").toLowerCase()===String(t.tagName||"").toLowerCase()}function fr(e,t){let n=e.matches?.('iframe[data-prom-visual="true"]')?new Set(["srcdoc","style"]):new Set;Array.from(e.attributes||[]).forEach(a=>{n.has(a.name)||t.hasAttribute(a.name)||e.removeAttribute(a.name)}),Array.from(t.attributes||[]).forEach(a=>{n.has(a.name)||e.getAttribute(a.name)!==a.value&&e.setAttribute(a.name,a.value)})}function Y(e,t,r,n=null){let a=Array.from(t||[]),o=Array.from(r||[]),i=Math.min(a.length,o.length),p=0;for(let c=0;c<i;c+=1){let l=a[c],d=o[c],m=rt(l,d);if(m){p+=m.reused;continue}let x=d.cloneNode(!0);e.replaceChild(x,l)}for(let c=i;c<o.length;c+=1)e.insertBefore(o[c].cloneNode(!0),n);for(let c=i;c<a.length;c+=1)a[c].remove();return p}function hr(e,t){return e.length===t.length&&e.every((r,n)=>r===t[n])}function tt(e,t){let r=Array.from(e.childNodes||[]),n=Array.from(t.childNodes||[]),a=r.map(ne).filter(Boolean),o=n.map(ne).filter(Boolean);if(a.length&&hr(a,o)){let i=0,p=0,c=0;for(let l of o){let d=r.findIndex((f,b)=>b>=i&&ne(f)===l),m=n.findIndex((f,b)=>b>=p&&ne(f)===l);if(d<0||m<0)return Y(e,r,n);c+=Y(e,r.slice(i,d),n.slice(p,m),r[d]);let x=rt(r[d],n[m]);if(!x)return Y(e,r,n);c+=x.reused,i=d+1,p=m+1}return c+=Y(e,r.slice(i),n.slice(p)),c}return Y(e,r,n)}function rt(e,t){return gr(e,t)?e.nodeType===3||e.nodeType===8?(e.nodeValue!==t.nodeValue&&(e.nodeValue=t.nodeValue),{reused:0}):e.matches?.('iframe[data-prom-visual="true"]')?xe(e)===xe(t)?{reused:1}:null:(fr(e,t),{reused:tt(e,t)}):null}function nt(e,t){return!e?.childNodes||!t?.childNodes?0:tt(e,t)}function vr(e,t){if(!e)return 0;let r=String(t||"");if(typeof document>"u"||typeof document.createElement!="function"||typeof e.appendChild!="function")return e.innerHTML=r,0;let n=document.createElement("template");n.innerHTML=r;let a=!!e.querySelector?.('iframe[data-prom-visual="true"]'),o=!!n.content.querySelector?.('iframe[data-prom-visual="true"]');return!a&&!o?(e.innerHTML=r,0):nt(e,n.content)}function br(e,t,r=0){let n=`${e}\0${r}\0${t}`,a=2166136261;for(let o=0;o<n.length;o+=1)a^=n.charCodeAt(o),a=Math.imul(a,16777619);return`visual_local_${(a>>>0).toString(36)}`}function at(e,t,r={}){mr();let n=r.artifact&&typeof r.artifact=="object"?r.artifact:null,a=String(n?.id||r.visualId||br(e,t,r.ordinal||0)),o=`vis_${a.replace(/[^a-z0-9_-]/gi,"_")}`,i=Qe(),p=ur(et(e,t,i),{visualId:a,state:n?.state||r.state||{}}),c=F(p),l=e.replace(/"/g,""),d=F(t),m=e==="chart"?240:e==="html"?180:220;return`<div class="visual-block visual-block--inline" id="${o}-wrap" data-vis-lang="${l}" data-vis-code="${d}" data-vis-surface="inline">
  <iframe
    id="${o}"
    data-prom-visual="true"
    data-visual-id="${F(a)}"
    data-visual-version="${F(n?.version||1)}"
    srcdoc="${c}"
    sandbox="allow-scripts allow-downloads"
    style="width:100%;height:${m}px;min-height:${m}px;border:none;display:block;background:transparent;color-scheme:${i.isDark?"dark":"light"}"
    loading="lazy"
  ></iframe>
</div>`}function ot(e){let t=String(e||""),r=typeof window<"u"?window.DOMPurify:null;return!r||typeof r.sanitize!="function"?T(t):r.sanitize(t,{USE_PROFILES:{html:!0},FORBID_TAGS:["script","style","iframe","object","embed","form","input","button","textarea","select","option","svg","math","link","meta","base"],FORBID_ATTR:["style","srcdoc","formaction","xlink:href"],ALLOW_DATA_ATTR:!1,ALLOW_ARIA_ATTR:!0,RETURN_TRUSTED_TYPE:!1})}function xr(e){let t=String(e||"").trim();if(!t)return"";if(/^file:\/\//i.test(t))try{t=decodeURIComponent(t.replace(/^file:\/\/\/?/i,""))}catch{t=t.replace(/^file:\/\/\/?/i,"")}t=t.replace(/^\.\//,"");let r=typeof window<"u"?window.__promResolveWorkspaceMediaUrl:null;if(typeof r=="function")try{let n=r(t);if(n)return String(n)}catch{}return`/api/canvas/inline?path=${encodeURIComponent(t)}`}function yr(e){let t=String(e||"").trim();return!t||t.startsWith("#")?!1:/^file:\/\//i.test(t)||/^[a-z]:[\\/]/i.test(t)?!0:!(/^[a-z][a-z0-9+.-]*:/i.test(t)||t.startsWith("/")||t.startsWith("\\"))}var wr=/\.(mp4|webm|mov|m4v)(?:$|[?#])/i;function $r(e){let t=String(e||"");return t.includes("<img")?t.replace(/<img\b([^>]*?)\ssrc="([^"]*)"([^>]*)>/gi,(r,n,a,o)=>{let i=a.replace(/&amp;/g,"&");if(!yr(i))return r;let p=xr(i),c=`${n}${o}`,l=c.match(/\salt="([^"]*)"/i),d=l?l[1]:"",m=F(i),x=d?`<span class="prom-inline-caption">${d}</span>`:"";return wr.test(i)?`<span class="prom-inline-figure is-video"><video class="prom-inline-media" src="${F(p)}" controls playsinline preload="metadata" data-workspace-path="${m}"></video>${x}</span>`:`<span class="prom-inline-figure"><img${c.replace(/\s(?:loading|class)="[^"]*"/gi,"")} src="${F(p)}" class="prom-inline-media" loading="lazy" decoding="async" data-workspace-path="${m}" role="button" tabindex="0">${x}</span>`}):t}function kr({src:e,name:t}){document.getElementById("prom-inline-lightbox")?.remove();let r=document.createElement("div");r.id="prom-inline-lightbox",r.className="prom-inline-lightbox",r.setAttribute("role","dialog"),r.setAttribute("aria-modal","true");let n=document.createElement("img");n.src=e,n.alt=t||"";let a=document.createElement("button");a.type="button",a.className="prom-inline-lightbox-close",a.setAttribute("aria-label","Close"),a.textContent="\xD7",r.append(n,a);let o=()=>{r.remove(),document.removeEventListener("keydown",i)},i=p=>{p.key==="Escape"&&o()};r.addEventListener("click",p=>{p.target!==n&&o()}),document.addEventListener("keydown",i),document.body.appendChild(r)}if(typeof document<"u"&&!window.__promInlineMediaWired){window.__promInlineMediaWired=!0;let e=t=>{let r=t.target?.closest?.("img.prom-inline-media");if(!r||t.type==="keydown"&&t.key!=="Enter"&&t.key!==" ")return;t.preventDefault();let n=r.getAttribute("data-workspace-path")||"",a={kind:"image",src:r.currentSrc||r.src,path:n,name:r.getAttribute("alt")||n.split(/[\\/]/).pop()||"Image"},o=window.__promOpenInlineMedia;if(typeof o=="function")try{o(a);return}catch{}kr(a)};document.addEventListener("click",e),document.addEventListener("keydown",e)}var Sr=600,Cr=2e5,q=new Map;function it(e,t={}){if(!e)return"";let r=String(e);if(r.length<=Cr&&!/```(chart|svg|html|mermaid)\n/.test(r)&&!Ye(r)&&(W.lastIndex=0,!W.test(r))&&!(Array.isArray(t.visualArtifacts)&&t.visualArtifacts.length)){let a=q.get(r);if(a!==void 0)return q.delete(r),q.set(r,a),a;let o=Je(r,t);return q.set(r,o),q.size>Sr&&q.delete(q.keys().next().value),o}return Je(r,t)}var Er=/```video-project[ \t]*\n([\s\S]*?)```/g,zr=/```video-project[ \t]*\n[\s\S]*$/;function Mr(e){let t="";try{t=String(JSON.parse(String(e||"").trim())?.projectId||"")}catch{t=(String(e||"").match(/vp_[A-Za-z0-9_-]+/)||[""])[0]}return/^vp_[A-Za-z0-9_-]{3,64}$/.test(t)?`<div class="prom-vp-card" data-vp-project="${t}"></div>`:""}var Ar=/```game-project[ \t]*\n([\s\S]*?)```/g,Tr=/```game-project[ \t]*\n[\s\S]*$/;function _r(e){let t="";try{t=String(JSON.parse(String(e||"").trim())?.projectId||"")}catch{t=(String(e||"").match(/gp_[A-Za-z0-9_-]+/)||[""])[0]}return/^gp_[A-Za-z0-9_-]{3,64}$/.test(t)?`<div class="prom-gp-card" data-gp-project="${t}"></div>`:""}function Je(e,t={}){let r=[],n=`PROMVPCARD${Math.random().toString(36).slice(2)}X`;try{let a=[],o=`PROMVISUAL${Math.random().toString(36).slice(2)}X`;e=String(e).replace(Er,(u,h)=>(r.push(Mr(h)),`

${n}${r.length-1}END

`)).replace(zr,"").replace(Ar,(u,h)=>(r.push(_r(h)),`

${n}${r.length-1}END

`)).replace(Tr,"");let i=He(e,n+"C");e=i.text,i.cards.forEach((u,h)=>{r.push(u),e=e.replace(`${n}C${h}END`,`${n}${r.length-1}END`)});let p=We(e,n+"I",t.visualArtifacts,t.renderArtifact);e=p.text,p.cards.forEach((u,h)=>{r.push(u),e=e.replace(`${n}I${h}END`,`${n}${r.length-1}END`)});let c=/```(chart|svg|html|mermaid)\n([\s\S]*?)```/g,l=0,d=Array.isArray(t.visualArtifacts)?t.visualArtifacts.filter(u=>u?.type==="visual"):[],m=String(e).replace(c,(u,h,g)=>{let v=a.length,$=h.toLowerCase(),S=d.find(O=>Number(O.ordinal)===l&&String(O.renderer||"")===$)||null;return a.push({lang:$,code:g.trim(),partial:!1,artifact:S,ordinal:l}),l+=1,`${o}${v}END`}),x=/```(chart|svg|html|mermaid)\n([\s\S]*)$/,f=m.match(x);if(f){let u=a.length;a.push({lang:f[1].toLowerCase(),code:f[2],partial:!0}),m=m.slice(0,f.index)+`${o}${u}END`}let b=Ge($r(ot(marked.parse(m,{breaks:!0,gfm:!0,mangle:!1,headerIds:!1}))));if(a.length){let u=new RegExp(`${o}(\\d+)END`,"g");b=b.replace(u,(h,g)=>{let v=a[+g];return v?v.partial?"":at(v.lang,v.code,{artifact:v.artifact,ordinal:v.ordinal}):""}),b=b.replace(/<p>\s*(<div class="visual-block"[\s\S]*?<\/div>)\s*<\/p>/g,"$1")}if(r.length){let u=new RegExp(`(?:<p>\\s*)?${n}(\\d+)END(?:\\s*<\\/p>)?`,"g");b=b.replace(u,(h,g)=>r[+g]||"")}return b}catch{return T(e).replace(new RegExp(`${n}(\\d+)END`,"g"),(o,i)=>r[+i]||"")}}window.escHtml=T;window.escapeHtml=T;window.sanitizeHtml=ot;window.renderMd=it;if(typeof document<"u"){let e=!1,t=()=>{e||!document.querySelector(".prom-vp-card")||(e=!0,import("./video-project-card-4MUF76NF.js").then(({installVideoProjectCards:n})=>{n(),r?.disconnect()}).catch(()=>{e=!1}))},r=typeof MutationObserver=="function"?new MutationObserver(t):null;r?.observe(document.documentElement,{childList:!0,subtree:!0}),t()}Se();be();window.renderPromDataCard=ee;window.timeAgo=rr;window.fmtPercent=nr;window.fmtMemoryGb=ar;window.meterWidth=Ke;window.setText=or;window.setMeter=ir;window.showToast=Xe;window.bgtToast=sr;window.showConfirm=cr;window.log=pr;window.buildVisualSrcdoc=et;window.buildVisualIframe=at;window.preserveVisualIframes=nt;window.setInnerHTMLPreservingVisuals=vr;window.renderMd=it;export{er as a,T as b,en as c,rr as d,nr as e,ar as f,Ke as g,or as h,tn as i,rn as j,ir as k,Xe as l,sr as m,cr as n,pr as o,et as p,nt as q,vr as r,at as s,ot as t,xr as u,it as v};
