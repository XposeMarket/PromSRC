import{A as kt,C as Y,E as Mt,F as Lt,J as At,K as Tt,L as _t,O as Et,Q as Ct,c as mt,f as ut,g as vt,h as Ce,i as gt,j as ht,l as be,m as ft,o as yt,p as bt,q as je,r as wt,s as $t,t as xt,u as qe,v as St}from"./chunk-JZC7FS33.js";import{b as ve}from"./chunk-J5HXEABW.js";import{a as B}from"./chunk-35CAQ6TV.js";import{H as y,I as u,O as _e,P as Ee}from"./chunk-5EVPYLUY.js";import{e as ie}from"./chunk-QRT4XV37.js";import{a as ct,b as dt,c as pt}from"./chunk-LXAE2DH2.js";import{La as lt,Q as Pe,R as Ye,S as Le,T as Je,U as Ze,V as Xe,X as et,Y as Ae,Z as tt,_ as Te,aa as at,ba as nt,c as Ge,ca as rt,da as st,ea as ot,ga as it,s as Qe}from"./chunk-AXH4665B.js";import{a as q}from"./chunk-4RINRH4P.js";function Ft(e){let r=e.house==="blue"?"#4a82d1":"#a4682b";return`
    <button class="pm-team-tile ${e.featured?"featured":""}" data-team="${e.id}">
      ${e.featured?'<span class="pm-star">\u2605</span>':""}
      <span class="pm-house" style="color:${r}">\u{1F3E0}</span>
      <span class="pm-team-name">${u(e.name)}</span>
      <span class="pm-team-agents">${y.users} ${e.agents} agents</span>
    </button>
  `}function qt(){return`<div class="pm-team-grid">${'<div class="pm-team-tile" style="opacity:.55"><span class="pm-house" style="opacity:.4">\u{1F3E0}</span><span class="pm-team-name" style="background:rgba(0,0,0,.06);color:transparent;border-radius:6px;height:16px;width:80%;">loading</span></div>'.repeat(4)}</div>`}async function la(e,{navigate:r}){let d=`
    <span class="pm-count-pill" id="pm-teams-count">\u2026</span>
    <span class="pm-spacer"></span>
    <button class="pm-icon-btn" id="pm-teams-refresh" aria-label="Refresh" style="background:var(--pm-surface);border:1px solid var(--pm-border);">${y.refresh}</button>
  `,h=_e({title:"Teams",online:!1,extras:d});e.innerHTML=`
    ${h}
    <div class="pm-body" id="pm-teams-body">${qt()}</div>
  `,Ee(e,{});let g=e.querySelector("#pm-teams-body"),p=e.querySelector("#pm-teams-count"),x=e.querySelector("#pm-teams-refresh");async function $({force:k=!1}={}){let l=[];try{l=await Ye({force:k})}catch(w){g.innerHTML=`<div class="pm-empty"><div class="pm-empty-icon">${y.users}</div><h2>Couldn\u2019t load teams</h2><p>${u(w.message||"Network error")}</p></div>`,p.textContent="0 teams";return}if(p.textContent=`${l.length} team${l.length===1?"":"s"}`,!l.length){g.innerHTML=`<div class="pm-empty"><div class="pm-empty-icon">${y.users}</div><h2>No teams yet</h2><p>Create your first team from the desktop app.</p></div>`;return}let n=l.find(w=>w.featured)||l[0],o=null;try{o=await Le(n.id)}catch{}let M=o?`
      <div class="pm-team-preview">
        <div class="pm-team-preview-head">
          <span class="pm-mini-house">${u(o.emoji||"\u{1F3E0}")}</span>
          <h3>${u(o.name)}</h3>
          <button class="pm-pill-btn" data-go="${u(o.id)}">View Team ${y.chev}</button>
        </div>
        <div style="font-size:13px;color:var(--pm-muted);font-weight:700;margin-top:4px;">Team members</div>
        <div class="pm-chip-row">
          ${o.members.map(w=>`<span class="pm-member-chip"><span class="pm-avatar" style="background:${w.color}">${w.avatar}</span>${u(w.name)}</span>`).join("")}
        </div>
        <div class="pm-divider"></div>
        <button type="button" class="pm-row pm-row-link" data-go-ws="${u(o.id)}"><span>\u{1F5C2}\uFE0F Workspace</span><span style="color:var(--pm-muted);display:inline-flex;align-items:center;gap:4px;">Open ${y.chev}</span></button>
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
      <div class="pm-team-grid">${l.map(Ft).join("")}</div>
      ${M}
    `,g.querySelectorAll("[data-team]").forEach(w=>{w.addEventListener("click",()=>r(`#mobile/teams/${w.getAttribute("data-team")}`))}),g.querySelectorAll("[data-go]").forEach(w=>{w.addEventListener("click",()=>r(`#mobile/teams/${w.getAttribute("data-go")}`))}),g.querySelectorAll("[data-go-ws]").forEach(w=>{w.addEventListener("click",()=>r(`#mobile/teams/${encodeURIComponent(w.getAttribute("data-go-ws"))}/workspace`))})}x.addEventListener("click",()=>{Pe(),g.innerHTML=qt(),$({force:!0})});let c=Ge("teams_raw",216e5);await $(),Array.isArray(c)&&$({force:!0}).catch(()=>{})}function Vt(){return`
    <div class="pm-detail-head"><span class="pm-house-icon">\u{1F3E0}</span><h1 style="background:rgba(0,0,0,.06);color:transparent;border-radius:8px;height:24px;flex:1;">loading</h1></div>
    <div class="pm-detail-sub">\u2026</div>
    <div class="pm-action-row">
      <button class="pm-action-btn primary">${y.play} Start Run</button>
      <button class="pm-action-btn">${y.pause} Pause</button>
      <button class="pm-action-btn">${y.brain} Review</button>
      <button class="pm-action-btn danger">${y.trash} Delete</button>
    </div>
    <div class="pm-card" style="opacity:.5"><div class="pm-card-head">${y.target} Purpose</div><div class="pm-card-body">Loading team\u2026</div></div>
  `}async function ca(e,{teamId:r,navigate:d,initialTab:h=""}){e.innerHTML=`
    ${_e({title:"Team",online:!0,leftIcon:"back",hideTitle:!0,hideBrand:!0})}
    <div class="pm-body pm-subagent-detail-body pm-team-detail-body" id="pm-detail-body">${Vt()}</div>
  `,Ee(e,{onBack:()=>d("#mobile/teams")});let g=e.querySelector("#pm-detail-body"),p=null;try{p=await Le(r)}catch(a){g.innerHTML=`<div class="pm-empty"><div class="pm-empty-icon">${y.users}</div><h2>Couldn\u2019t load team</h2><p>${u(a.message||"Network error")}</p></div>`;return}if(!p){g.innerHTML=`<div class="pm-empty"><div class="pm-empty-icon">${y.users}</div><h2>Team not found</h2><p>This team isn\u2019t available right now.</p></div>`;return}let x=["Context","Subagents","Workspace","Memory","Runs","Team Chat"];g.innerHTML=`
    <div class="pm-detail-head">
      <span class="pm-house-icon">${u(p.emoji||"\u{1F3E0}")}</span>
      <h1>${u(p.name)}</h1>
      <button class="pm-icon-btn pm-overflow" aria-label="More">${y.dots}</button>
    </div>
    <div class="pm-detail-sub">${p.subagents} subagents \xB7 ${p.totalRuns} total runs</div>

    <div class="pm-action-row">
      <button class="pm-action-btn primary" data-act="start">${y.play} Start Run</button>
      <button class="pm-action-btn"          data-act="pause">${p.paused?y.play+" Resume":y.pause+" Pause"}</button>
      <button class="pm-action-btn"          data-act="chat">${y.chat} Chat</button>
      <button class="pm-action-btn danger"   data-act="delete">${y.trash} Delete</button>
    </div>

    <div class="pm-tabs" role="tablist">
      ${x.map((a,b)=>`<button class="${b===0?"active":""}" data-tab="${a}">${u(a)}</button>`).join("")}
    </div>

    <div id="pm-tab-slot"></div>

    <div id="pm-context-slot">
    <div class="pm-team-preview">
      <div class="pm-team-preview-head">
        <span class="pm-mini-house">${u(p.emoji||"\u{1F3E0}")}</span>
        <h3>${u(p.name)}</h3>
      </div>
      <div style="font-size:13px;color:var(--pm-muted);">${p.subagents} subagents \xB7 ${p.totalRuns} total runs</div>
      <div class="pm-chip-row">
        ${p.members.map(a=>`<span class="pm-member-chip"><span class="pm-avatar" style="background:${a.color}">${a.avatar}</span>${u(a.name)}</span>`).join("")}
      </div>
    </div>

    <div class="pm-card">
      <div class="pm-card-head" style="display:flex;justify-content:space-between;align-items:center;">
        <span>${y.target} Purpose</span>
        <button class="pm-show-more" data-toggle-purpose>Show more \u25BE</button>
      </div>
      <div class="pm-card-body" data-purpose data-collapsed="1" style="display:-webkit-box;-webkit-line-clamp:6;-webkit-box-orient:vertical;overflow:hidden;">${u(p.purpose)}</div>
    </div>

    <div class="pm-card-grid">
      <div class="pm-card">
        <div class="pm-card-head">${y.check} Current Task / Goal</div>
        <div class="pm-card-body">${u(p.currentTask)}</div>
      </div>
      <div class="pm-card">
        <div class="pm-card-head">${y.clock} Last Run</div>
        <div class="pm-card-body strong">${u(p.lastRun)}</div>
      </div>
      <div class="pm-card">
        <div class="pm-card-head">${y.users} Member States</div>
        <div class="pm-card-body" data-member-states>${u(p.memberStates)}</div>
      </div>
      <div class="pm-card">
        <div class="pm-card-head">${y.send} Active Dispatches</div>
        <div class="pm-card-body" data-dispatches>${u(p.dispatches)}</div>
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
        <a href="#mobile/teams/${u(r)}/workspace" style="color:var(--pm-orange);font-weight:700;text-decoration:none;font-size:13px;">Open Workspace \u203A</a>
      </div>
      <div class="pm-card-body">${u(p.workspace)}</div>
    </div>
    </div><!-- /pm-context-slot -->
  `;let $=g.querySelector("#pm-context-slot"),c=g.querySelector("#pm-tab-slot");async function k(a){try{c?._pmCleanup?.()}catch{}if(c&&(c._pmCleanup=null),g.querySelectorAll(".pm-tabs button").forEach(b=>b.classList.toggle("active",b.getAttribute("data-tab")===a)),a==="Context"){$.style.display="",c.innerHTML="";return}$.style.display="none",c.innerHTML=`<div class="pm-card" style="text-align:center;padding:24px;color:var(--pm-muted);">Loading ${u(a)}\u2026</div>`;try{if(a==="Subagents")await Rt(c,p);else if(a==="Runs")await Kt(c,r);else if(a==="Team Chat"){d(`#mobile/teams/${encodeURIComponent(r)}/chat`);return}else a==="Workspace"?await na(c,r):a==="Memory"&&await ra(c,r,p)}catch(b){c.innerHTML=`<div class="pm-card"><div class="pm-card-head">${y.users} Error</div><div class="pm-card-body">${u(b.message||"Failed to load")}</div></div>`}}g.querySelectorAll(".pm-tabs button").forEach(a=>{a.addEventListener("click",()=>k(a.getAttribute("data-tab")))}),Ae(r).then(a=>{if(!a)return;let b=I=>(p.members||[]).find(J=>J.id===I)?.name||I,f=g.querySelector("[data-member-states]"),T=Object.entries(a.memberStates||{});f&&T.length&&(f.innerHTML=T.map(([I,J])=>`<div style="display:flex;justify-content:space-between;gap:8px;"><span>${u(b(I))}</span><span style="color:var(--pm-muted)">${u(String(J?.status||"idle"))}</span></div>`).join(""));let C=g.querySelector("[data-dispatches]"),O=Array.isArray(a.activeDispatches)?a.activeDispatches:[];C&&(C.textContent=O.length?`${O.map(I=>b(String(I.agentId||I.subagentId||""))).join(", ")} working`:"No active dispatches.")}).catch(()=>{});let l=x.find(a=>a.toLowerCase().replace(/\s+/g,"-")===String(h||"").toLowerCase());l&&l!=="Context"&&k(l);let n=g.querySelector("[data-toggle-purpose]"),o=g.querySelector("[data-purpose]");n&&o&&n.addEventListener("click",()=>{o.getAttribute("data-collapsed")==="1"?(o.style.webkitLineClamp="unset",o.style.display="block",o.setAttribute("data-collapsed","0"),n.textContent="Show less \u25B4"):(o.style.display="-webkit-box",o.style.webkitLineClamp="6",o.setAttribute("data-collapsed","1"),n.textContent="Show more \u25BE")});async function M(a,b,f){let T=a.innerHTML;a.disabled=!0,a.style.opacity="0.6";try{let C=await b();if(!C||C.success===!1)throw new Error(C?.error||"Failed");return B(f,"success"),C}catch(C){throw B(C.message||"Action failed","error"),C}finally{a.disabled=!1,a.style.opacity="",a.innerHTML=T}}g.querySelectorAll("[data-act]").forEach(a=>{let b=a.getAttribute("data-act");a.addEventListener("click",async()=>{if(b==="start")await M(a,()=>Je(r),"Run started").catch(()=>{});else if(b==="pause"){let f=p.paused;try{await M(a,()=>f?Xe(r):Ze(r),f?"Team resumed":"Team paused"),p.paused=!f,a.innerHTML=p.paused?`${y.play} Resume`:`${y.pause} Pause`}catch{}}else if(b==="chat")d(`#mobile/teams/${encodeURIComponent(r)}/chat`);else if(b==="delete"){if(!window.confirm(`Delete team "${p.name}"? This cannot be undone.`))return;try{await M(a,()=>et(r),"Team deleted"),Pe(),d("#mobile/teams")}catch{}}})});let w=g.querySelector("[data-save-ref]");w&&w.addEventListener("click",async()=>{let a=g.querySelector("#pm-ref-title"),b=g.querySelector("#pm-ref-body"),f=(a.value||"").trim(),T=(b.value||"").trim();if(!f||!T){B("Title and content required","error");return}try{await M(w,()=>lt(r,f,T),"Reference saved"),a.value="",b.value=""}catch{}}),e._pmCleanup=()=>{try{c?._pmCleanup?.()}catch{}}}var Ht={working:{label:"working",cls:"running"},active:{label:"active",cls:"active"},ready:{label:"ready",cls:"active"},idle:{label:"idle",cls:"gray"},blocked:{label:"blocked",cls:"orange"},paused:{label:"paused",cls:"gray"},awaiting:{label:"awaiting",cls:"orange"},offline:{label:"offline",cls:"gray"}};function Ut(e){let r=/^Goal update \(([a-z_]+)\):\s*(\{[\s\S]*\})\s*$/.exec(String(e||"").trim());if(!r)return e;let d;try{d=JSON.parse(r[2])}catch{return e}let h=g=>String(g??"").replace(/\s+/g," ").trim();switch(r[1]){case"log_completed":return`\u2705 Logged as done: ${h(d.entry??d.completed??d.text)}`;case"set_focus":return`\u{1F3AF} Focus set: ${h(d.focus??d.current_focus??d.text)}`;case"pause_agent":return`\u23F8 Paused ${h(d.agent_id)}`;case"unpause_agent":return`\u25B6 Resumed ${h(d.agent_id)}`;default:return`Goal update (${r[1]})`}}function Ot(e){if(!e||e<0)return"\u2014";let r=Math.floor(e/1e3);return r<60?`${r}s`:`${Math.floor(r/60)}m ${r%60}s`}async function Rt(e,r){let d=null;try{d=await Ae(r.id)}catch{}let h=d?.memberStates||{},g=Array.isArray(d?.activeDispatches)?d.activeDispatches:[],p=new Map;for(let l of g){let n=String(l.agentId||l.subagentId||"").trim();n&&p.set(n,l)}let x=r.members.filter(l=>l.id!=="manager"),$=new Map((await Promise.all(x.map(async l=>{let n=await it(l.id).catch(()=>null);return[l.id,n]}))).filter(([,l])=>l)),c=[],k=x.map(l=>{let n=h[l.id]||{},o=Ht[String(n.status||"idle").toLowerCase()]||Ht.idle,M=p.get(l.id),w=$.get(l.id),a=`pm-team-member-model-${r.id}-${l.id}`.replace(/[^a-zA-Z0-9_-]/g,"-");return w&&c.push({pickerScope:a,agent:w}),`
      <article class="pm-card pm-team-member-card">
        <div class="pm-schedule-head" style="margin-bottom:8px;">
          <span class="pm-emoji" style="font-size:22px;">${l.avatar}</span>
          <h3 style="margin:0;">${u(l.name)}</h3>
          <span class="pm-pill ${o.cls}">${o.label}</span>
        </div>
        ${n.currentTask?`<div class="pm-card-body" style="margin-bottom:6px;"><strong>Current:</strong> ${u(n.currentTask)}</div>`:""}
        ${n.blockedReason?`<div class="pm-card-body" style="color:var(--pm-red);margin-bottom:6px;"><strong>Blocked:</strong> ${u(n.blockedReason)}</div>`:""}
        ${n.lastResult?`<div class="pm-card-body" style="font-size:13px;color:var(--pm-muted);margin-bottom:6px;">Last: ${u(String(n.lastResult).slice(0,140))}${String(n.lastResult).length>140?"\u2026":""}</div>`:""}
        <div style="display:flex;justify-content:space-between;align-items:center;font-size:12px;color:var(--pm-muted);">
          <span>${M?"\u{1F4E1} dispatched":"Last update"}</span>
          <span>${ve(n.lastUpdateAt||M?.startedAt)}</span>
        </div>
        ${w?`<details class="pm-model-details"><summary>Model settings</summary>${ct(w,a)}</details>`:""}
      </article>
    `}).join("");e.innerHTML=k||`<div class="pm-empty"><div class="pm-empty-icon">${y.robot}</div><h2>No subagents yet</h2><p>Add members from the desktop team editor.</p></div>`,c.forEach(({pickerScope:l,agent:n})=>{pt(l,()=>Rt(e,r)),dt(l,n)})}function Wt(e){return e.inProgress?'<span class="pm-pill running">running</span>':e.success===!0?'<span class="pm-pill active">success</span>':e.success===!1&&e.taskStatus?`<span class="pm-pill orange">${u(String(e.taskStatus))}</span>`:'<span class="pm-pill gray">complete</span>'}async function Kt(e,r){let{runs:d}=await tt(r,30);if(!d.length){e.innerHTML=`<div class="pm-empty"><div class="pm-empty-icon">${y.clock}</div><h2>No runs yet</h2><p>Start a run from the top of this page.</p></div>`;return}e.innerHTML=d.map(h=>`
    <article class="pm-card" style="padding:14px 16px;">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
        <strong style="flex:1;font-size:14px;">${u(h.agentName||h.agentId||"Agent")}</strong>
        ${Wt(h)}
      </div>
      ${h.taskSummary?`<div class="pm-card-body" style="margin-bottom:6px;">${u(String(h.taskSummary).slice(0,200))}${String(h.taskSummary).length>200?"\u2026":""}</div>`:""}
      <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--pm-muted);">
        <span>${u(h.trigger||"manual")} \xB7 ${h.stepCount||0} steps</span>
        <span>${ve(h.startedAt)} \xB7 ${Ot(h.durationMs)}</span>
      </div>
    </article>
  `).join("")}function Gt(e){return e?{type:String(e.type||e.event||""),...e.data||{}}:null}async function Qt(e){try{if(!navigator.clipboard?.writeText)throw new Error("clipboard unavailable");return await navigator.clipboard.writeText(e),B("Message copied","success"),!0}catch{let r=document.createElement("textarea");r.value=e,r.setAttribute("readonly",""),r.style.position="fixed",r.style.opacity="0",document.body.appendChild(r),r.select();try{let d=document.execCommand("copy");return B(d?"Message copied":"Copy failed",d?"success":"error"),!!d}catch{return B("Copy failed","error"),!1}finally{r.remove()}}}function Yt(e){!e||e.dataset.pmAgentActionsWired==="1"||(e.dataset.pmAgentActionsWired="1",e.addEventListener("click",r=>{let d=r.target?.closest?.("[data-pm-agent-msg-action]");if(!d||!e.contains(d))return;let h=String(d.dataset.pmAgentMsgAction||""),g=String(d.closest(".pm-msg")?.querySelector(":scope > .pm-bubble > .markdown-body")?.innerText||"").trim();if(g){if(h==="copy"){Qt(g);return}if(h==="speak")try{Lt(),Mt(g)}catch{}}}))}function Jt(e,r,d){if(!e)return;let h=new Set,g=new Set;e.querySelectorAll(".pm-agent-chat-msg").forEach((p,x)=>{p.querySelector(".pm-trace-drawer.open")&&h.add(x),p.querySelectorAll("details.pm-trace-tool-group[open]").forEach((c,k)=>{g.add(`${x}:${c.getAttribute("data-pm-trace-group")||k}`)})}),e.innerHTML=r.map(d).join(""),e.querySelectorAll(".pm-agent-chat-msg").forEach((p,x)=>{let $=p.querySelector(".pm-trace-drawer"),c=p.querySelector('[data-expandable="trace"]');$&&h.has(x)&&($.classList.add("open"),c?.classList.add("expanded")),p.querySelectorAll("details.pm-trace-tool-group").forEach((k,l)=>{let n=`${x}:${k.getAttribute("data-pm-trace-group")||l}`;g.has(n)&&!k.closest('.pm-trace-drawer[data-trace-completed="1"]')&&k.setAttribute("open","")})}),kt(e)}var De={};function Zt(e,r){let d=String(e||"pm-agent-chat"),h=d==="pm-team-chat"||d==="pm-sa-chat";return`
    ${h?`<div class="pm-chat-mode-launcher pm-agent-chat-mode-launcher" id="${d}-mode-launcher" role="group" aria-label="Choose chat input">
      <button type="button" class="pm-chat-mode-button pm-chat-mode-button--voice" id="${d}-mode-voice" aria-label="Start voice mode">${y.micSmall}<span class="pm-chat-mode-button-label">Voice mode</span></button>
      <button type="button" class="pm-chat-mode-button pm-chat-mode-button--keyboard" id="${d}-mode-keyboard" aria-label="Open keyboard composer">${y.keyboard}<span class="pm-chat-mode-button-label">Keyboard composer</span></button>
    </div>`:""}
    <form class="pm-composer pm-agent-chat-composer${h?" pm-composer-mode-hidden":""}" id="${d}-form"${h?' aria-hidden="true" inert':""}>
      <span class="pm-glass-lens" aria-hidden="true"></span>
      <span class="pm-glass-border" aria-hidden="true"></span>
      <input id="${d}-file-input" type="file" multiple accept="image/*,video/*,.mp4,.mov,.m4v,.webm,.avi,.mkv,.txt,.md,.json,.csv,.tsv,.log,.xml,.html,.css,.js,.ts,.tsx,.jsx,.py,.yaml,.yml,application/pdf" hidden />
      <div class="pm-attach-tray" id="${d}-attach-tray" hidden></div>
      <div class="pm-composer-row">
        <button type="button" class="pm-icon-btn" id="${d}-attach-btn" aria-label="Attach files">${y.paperclip}</button>
        <div class="pm-composer-input-wrap" id="${d}-input-wrap">
          <textarea class="pm-composer-input" id="${d}-input" rows="1" placeholder="${u(r)}" aria-label="Message" autocomplete="off" autocapitalize="sentences" enterkeyhint="send"></textarea>
        </div>
        <button type="button" class="pm-icon-btn" id="${d}-mic-btn" aria-label="Voice input">${y.micSmall}</button>
        <button type="submit" class="pm-send" id="${d}-send-btn" aria-label="Send">${y.send}</button>
      </div>
      <div class="pm-chat-voice-shell" id="${d}-voice-shell" hidden>
        <button type="button" class="pm-chat-voice-camera" id="${d}-voice-camera" aria-label="Attach camera image">${y.image}</button>
        <button type="button" class="pm-chat-voice-close" id="${d}-voice-close" aria-label="Close voice mode">&times;</button>
        <div class="pm-chat-voice-inline" id="${d}-voice-inline"></div>
      </div>
    </form>`}function Xt(e,r,{placeholder:d,isBusy:h,onSubmit:g,onAbort:p,draftKey:x="",voiceTarget:$=null,onVoiceSubmit:c=null,openCameraCapture:k=null}){let l=String(r||"pm-agent-chat"),n=e.querySelector(`#${l}-form`),o=e.querySelector(`#${l}-input`),M=e.querySelector(`#${l}-send-btn`),w=e.querySelector(`#${l}-attach-btn`),a=e.querySelector(`#${l}-mic-btn`),b=e.querySelector(`#${l}-voice-shell`),f=e.querySelector(`#${l}-voice-close`),T=e.querySelector(`#${l}-voice-camera`),C=e.querySelector(`#${l}-voice-inline`),O=e.querySelector(`#${l}-file-input`),I=e.querySelector(`#${l}-attach-tray`),J=e.querySelector(`#${l}-mode-launcher`),ge=e.querySelector(`#${l}-mode-voice`),le=e.querySelector(`#${l}-mode-keyboard`),ae=String(x||"").trim(),H=null;ae&&(De[ae]||(De[ae]={text:"",pending:[]}),H=De[ae],Array.isArray(H.pending)||(H.pending=[]));let z=H?H.pending:[],_=!1,R=null,we=null,j=null,Z=0;o&&H?.text&&(o.value=H.text);let X=l==="pm-team-chat"||l==="pm-sa-chat",ne=document.querySelector(".pm-app")||document.body,ee=document.querySelector(".pm-tabbar"),P=window.visualViewport,$e=s=>{if(!ee)return 0;let m=getComputedStyle(ee);if(m.display==="none"||m.visibility==="hidden")return 0;let S=ee.getBoundingClientRect?.(),D=Math.max(0,Number(P?.offsetTop||0)),N=Math.max(0,Number(s||0));return!S||S.height<=0||S.bottom<=D||S.top>=N?0:Math.max(0,Math.round(N-Math.max(S.top,D)+16))},W=0,re=0,K=!1,te="",t=0,i=0,v=Math.max(Number(window.innerHeight||0),Number(P?.height||0)),L=0,A=0,E=e.querySelector?.(".pm-sa-chat-scrollport")||e.closest?.(".pm-page.pm-agent-chat-page")?.querySelector?.(".pm-sa-chat-scrollport")||e,oe=0,ce=0,F=Number(E?.scrollTop||0),V={passive:!0},U=["position","left","right","top","bottom","z-index"],he=()=>{!n||!X||(K=!1,te="",t=0,i=0,L=0,A=0,U.forEach(s=>n.style.removeProperty(s)),ne?.classList.remove("pm-keyboard-open","pm-agent-composer-keyboard-open"),ne?.style.removeProperty("--pm-keyboard-offset"),ee?.style.removeProperty("display"),W&&cancelAnimationFrame(W),W=0,re&&window.clearTimeout(re),re=0)},Pt=()=>{if(W=0,!n||!X||!K)return;ee?.style.setProperty("display","none","important");let s=Math.max(Number(window.innerHeight||0),Number(document.documentElement?.clientHeight||0)),m=Math.max(0,Number(P?.offsetTop||0)),S=Math.max(0,Number(P?.height||s||0)),D=Math.round(m+S),N=P?Math.max(0,Math.round(s-S)):0,se=Math.max(0,Math.round(v-S));if((N>90||se>90)&&!te){let Ke=Number(n.getBoundingClientRect?.().bottom||0);te=Ke>0&&Ke<=D+44?"visual":"layout",te==="visual"&&(t=D,i=S)}else te==="visual"&&Math.abs(S-i)>2&&(t=D,i=S);let ye=te==="visual"?t||D:s,ue=Math.max(54,Math.ceil(n.getBoundingClientRect?.().height||n.offsetHeight||54)),Me=$e(ye),It=te==="layout"&&N>0?N+8:0,zt=Math.max(8,Me,It),Bt=Math.max(8,Math.round(ye-zt-ue));n.style.setProperty("position","fixed","important"),n.style.setProperty("left","10px","important"),n.style.setProperty("right","10px","important"),n.style.setProperty("top",`${Bt}px`,"important"),n.style.setProperty("bottom","auto","important"),n.style.setProperty("z-index","10030","important"),ne?.classList.add("pm-keyboard-open","pm-agent-composer-keyboard-open"),ne?.style.setProperty("--pm-keyboard-offset",`${N}px`)},G=()=>{!X||!K||W||(W=requestAnimationFrame(()=>{if(W=0,!X||!K)return;let s=Math.max(Number(window.innerHeight||0),Number(document.documentElement?.clientHeight||0)),m=Math.max(0,Number(P?.height||s||0)),S=Math.max(0,s-m)>90||Math.max(0,v-m)>90,D=performance.now()<L||performance.now()<A;if(!S&&!D){xe();return}Pt()}))},Ne=()=>{X&&(K=!0,L=performance.now()+1600,ee?.style.setProperty("display","none","important"),v=Math.max(v,Number(window.innerHeight||0),Number(P?.height||0)),te="",t=0,i=0,ne?.classList.add("pm-keyboard-open","pm-agent-composer-keyboard-open"),ne?.style.setProperty("--pm-keyboard-offset","0px"),G(),[80,240,560,1e3].forEach(s=>window.setTimeout(G,s)),re&&window.clearTimeout(re),re=window.setTimeout(()=>{re=0,G()},1700))},xe=()=>{X&&(he(),v=Math.max(Number(window.innerHeight||0),Number(P?.height||0)))},de=()=>{if(!o)return;let s=Math.max(320,Math.round(window.visualViewport?.height||window.innerHeight||640)),m=Math.max(96,Math.min(280,Math.floor(s*.5)-86)),S=Number(o.dataset.maxHeight||m);o.style.height="auto",o.style.height=`${Math.min(S,Math.max(30,o.scrollHeight||30))}px`,o.style.overflowY=o.scrollHeight>S?"auto":"hidden"},pe=()=>!!(String(o?.value||"").trim()||z.length),me=()=>$&&typeof c=="function"&&b&&C,jt=()=>{if(!X||!n||n.classList.contains("pm-composer-mode-hidden")||n.classList.contains("is-voice-active"))return!1;let s=K||ne?.classList?.contains("pm-keyboard-open"),m=K||document.activeElement===o;return s||m?!1:!n.classList.contains("has-text")&&!n.classList.contains("has-attachments")&&!n.classList.contains("has-pending-question")},Se=()=>{ce=performance.now()+900},Ie=()=>{let s=Number(E?.scrollTop||0),m=s-F;if(F=s,m>=-2)return;let S=performance.now();S<oe||S>ce||jt()&&(xe(),He(!1,{animate:!0,reason:"scroll"}))},ke=()=>{n&&(n.classList.toggle("is-focused",document.activeElement===o),n.classList.toggle("has-text",!!String(o?.value||"").trim()),n.classList.toggle("has-attachments",z.length>0))},ze=()=>{if(!(!b||!C)){b.hidden=!0;try{C._pmCleanup?.()}catch{}C.innerHTML="",Tt(),Y?.target?.kind==="subagent"&&Y.target.agentId===$?.agentId&&(Y.target=null,Y.subagentSubmit=null)}},Be=async({autoStart:s=!0}={})=>{if(!me()){B("Voice mode is not available for this composer.","error");return}let m={kind:"subagent",agentId:String($.agentId||"").trim(),label:String($.label||$.name||"Subagent").trim(),voice:$.voice&&typeof $.voice=="object"?$.voice:null};Y.target=m,Y.targetSessionId=`subagent_chat_${m.agentId}`,Y.targetSessionLabel=m.label,Y.targetSessionChannel="subagent",Y.targetSessionForced=!0,Y.subagentSubmit=async S=>c({text:String(S||"").trim(),files:[]}),_t(m.voice),b.hidden=!1,C.innerHTML="",await At(C,{inline:!0,inlineChatSessionId:Y.targetSessionId,inlineChatSessionLabel:m.label,autoStart:s,openCameraCapture:k,cameraButton:T})},He=(s,{animate:m=!0,reason:S="keyboard"}={})=>{!X||!n||!J||(!s&&K&&xe(),n.classList.toggle("pm-composer-mode-hidden",!s),n.setAttribute("aria-hidden",s?"false":"true"),s?n.removeAttribute("inert"):n.setAttribute("inert",""),J.setAttribute("aria-hidden",s?"true":"false"),J.classList.toggle("is-transitioning",m),oe=performance.now()+(S==="keyboard"?1800:420),m&&setTimeout(()=>J.classList.remove("is-transitioning"),360))},Fe=()=>{He(!0,{reason:"keyboard"}),Ne(),window.requestAnimationFrame(()=>o?.focus({preventScroll:!0}))},Ve=async()=>{if(He(!0,{reason:"voice"}),me()){await Be({autoStart:!0});return}window.requestAnimationFrame(()=>a?.click())};try{le&&ie(le,Fe),ge&&ie(ge,()=>{Ve().catch(()=>{})})}catch(s){console.warn("[mobile agent chat] mode haptic wiring failed:",s),le?.addEventListener("click",Fe),ge?.addEventListener("click",()=>{Ve().catch(()=>{})})}E?.addEventListener("scroll",Ie,{passive:!0});for(let s of["touchstart","pointerdown","wheel"])E?.addEventListener(s,Se,V),E!==document&&document.addEventListener(s,Se,V);let fe=()=>{I&&(I.hidden=z.length===0,I.innerHTML=bt(z,!0),I.querySelectorAll("[data-remove-attachment]").forEach(s=>{s.addEventListener("click",()=>{let m=Number(s.getAttribute("data-remove-attachment"));Number.isFinite(m)&&z.splice(m,1),fe(),Q()})}),ke())},Q=()=>{let s=!!h?.(),m=s&&!pe();n&&(n.classList.toggle("is-busy",s),n.setAttribute("aria-busy",s?"true":"false"),n.dataset.composerState=s?m?"stopping":"busy":"idle"),o&&(o.placeholder=s?"Queue a message...":d),M&&(M.disabled=!1,M.classList.toggle("is-abort",m),M.classList.toggle("is-voice",!s&&!pe()&&me()),M.title=m?"Stop":!s&&!pe()&&me()?"Start voice mode":s?"Queue message":"Send",M.setAttribute("aria-label",m?"Stop":!s&&!pe()&&me()?"Start voice mode":s?"Queue message":"Send"),M.setAttribute("aria-busy",s?"true":"false"),M.innerHTML=m?'<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><rect x="7" y="7" width="10" height="10" rx="2"/></svg>':!s&&!pe()&&me()?`<img class="pm-send-voice-icon" src="${mt}" alt="" aria-hidden="true" />`:y.send),ke()},Ue=()=>{let s=String(o?.value||"").trim(),m=z.splice(0,z.length);if(o&&(o.value="",H&&(H.text=""),de()),_||R||j){_=!1,Z+=1,j&&clearTimeout(j),j=null;let S=R;R=null;try{S?.abort?.()}catch{try{S?.stop?.()}catch{}}a?.classList.remove("listening")}return fe(),Q(),{text:s,files:m}},Oe=({refocus:s=!0}={})=>{_=!1,Z+=1,j&&clearTimeout(j),j=null;let m=R;R=null;try{m?.stop?.()}catch{try{m?.abort?.()}catch{}}a?.classList.remove("listening"),s&&o?.focus(),de(),Q()},Dt=(s,m=140)=>{j&&clearTimeout(j),j=null,!(!_||R)&&(j=setTimeout(()=>{j=null,We(s)},m))},We=s=>{if(!(!_||R||!o))try{let m=new s,S=Z,D=String(o.value||"").trimEnd();R=m,m.lang=navigator.language||"en-US",m.interimResults=!0,m.continuous=!0,m.onstart=()=>{S===Z&&a?.classList.add("listening")},m.onresult=N=>{if(S!==Z)return;let se="",Re="";for(let ue=0;ue<N.results.length;ue+=1){let Me=String(N.results[ue]?.[0]?.transcript||"");N.results[ue].isFinal?se+=Me:Re+=Me}let ye=`${se}${Re}`.trim();o.value=`${D}${D&&ye?" ":""}${ye}`,H&&(H.text=o.value||""),de(),Q()},m.onerror=N=>{if(S!==Z)return;let se=String(N?.error||"unknown");["not-allowed","service-not-allowed","audio-capture"].includes(se)?(_=!1,B(se==="audio-capture"?"The microphone is not available.":"Microphone permission was denied.","error")):["no-speech","aborted"].includes(se)||console.warn("[mobile agent chat] dictation cycle error:",se)},m.onend=()=>{if(S===Z){if(R===m&&(R=null),de(),Q(),!_){a?.classList.remove("listening");return}Dt(s)}},m.start()}catch(m){R=null,_=!1,a?.classList.remove("listening"),B(m?.message||"Could not start dictation.","error")}};o?.addEventListener("input",()=>{H&&(H.text=o.value||""),de(),Q()}),o?.addEventListener("focus",()=>{ke(),Ne()}),o?.addEventListener("blur",()=>window.setTimeout(()=>{ke();let s=document.activeElement,m=!!(s&&n?.contains?.(s)),S=Math.max(Number(window.innerHeight||0),Number(document.documentElement?.clientHeight||0)),D=Math.max(0,Number(P?.height||S||0)),N=Math.max(0,S-D)>90||Math.max(0,v-D)>90;if(m||performance.now()<A||N){K&&G();return}xe()},120)),P?.addEventListener("resize",G),P?.addEventListener("scroll",G),window.addEventListener("resize",G,{passive:!0}),window.addEventListener("orientationchange",G),n?.addEventListener("pointerdown",s=>{s.target?.closest?.("button, .pm-haptic-host")&&(A=performance.now()+700)},{passive:!0}),o?.addEventListener("keydown",s=>{s.key==="Enter"&&!s.shiftKey&&(s.preventDefault(),n?.requestSubmit?.())}),o?.addEventListener("paste",async s=>{let m=Array.from(s.clipboardData?.files||[]);if(!m.length)return;String(s.clipboardData?.getData?.("text/plain")||"").trim()||s.preventDefault();let S=await Promise.all(m.slice(0,8).map(je));z.push(...S.filter(Boolean)),fe(),Q()}),w?.addEventListener("click",()=>O?.click()),a?.addEventListener("click",()=>{let s=window.SpeechRecognition||window.webkitSpeechRecognition;if(!s){B("Speech dictation is not available in this browser.","error");return}if(_){Oe();return}we=s,_=!0,Z+=1,a.classList.add("listening"),B("Listening until you tap the mic again.","info"),We(s)}),f?.addEventListener("click",ze),T?.addEventListener("click",()=>{typeof k=="function"?k():O?.click()}),O?.addEventListener("change",async()=>{let s=Array.from(O.files||[]).slice(0,8);if(O.value="",!s.length)return;let m=await Promise.all(s.map(je));z.push(...m.filter(Boolean)),fe(),Q()}),n?.addEventListener("submit",async s=>{if(s.preventDefault(),h?.()&&!pe()){p?.(),Q();return}let m=Ue();if(!m.text&&!m.files.length){await Be({autoStart:!0});return}await g?.(m),Q()});let Nt=e._pmCleanup;return e._pmCleanup=()=>{W&&cancelAnimationFrame(W),P?.removeEventListener("resize",G),P?.removeEventListener("scroll",G),window.removeEventListener("resize",G),window.removeEventListener("orientationchange",G),E?.removeEventListener("scroll",Ie);for(let s of["touchstart","pointerdown","wheel"])E?.removeEventListener(s,Se,V),E!==document&&document.removeEventListener(s,Se,V);he(),Oe({refocus:!1}),ze(),Nt?.()},requestAnimationFrame(()=>{fe(),de(),Q()}),{input:o,update:Q,consume:Ue,pending:z}}async function ea(e,r,{standalone:d=!1,team:h=null}={}){e.innerHTML=`
    <div class="${d?"pm-sa-chat-shell pm-team-chat-page-shell":"pm-card"} pm-team-chat-card" id="pm-team-chat-card">
      <div id="pm-team-chat-list" class="pm-team-chat-list${d?" pm-chat-thread pm-sa-chat-scrollport pm-sa-chat-list":""}" aria-live="polite">
        <div class="pm-team-chat-status">Loading team chat&hellip;</div>
      </div>
      <div id="pm-team-chat-queue" class="pm-mobile-queued-prompts" hidden></div>
      <div id="pm-team-chat-goal" class="pm-mobile-goal-strip pm-mobile-goal-strip-inline" hidden></div>
      ${Zt("pm-team-chat","Message the team manager...")}
    </div>
  `;let g=e.querySelector("#pm-team-chat-list"),p=e.querySelector("#pm-team-chat-queue"),x=e.querySelector("#pm-team-chat-goal");xt(g,()=>{}),vt(x,ut.activeSessionId,{fallbackToLast:!0});let $=[],c=null,k=null,l=0,n="",o=!1,M=!1,w=[],a=[],b=null;function f(t={}){let i=t?.body&&typeof t.body=="object"?t.body:{},v=t?.metadata&&typeof t.metadata=="object"?t.metadata:{},L=String(t?.from||t?.role||"").toLowerCase(),A=L==="user"||L==="you"||L==="human",E=Ut(String(t?.content||t?.message||t?.text||i.text||""));return{...t,role:A?"user":"agent",from:A?"user":L||"manager",fromLabel:t?.fromLabel||t?.fromName||i.sender||(A?"You":"Manager"),content:E,body:{...i,text:E},createdAt:t?.createdAt||t?.timestamp||t?.ts||Date.now(),processEntries:Array.isArray(t?.processEntries)?t.processEntries:Array.isArray(v.processEntries)?v.processEntries:[]}}function T(t,i){if(i?.role==="user")return"";let v=t?.body&&typeof t.body=="object"?t.body:{},L=t?.metadata&&typeof t.metadata=="object"?t.metadata:{},A=String(t?.agentId||t?.subagentId||t?.memberId||t?.fromId||v.agentId||v.subagentId||L.agentId||L.subagentId||i?.from||"").trim().toLowerCase(),E=String(i?.fromLabel||"").trim().toLowerCase(),ce=(Array.isArray(h?.members)?h.members:[]).find(V=>{let U=String(V?.id||"").trim().toLowerCase(),he=String(V?.name||"").trim().toLowerCase();return A&&(U===A||he===A)||E&&(U===E||he===E)}),F=String(ce?.id||(A&&!["agent","assistant","manager"].includes(A)?A:"manager")).trim();return`<span class="pm-team-sender-icon" aria-hidden="true">${Ct(F,{scale:.24})}</span>`}function C(t){let i=f(t),v=T(t,i);try{return St(i,{sender:i.fromLabel,senderIconHtml:v,chatParity:!0,live:t===c,keepLiveTraceVisible:t===c})}catch(L){console.warn("[mobile team chat] rich message render failed:",L);let A=i.role==="user";return`<div class="pm-msg ${A?"from-user":"from-ai"} pm-agent-chat-msg">
        <div class="pm-bubble">
          ${A?"":`<span class="pm-sender pm-sender-with-icon">${v}<span class="pm-sender-name">${u(i.fromLabel)}</span></span>`}
          <div class="markdown-body">${ht(i.content)}</div>
        </div>
      </div>`}}let O=()=>!!(k||c?.streaming||o),I=(t={})=>{let i=be(t),v=String(i.sessionId||i.sourceSessionId||"").trim();return!!i.id&&(v.startsWith(`team_dm_manager_${r}___`)||v.startsWith(`team_dm_member_${r}___`)||v===`team_chat_${r}`||String(i.teamId||i.toolArgs?.teamId||"").trim()===String(r))},J=(t={})=>{if(!I(t))return!1;let i=be(t),v=a.findIndex(A=>String(A?.approvalRequest?.id||"")===i.id),L={role:"agent",from:"manager",fromLabel:"Manager",content:"",createdAt:Date.now(),approvalRequest:i};return v>=0?a[v]={...a[v],approvalRequest:{...a[v].approvalRequest||{},...i}}:a.push(L),a=a.slice(-8),!0},ge=(t,i,v={})=>{let L=String(t||"").trim();if(!L)return!1;let A=a.findIndex(E=>String(E?.approvalRequest?.id||"")===L);return A<0?!1:(a[A].approvalRequest=be({...a[A].approvalRequest||{},...v.approval||v,id:L,status:i}),!0)},le=async()=>{let t=await Qe("pending").catch(()=>[]);(Array.isArray(t)?t:[]).forEach(J)};function ae(){p&&(p.hidden=w.length===0,p.innerHTML=w.length?`<div class="pm-mobile-queued-list">${w.map((t,i)=>`
           <div class="pm-mobile-queued-item">
             <button type="button" class="pm-mobile-queued-text" data-team-queue-edit="${i}">${u(String(t.text||"Attached file(s)").slice(0,120))}${t.files?.length?` <em>+${t.files.length}</em>`:""}</button>
             <div class="pm-mobile-queued-actions">
               <div class="pm-mobile-queued-menu-wrap">
                 <button type="button" class="pm-mobile-queued-icon pm-mobile-queued-menu-trigger" data-team-queue-menu="${i}" aria-label="Queued message actions" title="Actions">${y.dots}</button>
                 <div class="pm-mobile-queued-popover" data-team-queue-menu-popover="${i}" hidden>
                   <button type="button" class="pm-mobile-queued-menu-item pm-mobile-queued-steer" data-team-queue-steer="${i}">${y.target}<span>Steer</span></button>
                   <button type="button" class="pm-mobile-queued-menu-item pm-mobile-queued-remove" data-team-queue-remove="${i}">${y.trash}<span>Delete</span></button>
                 </div>
               </div>
             </div>
           </div>`).join("")}</div>`:"",gt(),p.querySelectorAll("[data-team-queue-edit]").forEach(t=>ie(t,()=>{})),p.querySelectorAll("[data-team-queue-menu]").forEach(t=>ie(t,()=>{let i=Number(t.getAttribute("data-team-queue-menu"));if(!Number.isInteger(i))return;let v=p.querySelector(`[data-team-queue-menu-popover="${i}"]`);if(!v)return;let L=!!v.hidden;Ce(p),v.hidden=!L})),p.querySelectorAll("[data-team-queue-steer]").forEach(t=>ie(t,()=>{let i=Number(t.getAttribute("data-team-queue-steer"));if(Number.isFinite(i)&&i>=0&&i<w.length){let[v]=w.splice(i,1);v&&w.unshift(v)}Ce(p),ae(),H()})),p.querySelectorAll("[data-team-queue-remove]").forEach(t=>ie(t,()=>{let i=Number(t.getAttribute("data-team-queue-remove"));Number.isFinite(i)&&w.splice(i,1),Ce(p),ae()})))}function H(){if(O()||!w.length){b?.update?.();return}let t=w.shift();ae(),te(t).catch(i=>B(i?.message||"Send failed","error"))}function z(t){let i=c&&!c._done?c:null;$=Array.isArray(t)?t.slice():[],i&&($.some(L=>String(L.content||L.message||L.text||"").trim()&&String(L.content||L.message||L.text||"").trim()===String(i.content||"").trim())||$.push(i))}function _(){let t=a.filter(v=>String(v?.approvalRequest?.status||"pending")==="pending"),i=[...$,...t];if(!i.length){g.innerHTML='<div style="text-align:center;color:var(--pm-muted);padding:24px 8px;font-size:13px;">No messages yet. Send the first one.</div>';return}Jt(g,i,C),Yt(g),g.querySelectorAll("[data-pm-approval-action][data-pm-approval-id]").forEach(ft),Et(g),g.scrollTop=g.scrollHeight}try{z(await Te(r,80)),await le(),_()}catch(t){g.innerHTML=`<div style="color:var(--pm-red);padding:16px;">${u(t.message||"Failed to load chat")}</div>`}async function R({forceHistory:t=!1}={}){try{let i=await at(r,n?l:0);i.stream?.streamId&&i.stream.streamId!==n&&(n=i.stream.streamId,l=0),i.stream?.streamId&&!c&&i.active&&(c={role:"manager",from:"manager",fromLabel:"Manager",content:"",_progress:"Reconnecting...",createdAt:Date.now(),workStartedAt:Date.now(),streaming:!0,processEntries:[]},$.push(c));for(let v of i.events||[])v.streamId&&(n=v.streamId),l=Math.max(l,Number(v.seq||0)),c||(c={role:"manager",from:"manager",fromLabel:"Manager",content:"",_progress:"Reconnecting...",createdAt:Date.now(),workStartedAt:Date.now(),streaming:!0,processEntries:[]},$.push(c)),qe(c,Gt(v),"Manager");(t||!i.active||c?._done)&&(z(await Te(r,80)),await le(),i.active||(c=null)),_()}catch{}}let we=()=>R({forceHistory:!0}),j=()=>{document.hidden||R({forceHistory:!0})},Z=async(t={})=>{if(String(t.teamId||"")===String(r))try{z(await Te(r,80)),c=null,_()}catch{}},X=(t={})=>{String(t.teamId||"")===String(r)&&(o||(t.streamId&&t.streamId!==n&&(n=t.streamId,l=0),l=Math.max(l,Number(t.seq||0)),c||(c={role:"manager",from:"manager",fromLabel:"Manager",content:"",_progress:"Thinking...",createdAt:Date.now(),workStartedAt:Date.now(),streaming:!0,processEntries:[]},$.push(c)),qe(c,{type:String(t.event||""),...t.data||{}},"Manager"),_()))},ne=async(t={})=>{let i=t.approval?be(t.approval,t):await yt(t);J(i)&&_()},ee=t=>(i={})=>{let v=t==="approval_approved"?"approved":t==="approval_denied"?"rejected":t==="approval_expired"?"expired":"failed";ge(i.approvalId||i.id||i.approval?.id,v,i)&&_()},P=ee("approval_approved"),$e=ee("approval_denied"),W=ee("approval_expired"),re=ee("approval_failed");q?.on?.("ws:open",we),q?.on?.("team_chat_message",Z),q?.on?.("team_chat_stream_event",X),q?.on?.("approval_created",ne),q?.on?.("approval_approved",P),q?.on?.("approval_denied",$e),q?.on?.("approval_expired",W),q?.on?.("approval_failed",re);let K=()=>{M||_()};window.addEventListener("prometheus:markdown-ready",K),document.addEventListener("visibilitychange",j),e._pmCleanup=()=>{if(!M){M=!0;try{k?.abort?.()}catch{}q?.off?.("ws:open",we),q?.off?.("team_chat_message",Z),q?.off?.("team_chat_stream_event",X),q?.off?.("approval_created",ne),q?.off?.("approval_approved",P),q?.off?.("approval_denied",$e),q?.off?.("approval_expired",W),q?.off?.("approval_failed",re),window.removeEventListener("prometheus:markdown-ready",K),document.removeEventListener("visibilitychange",j)}},R();async function te(t){let i=String(t?.text||"").trim(),v=Array.isArray(t?.files)?t.files:[],L=String(t?.source||"").trim(),A=i||(v.length?"Please review the attached file(s).":"");if(!A&&!v.length)return;if(O()){w.push({text:i,files:v,source:L,speak:t?.speak===!0,voice:t?.voice===!0}),ae(),b?.update?.();return}let E=A,oe=v;if(v.length){let F=await wt(v);E=`${A}${$t(F)}`,oe=F.map((V,U)=>({...v[U]||{},name:V.name||v[U]?.name||"attachment",kind:V.isImage?"image":V.isVideo?"video":v[U]?.kind||"file",workspacePath:V.workspacePath||v[U]?.workspacePath,path:V.workspacePath||v[U]?.path,dataUrl:v[U]?.dataUrl,mimeType:v[U]?.mimeType,sizeLabel:v[U]?.sizeLabel}))}let ce={role:"user",from:"user",content:A,body:{text:A,attachments:oe},attachmentPreviews:oe,createdAt:Date.now()};c={role:"manager",from:"manager",fromLabel:"Manager",content:"",_progress:"Manager is thinking...",createdAt:Date.now(),workStartedAt:Date.now(),streaming:!0,processEntries:[]},$.push(ce,c),_(),o=!0,b?.update?.(),k=nt(r,{message:E},{onEvent:F=>{qe(c,F,"Manager"),_()},onError:F=>{F?.name!=="AbortError"&&(c.content=c.content||`Error: ${F?.message||"stream failed"}`,c._progress="",c.streaming=!1,c.workEndedAt=Date.now(),o=!1,k=null,b?.update?.(),_(),B(F?.message||"Send failed","error"))},onDone:async()=>{c&&(c._progress="",c.streaming=!1,c.workEndedAt=c.workEndedAt||Date.now(),c.workDurationMs=Math.max(0,c.workEndedAt-Number(c.workStartedAt||c.createdAt||c.workEndedAt))),o=!1,k=null,b?.update?.(),await R({forceHistory:!0}),H()}})}b=Xt(e,"pm-team-chat",{placeholder:"Message the team manager...",draftKey:"team:manager",isBusy:O,onAbort:()=>{try{k?.abort?.()}catch{}c&&(c._progress="Stopping...",c.streaming=!1),k=null,o=!1,_()},onSubmit:te}),ae()}async function da(e,{teamId:r,navigate:d}){e.classList.add("pm-agent-chat-page","pm-team-agent-chat-page"),e.dataset.mobileAgentChatRoute="team",document.body.classList.add("pm-mobile-subagent-chat-locked"),document.body.classList.add("pm-mobile-agent-chat-locked"),e.innerHTML=`
    ${_e({title:"Team Chat",online:!0,leftIcon:"back",hideTitle:!0,hideBrand:!0})}
    <div class="pm-body pm-subagent-chat-body pm-team-chat-page-body" id="pm-team-chat-page-body">
      <div class="pm-card" style="text-align:center;padding:24px;color:var(--pm-muted);">Loading team chat&hellip;</div>
    </div>
  `,Ee(e,{onBack:()=>d?.(`#mobile/teams/${encodeURIComponent(r)}`)});let h=e.querySelector("#pm-team-chat-page-body"),g=e.querySelector(".pm-model-badge .pm-model-badge-label"),p=!1;e._pmCleanup=()=>{if(!p){p=!0;try{h?._pmCleanup?.()}catch{}document.body.classList.remove("pm-mobile-agent-chat-locked","pm-mobile-subagent-chat-locked")}};try{let x=await Le(r);if(!x)throw new Error("Team not found");if(p||e.isConnected===!1)return;g&&(g.textContent=`${x.emoji||"\u{1F3E0}"} ${x.name}`),await ea(h,r,{standalone:!0,team:x})}catch(x){h.innerHTML=`<div class="pm-empty"><div class="pm-empty-icon">${y.users}</div><h2>Couldn\u2019t load team chat</h2><p>${u(x?.message||"Network error")}</p></div>`}}function ta(e){let r=String(e||"").toLowerCase();return/\.(md|markdown|txt)$/.test(r)?"\u{1F4DD}":/\.(js|ts|tsx|jsx|mjs|cjs)$/.test(r)?"\u{1F4DC}":/\.(json|yaml|yml|toml)$/.test(r)?"\u{1F527}":/\.(png|jpg|jpeg|gif|svg|webp)$/.test(r)?"\u{1F5BC}\uFE0F":/\.(mp4|mov|webm|mkv)$/.test(r)?"\u{1F3AC}":/\.(mp3|wav|ogg|flac)$/.test(r)?"\u{1F3B5}":/\.(html|htm)$/.test(r)?"\u{1F310}":/\.(pdf)$/.test(r)?"\u{1F4C4}":"\u{1F4C3}"}function aa(e){return!e||e<1024?`${e||0} B`:e<1024*1024?`${(e/1024).toFixed(1)} KB`:`${(e/(1024*1024)).toFixed(2)} MB`}async function na(e,r){e.innerHTML='<div class="pm-card" style="text-align:center;padding:24px;color:var(--pm-muted);">Loading workspace\u2026</div>';let d;try{d=await rt(r)}catch(a){e.innerHTML=`<div class="pm-empty"><div class="pm-empty-icon">${y.doc}</div><h2>Couldn\u2019t load workspace</h2><p>${u(a.message||"")}</p></div>`;return}let h=/^(Brain|audit|memory|temp)[\\/]|(^|[\\/])(tool_audit\.log|team-notes\.jsonl|last_run\.json|memory\.json|pending\.json)$/i,g=a=>String(a.relativePath||a.relpath||a.name||a.path||""),p=(d.files||[]).slice().sort((a,b)=>Number(b.modifiedAt||0)-Number(a.modifiedAt||0)),x=p.filter(a=>!h.test(g(a))),$=x.length===0;if(!p.length){e.innerHTML=`<div class="pm-empty"><div class="pm-empty-icon">${y.doc}</div><h2>Workspace is empty</h2><p>Files written by team subagents will appear here.</p></div>`;return}let c=$?p:x;e.innerHTML=`
    <div class="pm-card" style="padding:10px 12px 12px;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
        <strong style="font-size:13px;" id="pm-ws-count"></strong>
        ${p.length>x.length&&x.length?'<button type="button" class="pm-show-more" id="pm-ws-runtime-toggle">Show runtime files</button>':""}
      </div>
      ${d.workspacePath?`<div title="${u(d.workspacePath)}" style="font-size:11px;color:var(--pm-muted);font-family:ui-monospace,monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;direction:rtl;text-align:left;margin-bottom:8px;">${u(d.workspacePath)}</div>`:""}
      <div id="pm-ws-list" style="display:flex;flex-direction:column;gap:6px;"></div>
      <div id="pm-ws-preview" style="margin-top:12px;display:none;"></div>
    </div>
  `;let k=e.querySelector("#pm-ws-list"),l=e.querySelector("#pm-ws-preview"),n=e.querySelector("#pm-ws-count"),o=e.querySelector("#pm-ws-runtime-toggle"),M=()=>{c=$?p:x,n&&(n.textContent=$||!x.length?`${p.length} file${p.length===1?"":"s"}`:`${x.length} project file${x.length===1?"":"s"}`),o&&(o.textContent=$?"Hide runtime files":`Show runtime files (${p.length-x.length})`),k.innerHTML=c.map(a=>{let b=g(a),f=a.size||0,T=a.modifiedAt||a.updatedAt;return`
      <button type="button" data-rel="${u(b)}" style="display:flex;align-items:center;gap:10px;width:100%;text-align:left;color:var(--pm-text);background:var(--pm-bg-soft);border:1px solid var(--pm-border);border-radius:12px;padding:10px 12px;cursor:pointer;font-family:inherit;">
        <span style="font-size:18px;">${ta(b)}</span>
        <span style="flex:1;min-width:0;overflow:hidden;">
          <span style="display:block;font-weight:700;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${u(b)}</span>
          <span style="display:block;font-size:11px;color:var(--pm-muted);">${aa(f)}${T?" \xB7 "+ve(typeof T=="number"?T:new Date(T).getTime()):""}</span>
        </span>
        <span style="color:var(--pm-muted);">${y.chev}</span>
      </button>
    `}).join(""),w()};o?.addEventListener("click",()=>{$=!$,M()});function w(){k.querySelectorAll("[data-rel]").forEach(a=>{a.addEventListener("click",async()=>{let b=a.getAttribute("data-rel");l.style.display="block",l.innerHTML=`<div class="pm-card-body" style="padding:14px;color:var(--pm-muted);">Loading ${u(b)}\u2026</div>`;try{let f=await st(r,b),T=f?.content||f?.body||"";l.innerHTML=`
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
            <strong style="flex:1;font-size:13px;">${u(b)}</strong>
            <button class="pm-btn ghost" id="pm-ws-close" style="padding:4px 10px;font-size:12px;">\u2715 Close</button>
          </div>
          <pre style="background:var(--pm-bg-soft);border:1px solid var(--pm-border);border-radius:10px;padding:12px;font-size:12px;line-height:1.5;font-family:ui-monospace,monospace;white-space:pre-wrap;word-break:break-word;max-height:60vh;overflow:auto;margin:0;">${u(String(T).slice(0,5e4))}${String(T).length>5e4?`

\u2026(truncated)`:""}</pre>
        `,l.querySelector("#pm-ws-close").addEventListener("click",()=>{l.style.display="none",l.innerHTML=""}),l.scrollIntoView({behavior:"smooth",block:"nearest"})}catch(f){l.innerHTML=`<div class="pm-card-body" style="color:var(--pm-red);">${u(f.message||"Failed to load file")}</div>`}})})}M()}async function ra(e,r,d){e.innerHTML='<div class="pm-card" style="text-align:center;padding:24px;color:var(--pm-muted);">Loading memory\u2026</div>';let h=null;try{h=await Ae(r)}catch{}if(h){let n=a=>String(a||"").replace(/\[DURABLE_TURN_COMMENTARY\][\s\S]*$/,"").replace(/\*\*/g,"").trim(),o=(Array.isArray(h.artifacts)?h.artifacts:[]).slice().reverse().slice(0,12),M=(Array.isArray(h.blockers)?h.blockers:[]).slice().reverse().slice(0,8),w=(Array.isArray(h.recentEvents)?h.recentEvents:[]).filter(a=>a&&a.category!=="tool"&&n(a.content)).slice().reverse().slice(0,15);if(o.length||M.length||w.length){let a=(f,T)=>T?`<div style="font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;color:var(--pm-muted);margin:14px 4px 6px;">${f}</div>${T}`:"",b=f=>f?ve(typeof f=="number"?f:new Date(f).getTime()):"";e.innerHTML=`
        ${a(`Blockers (${M.length})`,M.map(f=>`
          <article class="pm-card" style="padding:10px 12px;border-color:var(--pm-red);">
            <div class="pm-card-body">${u(n(f.content||f.reason||f.title||"Blocker"))}</div>
            <div style="font-size:11px;color:var(--pm-muted);margin-top:4px;">${u(f.agentName||f.agentId||"")} ${b(f.createdAt||f.timestamp)}</div>
          </article>`).join(""))}
        ${a(`Artifacts (${o.length})`,o.map(f=>`
          <article class="pm-card" style="padding:10px 12px;">
            <div style="display:flex;gap:8px;align-items:center;">
              <strong style="flex:1;font-size:13px;line-height:1.3;">${u(f.name||f.title||"Artifact")}</strong>
              <span style="font-size:11px;color:var(--pm-muted);white-space:nowrap;">${b(f.createdAt||f.timestamp)}</span>
            </div>
            ${f.description?`<div class="pm-card-body" style="font-size:13px;margin-top:4px;">${u(String(f.description).slice(0,220))}</div>`:""}
            ${f.path?`<div title="${u(f.path)}" style="font-size:11px;color:var(--pm-muted);font-family:ui-monospace,monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;direction:rtl;text-align:left;margin-top:4px;">${u(f.path)}</div>`:""}
          </article>`).join(""))}
        ${a("Recent activity",w.map(f=>`
          <article class="pm-card" style="padding:10px 12px;">
            <div style="display:flex;gap:8px;align-items:center;margin-bottom:4px;">
              <strong style="flex:1;font-size:13px;">${u(f.actorName||f.actorType||"Team")}</strong>
              <span style="font-size:11px;color:var(--pm-muted);white-space:nowrap;">${b(f.timestamp)}</span>
            </div>
            <div class="pm-card-body" style="font-size:13px;display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden;">${u(n(f.content).slice(0,400))}</div>
          </article>`).join(""))}
      `;return}}let g;try{g=await ot()}catch(n){e.innerHTML=`<div class="pm-empty"><div class="pm-empty-icon">${y.brain}</div><h2>Couldn\u2019t load memory</h2><p>${u(n.message||"")}</p></div>`;return}let p=Array.isArray(g?.nodes)?g.nodes.slice():[],x=String(r).toLowerCase(),$=String(d?.name||"").toLowerCase(),c=n=>{let o=String(n.sourcePath||"").toLowerCase(),M=String(n.projectId||"").toLowerCase();return M&&M.includes(x)||o&&(o.includes(x)||$&&o.includes($))},k=p.filter(c),l=(k.length?k:p).sort((n,o)=>String(o.timestamp||"").localeCompare(String(n.timestamp||""))).slice(0,30);if(!l.length){e.innerHTML=`<div class="pm-empty"><div class="pm-empty-icon">${y.brain}</div><h2>No memory yet</h2><p>As the team works, reflections and memory entries land here.</p></div>`;return}e.innerHTML=`
    <div style="display:flex;align-items:center;gap:8px;padding:6px 4px 10px;color:var(--pm-muted);font-size:12px;">
      <span class="pm-pill ${k.length?"orange":"gray"}">${k.length?"team-scoped":"global feed"}</span>
      <span>${l.length} of ${p.length} entries</span>
    </div>
    ${l.map(n=>`
      <article class="pm-card" style="padding:12px 14px;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
          <strong style="flex:1;font-size:13px;line-height:1.3;">${u(n.label||"Memory")}</strong>
          <span class="pm-pill gray" style="font-family:ui-monospace,monospace;">${u(n.sourceTypeLabel||n.sourceType||"memory")}</span>
        </div>
        ${n.summary?`<div class="pm-card-body" style="margin-bottom:4px;">${u(String(n.summary).slice(0,240))}${String(n.summary).length>240?"\u2026":""}</div>`:""}
        <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--pm-muted);">
          <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:70%;font-family:ui-monospace,monospace;">${u(n.sourcePath||"")}</span>
          <span>${n.timestamp?ve(new Date(n.timestamp).getTime()):""}</span>
        </div>
      </article>
    `).join("")}
  `}export{la as a,ca as b,Ot as c,Gt as d,Yt as e,Jt as f,Zt as g,Xt as h,da as i};
