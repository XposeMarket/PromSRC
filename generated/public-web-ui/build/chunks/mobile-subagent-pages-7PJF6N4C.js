import{a as xt,b as _t,c as Mt,d as Tt}from"./chunk-YBG347BU.js";import{c as wt,d as kt,e as At,f as xe,g as _e}from"./chunk-VQIKTTT2.js";import{C as ee,D as gt,E as yt,F as ht,G as ft,M as St,N as $t,O as te,a as rt,b as nt,d as Z,e as Se,f as it,g as ot,h as de,i as ct,j as lt,l as X,m as dt,o as pt,r as $e,s as ut,t as mt,u as pe,v as we,w as bt,x as ke,y as vt,z as Ae}from"./chunk-U3KFEL7Y.js";import{b as Y}from"./chunk-J5HXEABW.js";import{a as C}from"./chunk-35CAQ6TV.js";import{F as h,G as p,M as fe,N as le}from"./chunk-K6TWOLRE.js";import"./chunk-5RLMNBA7.js";import{e as J,j as ce}from"./chunk-RN77Y735.js";import"./chunk-7CO3CYD6.js";import"./chunk-WJYUTOOC.js";import{a as Ye,b as Xe,c as et}from"./chunk-MMI7TEBA.js";import"./chunk-Z5F7FVLI.js";import{e as he}from"./chunk-CUCDWB4G.js";import"./chunk-ZIZ27Q5R.js";import{c as Ne,ca as Fe,da as ge,ea as je,fa as Ve,ga as Qe,ha as ye,ia as ie,ja as Ue,ka as Ge,la as oe,m as Be,ma as Ke,na as We,oa as Ze,pa as Je,s as Oe}from"./chunk-IBYFZHFI.js";import"./chunk-YMT6MSCC.js";import"./chunk-NR5TFE3F.js";import{e as tt,f as at,g as st}from"./chunk-XREJVKMI.js";import"./chunk-R2RZ2V66.js";import"./chunk-JF4LWGNM.js";import"./chunk-CP4XDM65.js";import{a as R}from"./chunk-GBLBNUG2.js";import"./chunk-36KIJFV6.js";import"./chunk-EPSJJCWL.js";var ue={running:{label:"running",cls:"running"},idle:{label:"idle",cls:"gray"},scheduled:{label:"scheduled",cls:"orange"},team:{label:"team",cls:"active"},failed:{label:"failed",cls:"orange"}};function Ht(r){let e=ue[r.status]||ue.idle;return`
    <button class="pm-team-tile pm-subagent-tile" data-subagent="${p(r.id)}" type="button">
      <span class="pm-subagent-robot">${te(r.id,{scale:.5})}</span>
      <span class="pm-team-tile-meta">
        <strong>${p(r.name)}</strong>
        <small>${r.model?p(r.model):"default model"}</small>
      </span>
      <span class="pm-pill ${e.cls}">${e.label}</span>
    </button>
  `}function qt(){return`
    <div class="pm-team-grid">
      ${Array.from({length:4}).map(()=>`
        <div class="pm-team-tile" style="opacity:.5;">
          <span class="pm-avatar" style="background:var(--pm-bg-soft);">\u2026</span>
          <span class="pm-team-tile-meta"><strong style="background:rgba(0,0,0,.06);color:transparent;border-radius:6px;">loading</strong><small style="background:rgba(0,0,0,.06);color:transparent;border-radius:6px;">model</small></span>
        </div>
      `).join("")}
    </div>
  `}async function Ut(r,{navigate:e}={}){let u=`
    <span class="pm-count-pill" id="pm-subagents-count">\u2026</span>
    <span class="pm-spacer"></span>
    <button class="pm-icon-btn" id="pm-subagents-refresh" aria-label="Refresh" style="background:var(--pm-surface);border:1px solid var(--pm-border);">${h.refresh}</button>
  `;r.innerHTML=`
    ${fe({title:"Subagents",online:!1,extras:u})}
    <div class="pm-body" id="pm-subagents-body">${qt()}</div>
  `,le(r,{});let m=r.querySelector("#pm-subagents-body"),o=r.querySelector("#pm-subagents-count");async function c({force:b=!1}={}){let v=[];try{v=await Fe({force:b})}catch(A){m.innerHTML=`<div class="pm-empty"><div class="pm-empty-icon">${h.robot}</div><h2>Couldn\u2019t load subagents</h2><p>${p(A.message||"Network error")}</p></div>`,o.textContent="0 agents";return}if(o.textContent=`${v.length} agent${v.length===1?"":"s"}`,!v.length){m.innerHTML=`<div class="pm-empty"><div class="pm-empty-icon">${h.robot}</div><h2>No subagents yet</h2><p>Create agents from the desktop Settings \u2192 Agents page.</p></div>`;return}let i=v[0],S=`
      <div class="pm-team-preview">
        <div class="pm-team-preview-head">
          <span class="pm-subagent-robot pm-subagent-robot-sm">${te(i.id,{scale:.45})}</span>
          <h3>${p(i.name)}</h3>
          <button class="pm-pill-btn" data-go="${p(i.id)}">Open ${h.chev}</button>
        </div>
        <div style="font-size:13px;color:var(--pm-muted);font-weight:700;margin-top:4px;">${p(i.model||"Default model")}${i.isTeamMember?" \xB7 team member":""}</div>
        ${i.description?`<div class="pm-card-body" style="margin-top:6px;">${p(i.description.slice(0,240))}${i.description.length>240?"\u2026":""}</div>`:""}
        <div class="pm-divider"></div>
        <div class="pm-row"><span>${h.wand} Tools</span><span style="color:var(--pm-muted)">${i.tools.length?i.tools.length+" allowed":"all"}</span></div>
        <div class="pm-divider"></div>
        <div class="pm-row"><span>${h.clock} Last run</span><span style="color:var(--pm-muted)">${p(Y(i.lastRunAt||0))}</span></div>
      </div>
    `;m.innerHTML=`
      <div class="pm-team-grid">${v.map(Ht).join("")}</div>
      ${S}
    `,m.querySelectorAll("[data-subagent]").forEach(A=>{A.addEventListener("click",()=>e?.(`#mobile/subagents/${A.getAttribute("data-subagent")}`))}),m.querySelectorAll("[data-go]").forEach(A=>{A.addEventListener("click",()=>e?.(`#mobile/subagents/${A.getAttribute("data-go")}`))})}r.querySelector("#pm-subagents-refresh").addEventListener("click",()=>{m.innerHTML=qt(),c({force:!0})});let g=Ne("subagents",216e5);await c(),Array.isArray(g)&&c({force:!0}).catch(()=>{})}function Pt(){return`
    <div class="pm-detail-head"><span class="pm-subagent-robot pm-subagent-robot-lg" style="opacity:.4;">${te("loading",{scale:.7})}</span><h1 style="background:rgba(0,0,0,.06);color:transparent;border-radius:8px;height:24px;flex:1;">loading</h1></div>
    <div class="pm-detail-sub">\u2026</div>
    <div class="pm-action-row">
      <button class="pm-action-btn primary">${h.send} Dispatch</button>
      <button class="pm-action-btn">${h.refresh} Heartbeat</button>
    </div>
    <div class="pm-card" style="opacity:.5"><div class="pm-card-head">${h.robot} Overview</div><div class="pm-card-body">Loading agent\u2026</div></div>
  `}async function Dt(r,{agentId:e,navigate:u,initialTab:m=""}){r.innerHTML=`
    <header class="pm-header">
      <button class="pm-icon-btn" data-action="back" aria-label="Back">${h.back}</button>
            <div class="pm-header-actions">
        <button class="pm-icon-btn" data-action="settings" aria-label="Settings">${h.gear}</button>
      </div>
    </header>
    <div class="pm-body pm-subagent-detail-body" id="pm-detail-body">${Pt()}</div>
  `,le(r,{onBack:()=>u?.("#mobile/subagents")});let o=r.querySelector("#pm-detail-body"),c=null;try{c=await ge(e)}catch(d){o.innerHTML=`<div class="pm-empty"><div class="pm-empty-icon">${h.robot}</div><h2>Couldn\u2019t load subagent</h2><p>${p(d.message||"Network error")}</p></div>`;return}if(!c){o.innerHTML=`<div class="pm-empty"><div class="pm-empty-icon">${h.robot}</div><h2>Subagent not found</h2><p>${p(e)} isn\u2019t available right now.</p></div>`;return}let g=ue[c.status]||ue.idle,b=["Overview","Chat","Memory","Runs","Heartbeat"],v=`pm-sa-model-${c.id}`,i=`pm-sa-voice-${c.id}`,S=String(c.effectiveModel||c.model||"").trim();o.innerHTML=`
    <div class="pm-detail-head">
      <span class="pm-subagent-robot pm-subagent-robot-lg">${te(c.id,{isActive:!0,scale:.7})}</span>
      <h1>${p(c.name)}</h1>
      <span class="pm-pill ${g.cls}" style="align-self:center;">${g.label}</span>
    </div>
    <div class="pm-detail-sub">${p(S?S.split("/").pop():"Default model")}${c.isTeamMember?" \xB7 team member":""}${c.cronSchedule?" \xB7 scheduled":""}</div>

    <div class="pm-action-row">
      <button class="pm-action-btn primary" data-act="dispatch">${h.send} Dispatch Task</button>
      <button class="pm-action-btn"          data-act="heartbeat">${h.refresh} Tick</button>
      <button class="pm-action-btn"          data-act="open-chat">${h.chat} Chat</button>
    </div>

    <div class="pm-tabs" role="tablist">
      ${b.map((d,l)=>`<button class="${l===0?"active":""}" data-tab="${d}">${p(d)}</button>`).join("")}
    </div>

    <div id="pm-tab-slot"></div>

    <div id="pm-overview-slot">
      <div class="pm-card">
        <div class="pm-card-head">${h.target} Description</div>
        <div class="pm-card-body">${p(c.description||"No description set.")}</div>
      </div>

      <div class="pm-card-grid">
        <div class="pm-card">
          <div class="pm-card-head">${h.brain} Model</div>
          <div class="pm-card-body strong">${p(S?S.split("/").pop():"default")}</div>
        </div>
        <div class="pm-card">
          <div class="pm-card-head">${h.clock} Last Run</div>
          <div class="pm-card-body strong">${p(Y(c.lastRunAt||0))}</div>
        </div>
        <div class="pm-card">
          <div class="pm-card-head">${h.wand} Allowed Tools</div>
          <div class="pm-card-body">${c.tools.length?c.tools.slice(0,8).map(d=>`<span class="pm-tool-chip">${p(String(d))}</span>`).join(" ")+(c.tools.length>8?`<span class="pm-tool-chip more">+${c.tools.length-8}</span>`:""):'<em style="color:var(--pm-muted);">All tools</em>'}</div>
        </div>
        <div class="pm-card">
          <div class="pm-card-head">${h.globe} MCP Servers</div>
          <div class="pm-card-body">${c.mcpServers.length?c.mcpServers.map(d=>`<span class="pm-tool-chip">${p(String(d))}</span>`).join(" "):'<em style="color:var(--pm-muted);">None</em>'}</div>
        </div>
      </div>

      ${Ye(c,v)}
      ${tt(c,i)}

      <div class="pm-card" id="pm-subagent-ctxrefs">
        <div class="pm-card-head">${h.doc} Context References</div>
        <div class="pm-card-body" id="pm-subagent-ctxrefs-body">Loading\u2026</div>
      </div>
    </div>
  `,(async()=>{try{let d=await We(e),l=o.querySelector("#pm-subagent-ctxrefs-body");if(!l)return;if(!d.length){l.innerHTML='<em style="color:var(--pm-muted);">No context references attached.</em>';return}l.innerHTML=d.slice(0,10).map(f=>`
        <div class="pm-ctxref">
          <strong>${p(f.title||f.id||"Reference")}</strong>
          <span>${p(String(f.body||f.content||f.preview||"").slice(0,140))}${String(f.body||f.content||f.preview||"").length>140?"\u2026":""}</span>
        </div>
      `).join("")}catch{}})();let A=o.querySelector("#pm-overview-slot"),x=o.querySelector("#pm-tab-slot"),q=null,P=()=>Dt(r,{agentId:e,navigate:u,initialTab:"overview"});et(v,P),st(i,P),Xe(v,c),at(i,c);async function T(d){try{x?._pmCleanup?.()}catch{}if(x&&(x._pmCleanup=null),o.querySelectorAll(".pm-tabs button").forEach(l=>l.classList.toggle("active",l.getAttribute("data-tab")===d)),d==="Overview"){A.style.display="",x.innerHTML="";return}A.style.display="none",x.innerHTML=`<div class="pm-card" style="text-align:center;padding:24px;color:var(--pm-muted);">Loading ${p(d)}\u2026</div>`;try{if(d==="Chat"){u?.(`#mobile/subagents/${encodeURIComponent(e)}/chat`);return}d==="Memory"?await It(x,e):d==="Runs"?await Ot(x,e):d==="Heartbeat"&&await Rt(x,e)}catch(l){x.innerHTML=`<div class="pm-card"><div class="pm-card-head">${h.robot} Error</div><div class="pm-card-body">${p(l.message||"Failed to load")}</div></div>`}}o.querySelectorAll(".pm-tabs button").forEach(d=>{d.addEventListener("click",()=>T(d.getAttribute("data-tab")))});let a=b.find(d=>d.toLowerCase().replace(/\s+/g,"-")===String(m||"").toLowerCase());a&&a!=="Overview"&&T(a);async function n(d,l,f){let _=d.innerHTML;d.disabled=!0,d.style.opacity="0.6";try{let w=await l();if(w&&w.success===!1)throw new Error(w?.error||"Failed");return f&&C(f,"success"),w}catch(w){throw C(w.message||"Action failed","error"),w}finally{d.disabled=!1,d.style.opacity="",d.innerHTML=_}}o.querySelectorAll("[data-act]").forEach(d=>{let l=d.getAttribute("data-act");d.addEventListener("click",async()=>{l==="dispatch"?zt(e,d):l==="heartbeat"?await n(d,()=>ye(e),"Heartbeat ticked").catch(()=>{}):l==="open-chat"&&u?.(`#mobile/subagents/${encodeURIComponent(e)}/chat`)})}),r._pmCleanup=()=>{try{x?._pmCleanup?.()}catch{}try{q?.abort?.()}catch{}}}async function Gt(r,{agentId:e,navigate:u}){document.body.classList.add("pm-mobile-subagent-chat-locked"),ce(null);let m=he(e),o=null,c=fe({title:"Subagent",online:!0,leftIcon:"back",hideTitle:!0,hideBrand:!0,rightActions:`<button type="button" class="pm-icon-btn" id="pm-subagent-sources-button" aria-label="Sources">${h.layers}</button>`});r.innerHTML=`
    ${c}
    ${rt()}
    <div class="pm-body pm-subagent-chat-body" id="pm-subagent-chat-body"><div class="pm-card" style="text-align:center;padding:24px;color:var(--pm-muted);">Loading chat\u2026</div></div>
    <div id="pm-mobile-sources-popover" class="pm-mobile-sources-popover" hidden role="dialog" aria-modal="true" aria-label="Subagent chat sources">
      <button type="button" id="pm-mobile-sources-scrim" class="pm-mobile-sources-popover-scrim" aria-label="Close Sources"></button>
      <section class="pm-mobile-sources-panel">
        <div class="pm-mobile-sources-header"><div><strong>Sources <span id="pm-mobile-sources-count"></span></strong><div id="pm-mobile-sources-mode">Subagent chat sources</div></div><button type="button" id="pm-mobile-sources-close" class="pm-mobile-sources-close" aria-label="Close Sources">\xD7</button></div>
        <div id="pm-mobile-sources-list" class="pm-mobile-sources-list"><div class="pm-mobile-sources-empty">Sources produced by this subagent appear here.</div></div>
      </section>
    </div>
  `;let g=r.querySelector(".pm-model-badge .pm-model-badge-label");g&&(g.textContent="Loading\u2026");let b=r.querySelector(".pm-model-badge");b&&(b.classList.add("pm-subagent-model-badge"),b.setAttribute("aria-label","Subagent model"),b.title="Subagent model"),le(r,{onBack:()=>u?.(`#mobile/subagents/${encodeURIComponent(e)}`)}),r.querySelector("#pm-subagent-sources-button")?.addEventListener("click",()=>{vt(r,{sessionId:m})}),r.querySelector("#pm-mobile-sources-close")?.addEventListener("click",()=>ke(r)),r.querySelector("#pm-mobile-sources-scrim")?.addEventListener("click",()=>ke(r)),r.querySelector("#pm-mobile-sources-list")?.addEventListener("click",async S=>{let A=S.target?.closest?.("[data-mobile-source-detach]");if(A)try{await Be(m,A.getAttribute("data-mobile-source-detach")||""),await bt(r,{sessionId:m,history:!1})}catch(x){C(x?.message||"Source operation failed","error")}}),nt(r,{getSessionId:()=>m,getProvider:()=>Z(o||{}).provider,getAccountId:()=>Z(o||{}).accountId});let v=r.querySelector("#pm-subagent-chat-body"),i=null;try{let S=await ge(e);if(!S)throw new Error("Subagent not found");o=S;let A=Se(S);g&&(g.textContent=A),b&&(b.title=A,b.setAttribute("aria-label",`${A} \u2014 tap to choose reasoning level`));let x=Z(S);ce({agentId:S.id,provider:x.provider,model:x.model,effort:x.effort,onSaved:({effort:q,agent:P}={})=>{P&&typeof P=="object"?o={...o,...P,raw:{...o?.raw||{},...P}}:o&&(o={...o,reasoningEffort:String(q||""),reasoning_effort:String(q||""),raw:{...o.raw||{},reasoning_effort:String(q||"")}});let T=Se(o||S);g&&(g.textContent=T),b&&(b.title=T,b.setAttribute("aria-label",`${T} \u2014 tap to choose reasoning level`))}}),window.__pmMobileRefreshContextWindow?.({sessionId:m,provider:Z(S).provider,accountId:Z(S).accountId}),await Ft(v,S,q=>{i=q})}catch(S){v.innerHTML=`<div class="pm-empty"><div class="pm-empty-icon">${h.robot}</div><h2>Couldn\u2019t load subagent chat</h2><p>${p(S?.message||"Network error")}</p></div>`}r._pmCleanup=()=>{try{v?._pmCleanup?.()}catch{}try{i?.abort?.()}catch{}ce(null),document.body.classList.remove("pm-mobile-subagent-chat-locked")}}function zt(r,e){let u=document.createElement("div");u.className="pm-creative-sheet-overlay",u.innerHTML=`
    <div class="pm-creative-sheet">
      <h3>Dispatch a task</h3>
      <p style="color:var(--pm-muted);font-size:13px;margin:-6px 0 12px;text-align:center;">Sent to <strong>${p(r)}</strong> as a one-shot task.</p>
      <textarea class="pm-textarea" id="pm-dispatch-task" rows="4" placeholder="Describe the task for this subagent\u2026" style="min-height:120px;"></textarea>
      <div class="pm-row-buttons" style="margin-top:10px;">
        <button class="pm-btn ghost" data-close="1">Cancel</button>
        <button class="pm-btn primary" id="pm-dispatch-submit">${h.send} Dispatch</button>
      </div>
    </div>
  `,document.body.appendChild(u);let m=()=>u.remove();u.addEventListener("click",o=>{(o.target===u||o.target.getAttribute("data-close"))&&m()}),u.querySelector("#pm-dispatch-submit").addEventListener("click",async()=>{let o=String(u.querySelector("#pm-dispatch-task").value||"").trim();if(!o){C("Describe the task first","error");return}let c=u.querySelector("#pm-dispatch-submit");c.disabled=!0,c.innerHTML="\u2026sending";try{let g=await Ze(r,o);if(g?.success){let b=String(g.result?.result||g.result?.summary||"").slice(0,140);C(b?`Done \xB7 ${b}`:"Task complete","success"),m()}else C(g?.error||"Dispatch failed","error"),c.disabled=!1,c.innerHTML=`${h.send} Dispatch`}catch(g){C(g.message||"Dispatch failed","error"),c.disabled=!1,c.innerHTML=`${h.send} Dispatch`}}),setTimeout(()=>u.querySelector("#pm-dispatch-task")?.focus(),50)}async function It(r,e){let[u,m]=await Promise.all([je(e),Ve(e)]),o=[{key:"agent",title:"AGENT.md",content:u,exists:!!u,empty:"No AGENT.md is set for this agent yet."},{key:"memory",title:"MEMORY.md",content:m.content,exists:m.exists,empty:"No personal memory file exists for this agent yet."}],c="",g=()=>{r.innerHTML=`<section class="pm-subagent-memory" aria-label="Subagent memory files">
      <p class="pm-subagent-memory-intro">Private, read-only context for this agent.</p>
      ${o.map(b=>{let v=c===b.key;return`<article class="pm-subagent-memory-item ${v?"open":""}">
          <button type="button" class="pm-subagent-memory-toggle" data-memory-file="${b.key}" aria-expanded="${v}">
            <span>${h.doc}<strong>${b.title}</strong></span><span class="pm-subagent-memory-chevron">\u2304</span>
          </button>
          ${v?`<div class="pm-subagent-memory-panel">
            <div class="pm-subagent-memory-actions"><span>${b.exists?"Read-only":"Not found"}</span>${b.content?`<button type="button" class="pm-btn ghost" data-memory-copy="${b.key}">${h.check} Copy</button>`:""}</div>
            ${b.content?`<pre class="pm-subagent-md">${p(b.content)}</pre>`:`<div class="pm-subagent-memory-empty">${p(b.empty)}</div>`}
          </div>`:""}
        </article>`}).join("")}
    </section>`,r.querySelectorAll("[data-memory-file]").forEach(b=>b.addEventListener("click",()=>{let v=b.getAttribute("data-memory-file")||"";c=c===v?"":v,g()})),r.querySelectorAll("[data-memory-copy]").forEach(b=>b.addEventListener("click",()=>{let v=o.find(i=>i.key===b.getAttribute("data-memory-copy"));Ae(v?.content||"",b)}))};g()}function Nt(r){return String(r||"Task").replace(/^\s*\[\s*(?:subagent|agent)\s*\]\s*/i,"").trim()||"Task"}function Bt(r){let e=String(r||""),u=e.match(/\*\*Ready artifact\*\*\s*[-:]\s*`([^`\n]+)`/i),m=e.match(/\bSHA-?256:\s*`?([a-f0-9]{32,})`?/i);if(!u||!m)return null;let o=e.match(/\bSize:\s*\*{0,2}([\d,.]+\s*(?:bytes?|kb|mb|gb))\*{0,2}/i),c=e.indexOf(`
`,m.index+m[0].length);return{raw:e.slice(u.index,c===-1?e.length:c),path:String(u[1]||"").trim(),sha256:String(m[1]||"").trim(),size:String(o?.[1]||"").trim()}}function Lt(r,{compact:e=!1}={}){let u=String(r||"").trim();if(!u)return"";let m=Bt(u),o=m?u.replace(m.raw,"").trim():u,c=e&&o.length>420?`${o.slice(0,417).trimEnd()}...`:o,g=c?`<div class="pm-sa-run-summary markdown-body">${lt(c)}</div>`:"";return m?`${g}
    <section class="pm-sa-run-artifact" aria-label="Ready artifact">
      <div class="pm-sa-run-artifact-head">
        <span>Ready artifact</span>
        <button type="button" class="pm-sa-run-copy" data-sa-run-copy="${p(m.path)}">Copy path</button>
      </div>
      <code class="pm-sa-run-artifact-path" title="${p(m.path)}">${p(m.path)}</code>
      <div class="pm-sa-run-artifact-meta">
        ${m.size?`<span>${p(m.size)}</span>`:""}
        <span>SHA-256</span>
        <code>${p(m.sha256)}</code>
        <button type="button" class="pm-sa-run-copy" data-sa-run-copy="${p(m.sha256)}">Copy hash</button>
      </div>
    </section>`:g}async function Ot(r,e){let u=await ie(e,50),m="",o={},c=new Map,g=new Map,b=a=>{let n=String(a||"").trim();return c.has(n)||c.set(n,{busy:!1,queue:[],controller:null,status:"",tone:""}),c.get(n)},v=(a,n="",d="")=>{let l=String(a||"").trim(),f=b(l);f.status=String(n||"").trim(),f.tone=String(d||"").trim(),r.querySelectorAll("[data-sa-run-composer-status]").forEach(_=>{String(_.getAttribute("data-sa-run-composer-status")||"")===l&&(_.textContent=f.status,_.hidden=!f.status,f.tone?_.dataset.tone=f.tone:delete _.dataset.tone)})},i=a=>{g.get(String(a||"").trim())?.update?.()},S=()=>{if(!u.length){r.innerHTML=`<div class="pm-empty"><div class="pm-empty-icon">${h.clock}</div><h2>No runs yet</h2><p>Tap Dispatch Task above to give this agent something to do.</p></div>`;return}let a=[{key:"attention",label:"Needs Attention",statuses:["needs_assistance","awaiting_user_input","stalled"]},{key:"paused",label:"Paused",statuses:["paused"]},{key:"running",label:"Running",statuses:["queued","running","waiting_subagent"]},{key:"failed",label:"Failed",statuses:["failed"]},{key:"complete",label:"Completed",statuses:["complete"]}],n=new Set,d=a.map(f=>{let _=u.filter(w=>{let D=f.statuses.includes(String(w.status||w.taskStatus||"").toLowerCase());return D&&n.add(String(w.id||w.taskId||"")),D});return _.length?`<section style="display:flex;flex-direction:column;gap:8px;">
        <div style="font-size:11px;font-weight:800;color:var(--pm-muted);text-transform:uppercase;letter-spacing:.06em;">${p(f.label)} (${_.length})</div>
        ${_.map(q).join("")}
      </section>`:""}),l=u.filter(f=>!n.has(String(f.id||f.taskId||"")));l.length&&d.push(`<section style="display:flex;flex-direction:column;gap:8px;">
      <div style="font-size:11px;font-weight:800;color:var(--pm-muted);text-transform:uppercase;letter-spacing:.06em;">Other (${l.length})</div>
      ${l.map(q).join("")}
    </section>`),r.innerHTML=`
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
        <div>
          <div style="font-size:13px;font-weight:800;">Runs</div>
          <div style="font-size:12px;color:var(--pm-muted);">Task work and recovery stay here.</div>
        </div>
        <button class="pm-btn ghost" id="pm-sa-runs-refresh" style="padding:6px 10px;font-size:12px;">${h.refresh}</button>
      </div>
      <div style="display:flex;flex-direction:column;gap:14px;">${d.join("")}</div>
    `,T()},A=a=>(Array.isArray(a?.recoveryConversation)?a.recoveryConversation:[]).map((n,d)=>({id:`recovery_${a?.id||a?.taskId||"task"}_${d}`,role:n?.role==="user"?"user":"agent",content:String(n?.content||""),body:{text:String(n?.content||""),attachments:Array.isArray(n?.attachmentPreviews)?n.attachmentPreviews:[]},attachmentPreviews:Array.isArray(n?.attachmentPreviews)?n.attachmentPreviews:[],createdAt:Number(n?.timestamp||Date.now())||Date.now()})),x=(a,n,d)=>{let l=A(a),f=l.length?l.map(D=>we(D,{sender:"Recovery"})).join(""):'<div style="font-size:12px;color:var(--pm-muted);padding:8px 2px;">No recovery messages yet.</div>',_=`pm-sa-run-${String(n||"").replace(/[^a-zA-Z0-9_-]/g,"_")}`,w=b(n);return`<section class="pm-sa-run-recovery-panel">
      <div class="pm-card-head" style="color:var(--pm-orange);">Recovery Chat</div>
      ${a?.pendingClarificationQuestion?`<div class="pm-card-body"><strong>Pending question:</strong> ${p(String(a.pendingClarificationQuestion))}</div>`:""}
      ${a?.pauseAnalysis?.message?`<div class="pm-card-body" style="white-space:pre-wrap;"><strong>Pause analysis:</strong><br>${p(String(a.pauseAnalysis.message).slice(0,1200))}</div>`:""}
      <div class="pm-sa-run-recovery-thread">${f}</div>
      ${d?`<div class="pm-sa-run-recovery-composer" data-sa-run-composer="${p(n)}">
        ${xe(_,"Reply to this run...")}
        <div class="pm-sa-run-composer-status" data-sa-run-composer-status="${p(n)}" role="status" aria-live="polite"${w.status?"":" hidden"} data-tone="${p(w.tone)}">${p(w.status)}</div>
      </div>`:""}
    </section>`},q=a=>{let n=String(a.id||a.taskId||""),d=String(a.status||a.taskStatus||"").toLowerCase(),l=xt(d),f=String(a.resultPreview||a.finalSummary||a.pauseAnalysis?.message||a.prompt||"").trim(),_=Nt(a.taskName||a.title||"Task"),w=a.startedAt||a.createdAt,D=a.completedAt||a.finishedAt,j=D&&w?wt(D-w):"",M=m===n,E=o[n]?.task,H=o[n]?.loading,L=!!(E?.canRecover||a.canRecover||["needs_assistance","awaiting_user_input","paused","stalled","failed"].includes(d));return`
      <article class="pm-card pm-sa-run-card" data-sa-run-id="${p(n)}" style="padding:14px 16px;cursor:pointer;border-color:${M?"var(--pm-orange)":"var(--pm-border)"};">
        <div style="display:flex;align-items:flex-start;gap:8px;margin-bottom:6px;">
          <strong class="pm-sa-run-title">${p(_)}</strong>
          <span class="pm-pill ${l.cls}">${p(l.label)}</span>
        </div>
        ${f?`<div class="pm-sa-run-summary-wrap">${Lt(f,{compact:!0})}</div>`:""}
        <div class="pm-sa-run-meta">
          <span>${p(a.trigger||a.source||"manual")} - ${a.completedSteps||0}/${a.totalSteps||a.stepCount||0} steps</span>
          <span>${Y(a.lastProgressAt||w)}${j?" - "+j:""}</span>
        </div>
        ${L&&!M?'<div style="margin-top:8px;font-size:12px;font-weight:800;color:var(--pm-orange);">Open recovery chat</div>':""}
        ${M?`<div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--pm-border);display:flex;flex-direction:column;gap:12px;cursor:default;">
          ${H||!E?'<div class="pm-card-body">Loading run details...</div>':`
            ${E.finalSummary?`<section><div class="pm-card-head">Output</div><div class="pm-sa-run-output">${Lt(E.finalSummary)}</div></section>`:""}
            ${L||E.recoveryConversation?.length?x(E,n,L):""}
            <section><div class="pm-card-head">Progress</div>${Mt(_t(E))}</section>
            ${Tt(E)}
            <section><div class="pm-card-head">Process Log</div>${$t(E.journal)}</section>
          `}
        </div>`:""}
      </article>`};async function P(a){if(m=m===a?"":a,m&&!o[a]?.task){o[a]={loading:!0},S();try{let n=await Ue(e,a);o[a]={task:n.task||null,run:n.run||null,evidenceBus:n.evidenceBus||null}}catch(n){o[a]={task:null,error:n?.message||"Failed to load run"},C(n?.message||"Failed to load run","error")}}S()}function T(){r.querySelector("#pm-sa-runs-refresh")?.addEventListener("click",async a=>{a.stopPropagation(),u=await ie(e,50),S()}),r.querySelectorAll("[data-sa-run-id]").forEach(a=>{a.addEventListener("click",async n=>{n.target.closest("button, textarea, input, a, summary")||await P(a.getAttribute("data-sa-run-id"))})}),r.querySelectorAll("[data-sa-run-copy]").forEach(a=>{a.addEventListener("click",n=>{n.preventDefault(),n.stopPropagation(),Ae(a.getAttribute("data-sa-run-copy")||"",a)})}),r.querySelectorAll("[data-sa-run-composer]").forEach(a=>{let n=String(a.getAttribute("data-sa-run-composer")||"").trim();if(!n)return;let d=`pm-sa-run-${n.replace(/[^a-zA-Z0-9_-]/g,"_")}`,l=b(n),f=async(w,{queued:D=!1}={})=>{let j=String(w?.text||"").trim(),M=Array.isArray(w?.files)?w.files:[];if(!j&&!M.length)return;if(l.busy){if(l.queue.length>=8){v(n,"Queue is full. Wait for the current reply to finish.","error"),C("Recovery queue is full.","error");return}l.queue.push({text:j,files:M}),v(n,`Queued reply ${l.queue.length}/8.`,"queued"),C("Recovery reply queued.","info"),i(n);return}l.busy=!0,l.controller=new AbortController,l.status="",l.tone="",i(n),v(n,D?"Sending queued reply\u2026":"Sending recovery reply\u2026","busy");let E=!1;try{let H=M;M.length&&(v(n,`Uploading ${M.length===1?"attachment":"attachments"}\u2026`,"busy"),H=(await $e(M,{signal:l.controller.signal})).map((Q,N)=>({...M[N]||{},name:Q.name||M[N]?.name||"attachment",kind:Q.isImage?"image":Q.isVideo?"video":M[N]?.kind||"file",workspacePath:Q.workspacePath||M[N]?.workspacePath,path:Q.workspacePath||M[N]?.path,dataUrl:M[N]?.dataUrl,mimeType:M[N]?.mimeType,sizeLabel:M[N]?.sizeLabel})));let L=await Ge(e,n,j||(H.length?"Please review the attached file(s).":""),H,{signal:l.controller.signal});L?.task&&(o[n]={task:L.task,run:L.run||null,evidenceBus:L.evidenceBus||null}),u=await ie(e,50),E=!0,v(n,L?.resumed?"Run resumed.":"Reply sent.","success"),C(L?.resumed?"Run resumed":"Reply sent","success")}catch(H){if(l.controller?.signal?.aborted||H?.name==="AbortError")v(n,"Stopped. The run was not changed.","stopped"),C("Recovery reply stopped.","info");else{let G=H?.message||"Recovery reply failed.";v(n,G,"error"),C(G,"error")}}finally{let H=E&&l.queue.length?l.queue.shift():null;l.busy=!1,l.controller=null,S(),H&&f(H,{queued:!0})}},_=_e(a,d,{placeholder:"Reply to this run...",draftKey:`subagent_run:${e}:${n}`,isBusy:()=>l.busy,onAbort:()=>{l.busy&&(l.controller?.abort?.(),i(n))},onSubmit:w=>f(w)});g.set(n,_)})}S()}async function Rt(r,e){r.innerHTML='<div class="pm-card" style="text-align:center;padding:24px;color:var(--pm-muted);">Loading heartbeat\u2026</div>';let{status:u,markdown:m}=await Qe(e),o=u?.lastTickAt||u?.last_tick_at||u?.timestamp;r.innerHTML=`
    <div class="pm-card">
      <div class="pm-card-head" style="display:flex;justify-content:space-between;align-items:center;">
        <span>${h.clock} Last tick</span>
        <button class="pm-btn primary" id="pm-hb-tick" style="padding:6px 12px;font-size:12px;">${h.refresh} Tick now</button>
      </div>
      <div class="pm-card-body strong">${o?p(Y(o)):'<em style="color:var(--pm-muted);">No heartbeat yet</em>'}</div>
    </div>
    ${m?`
      <div class="pm-card" style="padding:0;overflow:hidden;">
        <div class="pm-card-head" style="padding:12px 14px;border-bottom:1px solid var(--pm-border);">${h.doc} Heartbeat Notes</div>
        <pre class="pm-subagent-md">${p(m)}</pre>
      </div>
    `:`<div class="pm-empty" style="padding:24px;"><div class="pm-empty-icon">${h.spark}</div><p>No heartbeat notes yet. Tick to refresh.</p></div>`}
  `;let c=r.querySelector("#pm-hb-tick");c&&c.addEventListener("click",async()=>{let g=c.innerHTML;c.disabled=!0,c.innerHTML="\u2026ticking";try{let b=await ye(e);if(b?.success===!1)throw new Error(b?.error||"Failed");C("Heartbeat ticked","success"),await Rt(r,e)}catch(b){C(b.message||"Tick failed","error"),c.disabled=!1,c.innerHTML=g}})}async function Ft(r,e,u){let m=he(e.id);r.innerHTML=`
    <div class="pm-sa-chat-shell" id="pm-sa-chat-card">
      <div class="pm-sa-chat-scrollport">
        <div id="pm-sa-chat-list" class="pm-sa-chat-list"></div>
        <div id="pm-sa-chat-queue" class="pm-mobile-queued-prompts" hidden></div>
      </div>
      <div id="pm-sa-chat-goal" class="pm-mobile-goal-strip pm-mobile-goal-strip-inline" hidden></div>
      ${xe("pm-sa-chat",`Message ${e.name||"this subagent"}...`)}
    </div>
  `;let o=r.querySelector("#pm-sa-chat-list"),c=r.querySelector(".pm-sa-chat-scrollport"),g=r.querySelector("#pm-sa-chat-queue");mt(o,()=>{});let b=r.querySelector("#pm-sa-chat-goal");ot(b,it.activeSessionId,{fallbackToLast:!0});let v=[],i=null,S=null,A=0,x="",q=!1,P=!1,T=[],a=[],n=null,d=null,l=0,f=null,_=0,w=!0,D=()=>!!(S||i?.streaming||q),j=(t={})=>{let s=X(t),y=String(s.sessionId||s.sourceSessionId||"").trim();return!!s.id&&(y===m||String(s.agentId||"").trim()===String(e.id))},M=(t={})=>{if(!j(t))return!1;let s=X(t),y=a.findIndex(k=>String(k?.approvalRequest?.id||"")===s.id),$={role:"agent",content:"",createdAt:Date.now(),approvalRequest:s};return y>=0?a[y]={...a[y],approvalRequest:{...a[y].approvalRequest||{},...s}}:a.push($),a=a.slice(-8),!0},E=(t,s,y={})=>{let $=String(t||"").trim();if(!$)return!1;let k=a.findIndex(F=>String(F?.approvalRequest?.id||"")===$);return k<0?!1:(a[k].approvalRequest=X({...a[k].approvalRequest||{},...y.approval||y,id:$,status:s}),!0)},H=async()=>{let t=await Oe("pending").catch(()=>[]);(Array.isArray(t)?t:[]).forEach(M)};function L(){g&&(g.hidden=T.length===0,g.innerHTML=T.length?`<div class="pm-mobile-queued-list">${T.map((t,s)=>`
           <div class="pm-mobile-queued-item">
             <button type="button" class="pm-mobile-queued-text" data-sa-queue-edit="${s}">${p(String(t.text||"Attached file(s)").slice(0,120))}${t.files?.length?` <em>+${t.files.length}</em>`:""}</button>
             <div class="pm-mobile-queued-actions">
               <div class="pm-mobile-queued-menu-wrap">
                 <button type="button" class="pm-mobile-queued-icon pm-mobile-queued-menu-trigger" data-sa-queue-menu="${s}" aria-label="Queued message actions" title="Actions">${h.dots}</button>
                 <div class="pm-mobile-queued-popover" data-sa-queue-menu-popover="${s}" hidden>
                   <button type="button" class="pm-mobile-queued-menu-item pm-mobile-queued-steer" data-sa-queue-steer="${s}">${h.target}<span>Steer</span></button>
                   <button type="button" class="pm-mobile-queued-menu-item pm-mobile-queued-remove" data-sa-queue-remove="${s}">${h.trash}<span>Delete</span></button>
                 </div>
               </div>
             </div>
           </div>`).join("")}</div>`:"",ct(),g.querySelectorAll("[data-sa-queue-edit]").forEach(t=>J(t,()=>{})),g.querySelectorAll("[data-sa-queue-menu]").forEach(t=>J(t,()=>{let s=Number(t.getAttribute("data-sa-queue-menu"));if(!Number.isInteger(s))return;let y=g.querySelector(`[data-sa-queue-menu-popover="${s}"]`);if(!y)return;let $=!!y.hidden;de(g),y.hidden=!$})),g.querySelectorAll("[data-sa-queue-steer]").forEach(t=>J(t,()=>{let s=Number(t.getAttribute("data-sa-queue-steer"));if(Number.isFinite(s)&&s>=0&&s<T.length){let[y]=T.splice(s,1);y&&T.unshift(y)}de(g),L(),G()})),g.querySelectorAll("[data-sa-queue-remove]").forEach(t=>J(t,()=>{let s=Number(t.getAttribute("data-sa-queue-remove"));Number.isFinite(s)&&T.splice(s,1),de(g),L()})))}function G(){if(D()||!T.length){n?.update?.();return}let t=T.shift();L(),ne(t).catch(s=>C(s?.message||"Send failed","error"))}function Q(t){return String(t||"").toLowerCase().replace(/\s+/g," ").trim().slice(0,500)}function N(t){let s=[],y=new Set,$=new Map;return(Array.isArray(t)?t:[]).forEach(k=>{if(!k||typeof k!="object")return;let F=String(k.id||"").trim();if(F){if(y.has(F))return;y.add(F)}let O=Q(k.content||k.text||k.body?.text||"");if(O){let K=`${String(k.role||"")}:${O}`,W=Number(k.ts||k.createdAt||k.timestamp||Date.now())||Date.now(),U=Number($.get(K)||0);if(U&&Math.abs(W-U)<3e4)return;$.set(K,W)}s.push(k)}),s}function me(t){let s=i&&!i._done?i:null;v=N(t),s&&(v.some($=>String(s.id||"").trim()&&String($.id||"").trim()===String(s.id||"").trim()||String($.content||$.text||"").trim()&&String($.content||$.text||"").trim()===String(s.content||"").trim())||v.push(s)),v=N(v)}function ae(){let t=c||o;if(!t)return;let s=()=>{t.scrollTop=Math.max(0,t.scrollHeight-t.clientHeight)};s(),requestAnimationFrame(s),setTimeout(s,80)}function B(){let t=a.filter(y=>String(y?.approvalRequest?.status||"pending")==="pending"),s=[...v,...t];if(!s.length){o.innerHTML=`<div style="text-align:center;color:var(--pm-muted);padding:24px 8px;font-size:13px;">No messages yet. Send the first one to ${p(e.name)}.</div>`,ae();return}At(o,s,y=>we(y,{sender:e.name||e.id||"Subagent",live:y===i,keepLiveTraceVisible:y===i})),o.querySelectorAll("[data-pm-approval-action][data-pm-approval-id]").forEach(dt),St(o),ae()}let Me=()=>{P||B()};window.addEventListener("prometheus:markdown-ready",Me);try{me(await oe(e.id,80)),await H(),B()}catch(t){o.innerHTML=`<div style="color:var(--pm-red);padding:16px;">${p(t.message||"Failed to load chat")}</div>`}async function se({forceHistory:t=!1}={}){try{let s=await Ke(e.id,x?A:0);s.stream?.streamId&&s.stream.streamId!==x&&(x=s.stream.streamId,A=0),s.stream?.streamId&&!i&&s.active&&(i={role:"agent",content:"",_progress:"Reconnecting...",createdAt:Date.now(),workStartedAt:Date.now(),streaming:!0,processEntries:[]},v.push(i));for(let y of s.events||[])y.streamId&&(x=y.streamId),A=Math.max(A,Number(y.seq||0)),i||(i={role:"agent",content:"",_progress:"Reconnecting...",createdAt:Date.now(),workStartedAt:Date.now(),streaming:!0,processEntries:[]},v.push(i)),pe(i,kt(y),e.name||e.id||"Subagent");(t||!s.active||i?._done)&&(me(await oe(e.id,80)),await H(),s.active||(i=null)),B()}catch{}}let Te=()=>se({forceHistory:!0}),qe=()=>{document.hidden||se({forceHistory:!0})},Le=async(t={})=>{if(String(t.agentId||"")===String(e.id))try{me(await oe(e.id,80)),q||(i=null),B()}catch{}},Re=(t={})=>{String(t.agentId||"")===String(e.id)&&(q||(t.streamId&&t.streamId!==x&&(x=t.streamId,A=0),A=Math.max(A,Number(t.seq||0)),i||(i={role:"agent",content:"",_progress:`${e.name} is thinking...`,createdAt:Date.now(),workStartedAt:Date.now(),streaming:!0,processEntries:[]},v.push(i)),pe(i,{type:String(t.event||""),...t.data||{}},e.name||e.id||"Subagent"),B()))},Ce=async(t={})=>{let s=t.approval?X(t.approval,t):await pt(t);M(s)&&B()},re=t=>(s={})=>{let y=t==="approval_approved"?"approved":t==="approval_denied"?"rejected":t==="approval_expired"?"expired":"failed";E(s.approvalId||s.id||s.approval?.id,y,s)&&B()},Ee=re("approval_approved"),He=re("approval_denied"),Pe=re("approval_expired"),De=re("approval_failed"),ze=t=>{let s=t?.detail||{};if(s.accepted===!0||String(s.agentId||"")!==String(e.id||""))return;let y=String(s.text||"").trim();if(!y)return;let $=`${e.id}:${ht(y)}`,k=ee.lastSubagentBridgeSubmit||{};if(k.key===$&&Date.now()-Number(k.at||0)<1e4){s.accepted=!0,s.promise=Promise.resolve(),ft("subagent-voice-bridge-dedupe-ignored",{agentId:e.id,textLen:y.length});return}ee.lastSubagentBridgeSubmit={key:$,at:Date.now()},s.accepted=!0,s.promise=ne({text:y,runtimeMessage:String(s.runtimeMessage||y).trim(),files:[],source:"subagent_voice",speak:!0})};R?.on?.("ws:open",Te),R?.on?.("subagent_chat_message",Le),R?.on?.("subagent_chat_stream_event",Re),R?.on?.("approval_created",Ce),R?.on?.("approval_approved",Ee),R?.on?.("approval_denied",He),R?.on?.("approval_expired",Pe),R?.on?.("approval_failed",De),window.addEventListener("pm-subagent-voice-submit",ze),document.addEventListener("visibilitychange",qe),r._pmCleanup=()=>{if(!P){P=!0;try{S?.abort?.()}catch{}l&&cancelAnimationFrame(l);try{d?.disconnect?.()}catch{}_&&clearTimeout(_);try{f?.disconnect?.()}catch{}R?.off?.("ws:open",Te),R?.off?.("subagent_chat_message",Le),R?.off?.("subagent_chat_stream_event",Re),R?.off?.("approval_created",Ce),R?.off?.("approval_approved",Ee),R?.off?.("approval_denied",He),R?.off?.("approval_expired",Pe),R?.off?.("approval_failed",De),window.removeEventListener("pm-subagent-voice-submit",ze),window.removeEventListener("prometheus:markdown-ready",Me),document.removeEventListener("visibilitychange",qe)}},se();async function ne(t){let s=String(t?.text||"").trim(),y=String(t?.runtimeMessage||t?.runtime_message||"").trim(),$=Array.isArray(t?.files)?t.files:[],k=String(t?.source||"").trim(),F=k==="subagent_voice"||t?.voice===!0,O=s||($.length?"Please review the attached file(s).":"");if(!O&&!$.length)return;if(D()){T.push({text:s,runtimeMessage:y,files:$,source:k,speak:t?.speak===!0,voice:t?.voice===!0}),L(),n?.update?.();return}let K=y||O,W=t?.clientMessageId||t?.client_message_id||`sa_${String(e.id||"agent").replace(/[^a-zA-Z0-9_.:-]/g,"_")}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,8)}`,U=$;if($.length){let z=await $e($);K=`${O}${ut(z)}`,U=z.map((I,V)=>({...$[V]||{},name:I.name||$[V]?.name||"attachment",kind:I.isImage?"image":I.isVideo?"video":$[V]?.kind||"file",workspacePath:I.workspacePath||$[V]?.workspacePath,path:I.workspacePath||$[V]?.path,dataUrl:$[V]?.dataUrl,mimeType:$[V]?.mimeType,sizeLabel:$[V]?.sizeLabel}))}let Ct={id:W,role:"user",content:O,body:{text:O,attachments:U,source:k},attachmentPreviews:U,source:k,createdAt:Date.now()};v.push(Ct),i={id:`${W}_agent`,role:"agent",content:"",source:k,_progress:`${e.name} is thinking...`,createdAt:Date.now(),workStartedAt:Date.now(),streaming:!0,processEntries:[]},v.push(i),B(),q=!0,n?.update?.();let ve=()=>{},Et=new Promise(z=>{ve=z});return S=Je(e.id,{message:K,clientMessageId:W,attachmentPreviews:U,...F&&O&&O!==K?{visibleMessage:O}:{},...k?{source:k}:{},...F?{voiceTarget:gt()}:{}},{onEvent:z=>{i&&(pe(i,z,e.name||e.id||"Subagent"),B())},onError:z=>{if(z?.name==="AbortError")return;let I=i;I&&(I.content=I.content||`Error: ${z?.message||"stream failed"}`,I._progress="",I.streaming=!1,I.workEndedAt=Date.now(),q=!1,S=null,u?.(null),n?.update?.(),B(),ve())},onDone:async()=>{let z=String(i?.content||i?.text||"").trim();i&&(i._progress="",i.streaming=!1,i.workEndedAt=i.workEndedAt||Date.now(),i.workDurationMs=Math.max(0,i.workEndedAt-Number(i.workStartedAt||i.createdAt||i.workEndedAt))),q=!1,S=null,u?.(null),n?.update?.(),await se({forceHistory:!0}),z&&F&&ee?.target?.kind==="subagent"&&String(ee.target.agentId||"")===String(e.id||"")&&await yt(e.id,z).catch(()=>{}),G(),ve()}}),u?.(S),Et}n=_e(r,"pm-sa-chat",{placeholder:`Message ${e.name||"this subagent"}...`,draftKey:`subagent:${e.id||""}`,isBusy:D,onAbort:()=>{try{S?.abort?.()}catch{}i&&(i._progress="Stopping...",i.streaming=!1),S=null,u?.(null),q=!1,B()},onSubmit:ne,onVoiceSubmit:ne,voiceTarget:{agentId:e.id,label:e.name||e.id||"Subagent",voice:e.voice||e.raw?.voice||null}});let be=r.querySelector("#pm-sa-chat-form"),Ie=()=>{l&&cancelAnimationFrame(l),l=requestAnimationFrame(()=>{l=0;let t=Math.ceil(be?.getBoundingClientRect?.().height||0);r.style.setProperty("--pm-sa-chat-composer-space",`${Math.max(132,t+28)}px`),ae()})};typeof ResizeObserver<"u"&&be&&(d=new ResizeObserver(Ie),d.observe(be)),typeof ResizeObserver<"u"&&o&&(f=new ResizeObserver(()=>{w&&ae()}),f.observe(o)),_=setTimeout(()=>{w=!1},900),Ie(),L()}export{Gt as renderSubagentChatPage,Dt as renderSubagentDetailPage,Ut as renderSubagentsPage};
