import{A as At,C as Y,E as Lt,F as Tt,J as _t,K as Et,L as Ct,O as qt,Q as Ht,c as vt,f as gt,g as ht,h as qe,i as ft,j as yt,l as we,m as bt,o as wt,p as $t,q as ze,r as xt,s as St,t as kt,u as He,v as Mt}from"./chunk-U3BWLW6U.js";import{b as ge}from"./chunk-J5HXEABW.js";import{a as B}from"./chunk-35CAQ6TV.js";import{H as y,I as v,O as Ee,P as Ce}from"./chunk-DCYOCX7L.js";import{e as le}from"./chunk-3G7SKSZD.js";import{a as pt,b as mt,c as ut}from"./chunk-LXAE2DH2.js";import{La as dt,Q as Ie,R as Ze,S as Le,T as Xe,U as et,V as tt,X as at,Y as Te,Z as nt,_ as _e,aa as rt,ba as st,c as Ye,ca as ot,da as it,ea as lt,ga as ct,s as Je}from"./chunk-LHYIPBQS.js";import{c as ie,d as Qe}from"./chunk-UGPXJRDS.js";import{a as q}from"./chunk-YF7XQ7HF.js";function Ut(e){return`
    <button class="pm-team-tile ${e.featured?"featured":""}" data-team="${e.id}">
      ${e.featured?'<span class="pm-star">\u2605</span>':""}
      <span class="pm-team-lead">${ie(e.leadId||e.id,{size:36})}</span>
      ${e.crewIds?.length?Qe(e.crewIds,{size:16,max:5}):""}
      <span class="pm-team-name">${v(e.name)}</span>
      <span class="pm-team-agents">${y.users} ${e.agents} agents</span>
    </button>
  `}function Rt(){return`<div class="pm-team-grid">${`<div class="pm-team-tile" style="opacity:.55"><span class="pm-team-lead" style="opacity:.4">${ie("team",{size:36})}</span><span class="pm-team-name" style="background:rgba(0,0,0,.06);color:transparent;border-radius:6px;height:16px;width:80%;">loading</span></div>`.repeat(4)}</div>`}async function pa(e,{navigate:s}){let p=`
    <span class="pm-count-pill" id="pm-teams-count">\u2026</span>
    <span class="pm-spacer"></span>
    <button class="pm-icon-btn" id="pm-teams-refresh" aria-label="Refresh" style="background:var(--pm-surface);border:1px solid var(--pm-border);">${y.refresh}</button>
  `,h=Ee({title:"Teams",online:!1,extras:p});e.innerHTML=`
    ${h}
    <div class="pm-body" id="pm-teams-body">${Rt()}</div>
  `,Ce(e,{});let g=e.querySelector("#pm-teams-body"),c=e.querySelector("#pm-teams-count"),S=e.querySelector("#pm-teams-refresh");async function $({force:k=!1}={}){let l=[];try{l=await Ze({force:k})}catch(w){g.innerHTML=`<div class="pm-empty"><div class="pm-empty-icon">${y.users}</div><h2>Couldn\u2019t load teams</h2><p>${v(w.message||"Network error")}</p></div>`,c.textContent="0 teams";return}if(c.textContent=`${l.length} team${l.length===1?"":"s"}`,!l.length){g.innerHTML=`<div class="pm-empty"><div class="pm-empty-icon">${y.users}</div><h2>No teams yet</h2><p>Create your first team from the desktop app.</p></div>`;return}let n=l.find(w=>w.featured)||l[0],o=null;try{o=await Le(n.id)}catch{}let M=o?`
      <div class="pm-team-preview">
        <div class="pm-team-preview-head">
          <span class="pm-mini-house">${ie(o.leadId||o.id,{size:24})}</span>
          <h3>${v(o.name)}</h3>
          <button class="pm-pill-btn" data-go="${v(o.id)}">View Team ${y.chev}</button>
        </div>
        <div style="font-size:13px;color:var(--pm-muted);font-weight:700;margin-top:4px;">Team members</div>
        <div class="pm-chip-row">
          ${o.members.map(w=>`<span class="pm-member-chip"><span class="pm-avatar" style="background:transparent">${w.avatar}</span>${v(w.name)}</span>`).join("")}
        </div>
        <div class="pm-divider"></div>
        <button type="button" class="pm-row pm-row-link" data-go-ws="${v(o.id)}"><span>\u{1F5C2}\uFE0F Workspace</span><span style="color:var(--pm-muted);display:inline-flex;align-items:center;gap:4px;">Open ${y.chev}</span></button>
        <div class="pm-divider"></div>
        <div class="pm-row" style="flex-direction:column;align-items:stretch;gap:4px;">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <strong>Progress</strong>
            <span style="color:var(--pm-muted)">Recent runs <b style="color:var(--pm-text)">${o.runsDone} / ${o.runsTotal} runs</b></span>
          </div>
          <div class="pm-progress"><span style="width:${o.runsTotal?Math.round(o.runsDone/o.runsTotal*100):0}%"></span></div>
        </div>
      </div>
    `:"";g.innerHTML=`
      <div class="pm-team-grid">${l.map(Ut).join("")}</div>
      ${M}
    `,g.querySelectorAll("[data-team]").forEach(w=>{w.addEventListener("click",()=>s(`#mobile/teams/${w.getAttribute("data-team")}`))}),g.querySelectorAll("[data-go]").forEach(w=>{w.addEventListener("click",()=>s(`#mobile/teams/${w.getAttribute("data-go")}`))}),g.querySelectorAll("[data-go-ws]").forEach(w=>{w.addEventListener("click",()=>s(`#mobile/teams/${encodeURIComponent(w.getAttribute("data-go-ws"))}/workspace`))})}S.addEventListener("click",()=>{Ie(),g.innerHTML=Rt(),$({force:!0})});let d=Ye("teams_raw",216e5);await $(),Array.isArray(d)&&$({force:!0}).catch(()=>{})}function Ot(){return`
    <div class="pm-detail-head"><span class="pm-house-icon">${ie("team",{size:30})}</span><h1 style="background:rgba(0,0,0,.06);color:transparent;border-radius:8px;height:24px;flex:1;">loading</h1></div>
    <div class="pm-detail-sub">\u2026</div>
    <div class="pm-action-row">
      <button class="pm-action-btn primary">${y.play} Start Run</button>
      <button class="pm-action-btn">${y.pause} Pause</button>
      <button class="pm-action-btn">${y.brain} Review</button>
      <button class="pm-action-btn danger">${y.trash} Delete</button>
    </div>
    <div class="pm-card" style="opacity:.5"><div class="pm-card-head">${y.target} Purpose</div><div class="pm-card-body">Loading team\u2026</div></div>
  `}async function ma(e,{teamId:s,navigate:p,initialTab:h=""}){e.innerHTML=`
    ${Ee({title:"Team",online:!0,leftIcon:"back",hideTitle:!0,hideBrand:!0})}
    <div class="pm-body pm-subagent-detail-body pm-team-detail-body" id="pm-detail-body">${Ot()}</div>
  `,Ce(e,{onBack:()=>p("#mobile/teams")});let g=e.querySelector("#pm-detail-body"),c=null;try{c=await Le(s)}catch(a){g.innerHTML=`<div class="pm-empty"><div class="pm-empty-icon">${y.users}</div><h2>Couldn\u2019t load team</h2><p>${v(a.message||"Network error")}</p></div>`;return}if(!c){g.innerHTML=`<div class="pm-empty"><div class="pm-empty-icon">${y.users}</div><h2>Team not found</h2><p>This team isn\u2019t available right now.</p></div>`;return}let S=["Context","Subagents","Workspace","Memory","Runs","Team Chat"];g.innerHTML=`
    <div class="pm-detail-head">
      <span class="pm-house-icon">${ie(c.leadId||c.id,{size:30})}</span>
      <h1>${v(c.name)}</h1>
      <button class="pm-icon-btn pm-overflow" aria-label="More">${y.dots}</button>
    </div>
    <div class="pm-detail-sub">${c.subagents} subagents \xB7 ${c.totalRuns} total runs</div>

    <div class="pm-action-row">
      <button class="pm-action-btn primary" data-act="start">${y.play} Start Run</button>
      <button class="pm-action-btn"          data-act="pause">${c.paused?y.play+" Resume":y.pause+" Pause"}</button>
      <button class="pm-action-btn"          data-act="chat">${y.chat} Chat</button>
      <button class="pm-action-btn danger"   data-act="delete">${y.trash} Delete</button>
    </div>

    <div class="pm-tabs" role="tablist">
      ${S.map((a,b)=>`<button class="${b===0?"active":""}" data-tab="${a}">${v(a)}</button>`).join("")}
    </div>

    <div id="pm-tab-slot"></div>

    <div id="pm-context-slot">
    <div class="pm-team-preview">
      <div class="pm-team-preview-head">
        <span class="pm-mini-house">${ie(c.leadId||c.id,{size:24})}</span>
        <h3>${v(c.name)}</h3>
      </div>
      <div style="font-size:13px;color:var(--pm-muted);">${c.subagents} subagents \xB7 ${c.totalRuns} total runs</div>
      <div class="pm-chip-row">
        ${c.members.map(a=>`<span class="pm-member-chip"><span class="pm-avatar" style="background:transparent">${a.avatar}</span>${v(a.name)}</span>`).join("")}
      </div>
    </div>

    <div class="pm-card">
      <div class="pm-card-head" style="display:flex;justify-content:space-between;align-items:center;">
        <span>${y.target} Purpose</span>
        <button class="pm-show-more" data-toggle-purpose>Show more \u25BE</button>
      </div>
      <div class="pm-card-body" data-purpose data-collapsed="1" style="display:-webkit-box;-webkit-line-clamp:6;-webkit-box-orient:vertical;overflow:hidden;">${v(c.purpose)}</div>
    </div>

    <div class="pm-card-grid">
      <div class="pm-card">
        <div class="pm-card-head">${y.check} Current Task / Goal</div>
        <div class="pm-card-body">${v(c.currentTask)}</div>
      </div>
      <div class="pm-card">
        <div class="pm-card-head">${y.clock} Last Run</div>
        <div class="pm-card-body strong">${v(c.lastRun)}</div>
      </div>
      <div class="pm-card">
        <div class="pm-card-head">${y.users} Member States</div>
        <div class="pm-card-body" data-member-states>${v(c.memberStates)}</div>
      </div>
      <div class="pm-card">
        <div class="pm-card-head">${y.send} Active Dispatches</div>
        <div class="pm-card-body" data-dispatches>${v(c.dispatches)}</div>
      </div>
    </div>

    <div class="pm-card">
      <div class="pm-card-head">${y.doc} Context &amp; Reference</div>
      <div class="pm-card-body" style="margin-bottom:10px;">Each save adds a new card. Cards are injected into manager + subagent runtime context.</div>
      <input class="pm-input" id="pm-ref-title" placeholder="Reference title (e.g. Brand Voice, API URL, Posting Rules)" />
      <textarea class="pm-textarea" id="pm-ref-body" placeholder="Reference content\u2026"></textarea>
      <div class="pm-row-buttons">
        <button class="pm-btn primary" data-save-ref>${y.check} Save</button>
      </div>
    </div>

    <div class="pm-card">
      <div class="pm-card-head" style="display:flex;justify-content:space-between;align-items:center;">
        <span>\u{1F4C1} Workspace Preview</span>
        <a href="#mobile/teams/${v(s)}/workspace" style="color:var(--pm-orange);font-weight:700;text-decoration:none;font-size:13px;">Open Workspace \u203A</a>
      </div>
      <div class="pm-card-body">${v(c.workspace)}</div>
    </div>
    </div><!-- /pm-context-slot -->
  `;let $=g.querySelector("#pm-context-slot"),d=g.querySelector("#pm-tab-slot");async function k(a){try{d?._pmCleanup?.()}catch{}if(d&&(d._pmCleanup=null),g.querySelectorAll(".pm-tabs button").forEach(b=>b.classList.toggle("active",b.getAttribute("data-tab")===a)),a==="Context"){$.style.display="",d.innerHTML="";return}$.style.display="none",d.innerHTML=`<div class="pm-card" style="text-align:center;padding:24px;color:var(--pm-muted);">Loading ${v(a)}\u2026</div>`;try{if(a==="Subagents")await It(d,c);else if(a==="Runs")await Qt(d,s);else if(a==="Team Chat"){p(`#mobile/teams/${encodeURIComponent(s)}/chat`);return}else a==="Workspace"?await sa(d,s):a==="Memory"&&await oa(d,s,c)}catch(b){d.innerHTML=`<div class="pm-card"><div class="pm-card-head">${y.users} Error</div><div class="pm-card-body">${v(b.message||"Failed to load")}</div></div>`}}g.querySelectorAll(".pm-tabs button").forEach(a=>{a.addEventListener("click",()=>k(a.getAttribute("data-tab")))}),Te(s).then(a=>{if(!a)return;let b=N=>(c.members||[]).find(J=>J.id===N)?.name||N,f=g.querySelector("[data-member-states]"),T=Object.entries(a.memberStates||{});f&&T.length&&(f.innerHTML=T.map(([N,J])=>`<div style="display:flex;justify-content:space-between;gap:8px;"><span>${v(b(N))}</span><span style="color:var(--pm-muted)">${v(String(J?.status||"idle"))}</span></div>`).join(""));let C=g.querySelector("[data-dispatches]"),O=Array.isArray(a.activeDispatches)?a.activeDispatches:[];C&&(C.textContent=O.length?`${O.map(N=>b(String(N.agentId||N.subagentId||""))).join(", ")} working`:"No active dispatches.")}).catch(()=>{});let l=S.find(a=>a.toLowerCase().replace(/\s+/g,"-")===String(h||"").toLowerCase());l&&l!=="Context"&&k(l);let n=g.querySelector("[data-toggle-purpose]"),o=g.querySelector("[data-purpose]");n&&o&&n.addEventListener("click",()=>{o.getAttribute("data-collapsed")==="1"?(o.style.webkitLineClamp="unset",o.style.display="block",o.setAttribute("data-collapsed","0"),n.textContent="Show less \u25B4"):(o.style.display="-webkit-box",o.style.webkitLineClamp="6",o.setAttribute("data-collapsed","1"),n.textContent="Show more \u25BE")});async function M(a,b,f){let T=a.innerHTML;a.disabled=!0,a.style.opacity="0.6";try{let C=await b();if(!C||C.success===!1)throw new Error(C?.error||"Failed");return B(f,"success"),C}catch(C){throw B(C.message||"Action failed","error"),C}finally{a.disabled=!1,a.style.opacity="",a.innerHTML=T}}g.querySelectorAll("[data-act]").forEach(a=>{let b=a.getAttribute("data-act");a.addEventListener("click",async()=>{if(b==="start")await M(a,()=>Xe(s),"Run started").catch(()=>{});else if(b==="pause"){let f=c.paused;try{await M(a,()=>f?tt(s):et(s),f?"Team resumed":"Team paused"),c.paused=!f,a.innerHTML=c.paused?`${y.play} Resume`:`${y.pause} Pause`}catch{}}else if(b==="chat")p(`#mobile/teams/${encodeURIComponent(s)}/chat`);else if(b==="delete"){if(!window.confirm(`Delete team "${c.name}"? This cannot be undone.`))return;try{await M(a,()=>at(s),"Team deleted"),Ie(),p("#mobile/teams")}catch{}}})});let w=g.querySelector("[data-save-ref]");w&&w.addEventListener("click",async()=>{let a=g.querySelector("#pm-ref-title"),b=g.querySelector("#pm-ref-body"),f=(a.value||"").trim(),T=(b.value||"").trim();if(!f||!T){B("Title and content required","error");return}try{await M(w,()=>dt(s,f,T),"Reference saved"),a.value="",b.value=""}catch{}}),e._pmCleanup=()=>{try{d?._pmCleanup?.()}catch{}}}var Pt={working:{label:"working",cls:"running"},active:{label:"active",cls:"active"},ready:{label:"ready",cls:"active"},idle:{label:"idle",cls:"gray"},blocked:{label:"blocked",cls:"orange"},paused:{label:"paused",cls:"gray"},awaiting:{label:"awaiting",cls:"orange"},offline:{label:"offline",cls:"gray"}};function Wt(e){let s=/^Goal update \(([a-z_]+)\):\s*(\{[\s\S]*\})\s*$/.exec(String(e||"").trim());if(!s)return e;let p;try{p=JSON.parse(s[2])}catch{return e}let h=g=>String(g??"").replace(/\s+/g," ").trim();switch(s[1]){case"log_completed":return`\u2705 Logged as done: ${h(p.entry??p.completed??p.text)}`;case"set_focus":return`\u{1F3AF} Focus set: ${h(p.focus??p.current_focus??p.text)}`;case"pause_agent":return`\u23F8 Paused ${h(p.agent_id)}`;case"unpause_agent":return`\u25B6 Resumed ${h(p.agent_id)}`;default:return`Goal update (${s[1]})`}}function Kt(e){if(!e||e<0)return"\u2014";let s=Math.floor(e/1e3);return s<60?`${s}s`:`${Math.floor(s/60)}m ${s%60}s`}async function It(e,s){let p=null;try{p=await Te(s.id)}catch{}let h=p?.memberStates||{},g=Array.isArray(p?.activeDispatches)?p.activeDispatches:[],c=new Map;for(let l of g){let n=String(l.agentId||l.subagentId||"").trim();n&&c.set(n,l)}let S=s.members.filter(l=>l.id!=="manager"),$=new Map((await Promise.all(S.map(async l=>{let n=await ct(l.id).catch(()=>null);return[l.id,n]}))).filter(([,l])=>l)),d=[],k=S.map(l=>{let n=h[l.id]||{},o=Pt[String(n.status||"idle").toLowerCase()]||Pt.idle,M=c.get(l.id),w=$.get(l.id),a=`pm-team-member-model-${s.id}-${l.id}`.replace(/[^a-zA-Z0-9_-]/g,"-");return w&&d.push({pickerScope:a,agent:w}),`
      <article class="pm-card pm-team-member-card">
        <div class="pm-schedule-head" style="margin-bottom:8px;">
          <span class="pm-emoji" style="font-size:22px;">${l.avatar}</span>
          <h3 style="margin:0;">${v(l.name)}</h3>
          <span class="pm-pill ${o.cls}">${o.label}</span>
        </div>
        ${n.currentTask?`<div class="pm-card-body" style="margin-bottom:6px;"><strong>Current:</strong> ${v(n.currentTask)}</div>`:""}
        ${n.blockedReason?`<div class="pm-card-body" style="color:var(--pm-red);margin-bottom:6px;"><strong>Blocked:</strong> ${v(n.blockedReason)}</div>`:""}
        ${n.lastResult?`<div class="pm-card-body" style="font-size:13px;color:var(--pm-muted);margin-bottom:6px;">Last: ${v(String(n.lastResult).slice(0,140))}${String(n.lastResult).length>140?"\u2026":""}</div>`:""}
        <div style="display:flex;justify-content:space-between;align-items:center;font-size:12px;color:var(--pm-muted);">
          <span>${M?"\u{1F4E1} dispatched":"Last update"}</span>
          <span>${ge(n.lastUpdateAt||M?.startedAt)}</span>
        </div>
        ${w?`<details class="pm-model-details"><summary>Model settings</summary>${pt(w,a)}</details>`:""}
      </article>
    `}).join("");e.innerHTML=k||`<div class="pm-empty"><div class="pm-empty-icon">${y.robot}</div><h2>No subagents yet</h2><p>Add members from the desktop team editor.</p></div>`,d.forEach(({pickerScope:l,agent:n})=>{ut(l,()=>It(e,s)),mt(l,n)})}function Gt(e){return e.inProgress?'<span class="pm-pill running">running</span>':e.success===!0?'<span class="pm-pill active">success</span>':e.success===!1&&e.taskStatus?`<span class="pm-pill orange">${v(String(e.taskStatus))}</span>`:'<span class="pm-pill gray">complete</span>'}async function Qt(e,s){let{runs:p}=await nt(s,30);if(!p.length){e.innerHTML=`<div class="pm-empty"><div class="pm-empty-icon">${y.clock}</div><h2>No runs yet</h2><p>Start a run from the top of this page.</p></div>`;return}e.innerHTML=p.map(h=>`
    <article class="pm-card" style="padding:14px 16px;">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
        <strong style="flex:1;font-size:14px;">${v(h.agentName||h.agentId||"Agent")}</strong>
        ${Gt(h)}
      </div>
      ${h.taskSummary?`<div class="pm-card-body" style="margin-bottom:6px;">${v(String(h.taskSummary).slice(0,200))}${String(h.taskSummary).length>200?"\u2026":""}</div>`:""}
      <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--pm-muted);">
        <span>${v(h.trigger||"manual")} \xB7 ${h.stepCount||0} steps</span>
        <span>${ge(h.startedAt)} \xB7 ${Kt(h.durationMs)}</span>
      </div>
    </article>
  `).join("")}function Yt(e){return e?{type:String(e.type||e.event||""),...e.data||{}}:null}async function Jt(e){try{if(!navigator.clipboard?.writeText)throw new Error("clipboard unavailable");return await navigator.clipboard.writeText(e),B("Message copied","success"),!0}catch{let s=document.createElement("textarea");s.value=e,s.setAttribute("readonly",""),s.style.position="fixed",s.style.opacity="0",document.body.appendChild(s),s.select();try{let p=document.execCommand("copy");return B(p?"Message copied":"Copy failed",p?"success":"error"),!!p}catch{return B("Copy failed","error"),!1}finally{s.remove()}}}function Zt(e){!e||e.dataset.pmAgentActionsWired==="1"||(e.dataset.pmAgentActionsWired="1",e.addEventListener("click",s=>{let p=s.target?.closest?.("[data-pm-agent-msg-action]");if(!p||!e.contains(p))return;let h=String(p.dataset.pmAgentMsgAction||""),g=String(p.closest(".pm-msg")?.querySelector(":scope > .pm-bubble > .markdown-body")?.innerText||"").trim();if(g){if(h==="copy"){Jt(g);return}if(h==="speak")try{Tt(),Lt(g)}catch{}}}))}function Xt(e,s,p){if(!e)return;let h=new Set,g=new Set;e.querySelectorAll(".pm-agent-chat-msg").forEach((c,S)=>{c.querySelector(".pm-trace-drawer.open")&&h.add(S),c.querySelectorAll("details.pm-trace-tool-group[open]").forEach((d,k)=>{g.add(`${S}:${d.getAttribute("data-pm-trace-group")||k}`)})}),e.innerHTML=s.map(p).join(""),e.querySelectorAll(".pm-agent-chat-msg").forEach((c,S)=>{let $=c.querySelector(".pm-trace-drawer"),d=c.querySelector('[data-expandable="trace"]');$&&h.has(S)&&($.classList.add("open"),d?.classList.add("expanded")),c.querySelectorAll("details.pm-trace-tool-group").forEach((k,l)=>{let n=`${S}:${k.getAttribute("data-pm-trace-group")||l}`;g.has(n)&&!k.closest('.pm-trace-drawer[data-trace-completed="1"]')&&k.setAttribute("open","")})}),At(e)}var De={};function ea(e,s){let p=String(e||"pm-agent-chat"),h=p==="pm-team-chat"||p==="pm-sa-chat";return`
    ${h?`<div class="pm-chat-mode-launcher pm-agent-chat-mode-launcher" id="${p}-mode-launcher" role="group" aria-label="Choose chat input">
      <button type="button" class="pm-chat-mode-button pm-chat-mode-button--voice" id="${p}-mode-voice" aria-label="Start voice mode">${y.micSmall}<span class="pm-chat-mode-button-label">Voice mode</span></button>
      <button type="button" class="pm-chat-mode-button pm-chat-mode-button--keyboard" id="${p}-mode-keyboard" aria-label="Open keyboard composer">${y.keyboard}<span class="pm-chat-mode-button-label">Keyboard composer</span></button>
    </div>`:""}
    <form class="pm-composer pm-agent-chat-composer${h?" pm-composer-mode-hidden":""}" id="${p}-form"${h?' aria-hidden="true" inert':""}>
      <span class="pm-glass-lens" aria-hidden="true"></span>
      <span class="pm-glass-border" aria-hidden="true"></span>
      <input id="${p}-file-input" type="file" multiple accept="image/*,video/*,.mp4,.mov,.m4v,.webm,.avi,.mkv,.txt,.md,.json,.csv,.tsv,.log,.xml,.html,.css,.js,.ts,.tsx,.jsx,.py,.yaml,.yml,application/pdf" hidden />
      <div class="pm-attach-tray" id="${p}-attach-tray" hidden></div>
      <div class="pm-composer-row">
        <button type="button" class="pm-icon-btn" id="${p}-attach-btn" aria-label="Attach files">${y.paperclip}</button>
        <div class="pm-composer-input-wrap" id="${p}-input-wrap">
          <textarea class="pm-composer-input" id="${p}-input" rows="1" placeholder="${v(s)}" aria-label="Message" autocomplete="off" autocapitalize="sentences" enterkeyhint="send"></textarea>
        </div>
        <button type="button" class="pm-icon-btn" id="${p}-mic-btn" aria-label="Voice input">${y.micSmall}</button>
        <button type="submit" class="pm-send" id="${p}-send-btn" aria-label="Send">${y.send}</button>
      </div>
      <div class="pm-chat-voice-shell" id="${p}-voice-shell" hidden>
        <button type="button" class="pm-chat-voice-camera" id="${p}-voice-camera" aria-label="Attach camera image">${y.image}</button>
        <button type="button" class="pm-chat-voice-close" id="${p}-voice-close" aria-label="Close voice mode">&times;</button>
        <div class="pm-chat-voice-inline" id="${p}-voice-inline"></div>
      </div>
    </form>`}function ta(e,s,{placeholder:p,isBusy:h,onSubmit:g,onAbort:c,draftKey:S="",voiceTarget:$=null,onVoiceSubmit:d=null,openCameraCapture:k=null}){let l=String(s||"pm-agent-chat"),n=e.querySelector(`#${l}-form`),o=e.querySelector(`#${l}-input`),M=e.querySelector(`#${l}-send-btn`),w=e.querySelector(`#${l}-attach-btn`),a=e.querySelector(`#${l}-mic-btn`),b=e.querySelector(`#${l}-voice-shell`),f=e.querySelector(`#${l}-voice-close`),T=e.querySelector(`#${l}-voice-camera`),C=e.querySelector(`#${l}-voice-inline`),O=e.querySelector(`#${l}-file-input`),N=e.querySelector(`#${l}-attach-tray`),J=e.querySelector(`#${l}-mode-launcher`),he=e.querySelector(`#${l}-mode-voice`),ce=e.querySelector(`#${l}-mode-keyboard`),ae=String(S||"").trim(),H=null;ae&&(De[ae]||(De[ae]={text:"",pending:[]}),H=De[ae],Array.isArray(H.pending)||(H.pending=[]));let j=H?H.pending:[],_=!1,R=null,$e=null,I=null,Z=0;o&&H?.text&&(o.value=H.text);let X=l==="pm-team-chat"||l==="pm-sa-chat",ne=document.querySelector(".pm-app")||document.body,ee=document.querySelector(".pm-tabbar"),P=window.visualViewport,xe=r=>{if(!ee)return 0;let m=getComputedStyle(ee);if(m.display==="none"||m.visibility==="hidden")return 0;let x=ee.getBoundingClientRect?.(),z=Math.max(0,Number(P?.offsetTop||0)),D=Math.max(0,Number(r||0));return!x||x.height<=0||x.bottom<=z||x.top>=D?0:Math.max(0,Math.round(D-Math.max(x.top,z)+16))},W=0,re=0,K=!1,te="",t=0,i=0,u=Math.max(Number(window.innerHeight||0),Number(P?.height||0)),A=0,L=0,E=e.querySelector?.(".pm-sa-chat-scrollport")||e.closest?.(".pm-page.pm-agent-chat-page")?.querySelector?.(".pm-sa-chat-scrollport")||e,oe=0,de=0,F=Number(E?.scrollTop||0),V={passive:!0},U=["position","left","right","top","bottom","z-index"],fe=()=>{!n||!X||(K=!1,te="",t=0,i=0,A=0,L=0,U.forEach(r=>n.style.removeProperty(r)),ne?.classList.remove("pm-keyboard-open","pm-agent-composer-keyboard-open"),ne?.style.removeProperty("--pm-keyboard-offset"),ee?.style.removeProperty("display"),W&&cancelAnimationFrame(W),W=0,re&&window.clearTimeout(re),re=0)},zt=()=>{if(W=0,!n||!X||!K)return;ee?.style.setProperty("display","none","important");let r=Math.max(Number(window.innerHeight||0),Number(document.documentElement?.clientHeight||0)),m=Math.max(0,Number(P?.offsetTop||0)),x=Math.max(0,Number(P?.height||r||0)),z=Math.round(m+x),D=P?Math.max(0,Math.round(r-x)):0,se=Math.max(0,Math.round(u-x));if((D>90||se>90)&&!te){let Ge=Number(n.getBoundingClientRect?.().bottom||0);te=Ge>0&&Ge<=z+44?"visual":"layout",te==="visual"&&(t=z,i=x)}else te==="visual"&&Math.abs(x-i)>2&&(t=z,i=x);let be=te==="visual"?t||z:r,ve=Math.max(54,Math.ceil(n.getBoundingClientRect?.().height||n.offsetHeight||54)),Ae=xe(be),Bt=te==="layout"&&D>0?D+8:0,Ft=Math.max(8,Ae,Bt),Vt=Math.max(8,Math.round(be-Ft-ve));n.style.setProperty("position","fixed","important"),n.style.setProperty("left","10px","important"),n.style.setProperty("right","10px","important"),n.style.setProperty("top",`${Vt}px`,"important"),n.style.setProperty("bottom","auto","important"),n.style.setProperty("z-index","10030","important"),ne?.classList.add("pm-keyboard-open","pm-agent-composer-keyboard-open"),ne?.style.setProperty("--pm-keyboard-offset",`${D}px`)},G=()=>{!X||!K||W||(W=requestAnimationFrame(()=>{if(W=0,!X||!K)return;let r=Math.max(Number(window.innerHeight||0),Number(document.documentElement?.clientHeight||0)),m=Math.max(0,Number(P?.height||r||0)),x=Math.max(0,r-m)>90||Math.max(0,u-m)>90,z=performance.now()<A||performance.now()<L;if(!x&&!z){Se();return}zt()}))},Ne=()=>{X&&(K=!0,A=performance.now()+1600,ee?.style.setProperty("display","none","important"),u=Math.max(u,Number(window.innerHeight||0),Number(P?.height||0)),te="",t=0,i=0,ne?.classList.add("pm-keyboard-open","pm-agent-composer-keyboard-open"),ne?.style.setProperty("--pm-keyboard-offset","0px"),G(),[80,240,560,1e3].forEach(r=>window.setTimeout(G,r)),re&&window.clearTimeout(re),re=window.setTimeout(()=>{re=0,G()},1700))},Se=()=>{X&&(fe(),u=Math.max(Number(window.innerHeight||0),Number(P?.height||0)))},pe=()=>{if(!o)return;let r=Math.max(320,Math.round(window.visualViewport?.height||window.innerHeight||640)),m=Math.max(96,Math.min(280,Math.floor(r*.5)-86)),x=Number(o.dataset.maxHeight||m);o.style.height="auto",o.style.height=`${Math.min(x,Math.max(30,o.scrollHeight||30))}px`,o.style.overflowY=o.scrollHeight>x?"auto":"hidden"},me=()=>!!(String(o?.value||"").trim()||j.length),ue=()=>$&&typeof d=="function"&&b&&C,Dt=()=>{if(!X||!n||n.classList.contains("pm-composer-mode-hidden")||n.classList.contains("is-voice-active"))return!1;let r=K||ne?.classList?.contains("pm-keyboard-open"),m=K||document.activeElement===o;return r||m?!1:!n.classList.contains("has-text")&&!n.classList.contains("has-attachments")&&!n.classList.contains("has-pending-question")},ke=()=>{de=performance.now()+900},je=()=>{let r=Number(E?.scrollTop||0),m=r-F;if(F=r,m>=-2)return;let x=performance.now();x<oe||x>de||Dt()&&(Se(),Re(!1,{animate:!0,reason:"scroll"}))},Me=()=>{n&&(n.classList.toggle("is-focused",document.activeElement===o),n.classList.toggle("has-text",!!String(o?.value||"").trim()),n.classList.toggle("has-attachments",j.length>0))},Be=()=>{if(!(!b||!C)){b.hidden=!0;try{C._pmCleanup?.()}catch{}C.innerHTML="",Et(),Y?.target?.kind==="subagent"&&Y.target.agentId===$?.agentId&&(Y.target=null,Y.subagentSubmit=null)}},Fe=async({autoStart:r=!0}={})=>{if(!ue()){B("Voice mode is not available for this composer.","error");return}let m={kind:"subagent",agentId:String($.agentId||"").trim(),label:String($.label||$.name||"Subagent").trim(),voice:$.voice&&typeof $.voice=="object"?$.voice:null};Y.target=m,Y.targetSessionId=`subagent_chat_${m.agentId}`,Y.targetSessionLabel=m.label,Y.targetSessionChannel="subagent",Y.targetSessionForced=!0,Y.subagentSubmit=async x=>d({text:String(x||"").trim(),files:[]}),Ct(m.voice),b.hidden=!1,C.innerHTML="",await _t(C,{inline:!0,inlineChatSessionId:Y.targetSessionId,inlineChatSessionLabel:m.label,autoStart:r,openCameraCapture:k,cameraButton:T})},Re=(r,{animate:m=!0,reason:x="keyboard"}={})=>{!X||!n||!J||(!r&&K&&Se(),n.classList.toggle("pm-composer-mode-hidden",!r),n.setAttribute("aria-hidden",r?"false":"true"),r?n.removeAttribute("inert"):n.setAttribute("inert",""),J.setAttribute("aria-hidden",r?"true":"false"),J.classList.toggle("is-transitioning",m),oe=performance.now()+(x==="keyboard"?1800:420),m&&setTimeout(()=>J.classList.remove("is-transitioning"),360))},Ve=()=>{Re(!0,{reason:"keyboard"}),Ne(),window.requestAnimationFrame(()=>o?.focus({preventScroll:!0}))},Ue=async()=>{if(Re(!0,{reason:"voice"}),ue()){await Fe({autoStart:!0});return}window.requestAnimationFrame(()=>a?.click())};try{ce&&le(ce,Ve),he&&le(he,()=>{Ue().catch(()=>{})})}catch(r){console.warn("[mobile agent chat] mode haptic wiring failed:",r),ce?.addEventListener("click",Ve),he?.addEventListener("click",()=>{Ue().catch(()=>{})})}E?.addEventListener("scroll",je,{passive:!0});for(let r of["touchstart","pointerdown","wheel"])E?.addEventListener(r,ke,V),E!==document&&document.addEventListener(r,ke,V);let ye=()=>{N&&(N.hidden=j.length===0,N.innerHTML=$t(j,!0),N.querySelectorAll("[data-remove-attachment]").forEach(r=>{r.addEventListener("click",()=>{let m=Number(r.getAttribute("data-remove-attachment"));Number.isFinite(m)&&j.splice(m,1),ye(),Q()})}),Me())},Q=()=>{let r=!!h?.(),m=r&&!me();n&&(n.classList.toggle("is-busy",r),n.setAttribute("aria-busy",r?"true":"false"),n.dataset.composerState=r?m?"stopping":"busy":"idle"),o&&(o.placeholder=r?"Queue a message...":p),M&&(M.disabled=!1,M.classList.toggle("is-abort",m),M.classList.toggle("is-voice",!r&&!me()&&ue()),M.title=m?"Stop":!r&&!me()&&ue()?"Start voice mode":r?"Queue message":"Send",M.setAttribute("aria-label",m?"Stop":!r&&!me()&&ue()?"Start voice mode":r?"Queue message":"Send"),M.setAttribute("aria-busy",r?"true":"false"),M.innerHTML=m?'<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><rect x="7" y="7" width="10" height="10" rx="2"/></svg>':!r&&!me()&&ue()?`<img class="pm-send-voice-icon" src="${vt}" alt="" aria-hidden="true" />`:y.send),Me()},Oe=()=>{let r=String(o?.value||"").trim(),m=j.splice(0,j.length);if(o&&(o.value="",H&&(H.text=""),pe()),_||R||I){_=!1,Z+=1,I&&clearTimeout(I),I=null;let x=R;R=null;try{x?.abort?.()}catch{try{x?.stop?.()}catch{}}a?.classList.remove("listening")}return ye(),Q(),{text:r,files:m}},We=({refocus:r=!0}={})=>{_=!1,Z+=1,I&&clearTimeout(I),I=null;let m=R;R=null;try{m?.stop?.()}catch{try{m?.abort?.()}catch{}}a?.classList.remove("listening"),r&&o?.focus(),pe(),Q()},Nt=(r,m=140)=>{I&&clearTimeout(I),I=null,!(!_||R)&&(I=setTimeout(()=>{I=null,Ke(r)},m))},Ke=r=>{if(!(!_||R||!o))try{let m=new r,x=Z,z=String(o.value||"").trimEnd();R=m,m.lang=navigator.language||"en-US",m.interimResults=!0,m.continuous=!0,m.onstart=()=>{x===Z&&a?.classList.add("listening")},m.onresult=D=>{if(x!==Z)return;let se="",Pe="";for(let ve=0;ve<D.results.length;ve+=1){let Ae=String(D.results[ve]?.[0]?.transcript||"");D.results[ve].isFinal?se+=Ae:Pe+=Ae}let be=`${se}${Pe}`.trim();o.value=`${z}${z&&be?" ":""}${be}`,H&&(H.text=o.value||""),pe(),Q()},m.onerror=D=>{if(x!==Z)return;let se=String(D?.error||"unknown");["not-allowed","service-not-allowed","audio-capture"].includes(se)?(_=!1,B(se==="audio-capture"?"The microphone is not available.":"Microphone permission was denied.","error")):["no-speech","aborted"].includes(se)||console.warn("[mobile agent chat] dictation cycle error:",se)},m.onend=()=>{if(x===Z){if(R===m&&(R=null),pe(),Q(),!_){a?.classList.remove("listening");return}Nt(r)}},m.start()}catch(m){R=null,_=!1,a?.classList.remove("listening"),B(m?.message||"Could not start dictation.","error")}};o?.addEventListener("input",()=>{H&&(H.text=o.value||""),pe(),Q()}),o?.addEventListener("focus",()=>{Me(),Ne()}),o?.addEventListener("blur",()=>window.setTimeout(()=>{Me();let r=document.activeElement,m=!!(r&&n?.contains?.(r)),x=Math.max(Number(window.innerHeight||0),Number(document.documentElement?.clientHeight||0)),z=Math.max(0,Number(P?.height||x||0)),D=Math.max(0,x-z)>90||Math.max(0,u-z)>90;if(m||performance.now()<L||D){K&&G();return}Se()},120)),P?.addEventListener("resize",G),P?.addEventListener("scroll",G),window.addEventListener("resize",G,{passive:!0}),window.addEventListener("orientationchange",G),n?.addEventListener("pointerdown",r=>{r.target?.closest?.("button, .pm-haptic-host")&&(L=performance.now()+700)},{passive:!0}),o?.addEventListener("keydown",r=>{r.key==="Enter"&&!r.shiftKey&&(r.preventDefault(),n?.requestSubmit?.())}),o?.addEventListener("paste",async r=>{let m=Array.from(r.clipboardData?.files||[]);if(!m.length)return;String(r.clipboardData?.getData?.("text/plain")||"").trim()||r.preventDefault();let x=await Promise.all(m.slice(0,8).map(ze));j.push(...x.filter(Boolean)),ye(),Q()}),w?.addEventListener("click",()=>O?.click()),a?.addEventListener("click",()=>{let r=window.SpeechRecognition||window.webkitSpeechRecognition;if(!r){B("Speech dictation is not available in this browser.","error");return}if(_){We();return}$e=r,_=!0,Z+=1,a.classList.add("listening"),B("Listening until you tap the mic again.","info"),Ke(r)}),f?.addEventListener("click",Be),T?.addEventListener("click",()=>{typeof k=="function"?k():O?.click()}),O?.addEventListener("change",async()=>{let r=Array.from(O.files||[]).slice(0,8);if(O.value="",!r.length)return;let m=await Promise.all(r.map(ze));j.push(...m.filter(Boolean)),ye(),Q()}),n?.addEventListener("submit",async r=>{if(r.preventDefault(),h?.()&&!me()){c?.(),Q();return}let m=Oe();if(!m.text&&!m.files.length){await Fe({autoStart:!0});return}await g?.(m),Q()});let jt=e._pmCleanup;return e._pmCleanup=()=>{W&&cancelAnimationFrame(W),P?.removeEventListener("resize",G),P?.removeEventListener("scroll",G),window.removeEventListener("resize",G),window.removeEventListener("orientationchange",G),E?.removeEventListener("scroll",je);for(let r of["touchstart","pointerdown","wheel"])E?.removeEventListener(r,ke,V),E!==document&&document.removeEventListener(r,ke,V);fe(),We({refocus:!1}),Be(),jt?.()},requestAnimationFrame(()=>{ye(),pe(),Q()}),{input:o,update:Q,consume:Oe,pending:j}}async function aa(e,s,{standalone:p=!1,team:h=null}={}){e.innerHTML=`
    <div class="${p?"pm-sa-chat-shell pm-team-chat-page-shell":"pm-card"} pm-team-chat-card" id="pm-team-chat-card">
      <div id="pm-team-chat-list" class="pm-team-chat-list${p?" pm-chat-thread pm-sa-chat-scrollport pm-sa-chat-list":""}" aria-live="polite">
        <div class="pm-team-chat-status">Loading team chat&hellip;</div>
      </div>
      <div id="pm-team-chat-queue" class="pm-mobile-queued-prompts" hidden></div>
      <div id="pm-team-chat-goal" class="pm-mobile-goal-strip pm-mobile-goal-strip-inline" hidden></div>
      ${ea("pm-team-chat","Message the team manager...")}
    </div>
  `;let g=e.querySelector("#pm-team-chat-list"),c=e.querySelector("#pm-team-chat-queue"),S=e.querySelector("#pm-team-chat-goal");kt(g,()=>{}),ht(S,gt.activeSessionId,{fallbackToLast:!0});let $=[],d=null,k=null,l=0,n="",o=!1,M=!1,w=[],a=[],b=null;function f(t={}){let i=t?.body&&typeof t.body=="object"?t.body:{},u=t?.metadata&&typeof t.metadata=="object"?t.metadata:{},A=String(t?.from||t?.role||"").toLowerCase(),L=A==="user"||A==="you"||A==="human",E=Wt(String(t?.content||t?.message||t?.text||i.text||""));return{...t,role:L?"user":"agent",from:L?"user":A||"manager",fromLabel:t?.fromLabel||t?.fromName||i.sender||(L?"You":"Manager"),content:E,body:{...i,text:E},createdAt:t?.createdAt||t?.timestamp||t?.ts||Date.now(),processEntries:Array.isArray(t?.processEntries)?t.processEntries:Array.isArray(u.processEntries)?u.processEntries:[]}}function T(t,i){if(i?.role==="user")return"";let u=t?.body&&typeof t.body=="object"?t.body:{},A=t?.metadata&&typeof t.metadata=="object"?t.metadata:{},L=String(t?.agentId||t?.subagentId||t?.memberId||t?.fromId||u.agentId||u.subagentId||A.agentId||A.subagentId||i?.from||"").trim().toLowerCase(),E=String(i?.fromLabel||"").trim().toLowerCase(),de=(Array.isArray(h?.members)?h.members:[]).find(V=>{let U=String(V?.id||"").trim().toLowerCase(),fe=String(V?.name||"").trim().toLowerCase();return L&&(U===L||fe===L)||E&&(U===E||fe===E)}),F=String(de?.id||(L&&!["agent","assistant","manager"].includes(L)?L:"manager")).trim();return`<span class="pm-team-sender-icon" aria-hidden="true">${Ht(F,{scale:.24})}</span>`}function C(t){let i=f(t),u=T(t,i);try{return Mt(i,{sender:i.fromLabel,senderIconHtml:u,chatParity:!0,live:t===d,keepLiveTraceVisible:t===d})}catch(A){console.warn("[mobile team chat] rich message render failed:",A);let L=i.role==="user";return`<div class="pm-msg ${L?"from-user":"from-ai"} pm-agent-chat-msg">
        <div class="pm-bubble">
          ${L?"":`<span class="pm-sender pm-sender-with-icon">${u}<span class="pm-sender-name">${v(i.fromLabel)}</span></span>`}
          <div class="markdown-body">${yt(i.content)}</div>
        </div>
      </div>`}}let O=()=>!!(k||d?.streaming||o),N=(t={})=>{let i=we(t),u=String(i.sessionId||i.sourceSessionId||"").trim();return!!i.id&&(u.startsWith(`team_dm_manager_${s}___`)||u.startsWith(`team_dm_member_${s}___`)||u===`team_chat_${s}`||String(i.teamId||i.toolArgs?.teamId||"").trim()===String(s))},J=(t={})=>{if(!N(t))return!1;let i=we(t),u=a.findIndex(L=>String(L?.approvalRequest?.id||"")===i.id),A={role:"agent",from:"manager",fromLabel:"Manager",content:"",createdAt:Date.now(),approvalRequest:i};return u>=0?a[u]={...a[u],approvalRequest:{...a[u].approvalRequest||{},...i}}:a.push(A),a=a.slice(-8),!0},he=(t,i,u={})=>{let A=String(t||"").trim();if(!A)return!1;let L=a.findIndex(E=>String(E?.approvalRequest?.id||"")===A);return L<0?!1:(a[L].approvalRequest=we({...a[L].approvalRequest||{},...u.approval||u,id:A,status:i}),!0)},ce=async()=>{let t=await Je("pending").catch(()=>[]);(Array.isArray(t)?t:[]).forEach(J)};function ae(){c&&(c.hidden=w.length===0,c.innerHTML=w.length?`<div class="pm-mobile-queued-list">${w.map((t,i)=>`
           <div class="pm-mobile-queued-item">
             <button type="button" class="pm-mobile-queued-text" data-team-queue-edit="${i}">${v(String(t.text||"Attached file(s)").slice(0,120))}${t.files?.length?` <em>+${t.files.length}</em>`:""}</button>
             <div class="pm-mobile-queued-actions">
               <div class="pm-mobile-queued-menu-wrap">
                 <button type="button" class="pm-mobile-queued-icon pm-mobile-queued-menu-trigger" data-team-queue-menu="${i}" aria-label="Queued message actions" title="Actions">${y.dots}</button>
                 <div class="pm-mobile-queued-popover" data-team-queue-menu-popover="${i}" hidden>
                   <button type="button" class="pm-mobile-queued-menu-item pm-mobile-queued-steer" data-team-queue-steer="${i}">${y.target}<span>Steer</span></button>
                   <button type="button" class="pm-mobile-queued-menu-item pm-mobile-queued-remove" data-team-queue-remove="${i}">${y.trash}<span>Delete</span></button>
                 </div>
               </div>
             </div>
           </div>`).join("")}</div>`:"",ft(),c.querySelectorAll("[data-team-queue-edit]").forEach(t=>le(t,()=>{})),c.querySelectorAll("[data-team-queue-menu]").forEach(t=>le(t,()=>{let i=Number(t.getAttribute("data-team-queue-menu"));if(!Number.isInteger(i))return;let u=c.querySelector(`[data-team-queue-menu-popover="${i}"]`);if(!u)return;let A=!!u.hidden;qe(c),u.hidden=!A})),c.querySelectorAll("[data-team-queue-steer]").forEach(t=>le(t,()=>{let i=Number(t.getAttribute("data-team-queue-steer"));if(Number.isFinite(i)&&i>=0&&i<w.length){let[u]=w.splice(i,1);u&&w.unshift(u)}qe(c),ae(),H()})),c.querySelectorAll("[data-team-queue-remove]").forEach(t=>le(t,()=>{let i=Number(t.getAttribute("data-team-queue-remove"));Number.isFinite(i)&&w.splice(i,1),qe(c),ae()})))}function H(){if(O()||!w.length){b?.update?.();return}let t=w.shift();ae(),te(t).catch(i=>B(i?.message||"Send failed","error"))}function j(t){let i=d&&!d._done?d:null;$=Array.isArray(t)?t.slice():[],i&&($.some(A=>String(A.content||A.message||A.text||"").trim()&&String(A.content||A.message||A.text||"").trim()===String(i.content||"").trim())||$.push(i))}function _(){let t=a.filter(u=>String(u?.approvalRequest?.status||"pending")==="pending"),i=[...$,...t];if(!i.length){g.innerHTML='<div style="text-align:center;color:var(--pm-muted);padding:24px 8px;font-size:13px;">No messages yet. Send the first one.</div>';return}Xt(g,i,C),Zt(g),g.querySelectorAll("[data-pm-approval-action][data-pm-approval-id]").forEach(bt),qt(g),g.scrollTop=g.scrollHeight}try{j(await _e(s,80)),await ce(),_()}catch(t){g.innerHTML=`<div style="color:var(--pm-red);padding:16px;">${v(t.message||"Failed to load chat")}</div>`}async function R({forceHistory:t=!1}={}){try{let i=await rt(s,n?l:0);i.stream?.streamId&&i.stream.streamId!==n&&(n=i.stream.streamId,l=0),i.stream?.streamId&&!d&&i.active&&(d={role:"manager",from:"manager",fromLabel:"Manager",content:"",_progress:"Reconnecting...",createdAt:Date.now(),workStartedAt:Date.now(),streaming:!0,processEntries:[]},$.push(d));for(let u of i.events||[])u.streamId&&(n=u.streamId),l=Math.max(l,Number(u.seq||0)),d||(d={role:"manager",from:"manager",fromLabel:"Manager",content:"",_progress:"Reconnecting...",createdAt:Date.now(),workStartedAt:Date.now(),streaming:!0,processEntries:[]},$.push(d)),He(d,Yt(u),"Manager");(t||!i.active||d?._done)&&(j(await _e(s,80)),await ce(),i.active||(d=null)),_()}catch{}}let $e=()=>R({forceHistory:!0}),I=()=>{document.hidden||R({forceHistory:!0})},Z=async(t={})=>{if(String(t.teamId||"")===String(s))try{j(await _e(s,80)),d=null,_()}catch{}},X=(t={})=>{String(t.teamId||"")===String(s)&&(o||(t.streamId&&t.streamId!==n&&(n=t.streamId,l=0),l=Math.max(l,Number(t.seq||0)),d||(d={role:"manager",from:"manager",fromLabel:"Manager",content:"",_progress:"Thinking...",createdAt:Date.now(),workStartedAt:Date.now(),streaming:!0,processEntries:[]},$.push(d)),He(d,{type:String(t.event||""),...t.data||{}},"Manager"),_()))},ne=async(t={})=>{let i=t.approval?we(t.approval,t):await wt(t);J(i)&&_()},ee=t=>(i={})=>{let u=t==="approval_approved"?"approved":t==="approval_denied"?"rejected":t==="approval_expired"?"expired":"failed";he(i.approvalId||i.id||i.approval?.id,u,i)&&_()},P=ee("approval_approved"),xe=ee("approval_denied"),W=ee("approval_expired"),re=ee("approval_failed");q?.on?.("ws:open",$e),q?.on?.("team_chat_message",Z),q?.on?.("team_chat_stream_event",X),q?.on?.("approval_created",ne),q?.on?.("approval_approved",P),q?.on?.("approval_denied",xe),q?.on?.("approval_expired",W),q?.on?.("approval_failed",re);let K=()=>{M||_()};window.addEventListener("prometheus:markdown-ready",K),document.addEventListener("visibilitychange",I),e._pmCleanup=()=>{if(!M){M=!0;try{k?.abort?.()}catch{}q?.off?.("ws:open",$e),q?.off?.("team_chat_message",Z),q?.off?.("team_chat_stream_event",X),q?.off?.("approval_created",ne),q?.off?.("approval_approved",P),q?.off?.("approval_denied",xe),q?.off?.("approval_expired",W),q?.off?.("approval_failed",re),window.removeEventListener("prometheus:markdown-ready",K),document.removeEventListener("visibilitychange",I)}},R();async function te(t){let i=String(t?.text||"").trim(),u=Array.isArray(t?.files)?t.files:[],A=String(t?.source||"").trim(),L=i||(u.length?"Please review the attached file(s).":"");if(!L&&!u.length)return;if(O()){w.push({text:i,files:u,source:A,speak:t?.speak===!0,voice:t?.voice===!0}),ae(),b?.update?.();return}let E=L,oe=u;if(u.length){let F=await xt(u);E=`${L}${St(F)}`,oe=F.map((V,U)=>({...u[U]||{},name:V.name||u[U]?.name||"attachment",kind:V.isImage?"image":V.isVideo?"video":u[U]?.kind||"file",workspacePath:V.workspacePath||u[U]?.workspacePath,path:V.workspacePath||u[U]?.path,dataUrl:u[U]?.dataUrl,mimeType:u[U]?.mimeType,sizeLabel:u[U]?.sizeLabel}))}let de={role:"user",from:"user",content:L,body:{text:L,attachments:oe},attachmentPreviews:oe,createdAt:Date.now()};d={role:"manager",from:"manager",fromLabel:"Manager",content:"",_progress:"Manager is thinking...",createdAt:Date.now(),workStartedAt:Date.now(),streaming:!0,processEntries:[]},$.push(de,d),_(),o=!0,b?.update?.(),k=st(s,{message:E},{onEvent:F=>{He(d,F,"Manager"),_()},onError:F=>{F?.name!=="AbortError"&&(d.content=d.content||`Error: ${F?.message||"stream failed"}`,d._progress="",d.streaming=!1,d.workEndedAt=Date.now(),o=!1,k=null,b?.update?.(),_(),B(F?.message||"Send failed","error"))},onDone:async()=>{d&&(d._progress="",d.streaming=!1,d.workEndedAt=d.workEndedAt||Date.now(),d.workDurationMs=Math.max(0,d.workEndedAt-Number(d.workStartedAt||d.createdAt||d.workEndedAt))),o=!1,k=null,b?.update?.(),await R({forceHistory:!0}),H()}})}b=ta(e,"pm-team-chat",{placeholder:"Message the team manager...",draftKey:"team:manager",isBusy:O,onAbort:()=>{try{k?.abort?.()}catch{}d&&(d._progress="Stopping...",d.streaming=!1),k=null,o=!1,_()},onSubmit:te}),ae()}async function ua(e,{teamId:s,navigate:p}){e.classList.add("pm-agent-chat-page","pm-team-agent-chat-page"),e.dataset.mobileAgentChatRoute="team",document.body.classList.add("pm-mobile-subagent-chat-locked"),document.body.classList.add("pm-mobile-agent-chat-locked"),e.innerHTML=`
    ${Ee({title:"Team Chat",online:!0,leftIcon:"back",hideTitle:!0,hideBrand:!0})}
    <div class="pm-body pm-subagent-chat-body pm-team-chat-page-body" id="pm-team-chat-page-body">
      <div class="pm-card" style="text-align:center;padding:24px;color:var(--pm-muted);">Loading team chat&hellip;</div>
    </div>
  `,Ce(e,{onBack:()=>p?.(`#mobile/teams/${encodeURIComponent(s)}`)});let h=e.querySelector("#pm-team-chat-page-body"),g=e.querySelector(".pm-model-badge .pm-model-badge-label"),c=!1;e._pmCleanup=()=>{if(!c){c=!0;try{h?._pmCleanup?.()}catch{}document.body.classList.remove("pm-mobile-agent-chat-locked","pm-mobile-subagent-chat-locked")}};try{let S=await Le(s);if(!S)throw new Error("Team not found");if(c||e.isConnected===!1)return;g&&(g.textContent=S.name),await aa(h,s,{standalone:!0,team:S})}catch(S){h.innerHTML=`<div class="pm-empty"><div class="pm-empty-icon">${y.users}</div><h2>Couldn\u2019t load team chat</h2><p>${v(S?.message||"Network error")}</p></div>`}}function na(e){let s=String(e||"").toLowerCase();return/\.(md|markdown|txt)$/.test(s)?"\u{1F4DD}":/\.(js|ts|tsx|jsx|mjs|cjs)$/.test(s)?"\u{1F4DC}":/\.(json|yaml|yml|toml)$/.test(s)?"\u{1F527}":/\.(png|jpg|jpeg|gif|svg|webp)$/.test(s)?"\u{1F5BC}\uFE0F":/\.(mp4|mov|webm|mkv)$/.test(s)?"\u{1F3AC}":/\.(mp3|wav|ogg|flac)$/.test(s)?"\u{1F3B5}":/\.(html|htm)$/.test(s)?"\u{1F310}":/\.(pdf)$/.test(s)?"\u{1F4C4}":"\u{1F4C3}"}function ra(e){return!e||e<1024?`${e||0} B`:e<1024*1024?`${(e/1024).toFixed(1)} KB`:`${(e/(1024*1024)).toFixed(2)} MB`}async function sa(e,s){e.innerHTML='<div class="pm-card" style="text-align:center;padding:24px;color:var(--pm-muted);">Loading workspace\u2026</div>';let p;try{p=await ot(s)}catch(a){e.innerHTML=`<div class="pm-empty"><div class="pm-empty-icon">${y.doc}</div><h2>Couldn\u2019t load workspace</h2><p>${v(a.message||"")}</p></div>`;return}let h=/^(Brain|audit|memory|temp)[\\/]|(^|[\\/])(tool_audit\.log|team-notes\.jsonl|last_run\.json|memory\.json|pending\.json)$/i,g=a=>String(a.relativePath||a.relpath||a.name||a.path||""),c=(p.files||[]).slice().sort((a,b)=>Number(b.modifiedAt||0)-Number(a.modifiedAt||0)),S=c.filter(a=>!h.test(g(a))),$=S.length===0;if(!c.length){e.innerHTML=`<div class="pm-empty"><div class="pm-empty-icon">${y.doc}</div><h2>Workspace is empty</h2><p>Files written by team subagents will appear here.</p></div>`;return}let d=$?c:S;e.innerHTML=`
    <div class="pm-card" style="padding:10px 12px 12px;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
        <strong style="font-size:13px;" id="pm-ws-count"></strong>
        ${c.length>S.length&&S.length?'<button type="button" class="pm-show-more" id="pm-ws-runtime-toggle">Show runtime files</button>':""}
      </div>
      ${p.workspacePath?`<div title="${v(p.workspacePath)}" style="font-size:11px;color:var(--pm-muted);font-family:ui-monospace,monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;direction:rtl;text-align:left;margin-bottom:8px;">${v(p.workspacePath)}</div>`:""}
      <div id="pm-ws-list" style="display:flex;flex-direction:column;gap:6px;"></div>
      <div id="pm-ws-preview" style="margin-top:12px;display:none;"></div>
    </div>
  `;let k=e.querySelector("#pm-ws-list"),l=e.querySelector("#pm-ws-preview"),n=e.querySelector("#pm-ws-count"),o=e.querySelector("#pm-ws-runtime-toggle"),M=()=>{d=$?c:S,n&&(n.textContent=$||!S.length?`${c.length} file${c.length===1?"":"s"}`:`${S.length} project file${S.length===1?"":"s"}`),o&&(o.textContent=$?"Hide runtime files":`Show runtime files (${c.length-S.length})`),k.innerHTML=d.map(a=>{let b=g(a),f=a.size||0,T=a.modifiedAt||a.updatedAt;return`
      <button type="button" data-rel="${v(b)}" style="display:flex;align-items:center;gap:10px;width:100%;text-align:left;color:var(--pm-text);background:var(--pm-bg-soft);border:1px solid var(--pm-border);border-radius:12px;padding:10px 12px;cursor:pointer;font-family:inherit;">
        <span style="font-size:18px;">${na(b)}</span>
        <span style="flex:1;min-width:0;overflow:hidden;">
          <span style="display:block;font-weight:700;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${v(b)}</span>
          <span style="display:block;font-size:11px;color:var(--pm-muted);">${ra(f)}${T?" \xB7 "+ge(typeof T=="number"?T:new Date(T).getTime()):""}</span>
        </span>
        <span style="color:var(--pm-muted);">${y.chev}</span>
      </button>
    `}).join(""),w()};o?.addEventListener("click",()=>{$=!$,M()});function w(){k.querySelectorAll("[data-rel]").forEach(a=>{a.addEventListener("click",async()=>{let b=a.getAttribute("data-rel");l.style.display="block",l.innerHTML=`<div class="pm-card-body" style="padding:14px;color:var(--pm-muted);">Loading ${v(b)}\u2026</div>`;try{let f=await it(s,b),T=f?.content||f?.body||"";l.innerHTML=`
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
            <strong style="flex:1;font-size:13px;">${v(b)}</strong>
            <button class="pm-btn ghost" id="pm-ws-close" style="padding:4px 10px;font-size:12px;">\u2715 Close</button>
          </div>
          <pre style="background:var(--pm-bg-soft);border:1px solid var(--pm-border);border-radius:10px;padding:12px;font-size:12px;line-height:1.5;font-family:ui-monospace,monospace;white-space:pre-wrap;word-break:break-word;max-height:60vh;overflow:auto;margin:0;">${v(String(T).slice(0,5e4))}${String(T).length>5e4?`

\u2026(truncated)`:""}</pre>
        `,l.querySelector("#pm-ws-close").addEventListener("click",()=>{l.style.display="none",l.innerHTML=""}),l.scrollIntoView({behavior:"smooth",block:"nearest"})}catch(f){l.innerHTML=`<div class="pm-card-body" style="color:var(--pm-red);">${v(f.message||"Failed to load file")}</div>`}})})}M()}async function oa(e,s,p){e.innerHTML='<div class="pm-card" style="text-align:center;padding:24px;color:var(--pm-muted);">Loading memory\u2026</div>';let h=null;try{h=await Te(s)}catch{}if(h){let n=a=>String(a||"").replace(/\[DURABLE_TURN_COMMENTARY\][\s\S]*$/,"").replace(/\*\*/g,"").trim(),o=(Array.isArray(h.artifacts)?h.artifacts:[]).slice().reverse().slice(0,12),M=(Array.isArray(h.blockers)?h.blockers:[]).slice().reverse().slice(0,8),w=(Array.isArray(h.recentEvents)?h.recentEvents:[]).filter(a=>a&&a.category!=="tool"&&n(a.content)).slice().reverse().slice(0,15);if(o.length||M.length||w.length){let a=(f,T)=>T?`<div style="font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;color:var(--pm-muted);margin:14px 4px 6px;">${f}</div>${T}`:"",b=f=>f?ge(typeof f=="number"?f:new Date(f).getTime()):"";e.innerHTML=`
        ${a(`Blockers (${M.length})`,M.map(f=>`
          <article class="pm-card" style="padding:10px 12px;border-color:var(--pm-red);">
            <div class="pm-card-body">${v(n(f.content||f.reason||f.title||"Blocker"))}</div>
            <div style="font-size:11px;color:var(--pm-muted);margin-top:4px;">${v(f.agentName||f.agentId||"")} ${b(f.createdAt||f.timestamp)}</div>
          </article>`).join(""))}
        ${a(`Artifacts (${o.length})`,o.map(f=>`
          <article class="pm-card" style="padding:10px 12px;">
            <div style="display:flex;gap:8px;align-items:center;">
              <strong style="flex:1;font-size:13px;line-height:1.3;">${v(f.name||f.title||"Artifact")}</strong>
              <span style="font-size:11px;color:var(--pm-muted);white-space:nowrap;">${b(f.createdAt||f.timestamp)}</span>
            </div>
            ${f.description?`<div class="pm-card-body" style="font-size:13px;margin-top:4px;">${v(String(f.description).slice(0,220))}</div>`:""}
            ${f.path?`<div title="${v(f.path)}" style="font-size:11px;color:var(--pm-muted);font-family:ui-monospace,monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;direction:rtl;text-align:left;margin-top:4px;">${v(f.path)}</div>`:""}
          </article>`).join(""))}
        ${a("Recent activity",w.map(f=>`
          <article class="pm-card" style="padding:10px 12px;">
            <div style="display:flex;gap:8px;align-items:center;margin-bottom:4px;">
              <strong style="flex:1;font-size:13px;">${v(f.actorName||f.actorType||"Team")}</strong>
              <span style="font-size:11px;color:var(--pm-muted);white-space:nowrap;">${b(f.timestamp)}</span>
            </div>
            <div class="pm-card-body" style="font-size:13px;display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden;">${v(n(f.content).slice(0,400))}</div>
          </article>`).join(""))}
      `;return}}let g;try{g=await lt()}catch(n){e.innerHTML=`<div class="pm-empty"><div class="pm-empty-icon">${y.brain}</div><h2>Couldn\u2019t load memory</h2><p>${v(n.message||"")}</p></div>`;return}let c=Array.isArray(g?.nodes)?g.nodes.slice():[],S=String(s).toLowerCase(),$=String(p?.name||"").toLowerCase(),d=n=>{let o=String(n.sourcePath||"").toLowerCase(),M=String(n.projectId||"").toLowerCase();return M&&M.includes(S)||o&&(o.includes(S)||$&&o.includes($))},k=c.filter(d),l=(k.length?k:c).sort((n,o)=>String(o.timestamp||"").localeCompare(String(n.timestamp||""))).slice(0,30);if(!l.length){e.innerHTML=`<div class="pm-empty"><div class="pm-empty-icon">${y.brain}</div><h2>No memory yet</h2><p>As the team works, reflections and memory entries land here.</p></div>`;return}e.innerHTML=`
    <div style="display:flex;align-items:center;gap:8px;padding:6px 4px 10px;color:var(--pm-muted);font-size:12px;">
      <span class="pm-pill ${k.length?"orange":"gray"}">${k.length?"team-scoped":"global feed"}</span>
      <span>${l.length} of ${c.length} entries</span>
    </div>
    ${l.map(n=>`
      <article class="pm-card" style="padding:12px 14px;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
          <strong style="flex:1;font-size:13px;line-height:1.3;">${v(n.label||"Memory")}</strong>
          <span class="pm-pill gray" style="font-family:ui-monospace,monospace;">${v(n.sourceTypeLabel||n.sourceType||"memory")}</span>
        </div>
        ${n.summary?`<div class="pm-card-body" style="margin-bottom:4px;">${v(String(n.summary).slice(0,240))}${String(n.summary).length>240?"\u2026":""}</div>`:""}
        <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--pm-muted);">
          <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:70%;font-family:ui-monospace,monospace;">${v(n.sourcePath||"")}</span>
          <span>${n.timestamp?ge(new Date(n.timestamp).getTime()):""}</span>
        </div>
      </article>
    `).join("")}
  `}export{pa as a,ma as b,Kt as c,Yt as d,Zt as e,Xt as f,ea as g,ta as h,ua as i};
