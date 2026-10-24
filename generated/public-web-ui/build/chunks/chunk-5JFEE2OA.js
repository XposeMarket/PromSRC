import{A as kt,C as Y,E as Mt,F as Lt,J as At,K as Tt,L as _t,O as Et,Q as Ct,c as mt,f as ut,g as vt,h as Ce,i as ht,j as gt,l as ye,m as ft,o as bt,p as yt,q as je,r as wt,s as $t,t as xt,u as qe,v as St}from"./chunk-KZWNNT4C.js";import{b as ve}from"./chunk-J5HXEABW.js";import{a as U}from"./chunk-35CAQ6TV.js";import{H as b,I as u,O as _e,P as Ee}from"./chunk-5EVPYLUY.js";import{e as ie}from"./chunk-QRT4XV37.js";import{a as ct,b as dt,c as pt}from"./chunk-LXAE2DH2.js";import{La as lt,Q as Pe,R as Ye,S as Le,T as Je,U as Ze,V as Xe,X as et,Y as Ae,Z as tt,_ as Te,aa as at,ba as nt,c as Ge,ca as rt,da as st,ea as ot,ga as it,s as Qe}from"./chunk-AXH4665B.js";import{a as q}from"./chunk-4RINRH4P.js";function Ft(e){let i=e.house==="blue"?"#4a82d1":"#a4682b";return`
    <button class="pm-team-tile ${e.featured?"featured":""}" data-team="${e.id}">
      ${e.featured?'<span class="pm-star">\u2605</span>':""}
      <span class="pm-house" style="color:${i}">\u{1F3E0}</span>
      <span class="pm-team-name">${u(e.name)}</span>
      <span class="pm-team-agents">${b.users} ${e.agents} agents</span>
    </button>
  `}function qt(){return`<div class="pm-team-grid">${'<div class="pm-team-tile" style="opacity:.55"><span class="pm-house" style="opacity:.4">\u{1F3E0}</span><span class="pm-team-name" style="background:rgba(0,0,0,.06);color:transparent;border-radius:6px;height:16px;width:80%;">loading</span></div>'.repeat(4)}</div>`}async function ia(e,{navigate:i}){let p=`
    <span class="pm-count-pill" id="pm-teams-count">\u2026</span>
    <span class="pm-spacer"></span>
    <button class="pm-icon-btn" id="pm-teams-refresh" aria-label="Refresh" style="background:var(--pm-surface);border:1px solid var(--pm-border);">${b.refresh}</button>
  `,g=_e({title:"Teams",online:!1,extras:p});e.innerHTML=`
    ${g}
    <div class="pm-body" id="pm-teams-body">${qt()}</div>
  `,Ee(e,{});let h=e.querySelector("#pm-teams-body"),d=e.querySelector("#pm-teams-count"),x=e.querySelector("#pm-teams-refresh");async function $({force:k=!1}={}){let l=[];try{l=await Ye({force:k})}catch(w){h.innerHTML=`<div class="pm-empty"><div class="pm-empty-icon">${b.users}</div><h2>Couldn\u2019t load teams</h2><p>${u(w.message||"Network error")}</p></div>`,d.textContent="0 teams";return}if(d.textContent=`${l.length} team${l.length===1?"":"s"}`,!l.length){h.innerHTML=`<div class="pm-empty"><div class="pm-empty-icon">${b.users}</div><h2>No teams yet</h2><p>Create your first team from the desktop app.</p></div>`;return}let n=l.find(w=>w.featured)||l[0],s=null;try{s=await Le(n.id)}catch{}let M=s?`
      <div class="pm-team-preview">
        <div class="pm-team-preview-head">
          <span class="pm-mini-house">${u(s.emoji||"\u{1F3E0}")}</span>
          <h3>${u(s.name)}</h3>
          <button class="pm-pill-btn" data-go="${u(s.id)}">View Team ${b.chev}</button>
        </div>
        <div style="font-size:13px;color:var(--pm-muted);font-weight:700;margin-top:4px;">Team members</div>
        <div class="pm-chip-row">
          ${s.members.map(w=>`<span class="pm-member-chip"><span class="pm-avatar" style="background:${w.color}">${w.avatar}</span>${u(w.name)}</span>`).join("")}
        </div>
        <div class="pm-divider"></div>
        <button type="button" class="pm-row pm-row-link" data-go-ws="${u(s.id)}"><span>\u{1F5C2}\uFE0F Workspace</span><span style="color:var(--pm-muted);display:inline-flex;align-items:center;gap:4px;">Open ${b.chev}</span></button>
        <div class="pm-divider"></div>
        <div class="pm-row" style="flex-direction:column;align-items:stretch;gap:4px;">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <strong>Progress</strong>
            <span style="color:var(--pm-muted)">Recent runs <b style="color:var(--pm-text)">${s.runsDone} / ${s.runsTotal} runs</b></span>
          </div>
          <div class="pm-progress"><span style="width:${s.runsTotal?Math.round(s.runsDone/s.runsTotal*100):0}%"></span></div>
        </div>
      </div>
    `:"";h.innerHTML=`
      <div class="pm-team-grid">${l.map(Ft).join("")}</div>
      ${M}
    `,h.querySelectorAll("[data-team]").forEach(w=>{w.addEventListener("click",()=>i(`#mobile/teams/${w.getAttribute("data-team")}`))}),h.querySelectorAll("[data-go]").forEach(w=>{w.addEventListener("click",()=>i(`#mobile/teams/${w.getAttribute("data-go")}`))}),h.querySelectorAll("[data-go-ws]").forEach(w=>{w.addEventListener("click",()=>i(`#mobile/teams/${encodeURIComponent(w.getAttribute("data-go-ws"))}/workspace`))})}x.addEventListener("click",()=>{Pe(),h.innerHTML=qt(),$({force:!0})});let c=Ge("teams_raw",216e5);await $(),Array.isArray(c)&&$({force:!0}).catch(()=>{})}function Vt(){return`
    <div class="pm-detail-head"><span class="pm-house-icon">\u{1F3E0}</span><h1 style="background:rgba(0,0,0,.06);color:transparent;border-radius:8px;height:24px;flex:1;">loading</h1></div>
    <div class="pm-detail-sub">\u2026</div>
    <div class="pm-action-row">
      <button class="pm-action-btn primary">${b.play} Start Run</button>
      <button class="pm-action-btn">${b.pause} Pause</button>
      <button class="pm-action-btn">${b.brain} Review</button>
      <button class="pm-action-btn danger">${b.trash} Delete</button>
    </div>
    <div class="pm-card" style="opacity:.5"><div class="pm-card-head">${b.target} Purpose</div><div class="pm-card-body">Loading team\u2026</div></div>
  `}async function la(e,{teamId:i,navigate:p,initialTab:g=""}){e.innerHTML=`
    ${_e({title:"Team",online:!0,leftIcon:"back",hideTitle:!0,hideBrand:!0})}
    <div class="pm-body pm-subagent-detail-body pm-team-detail-body" id="pm-detail-body">${Vt()}</div>
  `,Ee(e,{onBack:()=>p("#mobile/teams")});let h=e.querySelector("#pm-detail-body"),d=null;try{d=await Le(i)}catch(a){h.innerHTML=`<div class="pm-empty"><div class="pm-empty-icon">${b.users}</div><h2>Couldn\u2019t load team</h2><p>${u(a.message||"Network error")}</p></div>`;return}if(!d){h.innerHTML=`<div class="pm-empty"><div class="pm-empty-icon">${b.users}</div><h2>Team not found</h2><p>This team isn\u2019t available right now.</p></div>`;return}let x=["Context","Subagents","Workspace","Memory","Runs","Team Chat"];h.innerHTML=`
    <div class="pm-detail-head">
      <span class="pm-house-icon">${u(d.emoji||"\u{1F3E0}")}</span>
      <h1>${u(d.name)}</h1>
      <button class="pm-icon-btn pm-overflow" aria-label="More">${b.dots}</button>
    </div>
    <div class="pm-detail-sub">${d.subagents} subagents \xB7 ${d.totalRuns} total runs</div>

    <div class="pm-action-row">
      <button class="pm-action-btn primary" data-act="start">${b.play} Start Run</button>
      <button class="pm-action-btn"          data-act="pause">${d.paused?b.play+" Resume":b.pause+" Pause"}</button>
      <button class="pm-action-btn"          data-act="chat">${b.chat} Chat</button>
      <button class="pm-action-btn danger"   data-act="delete">${b.trash} Delete</button>
    </div>

    <div class="pm-tabs" role="tablist">
      ${x.map((a,y)=>`<button class="${y===0?"active":""}" data-tab="${a}">${u(a)}</button>`).join("")}
    </div>

    <div id="pm-tab-slot"></div>

    <div id="pm-context-slot">
    <div class="pm-team-preview">
      <div class="pm-team-preview-head">
        <span class="pm-mini-house">${u(d.emoji||"\u{1F3E0}")}</span>
        <h3>${u(d.name)}</h3>
      </div>
      <div style="font-size:13px;color:var(--pm-muted);">${d.subagents} subagents \xB7 ${d.totalRuns} total runs</div>
      <div class="pm-chip-row">
        ${d.members.map(a=>`<span class="pm-member-chip"><span class="pm-avatar" style="background:${a.color}">${a.avatar}</span>${u(a.name)}</span>`).join("")}
      </div>
    </div>

    <div class="pm-card">
      <div class="pm-card-head" style="display:flex;justify-content:space-between;align-items:center;">
        <span>${b.target} Purpose</span>
        <button class="pm-show-more" data-toggle-purpose>Show more \u25BE</button>
      </div>
      <div class="pm-card-body" data-purpose data-collapsed="1" style="display:-webkit-box;-webkit-line-clamp:6;-webkit-box-orient:vertical;overflow:hidden;">${u(d.purpose)}</div>
    </div>

    <div class="pm-card-grid">
      <div class="pm-card">
        <div class="pm-card-head">${b.check} Current Task / Goal</div>
        <div class="pm-card-body">${u(d.currentTask)}</div>
      </div>
      <div class="pm-card">
        <div class="pm-card-head">${b.clock} Last Run</div>
        <div class="pm-card-body strong">${u(d.lastRun)}</div>
      </div>
      <div class="pm-card">
        <div class="pm-card-head">${b.users} Member States</div>
        <div class="pm-card-body" data-member-states>${u(d.memberStates)}</div>
      </div>
      <div class="pm-card">
        <div class="pm-card-head">${b.send} Active Dispatches</div>
        <div class="pm-card-body" data-dispatches>${u(d.dispatches)}</div>
      </div>
    </div>

    <div class="pm-card">
      <div class="pm-card-head">${b.doc} Context &amp; Reference</div>
      <div class="pm-card-body" style="margin-bottom:10px;">Each save adds a new card. Cards are injected into manager + subagent runtime context.</div>
      <input class="pm-input" id="pm-ref-title" placeholder="Reference title (e.g. Brand Voice, API URL, Posting Rules)" />
      <textarea class="pm-textarea" id="pm-ref-body" placeholder="Reference content\u2026"></textarea>
      <div class="pm-row-buttons">
        <button class="pm-btn primary" data-save-ref>${b.check} Save</button>
      </div>
    </div>

    <div class="pm-card">
      <div class="pm-card-head" style="display:flex;justify-content:space-between;align-items:center;">
        <span>\u{1F4C1} Workspace Preview</span>
        <a href="#mobile/teams/${u(i)}/workspace" style="color:var(--pm-orange);font-weight:700;text-decoration:none;font-size:13px;">Open Workspace \u203A</a>
      </div>
      <div class="pm-card-body">${u(d.workspace)}</div>
    </div>
    </div><!-- /pm-context-slot -->
  `;let $=h.querySelector("#pm-context-slot"),c=h.querySelector("#pm-tab-slot");async function k(a){try{c?._pmCleanup?.()}catch{}if(c&&(c._pmCleanup=null),h.querySelectorAll(".pm-tabs button").forEach(y=>y.classList.toggle("active",y.getAttribute("data-tab")===a)),a==="Context"){$.style.display="",c.innerHTML="";return}$.style.display="none",c.innerHTML=`<div class="pm-card" style="text-align:center;padding:24px;color:var(--pm-muted);">Loading ${u(a)}\u2026</div>`;try{if(a==="Subagents")await Rt(c,d);else if(a==="Runs")await Kt(c,i);else if(a==="Team Chat"){p(`#mobile/teams/${encodeURIComponent(i)}/chat`);return}else a==="Workspace"?await aa(c,i):a==="Memory"&&await na(c,i,d)}catch(y){c.innerHTML=`<div class="pm-card"><div class="pm-card-head">${b.users} Error</div><div class="pm-card-body">${u(y.message||"Failed to load")}</div></div>`}}h.querySelectorAll(".pm-tabs button").forEach(a=>{a.addEventListener("click",()=>k(a.getAttribute("data-tab")))}),Ae(i).then(a=>{if(!a)return;let y=I=>(d.members||[]).find(J=>J.id===I)?.name||I,f=h.querySelector("[data-member-states]"),T=Object.entries(a.memberStates||{});f&&T.length&&(f.innerHTML=T.map(([I,J])=>`<div style="display:flex;justify-content:space-between;gap:8px;"><span>${u(y(I))}</span><span style="color:var(--pm-muted)">${u(String(J?.status||"idle"))}</span></div>`).join(""));let C=h.querySelector("[data-dispatches]"),O=Array.isArray(a.activeDispatches)?a.activeDispatches:[];C&&(C.textContent=O.length?`${O.map(I=>y(String(I.agentId||I.subagentId||""))).join(", ")} working`:"No active dispatches.")}).catch(()=>{});let l=x.find(a=>a.toLowerCase().replace(/\s+/g,"-")===String(g||"").toLowerCase());l&&l!=="Context"&&k(l);let n=h.querySelector("[data-toggle-purpose]"),s=h.querySelector("[data-purpose]");n&&s&&n.addEventListener("click",()=>{s.getAttribute("data-collapsed")==="1"?(s.style.webkitLineClamp="unset",s.style.display="block",s.setAttribute("data-collapsed","0"),n.textContent="Show less \u25B4"):(s.style.display="-webkit-box",s.style.webkitLineClamp="6",s.setAttribute("data-collapsed","1"),n.textContent="Show more \u25BE")});async function M(a,y,f){let T=a.innerHTML;a.disabled=!0,a.style.opacity="0.6";try{let C=await y();if(!C||C.success===!1)throw new Error(C?.error||"Failed");return U(f,"success"),C}catch(C){throw U(C.message||"Action failed","error"),C}finally{a.disabled=!1,a.style.opacity="",a.innerHTML=T}}h.querySelectorAll("[data-act]").forEach(a=>{let y=a.getAttribute("data-act");a.addEventListener("click",async()=>{if(y==="start")await M(a,()=>Je(i),"Run started").catch(()=>{});else if(y==="pause"){let f=d.paused;try{await M(a,()=>f?Xe(i):Ze(i),f?"Team resumed":"Team paused"),d.paused=!f,a.innerHTML=d.paused?`${b.play} Resume`:`${b.pause} Pause`}catch{}}else if(y==="chat")p(`#mobile/teams/${encodeURIComponent(i)}/chat`);else if(y==="delete"){if(!window.confirm(`Delete team "${d.name}"? This cannot be undone.`))return;try{await M(a,()=>et(i),"Team deleted"),Pe(),p("#mobile/teams")}catch{}}})});let w=h.querySelector("[data-save-ref]");w&&w.addEventListener("click",async()=>{let a=h.querySelector("#pm-ref-title"),y=h.querySelector("#pm-ref-body"),f=(a.value||"").trim(),T=(y.value||"").trim();if(!f||!T){U("Title and content required","error");return}try{await M(w,()=>lt(i,f,T),"Reference saved"),a.value="",y.value=""}catch{}}),e._pmCleanup=()=>{try{c?._pmCleanup?.()}catch{}}}var Ht={working:{label:"working",cls:"running"},active:{label:"active",cls:"active"},ready:{label:"ready",cls:"active"},idle:{label:"idle",cls:"gray"},blocked:{label:"blocked",cls:"orange"},paused:{label:"paused",cls:"gray"},awaiting:{label:"awaiting",cls:"orange"},offline:{label:"offline",cls:"gray"}};function Ut(e){let i=/^Goal update \(([a-z_]+)\):\s*(\{[\s\S]*\})\s*$/.exec(String(e||"").trim());if(!i)return e;let p;try{p=JSON.parse(i[2])}catch{return e}let g=h=>String(h??"").replace(/\s+/g," ").trim();switch(i[1]){case"log_completed":return`\u2705 Logged as done: ${g(p.entry??p.completed??p.text)}`;case"set_focus":return`\u{1F3AF} Focus set: ${g(p.focus??p.current_focus??p.text)}`;case"pause_agent":return`\u23F8 Paused ${g(p.agent_id)}`;case"unpause_agent":return`\u25B6 Resumed ${g(p.agent_id)}`;default:return`Goal update (${i[1]})`}}function Ot(e){if(!e||e<0)return"\u2014";let i=Math.floor(e/1e3);return i<60?`${i}s`:`${Math.floor(i/60)}m ${i%60}s`}async function Rt(e,i){let p=null;try{p=await Ae(i.id)}catch{}let g=p?.memberStates||{},h=Array.isArray(p?.activeDispatches)?p.activeDispatches:[],d=new Map;for(let l of h){let n=String(l.agentId||l.subagentId||"").trim();n&&d.set(n,l)}let x=i.members.filter(l=>l.id!=="manager"),$=new Map((await Promise.all(x.map(async l=>{let n=await it(l.id).catch(()=>null);return[l.id,n]}))).filter(([,l])=>l)),c=[],k=x.map(l=>{let n=g[l.id]||{},s=Ht[String(n.status||"idle").toLowerCase()]||Ht.idle,M=d.get(l.id),w=$.get(l.id),a=`pm-team-member-model-${i.id}-${l.id}`.replace(/[^a-zA-Z0-9_-]/g,"-");return w&&c.push({pickerScope:a,agent:w}),`
      <article class="pm-card pm-team-member-card">
        <div class="pm-schedule-head" style="margin-bottom:8px;">
          <span class="pm-emoji" style="font-size:22px;">${l.avatar}</span>
          <h3 style="margin:0;">${u(l.name)}</h3>
          <span class="pm-pill ${s.cls}">${s.label}</span>
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
    `}).join("");e.innerHTML=k||`<div class="pm-empty"><div class="pm-empty-icon">${b.robot}</div><h2>No subagents yet</h2><p>Add members from the desktop team editor.</p></div>`,c.forEach(({pickerScope:l,agent:n})=>{pt(l,()=>Rt(e,i)),dt(l,n)})}function Wt(e){return e.inProgress?'<span class="pm-pill running">running</span>':e.success===!0?'<span class="pm-pill active">success</span>':e.success===!1&&e.taskStatus?`<span class="pm-pill orange">${u(String(e.taskStatus))}</span>`:'<span class="pm-pill gray">complete</span>'}async function Kt(e,i){let{runs:p}=await tt(i,30);if(!p.length){e.innerHTML=`<div class="pm-empty"><div class="pm-empty-icon">${b.clock}</div><h2>No runs yet</h2><p>Start a run from the top of this page.</p></div>`;return}e.innerHTML=p.map(g=>`
    <article class="pm-card" style="padding:14px 16px;">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
        <strong style="flex:1;font-size:14px;">${u(g.agentName||g.agentId||"Agent")}</strong>
        ${Wt(g)}
      </div>
      ${g.taskSummary?`<div class="pm-card-body" style="margin-bottom:6px;">${u(String(g.taskSummary).slice(0,200))}${String(g.taskSummary).length>200?"\u2026":""}</div>`:""}
      <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--pm-muted);">
        <span>${u(g.trigger||"manual")} \xB7 ${g.stepCount||0} steps</span>
        <span>${ve(g.startedAt)} \xB7 ${Ot(g.durationMs)}</span>
      </div>
    </article>
  `).join("")}function Gt(e){return e?{type:String(e.type||e.event||""),...e.data||{}}:null}function Qt(e){!e||e.dataset.pmAgentActionsWired==="1"||(e.dataset.pmAgentActionsWired="1",e.addEventListener("click",i=>{let p=i.target?.closest?.("[data-pm-agent-msg-action]");if(!p||!e.contains(p))return;let g=String(p.dataset.pmAgentMsgAction||""),h=String(p.closest(".pm-msg")?.querySelector(".markdown-body")?.innerText||"").trim();if(g==="copy"){navigator.clipboard.writeText(h).then(()=>U("Copied","success"),()=>U("Copy failed","error"));return}if(g==="speak")try{Lt(),Mt(h)}catch{}}))}function Yt(e,i,p){if(!e)return;let g=new Set,h=new Set;e.querySelectorAll(".pm-agent-chat-msg").forEach((d,x)=>{d.querySelector(".pm-trace-drawer.open")&&g.add(x),d.querySelectorAll("details.pm-trace-tool-group[open]").forEach((c,k)=>{h.add(`${x}:${c.getAttribute("data-pm-trace-group")||k}`)})}),e.innerHTML=i.map(p).join(""),e.querySelectorAll(".pm-agent-chat-msg").forEach((d,x)=>{let $=d.querySelector(".pm-trace-drawer"),c=d.querySelector('[data-expandable="trace"]');$&&g.has(x)&&($.classList.add("open"),c?.classList.add("expanded")),d.querySelectorAll("details.pm-trace-tool-group").forEach((k,l)=>{let n=`${x}:${k.getAttribute("data-pm-trace-group")||l}`;h.has(n)&&!k.closest('.pm-trace-drawer[data-trace-completed="1"]')&&k.setAttribute("open","")})}),kt(e)}var De={};function Jt(e,i){let p=String(e||"pm-agent-chat"),g=p==="pm-team-chat"||p==="pm-sa-chat";return`
    ${g?`<div class="pm-chat-mode-launcher pm-agent-chat-mode-launcher" id="${p}-mode-launcher" role="group" aria-label="Choose chat input">
      <button type="button" class="pm-chat-mode-button pm-chat-mode-button--voice" id="${p}-mode-voice" aria-label="Start voice mode">${b.micSmall}<span class="pm-chat-mode-button-label">Voice mode</span></button>
      <button type="button" class="pm-chat-mode-button pm-chat-mode-button--keyboard" id="${p}-mode-keyboard" aria-label="Open keyboard composer">${b.keyboard}<span class="pm-chat-mode-button-label">Keyboard composer</span></button>
    </div>`:""}
    <form class="pm-composer pm-agent-chat-composer${g?" pm-composer-mode-hidden":""}" id="${p}-form"${g?' aria-hidden="true" inert':""}>
      <span class="pm-glass-lens" aria-hidden="true"></span>
      <span class="pm-glass-border" aria-hidden="true"></span>
      <input id="${p}-file-input" type="file" multiple accept="image/*,video/*,.mp4,.mov,.m4v,.webm,.avi,.mkv,.txt,.md,.json,.csv,.tsv,.log,.xml,.html,.css,.js,.ts,.tsx,.jsx,.py,.yaml,.yml,application/pdf" hidden />
      <div class="pm-attach-tray" id="${p}-attach-tray" hidden></div>
      <div class="pm-composer-row">
        <button type="button" class="pm-icon-btn" id="${p}-attach-btn" aria-label="Attach files">${b.paperclip}</button>
        <div class="pm-composer-input-wrap" id="${p}-input-wrap">
          <textarea class="pm-composer-input" id="${p}-input" rows="1" placeholder="${u(i)}" aria-label="Message" autocomplete="off" autocapitalize="sentences" enterkeyhint="send"></textarea>
        </div>
        <button type="button" class="pm-icon-btn" id="${p}-mic-btn" aria-label="Voice input">${b.micSmall}</button>
        <button type="submit" class="pm-send" id="${p}-send-btn" aria-label="Send">${b.send}</button>
      </div>
      <div class="pm-chat-voice-shell" id="${p}-voice-shell" hidden>
        <button type="button" class="pm-chat-voice-camera" id="${p}-voice-camera" aria-label="Attach camera image">${b.image}</button>
        <button type="button" class="pm-chat-voice-close" id="${p}-voice-close" aria-label="Close voice mode">&times;</button>
        <div class="pm-chat-voice-inline" id="${p}-voice-inline"></div>
      </div>
    </form>`}function Zt(e,i,{placeholder:p,isBusy:g,onSubmit:h,onAbort:d,draftKey:x="",voiceTarget:$=null,onVoiceSubmit:c=null,openCameraCapture:k=null}){let l=String(i||"pm-agent-chat"),n=e.querySelector(`#${l}-form`),s=e.querySelector(`#${l}-input`),M=e.querySelector(`#${l}-send-btn`),w=e.querySelector(`#${l}-attach-btn`),a=e.querySelector(`#${l}-mic-btn`),y=e.querySelector(`#${l}-voice-shell`),f=e.querySelector(`#${l}-voice-close`),T=e.querySelector(`#${l}-voice-camera`),C=e.querySelector(`#${l}-voice-inline`),O=e.querySelector(`#${l}-file-input`),I=e.querySelector(`#${l}-attach-tray`),J=e.querySelector(`#${l}-mode-launcher`),he=e.querySelector(`#${l}-mode-voice`),le=e.querySelector(`#${l}-mode-keyboard`),ae=String(x||"").trim(),H=null;ae&&(De[ae]||(De[ae]={text:"",pending:[]}),H=De[ae],Array.isArray(H.pending)||(H.pending=[]));let z=H?H.pending:[],_=!1,R=null,we=null,j=null,Z=0;s&&H?.text&&(s.value=H.text);let X=l==="pm-team-chat"||l==="pm-sa-chat",ne=document.querySelector(".pm-app")||document.body,ee=document.querySelector(".pm-tabbar"),P=window.visualViewport,$e=r=>{if(!ee)return 0;let m=getComputedStyle(ee);if(m.display==="none"||m.visibility==="hidden")return 0;let S=ee.getBoundingClientRect?.(),D=Math.max(0,Number(P?.offsetTop||0)),N=Math.max(0,Number(r||0));return!S||S.height<=0||S.bottom<=D||S.top>=N?0:Math.max(0,Math.round(N-Math.max(S.top,D)+16))},W=0,re=0,K=!1,te="",t=0,o=0,v=Math.max(Number(window.innerHeight||0),Number(P?.height||0)),L=0,A=0,E=e.querySelector?.(".pm-sa-chat-scrollport")||e.closest?.(".pm-page.pm-agent-chat-page")?.querySelector?.(".pm-sa-chat-scrollport")||e,oe=0,ce=0,B=Number(E?.scrollTop||0),F={passive:!0},V=["position","left","right","top","bottom","z-index"],ge=()=>{!n||!X||(K=!1,te="",t=0,o=0,L=0,A=0,V.forEach(r=>n.style.removeProperty(r)),ne?.classList.remove("pm-keyboard-open","pm-agent-composer-keyboard-open"),ne?.style.removeProperty("--pm-keyboard-offset"),ee?.style.removeProperty("display"),W&&cancelAnimationFrame(W),W=0,re&&window.clearTimeout(re),re=0)},Pt=()=>{if(W=0,!n||!X||!K)return;ee?.style.setProperty("display","none","important");let r=Math.max(Number(window.innerHeight||0),Number(document.documentElement?.clientHeight||0)),m=Math.max(0,Number(P?.offsetTop||0)),S=Math.max(0,Number(P?.height||r||0)),D=Math.round(m+S),N=P?Math.max(0,Math.round(r-S)):0,se=Math.max(0,Math.round(v-S));if((N>90||se>90)&&!te){let Ke=Number(n.getBoundingClientRect?.().bottom||0);te=Ke>0&&Ke<=D+44?"visual":"layout",te==="visual"&&(t=D,o=S)}else te==="visual"&&Math.abs(S-o)>2&&(t=D,o=S);let be=te==="visual"?t||D:r,ue=Math.max(54,Math.ceil(n.getBoundingClientRect?.().height||n.offsetHeight||54)),Me=$e(be),It=te==="layout"&&N>0?N+8:0,zt=Math.max(8,Me,It),Bt=Math.max(8,Math.round(be-zt-ue));n.style.setProperty("position","fixed","important"),n.style.setProperty("left","10px","important"),n.style.setProperty("right","10px","important"),n.style.setProperty("top",`${Bt}px`,"important"),n.style.setProperty("bottom","auto","important"),n.style.setProperty("z-index","10030","important"),ne?.classList.add("pm-keyboard-open","pm-agent-composer-keyboard-open"),ne?.style.setProperty("--pm-keyboard-offset",`${N}px`)},G=()=>{!X||!K||W||(W=requestAnimationFrame(()=>{if(W=0,!X||!K)return;let r=Math.max(Number(window.innerHeight||0),Number(document.documentElement?.clientHeight||0)),m=Math.max(0,Number(P?.height||r||0)),S=Math.max(0,r-m)>90||Math.max(0,v-m)>90,D=performance.now()<L||performance.now()<A;if(!S&&!D){xe();return}Pt()}))},Ne=()=>{X&&(K=!0,L=performance.now()+1600,ee?.style.setProperty("display","none","important"),v=Math.max(v,Number(window.innerHeight||0),Number(P?.height||0)),te="",t=0,o=0,ne?.classList.add("pm-keyboard-open","pm-agent-composer-keyboard-open"),ne?.style.setProperty("--pm-keyboard-offset","0px"),G(),[80,240,560,1e3].forEach(r=>window.setTimeout(G,r)),re&&window.clearTimeout(re),re=window.setTimeout(()=>{re=0,G()},1700))},xe=()=>{X&&(ge(),v=Math.max(Number(window.innerHeight||0),Number(P?.height||0)))},de=()=>{if(!s)return;let r=Math.max(320,Math.round(window.visualViewport?.height||window.innerHeight||640)),m=Math.max(96,Math.min(280,Math.floor(r*.5)-86)),S=Number(s.dataset.maxHeight||m);s.style.height="auto",s.style.height=`${Math.min(S,Math.max(30,s.scrollHeight||30))}px`,s.style.overflowY=s.scrollHeight>S?"auto":"hidden"},pe=()=>!!(String(s?.value||"").trim()||z.length),me=()=>$&&typeof c=="function"&&y&&C,jt=()=>{if(!X||!n||n.classList.contains("pm-composer-mode-hidden")||n.classList.contains("is-voice-active"))return!1;let r=K||ne?.classList?.contains("pm-keyboard-open"),m=K||document.activeElement===s;return r||m?!1:!n.classList.contains("has-text")&&!n.classList.contains("has-attachments")&&!n.classList.contains("has-pending-question")},Se=()=>{ce=performance.now()+900},Ie=()=>{let r=Number(E?.scrollTop||0),m=r-B;if(B=r,m>=-2)return;let S=performance.now();S<oe||S>ce||jt()&&(xe(),He(!1,{animate:!0,reason:"scroll"}))},ke=()=>{n&&(n.classList.toggle("is-focused",document.activeElement===s),n.classList.toggle("has-text",!!String(s?.value||"").trim()),n.classList.toggle("has-attachments",z.length>0))},ze=()=>{if(!(!y||!C)){y.hidden=!0;try{C._pmCleanup?.()}catch{}C.innerHTML="",Tt(),Y?.target?.kind==="subagent"&&Y.target.agentId===$?.agentId&&(Y.target=null,Y.subagentSubmit=null)}},Be=async({autoStart:r=!0}={})=>{if(!me()){U("Voice mode is not available for this composer.","error");return}let m={kind:"subagent",agentId:String($.agentId||"").trim(),label:String($.label||$.name||"Subagent").trim(),voice:$.voice&&typeof $.voice=="object"?$.voice:null};Y.target=m,Y.targetSessionId=`subagent_chat_${m.agentId}`,Y.targetSessionLabel=m.label,Y.targetSessionChannel="subagent",Y.targetSessionForced=!0,Y.subagentSubmit=async S=>c({text:String(S||"").trim(),files:[]}),_t(m.voice),y.hidden=!1,C.innerHTML="",await At(C,{inline:!0,inlineChatSessionId:Y.targetSessionId,inlineChatSessionLabel:m.label,autoStart:r,openCameraCapture:k,cameraButton:T})},He=(r,{animate:m=!0,reason:S="keyboard"}={})=>{!X||!n||!J||(!r&&K&&xe(),n.classList.toggle("pm-composer-mode-hidden",!r),n.setAttribute("aria-hidden",r?"false":"true"),r?n.removeAttribute("inert"):n.setAttribute("inert",""),J.setAttribute("aria-hidden",r?"true":"false"),J.classList.toggle("is-transitioning",m),oe=performance.now()+(S==="keyboard"?1800:420),m&&setTimeout(()=>J.classList.remove("is-transitioning"),360))},Fe=()=>{He(!0,{reason:"keyboard"}),Ne(),window.requestAnimationFrame(()=>s?.focus({preventScroll:!0}))},Ve=async()=>{if(He(!0,{reason:"voice"}),me()){await Be({autoStart:!0});return}window.requestAnimationFrame(()=>a?.click())};try{le&&ie(le,Fe),he&&ie(he,()=>{Ve().catch(()=>{})})}catch(r){console.warn("[mobile agent chat] mode haptic wiring failed:",r),le?.addEventListener("click",Fe),he?.addEventListener("click",()=>{Ve().catch(()=>{})})}E?.addEventListener("scroll",Ie,{passive:!0});for(let r of["touchstart","pointerdown","wheel"])E?.addEventListener(r,Se,F),E!==document&&document.addEventListener(r,Se,F);let fe=()=>{I&&(I.hidden=z.length===0,I.innerHTML=yt(z,!0),I.querySelectorAll("[data-remove-attachment]").forEach(r=>{r.addEventListener("click",()=>{let m=Number(r.getAttribute("data-remove-attachment"));Number.isFinite(m)&&z.splice(m,1),fe(),Q()})}),ke())},Q=()=>{let r=!!g?.(),m=r&&!pe();n&&(n.classList.toggle("is-busy",r),n.setAttribute("aria-busy",r?"true":"false"),n.dataset.composerState=r?m?"stopping":"busy":"idle"),s&&(s.placeholder=r?"Queue a message...":p),M&&(M.disabled=!1,M.classList.toggle("is-abort",m),M.classList.toggle("is-voice",!r&&!pe()&&me()),M.title=m?"Stop":!r&&!pe()&&me()?"Start voice mode":r?"Queue message":"Send",M.setAttribute("aria-label",m?"Stop":!r&&!pe()&&me()?"Start voice mode":r?"Queue message":"Send"),M.setAttribute("aria-busy",r?"true":"false"),M.innerHTML=m?'<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><rect x="7" y="7" width="10" height="10" rx="2"/></svg>':!r&&!pe()&&me()?`<img class="pm-send-voice-icon" src="${mt}" alt="" aria-hidden="true" />`:b.send),ke()},Ue=()=>{let r=String(s?.value||"").trim(),m=z.splice(0,z.length);if(s&&(s.value="",H&&(H.text=""),de()),_||R||j){_=!1,Z+=1,j&&clearTimeout(j),j=null;let S=R;R=null;try{S?.abort?.()}catch{try{S?.stop?.()}catch{}}a?.classList.remove("listening")}return fe(),Q(),{text:r,files:m}},Oe=({refocus:r=!0}={})=>{_=!1,Z+=1,j&&clearTimeout(j),j=null;let m=R;R=null;try{m?.stop?.()}catch{try{m?.abort?.()}catch{}}a?.classList.remove("listening"),r&&s?.focus(),de(),Q()},Dt=(r,m=140)=>{j&&clearTimeout(j),j=null,!(!_||R)&&(j=setTimeout(()=>{j=null,We(r)},m))},We=r=>{if(!(!_||R||!s))try{let m=new r,S=Z,D=String(s.value||"").trimEnd();R=m,m.lang=navigator.language||"en-US",m.interimResults=!0,m.continuous=!0,m.onstart=()=>{S===Z&&a?.classList.add("listening")},m.onresult=N=>{if(S!==Z)return;let se="",Re="";for(let ue=0;ue<N.results.length;ue+=1){let Me=String(N.results[ue]?.[0]?.transcript||"");N.results[ue].isFinal?se+=Me:Re+=Me}let be=`${se}${Re}`.trim();s.value=`${D}${D&&be?" ":""}${be}`,H&&(H.text=s.value||""),de(),Q()},m.onerror=N=>{if(S!==Z)return;let se=String(N?.error||"unknown");["not-allowed","service-not-allowed","audio-capture"].includes(se)?(_=!1,U(se==="audio-capture"?"The microphone is not available.":"Microphone permission was denied.","error")):["no-speech","aborted"].includes(se)||console.warn("[mobile agent chat] dictation cycle error:",se)},m.onend=()=>{if(S===Z){if(R===m&&(R=null),de(),Q(),!_){a?.classList.remove("listening");return}Dt(r)}},m.start()}catch(m){R=null,_=!1,a?.classList.remove("listening"),U(m?.message||"Could not start dictation.","error")}};s?.addEventListener("input",()=>{H&&(H.text=s.value||""),de(),Q()}),s?.addEventListener("focus",()=>{ke(),Ne()}),s?.addEventListener("blur",()=>window.setTimeout(()=>{ke();let r=document.activeElement,m=!!(r&&n?.contains?.(r)),S=Math.max(Number(window.innerHeight||0),Number(document.documentElement?.clientHeight||0)),D=Math.max(0,Number(P?.height||S||0)),N=Math.max(0,S-D)>90||Math.max(0,v-D)>90;if(m||performance.now()<A||N){K&&G();return}xe()},120)),P?.addEventListener("resize",G),P?.addEventListener("scroll",G),window.addEventListener("resize",G,{passive:!0}),window.addEventListener("orientationchange",G),n?.addEventListener("pointerdown",r=>{r.target?.closest?.("button, .pm-haptic-host")&&(A=performance.now()+700)},{passive:!0}),s?.addEventListener("keydown",r=>{r.key==="Enter"&&!r.shiftKey&&(r.preventDefault(),n?.requestSubmit?.())}),s?.addEventListener("paste",async r=>{let m=Array.from(r.clipboardData?.files||[]);if(!m.length)return;String(r.clipboardData?.getData?.("text/plain")||"").trim()||r.preventDefault();let S=await Promise.all(m.slice(0,8).map(je));z.push(...S.filter(Boolean)),fe(),Q()}),w?.addEventListener("click",()=>O?.click()),a?.addEventListener("click",()=>{let r=window.SpeechRecognition||window.webkitSpeechRecognition;if(!r){U("Speech dictation is not available in this browser.","error");return}if(_){Oe();return}we=r,_=!0,Z+=1,a.classList.add("listening"),U("Listening until you tap the mic again.","info"),We(r)}),f?.addEventListener("click",ze),T?.addEventListener("click",()=>{typeof k=="function"?k():O?.click()}),O?.addEventListener("change",async()=>{let r=Array.from(O.files||[]).slice(0,8);if(O.value="",!r.length)return;let m=await Promise.all(r.map(je));z.push(...m.filter(Boolean)),fe(),Q()}),n?.addEventListener("submit",async r=>{if(r.preventDefault(),g?.()&&!pe()){d?.(),Q();return}let m=Ue();if(!m.text&&!m.files.length){await Be({autoStart:!0});return}await h?.(m),Q()});let Nt=e._pmCleanup;return e._pmCleanup=()=>{W&&cancelAnimationFrame(W),P?.removeEventListener("resize",G),P?.removeEventListener("scroll",G),window.removeEventListener("resize",G),window.removeEventListener("orientationchange",G),E?.removeEventListener("scroll",Ie);for(let r of["touchstart","pointerdown","wheel"])E?.removeEventListener(r,Se,F),E!==document&&document.removeEventListener(r,Se,F);ge(),Oe({refocus:!1}),ze(),Nt?.()},requestAnimationFrame(()=>{fe(),de(),Q()}),{input:s,update:Q,consume:Ue,pending:z}}async function Xt(e,i,{standalone:p=!1,team:g=null}={}){e.innerHTML=`
    <div class="${p?"pm-sa-chat-shell pm-team-chat-page-shell":"pm-card"} pm-team-chat-card" id="pm-team-chat-card">
      <div id="pm-team-chat-list" class="pm-team-chat-list${p?" pm-chat-thread pm-sa-chat-scrollport pm-sa-chat-list":""}" aria-live="polite">
        <div class="pm-team-chat-status">Loading team chat&hellip;</div>
      </div>
      <div id="pm-team-chat-queue" class="pm-mobile-queued-prompts" hidden></div>
      <div id="pm-team-chat-goal" class="pm-mobile-goal-strip pm-mobile-goal-strip-inline" hidden></div>
      ${Jt("pm-team-chat","Message the team manager...")}
    </div>
  `;let h=e.querySelector("#pm-team-chat-list"),d=e.querySelector("#pm-team-chat-queue"),x=e.querySelector("#pm-team-chat-goal");xt(h,()=>{}),vt(x,ut.activeSessionId,{fallbackToLast:!0});let $=[],c=null,k=null,l=0,n="",s=!1,M=!1,w=[],a=[],y=null;function f(t={}){let o=t?.body&&typeof t.body=="object"?t.body:{},v=t?.metadata&&typeof t.metadata=="object"?t.metadata:{},L=String(t?.from||t?.role||"").toLowerCase(),A=L==="user"||L==="you"||L==="human",E=Ut(String(t?.content||t?.message||t?.text||o.text||""));return{...t,role:A?"user":"agent",from:A?"user":L||"manager",fromLabel:t?.fromLabel||t?.fromName||o.sender||(A?"You":"Manager"),content:E,body:{...o,text:E},createdAt:t?.createdAt||t?.timestamp||t?.ts||Date.now(),processEntries:Array.isArray(t?.processEntries)?t.processEntries:Array.isArray(v.processEntries)?v.processEntries:[]}}function T(t,o){if(o?.role==="user")return"";let v=t?.body&&typeof t.body=="object"?t.body:{},L=t?.metadata&&typeof t.metadata=="object"?t.metadata:{},A=String(t?.agentId||t?.subagentId||t?.memberId||t?.fromId||v.agentId||v.subagentId||L.agentId||L.subagentId||o?.from||"").trim().toLowerCase(),E=String(o?.fromLabel||"").trim().toLowerCase(),ce=(Array.isArray(g?.members)?g.members:[]).find(F=>{let V=String(F?.id||"").trim().toLowerCase(),ge=String(F?.name||"").trim().toLowerCase();return A&&(V===A||ge===A)||E&&(V===E||ge===E)}),B=String(ce?.id||(A&&!["agent","assistant","manager"].includes(A)?A:"manager")).trim();return`<span class="pm-team-sender-icon" aria-hidden="true">${Ct(B,{scale:.24})}</span>`}function C(t){let o=f(t),v=T(t,o);try{return St(o,{sender:o.fromLabel,senderIconHtml:v,chatParity:!0,live:t===c,keepLiveTraceVisible:t===c})}catch(L){console.warn("[mobile team chat] rich message render failed:",L);let A=o.role==="user";return`<div class="pm-msg ${A?"from-user":"from-ai"} pm-agent-chat-msg">
        <div class="pm-bubble">
          ${A?"":`<span class="pm-sender pm-sender-with-icon">${v}<span class="pm-sender-name">${u(o.fromLabel)}</span></span>`}
          <div class="markdown-body">${gt(o.content)}</div>
        </div>
      </div>`}}let O=()=>!!(k||c?.streaming||s),I=(t={})=>{let o=ye(t),v=String(o.sessionId||o.sourceSessionId||"").trim();return!!o.id&&(v.startsWith(`team_dm_manager_${i}___`)||v.startsWith(`team_dm_member_${i}___`)||v===`team_chat_${i}`||String(o.teamId||o.toolArgs?.teamId||"").trim()===String(i))},J=(t={})=>{if(!I(t))return!1;let o=ye(t),v=a.findIndex(A=>String(A?.approvalRequest?.id||"")===o.id),L={role:"agent",from:"manager",fromLabel:"Manager",content:"",createdAt:Date.now(),approvalRequest:o};return v>=0?a[v]={...a[v],approvalRequest:{...a[v].approvalRequest||{},...o}}:a.push(L),a=a.slice(-8),!0},he=(t,o,v={})=>{let L=String(t||"").trim();if(!L)return!1;let A=a.findIndex(E=>String(E?.approvalRequest?.id||"")===L);return A<0?!1:(a[A].approvalRequest=ye({...a[A].approvalRequest||{},...v.approval||v,id:L,status:o}),!0)},le=async()=>{let t=await Qe("pending").catch(()=>[]);(Array.isArray(t)?t:[]).forEach(J)};function ae(){d&&(d.hidden=w.length===0,d.innerHTML=w.length?`<div class="pm-mobile-queued-list">${w.map((t,o)=>`
           <div class="pm-mobile-queued-item">
             <button type="button" class="pm-mobile-queued-text" data-team-queue-edit="${o}">${u(String(t.text||"Attached file(s)").slice(0,120))}${t.files?.length?` <em>+${t.files.length}</em>`:""}</button>
             <div class="pm-mobile-queued-actions">
               <div class="pm-mobile-queued-menu-wrap">
                 <button type="button" class="pm-mobile-queued-icon pm-mobile-queued-menu-trigger" data-team-queue-menu="${o}" aria-label="Queued message actions" title="Actions">${b.dots}</button>
                 <div class="pm-mobile-queued-popover" data-team-queue-menu-popover="${o}" hidden>
                   <button type="button" class="pm-mobile-queued-menu-item pm-mobile-queued-steer" data-team-queue-steer="${o}">${b.target}<span>Steer</span></button>
                   <button type="button" class="pm-mobile-queued-menu-item pm-mobile-queued-remove" data-team-queue-remove="${o}">${b.trash}<span>Delete</span></button>
                 </div>
               </div>
             </div>
           </div>`).join("")}</div>`:"",ht(),d.querySelectorAll("[data-team-queue-edit]").forEach(t=>ie(t,()=>{})),d.querySelectorAll("[data-team-queue-menu]").forEach(t=>ie(t,()=>{let o=Number(t.getAttribute("data-team-queue-menu"));if(!Number.isInteger(o))return;let v=d.querySelector(`[data-team-queue-menu-popover="${o}"]`);if(!v)return;let L=!!v.hidden;Ce(d),v.hidden=!L})),d.querySelectorAll("[data-team-queue-steer]").forEach(t=>ie(t,()=>{let o=Number(t.getAttribute("data-team-queue-steer"));if(Number.isFinite(o)&&o>=0&&o<w.length){let[v]=w.splice(o,1);v&&w.unshift(v)}Ce(d),ae(),H()})),d.querySelectorAll("[data-team-queue-remove]").forEach(t=>ie(t,()=>{let o=Number(t.getAttribute("data-team-queue-remove"));Number.isFinite(o)&&w.splice(o,1),Ce(d),ae()})))}function H(){if(O()||!w.length){y?.update?.();return}let t=w.shift();ae(),te(t).catch(o=>U(o?.message||"Send failed","error"))}function z(t){let o=c&&!c._done?c:null;$=Array.isArray(t)?t.slice():[],o&&($.some(L=>String(L.content||L.message||L.text||"").trim()&&String(L.content||L.message||L.text||"").trim()===String(o.content||"").trim())||$.push(o))}function _(){let t=a.filter(v=>String(v?.approvalRequest?.status||"pending")==="pending"),o=[...$,...t];if(!o.length){h.innerHTML='<div style="text-align:center;color:var(--pm-muted);padding:24px 8px;font-size:13px;">No messages yet. Send the first one.</div>';return}Yt(h,o,C),Qt(h),h.querySelectorAll("[data-pm-approval-action][data-pm-approval-id]").forEach(ft),Et(h),h.scrollTop=h.scrollHeight}try{z(await Te(i,80)),await le(),_()}catch(t){h.innerHTML=`<div style="color:var(--pm-red);padding:16px;">${u(t.message||"Failed to load chat")}</div>`}async function R({forceHistory:t=!1}={}){try{let o=await at(i,n?l:0);o.stream?.streamId&&o.stream.streamId!==n&&(n=o.stream.streamId,l=0),o.stream?.streamId&&!c&&o.active&&(c={role:"manager",from:"manager",fromLabel:"Manager",content:"",_progress:"Reconnecting...",createdAt:Date.now(),workStartedAt:Date.now(),streaming:!0,processEntries:[]},$.push(c));for(let v of o.events||[])v.streamId&&(n=v.streamId),l=Math.max(l,Number(v.seq||0)),c||(c={role:"manager",from:"manager",fromLabel:"Manager",content:"",_progress:"Reconnecting...",createdAt:Date.now(),workStartedAt:Date.now(),streaming:!0,processEntries:[]},$.push(c)),qe(c,Gt(v),"Manager");(t||!o.active||c?._done)&&(z(await Te(i,80)),await le(),o.active||(c=null)),_()}catch{}}let we=()=>R({forceHistory:!0}),j=()=>{document.hidden||R({forceHistory:!0})},Z=async(t={})=>{if(String(t.teamId||"")===String(i))try{z(await Te(i,80)),c=null,_()}catch{}},X=(t={})=>{String(t.teamId||"")===String(i)&&(s||(t.streamId&&t.streamId!==n&&(n=t.streamId,l=0),l=Math.max(l,Number(t.seq||0)),c||(c={role:"manager",from:"manager",fromLabel:"Manager",content:"",_progress:"Thinking...",createdAt:Date.now(),workStartedAt:Date.now(),streaming:!0,processEntries:[]},$.push(c)),qe(c,{type:String(t.event||""),...t.data||{}},"Manager"),_()))},ne=async(t={})=>{let o=t.approval?ye(t.approval,t):await bt(t);J(o)&&_()},ee=t=>(o={})=>{let v=t==="approval_approved"?"approved":t==="approval_denied"?"rejected":t==="approval_expired"?"expired":"failed";he(o.approvalId||o.id||o.approval?.id,v,o)&&_()},P=ee("approval_approved"),$e=ee("approval_denied"),W=ee("approval_expired"),re=ee("approval_failed");q?.on?.("ws:open",we),q?.on?.("team_chat_message",Z),q?.on?.("team_chat_stream_event",X),q?.on?.("approval_created",ne),q?.on?.("approval_approved",P),q?.on?.("approval_denied",$e),q?.on?.("approval_expired",W),q?.on?.("approval_failed",re);let K=()=>{M||_()};window.addEventListener("prometheus:markdown-ready",K),document.addEventListener("visibilitychange",j),e._pmCleanup=()=>{if(!M){M=!0;try{k?.abort?.()}catch{}q?.off?.("ws:open",we),q?.off?.("team_chat_message",Z),q?.off?.("team_chat_stream_event",X),q?.off?.("approval_created",ne),q?.off?.("approval_approved",P),q?.off?.("approval_denied",$e),q?.off?.("approval_expired",W),q?.off?.("approval_failed",re),window.removeEventListener("prometheus:markdown-ready",K),document.removeEventListener("visibilitychange",j)}},R();async function te(t){let o=String(t?.text||"").trim(),v=Array.isArray(t?.files)?t.files:[],L=String(t?.source||"").trim(),A=o||(v.length?"Please review the attached file(s).":"");if(!A&&!v.length)return;if(O()){w.push({text:o,files:v,source:L,speak:t?.speak===!0,voice:t?.voice===!0}),ae(),y?.update?.();return}let E=A,oe=v;if(v.length){let B=await wt(v);E=`${A}${$t(B)}`,oe=B.map((F,V)=>({...v[V]||{},name:F.name||v[V]?.name||"attachment",kind:F.isImage?"image":F.isVideo?"video":v[V]?.kind||"file",workspacePath:F.workspacePath||v[V]?.workspacePath,path:F.workspacePath||v[V]?.path,dataUrl:v[V]?.dataUrl,mimeType:v[V]?.mimeType,sizeLabel:v[V]?.sizeLabel}))}let ce={role:"user",from:"user",content:A,body:{text:A,attachments:oe},attachmentPreviews:oe,createdAt:Date.now()};c={role:"manager",from:"manager",fromLabel:"Manager",content:"",_progress:"Manager is thinking...",createdAt:Date.now(),workStartedAt:Date.now(),streaming:!0,processEntries:[]},$.push(ce,c),_(),s=!0,y?.update?.(),k=nt(i,{message:E},{onEvent:B=>{qe(c,B,"Manager"),_()},onError:B=>{B?.name!=="AbortError"&&(c.content=c.content||`Error: ${B?.message||"stream failed"}`,c._progress="",c.streaming=!1,c.workEndedAt=Date.now(),s=!1,k=null,y?.update?.(),_(),U(B?.message||"Send failed","error"))},onDone:async()=>{c&&(c._progress="",c.streaming=!1,c.workEndedAt=c.workEndedAt||Date.now(),c.workDurationMs=Math.max(0,c.workEndedAt-Number(c.workStartedAt||c.createdAt||c.workEndedAt))),s=!1,k=null,y?.update?.(),await R({forceHistory:!0}),H()}})}y=Zt(e,"pm-team-chat",{placeholder:"Message the team manager...",draftKey:"team:manager",isBusy:O,onAbort:()=>{try{k?.abort?.()}catch{}c&&(c._progress="Stopping...",c.streaming=!1),k=null,s=!1,_()},onSubmit:te}),ae()}async function ca(e,{teamId:i,navigate:p}){e.classList.add("pm-agent-chat-page","pm-team-agent-chat-page"),e.dataset.mobileAgentChatRoute="team",document.body.classList.add("pm-mobile-subagent-chat-locked"),document.body.classList.add("pm-mobile-agent-chat-locked"),e.innerHTML=`
    ${_e({title:"Team Chat",online:!0,leftIcon:"back",hideTitle:!0,hideBrand:!0})}
    <div class="pm-body pm-subagent-chat-body pm-team-chat-page-body" id="pm-team-chat-page-body">
      <div class="pm-card" style="text-align:center;padding:24px;color:var(--pm-muted);">Loading team chat&hellip;</div>
    </div>
  `,Ee(e,{onBack:()=>p?.(`#mobile/teams/${encodeURIComponent(i)}`)});let g=e.querySelector("#pm-team-chat-page-body"),h=e.querySelector(".pm-model-badge .pm-model-badge-label"),d=!1;e._pmCleanup=()=>{if(!d){d=!0;try{g?._pmCleanup?.()}catch{}document.body.classList.remove("pm-mobile-agent-chat-locked","pm-mobile-subagent-chat-locked")}};try{let x=await Le(i);if(!x)throw new Error("Team not found");if(d||e.isConnected===!1)return;h&&(h.textContent=`${x.emoji||"\u{1F3E0}"} ${x.name}`),await Xt(g,i,{standalone:!0,team:x})}catch(x){g.innerHTML=`<div class="pm-empty"><div class="pm-empty-icon">${b.users}</div><h2>Couldn\u2019t load team chat</h2><p>${u(x?.message||"Network error")}</p></div>`}}function ea(e){let i=String(e||"").toLowerCase();return/\.(md|markdown|txt)$/.test(i)?"\u{1F4DD}":/\.(js|ts|tsx|jsx|mjs|cjs)$/.test(i)?"\u{1F4DC}":/\.(json|yaml|yml|toml)$/.test(i)?"\u{1F527}":/\.(png|jpg|jpeg|gif|svg|webp)$/.test(i)?"\u{1F5BC}\uFE0F":/\.(mp4|mov|webm|mkv)$/.test(i)?"\u{1F3AC}":/\.(mp3|wav|ogg|flac)$/.test(i)?"\u{1F3B5}":/\.(html|htm)$/.test(i)?"\u{1F310}":/\.(pdf)$/.test(i)?"\u{1F4C4}":"\u{1F4C3}"}function ta(e){return!e||e<1024?`${e||0} B`:e<1024*1024?`${(e/1024).toFixed(1)} KB`:`${(e/(1024*1024)).toFixed(2)} MB`}async function aa(e,i){e.innerHTML='<div class="pm-card" style="text-align:center;padding:24px;color:var(--pm-muted);">Loading workspace\u2026</div>';let p;try{p=await rt(i)}catch(a){e.innerHTML=`<div class="pm-empty"><div class="pm-empty-icon">${b.doc}</div><h2>Couldn\u2019t load workspace</h2><p>${u(a.message||"")}</p></div>`;return}let g=/^(Brain|audit|memory|temp)[\\/]|(^|[\\/])(tool_audit\.log|team-notes\.jsonl|last_run\.json|memory\.json|pending\.json)$/i,h=a=>String(a.relativePath||a.relpath||a.name||a.path||""),d=(p.files||[]).slice().sort((a,y)=>Number(y.modifiedAt||0)-Number(a.modifiedAt||0)),x=d.filter(a=>!g.test(h(a))),$=x.length===0;if(!d.length){e.innerHTML=`<div class="pm-empty"><div class="pm-empty-icon">${b.doc}</div><h2>Workspace is empty</h2><p>Files written by team subagents will appear here.</p></div>`;return}let c=$?d:x;e.innerHTML=`
    <div class="pm-card" style="padding:10px 12px 12px;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
        <strong style="font-size:13px;" id="pm-ws-count"></strong>
        ${d.length>x.length&&x.length?'<button type="button" class="pm-show-more" id="pm-ws-runtime-toggle">Show runtime files</button>':""}
      </div>
      ${p.workspacePath?`<div title="${u(p.workspacePath)}" style="font-size:11px;color:var(--pm-muted);font-family:ui-monospace,monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;direction:rtl;text-align:left;margin-bottom:8px;">${u(p.workspacePath)}</div>`:""}
      <div id="pm-ws-list" style="display:flex;flex-direction:column;gap:6px;"></div>
      <div id="pm-ws-preview" style="margin-top:12px;display:none;"></div>
    </div>
  `;let k=e.querySelector("#pm-ws-list"),l=e.querySelector("#pm-ws-preview"),n=e.querySelector("#pm-ws-count"),s=e.querySelector("#pm-ws-runtime-toggle"),M=()=>{c=$?d:x,n&&(n.textContent=$||!x.length?`${d.length} file${d.length===1?"":"s"}`:`${x.length} project file${x.length===1?"":"s"}`),s&&(s.textContent=$?"Hide runtime files":`Show runtime files (${d.length-x.length})`),k.innerHTML=c.map(a=>{let y=h(a),f=a.size||0,T=a.modifiedAt||a.updatedAt;return`
      <button type="button" data-rel="${u(y)}" style="display:flex;align-items:center;gap:10px;width:100%;text-align:left;color:var(--pm-text);background:var(--pm-bg-soft);border:1px solid var(--pm-border);border-radius:12px;padding:10px 12px;cursor:pointer;font-family:inherit;">
        <span style="font-size:18px;">${ea(y)}</span>
        <span style="flex:1;min-width:0;overflow:hidden;">
          <span style="display:block;font-weight:700;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${u(y)}</span>
          <span style="display:block;font-size:11px;color:var(--pm-muted);">${ta(f)}${T?" \xB7 "+ve(typeof T=="number"?T:new Date(T).getTime()):""}</span>
        </span>
        <span style="color:var(--pm-muted);">${b.chev}</span>
      </button>
    `}).join(""),w()};s?.addEventListener("click",()=>{$=!$,M()});function w(){k.querySelectorAll("[data-rel]").forEach(a=>{a.addEventListener("click",async()=>{let y=a.getAttribute("data-rel");l.style.display="block",l.innerHTML=`<div class="pm-card-body" style="padding:14px;color:var(--pm-muted);">Loading ${u(y)}\u2026</div>`;try{let f=await st(i,y),T=f?.content||f?.body||"";l.innerHTML=`
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
            <strong style="flex:1;font-size:13px;">${u(y)}</strong>
            <button class="pm-btn ghost" id="pm-ws-close" style="padding:4px 10px;font-size:12px;">\u2715 Close</button>
          </div>
          <pre style="background:var(--pm-bg-soft);border:1px solid var(--pm-border);border-radius:10px;padding:12px;font-size:12px;line-height:1.5;font-family:ui-monospace,monospace;white-space:pre-wrap;word-break:break-word;max-height:60vh;overflow:auto;margin:0;">${u(String(T).slice(0,5e4))}${String(T).length>5e4?`

\u2026(truncated)`:""}</pre>
        `,l.querySelector("#pm-ws-close").addEventListener("click",()=>{l.style.display="none",l.innerHTML=""}),l.scrollIntoView({behavior:"smooth",block:"nearest"})}catch(f){l.innerHTML=`<div class="pm-card-body" style="color:var(--pm-red);">${u(f.message||"Failed to load file")}</div>`}})})}M()}async function na(e,i,p){e.innerHTML='<div class="pm-card" style="text-align:center;padding:24px;color:var(--pm-muted);">Loading memory\u2026</div>';let g=null;try{g=await Ae(i)}catch{}if(g){let n=a=>String(a||"").replace(/\[DURABLE_TURN_COMMENTARY\][\s\S]*$/,"").replace(/\*\*/g,"").trim(),s=(Array.isArray(g.artifacts)?g.artifacts:[]).slice().reverse().slice(0,12),M=(Array.isArray(g.blockers)?g.blockers:[]).slice().reverse().slice(0,8),w=(Array.isArray(g.recentEvents)?g.recentEvents:[]).filter(a=>a&&a.category!=="tool"&&n(a.content)).slice().reverse().slice(0,15);if(s.length||M.length||w.length){let a=(f,T)=>T?`<div style="font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;color:var(--pm-muted);margin:14px 4px 6px;">${f}</div>${T}`:"",y=f=>f?ve(typeof f=="number"?f:new Date(f).getTime()):"";e.innerHTML=`
        ${a(`Blockers (${M.length})`,M.map(f=>`
          <article class="pm-card" style="padding:10px 12px;border-color:var(--pm-red);">
            <div class="pm-card-body">${u(n(f.content||f.reason||f.title||"Blocker"))}</div>
            <div style="font-size:11px;color:var(--pm-muted);margin-top:4px;">${u(f.agentName||f.agentId||"")} ${y(f.createdAt||f.timestamp)}</div>
          </article>`).join(""))}
        ${a(`Artifacts (${s.length})`,s.map(f=>`
          <article class="pm-card" style="padding:10px 12px;">
            <div style="display:flex;gap:8px;align-items:center;">
              <strong style="flex:1;font-size:13px;line-height:1.3;">${u(f.name||f.title||"Artifact")}</strong>
              <span style="font-size:11px;color:var(--pm-muted);white-space:nowrap;">${y(f.createdAt||f.timestamp)}</span>
            </div>
            ${f.description?`<div class="pm-card-body" style="font-size:13px;margin-top:4px;">${u(String(f.description).slice(0,220))}</div>`:""}
            ${f.path?`<div title="${u(f.path)}" style="font-size:11px;color:var(--pm-muted);font-family:ui-monospace,monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;direction:rtl;text-align:left;margin-top:4px;">${u(f.path)}</div>`:""}
          </article>`).join(""))}
        ${a("Recent activity",w.map(f=>`
          <article class="pm-card" style="padding:10px 12px;">
            <div style="display:flex;gap:8px;align-items:center;margin-bottom:4px;">
              <strong style="flex:1;font-size:13px;">${u(f.actorName||f.actorType||"Team")}</strong>
              <span style="font-size:11px;color:var(--pm-muted);white-space:nowrap;">${y(f.timestamp)}</span>
            </div>
            <div class="pm-card-body" style="font-size:13px;display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden;">${u(n(f.content).slice(0,400))}</div>
          </article>`).join(""))}
      `;return}}let h;try{h=await ot()}catch(n){e.innerHTML=`<div class="pm-empty"><div class="pm-empty-icon">${b.brain}</div><h2>Couldn\u2019t load memory</h2><p>${u(n.message||"")}</p></div>`;return}let d=Array.isArray(h?.nodes)?h.nodes.slice():[],x=String(i).toLowerCase(),$=String(p?.name||"").toLowerCase(),c=n=>{let s=String(n.sourcePath||"").toLowerCase(),M=String(n.projectId||"").toLowerCase();return M&&M.includes(x)||s&&(s.includes(x)||$&&s.includes($))},k=d.filter(c),l=(k.length?k:d).sort((n,s)=>String(s.timestamp||"").localeCompare(String(n.timestamp||""))).slice(0,30);if(!l.length){e.innerHTML=`<div class="pm-empty"><div class="pm-empty-icon">${b.brain}</div><h2>No memory yet</h2><p>As the team works, reflections and memory entries land here.</p></div>`;return}e.innerHTML=`
    <div style="display:flex;align-items:center;gap:8px;padding:6px 4px 10px;color:var(--pm-muted);font-size:12px;">
      <span class="pm-pill ${k.length?"orange":"gray"}">${k.length?"team-scoped":"global feed"}</span>
      <span>${l.length} of ${d.length} entries</span>
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
  `}export{ia as a,la as b,Ot as c,Gt as d,Qt as e,Yt as f,Jt as g,Zt as h,ca as i};
