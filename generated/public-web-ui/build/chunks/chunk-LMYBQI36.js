import{A as kt,C as Q,H as Lt,I as Mt,J as At,M as Tt,O as _t,c as mt,f as ut,g as vt,h as Ee,i as ht,j as gt,l as fe,m as ft,o as bt,p as yt,q as Pe,r as wt,s as $t,t as xt,u as Ce,v as St}from"./chunk-2AOFYIKJ.js";import{b as ue}from"./chunk-J5HXEABW.js";import{a as ee}from"./chunk-35CAQ6TV.js";import{H as b,I as m,O as Te,P as _e}from"./chunk-JLTKH2SU.js";import{e as oe}from"./chunk-T5RPXYYW.js";import{a as ct,b as dt,c as pt}from"./chunk-PHXVQCOK.js";import{La as lt,Q as Re,R as Ye,S as Le,T as Je,U as Ze,V as Xe,X as et,Y as Me,Z as tt,_ as Ae,aa as at,ba as nt,c as Ge,ca as rt,da as st,ea as ot,ga as it,s as Qe}from"./chunk-3GPYCJDH.js";import{a as C}from"./chunk-DFHP73MY.js";function zt(e){let i=e.house==="blue"?"#4a82d1":"#a4682b";return`
    <button class="pm-team-tile ${e.featured?"featured":""}" data-team="${e.id}">
      ${e.featured?'<span class="pm-star">\u2605</span>':""}
      <span class="pm-house" style="color:${i}">\u{1F3E0}</span>
      <span class="pm-team-name">${m(e.name)}</span>
      <span class="pm-team-agents">${b.users} ${e.agents} agents</span>
    </button>
  `}function Et(){return`<div class="pm-team-grid">${'<div class="pm-team-tile" style="opacity:.55"><span class="pm-house" style="opacity:.4">\u{1F3E0}</span><span class="pm-team-name" style="background:rgba(0,0,0,.06);color:transparent;border-radius:6px;height:16px;width:80%;">loading</span></div>'.repeat(4)}</div>`}async function ra(e,{navigate:i}){let u=`
    <span class="pm-count-pill" id="pm-teams-count">\u2026</span>
    <span class="pm-spacer"></span>
    <button class="pm-icon-btn" id="pm-teams-refresh" aria-label="Refresh" style="background:var(--pm-surface);border:1px solid var(--pm-border);">${b.refresh}</button>
  `,f=Te({title:"Teams",online:!1,extras:u});e.innerHTML=`
    ${f}
    <div class="pm-body" id="pm-teams-body">${Et()}</div>
  `,_e(e,{});let g=e.querySelector("#pm-teams-body"),d=e.querySelector("#pm-teams-count"),x=e.querySelector("#pm-teams-refresh");async function $({force:L=!1}={}){let l=[];try{l=await Ye({force:L})}catch(w){g.innerHTML=`<div class="pm-empty"><div class="pm-empty-icon">${b.users}</div><h2>Couldn\u2019t load teams</h2><p>${m(w.message||"Network error")}</p></div>`,d.textContent="0 teams";return}if(d.textContent=`${l.length} team${l.length===1?"":"s"}`,!l.length){g.innerHTML=`<div class="pm-empty"><div class="pm-empty-icon">${b.users}</div><h2>No teams yet</h2><p>Create your first team from the desktop app.</p></div>`;return}let n=l.find(w=>w.featured)||l[0],s=null;try{s=await Le(n.id)}catch{}let M=s?`
      <div class="pm-team-preview">
        <div class="pm-team-preview-head">
          <span class="pm-mini-house">${m(s.emoji||"\u{1F3E0}")}</span>
          <h3>${m(s.name)}</h3>
          <button class="pm-pill-btn" data-go="${m(s.id)}">View Team ${b.chev}</button>
        </div>
        <div style="font-size:13px;color:var(--pm-muted);font-weight:700;margin-top:4px;">Team members</div>
        <div class="pm-chip-row">
          ${s.members.map(w=>`<span class="pm-member-chip"><span class="pm-avatar" style="background:${w.color}">${w.avatar}</span>${m(w.name)}</span>`).join("")}
        </div>
        <div class="pm-divider"></div>
        <button type="button" class="pm-row pm-row-link" data-go-ws="${m(s.id)}"><span>\u{1F5C2}\uFE0F Workspace</span><span style="color:var(--pm-muted);display:inline-flex;align-items:center;gap:4px;">Open ${b.chev}</span></button>
        <div class="pm-divider"></div>
        <div class="pm-row" style="flex-direction:column;align-items:stretch;gap:4px;">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <strong>Progress</strong>
            <span style="color:var(--pm-muted)">Recent runs <b style="color:var(--pm-text)">${s.runsDone} / ${s.runsTotal} runs</b></span>
          </div>
          <div class="pm-progress"><span style="width:${s.runsTotal?Math.round(s.runsDone/s.runsTotal*100):0}%"></span></div>
        </div>
      </div>
    `:"";g.innerHTML=`
      <div class="pm-team-grid">${l.map(zt).join("")}</div>
      ${M}
    `,g.querySelectorAll("[data-team]").forEach(w=>{w.addEventListener("click",()=>i(`#mobile/teams/${w.getAttribute("data-team")}`))}),g.querySelectorAll("[data-go]").forEach(w=>{w.addEventListener("click",()=>i(`#mobile/teams/${w.getAttribute("data-go")}`))}),g.querySelectorAll("[data-go-ws]").forEach(w=>{w.addEventListener("click",()=>i(`#mobile/teams/${encodeURIComponent(w.getAttribute("data-go-ws"))}/workspace`))})}x.addEventListener("click",()=>{Re(),g.innerHTML=Et(),$({force:!0})});let c=Ge("teams_raw",216e5);await $(),Array.isArray(c)&&$({force:!0}).catch(()=>{})}function Bt(){return`
    <div class="pm-detail-head"><span class="pm-house-icon">\u{1F3E0}</span><h1 style="background:rgba(0,0,0,.06);color:transparent;border-radius:8px;height:24px;flex:1;">loading</h1></div>
    <div class="pm-detail-sub">\u2026</div>
    <div class="pm-action-row">
      <button class="pm-action-btn primary">${b.play} Start Run</button>
      <button class="pm-action-btn">${b.pause} Pause</button>
      <button class="pm-action-btn">${b.brain} Review</button>
      <button class="pm-action-btn danger">${b.trash} Delete</button>
    </div>
    <div class="pm-card" style="opacity:.5"><div class="pm-card-head">${b.target} Purpose</div><div class="pm-card-body">Loading team\u2026</div></div>
  `}async function sa(e,{teamId:i,navigate:u,initialTab:f=""}){e.innerHTML=`
    ${Te({title:"Team",online:!0,leftIcon:"back",hideTitle:!0,hideBrand:!0})}
    <div class="pm-body pm-subagent-detail-body pm-team-detail-body" id="pm-detail-body">${Bt()}</div>
  `,_e(e,{onBack:()=>u("#mobile/teams")});let g=e.querySelector("#pm-detail-body"),d=null;try{d=await Le(i)}catch(a){g.innerHTML=`<div class="pm-empty"><div class="pm-empty-icon">${b.users}</div><h2>Couldn\u2019t load team</h2><p>${m(a.message||"Network error")}</p></div>`;return}if(!d){g.innerHTML=`<div class="pm-empty"><div class="pm-empty-icon">${b.users}</div><h2>Team not found</h2><p>This team isn\u2019t available right now.</p></div>`;return}let x=["Context","Subagents","Workspace","Memory","Runs","Team Chat"];g.innerHTML=`
    <div class="pm-detail-head">
      <span class="pm-house-icon">${m(d.emoji||"\u{1F3E0}")}</span>
      <h1>${m(d.name)}</h1>
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
      ${x.map((a,y)=>`<button class="${y===0?"active":""}" data-tab="${a}">${m(a)}</button>`).join("")}
    </div>

    <div id="pm-tab-slot"></div>

    <div id="pm-context-slot">
    <div class="pm-team-preview">
      <div class="pm-team-preview-head">
        <span class="pm-mini-house">${m(d.emoji||"\u{1F3E0}")}</span>
        <h3>${m(d.name)}</h3>
      </div>
      <div style="font-size:13px;color:var(--pm-muted);">${d.subagents} subagents \xB7 ${d.totalRuns} total runs</div>
      <div class="pm-chip-row">
        ${d.members.map(a=>`<span class="pm-member-chip"><span class="pm-avatar" style="background:${a.color}">${a.avatar}</span>${m(a.name)}</span>`).join("")}
      </div>
    </div>

    <div class="pm-card">
      <div class="pm-card-head" style="display:flex;justify-content:space-between;align-items:center;">
        <span>${b.target} Purpose</span>
        <button class="pm-show-more" data-toggle-purpose>Show more \u25BE</button>
      </div>
      <div class="pm-card-body" data-purpose data-collapsed="1" style="display:-webkit-box;-webkit-line-clamp:6;-webkit-box-orient:vertical;overflow:hidden;">${m(d.purpose)}</div>
    </div>

    <div class="pm-card-grid">
      <div class="pm-card">
        <div class="pm-card-head">${b.check} Current Task / Goal</div>
        <div class="pm-card-body">${m(d.currentTask)}</div>
      </div>
      <div class="pm-card">
        <div class="pm-card-head">${b.clock} Last Run</div>
        <div class="pm-card-body strong">${m(d.lastRun)}</div>
      </div>
      <div class="pm-card">
        <div class="pm-card-head">${b.users} Member States</div>
        <div class="pm-card-body" data-member-states>${m(d.memberStates)}</div>
      </div>
      <div class="pm-card">
        <div class="pm-card-head">${b.send} Active Dispatches</div>
        <div class="pm-card-body" data-dispatches>${m(d.dispatches)}</div>
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
        <a href="#mobile/teams/${m(i)}/workspace" style="color:var(--pm-orange);font-weight:700;text-decoration:none;font-size:13px;">Open Workspace \u203A</a>
      </div>
      <div class="pm-card-body">${m(d.workspace)}</div>
    </div>
    </div><!-- /pm-context-slot -->
  `;let $=g.querySelector("#pm-context-slot"),c=g.querySelector("#pm-tab-slot");async function L(a){try{c?._pmCleanup?.()}catch{}if(c&&(c._pmCleanup=null),g.querySelectorAll(".pm-tabs button").forEach(y=>y.classList.toggle("active",y.getAttribute("data-tab")===a)),a==="Context"){$.style.display="",c.innerHTML="";return}$.style.display="none",c.innerHTML=`<div class="pm-card" style="text-align:center;padding:24px;color:var(--pm-muted);">Loading ${m(a)}\u2026</div>`;try{if(a==="Subagents")await qt(c,d);else if(a==="Runs")await Ot(c,i);else if(a==="Team Chat"){u(`#mobile/teams/${encodeURIComponent(i)}/chat`);return}else a==="Workspace"?await Xt(c,i):a==="Memory"&&await ea(c,i,d)}catch(y){c.innerHTML=`<div class="pm-card"><div class="pm-card-head">${b.users} Error</div><div class="pm-card-body">${m(y.message||"Failed to load")}</div></div>`}}g.querySelectorAll(".pm-tabs button").forEach(a=>{a.addEventListener("click",()=>L(a.getAttribute("data-tab")))}),Me(i).then(a=>{if(!a)return;let y=z=>(d.members||[]).find(Y=>Y.id===z)?.name||z,h=g.querySelector("[data-member-states]"),T=Object.entries(a.memberStates||{});h&&T.length&&(h.innerHTML=T.map(([z,Y])=>`<div style="display:flex;justify-content:space-between;gap:8px;"><span>${m(y(z))}</span><span style="color:var(--pm-muted)">${m(String(Y?.status||"idle"))}</span></div>`).join(""));let E=g.querySelector("[data-dispatches]"),U=Array.isArray(a.activeDispatches)?a.activeDispatches:[];E&&(E.textContent=U.length?`${U.map(z=>y(String(z.agentId||z.subagentId||""))).join(", ")} working`:"No active dispatches.")}).catch(()=>{});let l=x.find(a=>a.toLowerCase().replace(/\s+/g,"-")===String(f||"").toLowerCase());l&&l!=="Context"&&L(l);let n=g.querySelector("[data-toggle-purpose]"),s=g.querySelector("[data-purpose]");n&&s&&n.addEventListener("click",()=>{s.getAttribute("data-collapsed")==="1"?(s.style.webkitLineClamp="unset",s.style.display="block",s.setAttribute("data-collapsed","0"),n.textContent="Show less \u25B4"):(s.style.display="-webkit-box",s.style.webkitLineClamp="6",s.setAttribute("data-collapsed","1"),n.textContent="Show more \u25BE")});async function M(a,y,h){let T=a.innerHTML;a.disabled=!0,a.style.opacity="0.6";try{let E=await y();if(!E||E.success===!1)throw new Error(E?.error||"Failed");return ee(h,"success"),E}catch(E){throw ee(E.message||"Action failed","error"),E}finally{a.disabled=!1,a.style.opacity="",a.innerHTML=T}}g.querySelectorAll("[data-act]").forEach(a=>{let y=a.getAttribute("data-act");a.addEventListener("click",async()=>{if(y==="start")await M(a,()=>Je(i),"Run started").catch(()=>{});else if(y==="pause"){let h=d.paused;try{await M(a,()=>h?Xe(i):Ze(i),h?"Team resumed":"Team paused"),d.paused=!h,a.innerHTML=d.paused?`${b.play} Resume`:`${b.pause} Pause`}catch{}}else if(y==="chat")u(`#mobile/teams/${encodeURIComponent(i)}/chat`);else if(y==="delete"){if(!window.confirm(`Delete team "${d.name}"? This cannot be undone.`))return;try{await M(a,()=>et(i),"Team deleted"),Re(),u("#mobile/teams")}catch{}}})});let w=g.querySelector("[data-save-ref]");w&&w.addEventListener("click",async()=>{let a=g.querySelector("#pm-ref-title"),y=g.querySelector("#pm-ref-body"),h=(a.value||"").trim(),T=(y.value||"").trim();if(!h||!T){ee("Title and content required","error");return}try{await M(w,()=>lt(i,h,T),"Reference saved"),a.value="",y.value=""}catch{}}),e._pmCleanup=()=>{try{c?._pmCleanup?.()}catch{}}}var Ct={working:{label:"working",cls:"running"},active:{label:"active",cls:"active"},ready:{label:"ready",cls:"active"},idle:{label:"idle",cls:"gray"},blocked:{label:"blocked",cls:"orange"},paused:{label:"paused",cls:"gray"},awaiting:{label:"awaiting",cls:"orange"},offline:{label:"offline",cls:"gray"}};function Ft(e){let i=/^Goal update \(([a-z_]+)\):\s*(\{[\s\S]*\})\s*$/.exec(String(e||"").trim());if(!i)return e;let u;try{u=JSON.parse(i[2])}catch{return e}let f=g=>String(g??"").replace(/\s+/g," ").trim();switch(i[1]){case"log_completed":return`\u2705 Logged as done: ${f(u.entry??u.completed??u.text)}`;case"set_focus":return`\u{1F3AF} Focus set: ${f(u.focus??u.current_focus??u.text)}`;case"pause_agent":return`\u23F8 Paused ${f(u.agent_id)}`;case"unpause_agent":return`\u25B6 Resumed ${f(u.agent_id)}`;default:return`Goal update (${i[1]})`}}function Vt(e){if(!e||e<0)return"\u2014";let i=Math.floor(e/1e3);return i<60?`${i}s`:`${Math.floor(i/60)}m ${i%60}s`}async function qt(e,i){let u=null;try{u=await Me(i.id)}catch{}let f=u?.memberStates||{},g=Array.isArray(u?.activeDispatches)?u.activeDispatches:[],d=new Map;for(let l of g){let n=String(l.agentId||l.subagentId||"").trim();n&&d.set(n,l)}let x=i.members.filter(l=>l.id!=="manager"),$=new Map((await Promise.all(x.map(async l=>{let n=await it(l.id).catch(()=>null);return[l.id,n]}))).filter(([,l])=>l)),c=[],L=x.map(l=>{let n=f[l.id]||{},s=Ct[String(n.status||"idle").toLowerCase()]||Ct.idle,M=d.get(l.id),w=$.get(l.id),a=`pm-team-member-model-${i.id}-${l.id}`.replace(/[^a-zA-Z0-9_-]/g,"-");return w&&c.push({pickerScope:a,agent:w}),`
      <article class="pm-card pm-team-member-card">
        <div class="pm-schedule-head" style="margin-bottom:8px;">
          <span class="pm-emoji" style="font-size:22px;">${l.avatar}</span>
          <h3 style="margin:0;">${m(l.name)}</h3>
          <span class="pm-pill ${s.cls}">${s.label}</span>
        </div>
        ${n.currentTask?`<div class="pm-card-body" style="margin-bottom:6px;"><strong>Current:</strong> ${m(n.currentTask)}</div>`:""}
        ${n.blockedReason?`<div class="pm-card-body" style="color:var(--pm-red);margin-bottom:6px;"><strong>Blocked:</strong> ${m(n.blockedReason)}</div>`:""}
        ${n.lastResult?`<div class="pm-card-body" style="font-size:13px;color:var(--pm-muted);margin-bottom:6px;">Last: ${m(String(n.lastResult).slice(0,140))}${String(n.lastResult).length>140?"\u2026":""}</div>`:""}
        <div style="display:flex;justify-content:space-between;align-items:center;font-size:12px;color:var(--pm-muted);">
          <span>${M?"\u{1F4E1} dispatched":"Last update"}</span>
          <span>${ue(n.lastUpdateAt||M?.startedAt)}</span>
        </div>
        ${w?`<details class="pm-model-details"><summary>Model settings</summary>${ct(w,a)}</details>`:""}
      </article>
    `}).join("");e.innerHTML=L||`<div class="pm-empty"><div class="pm-empty-icon">${b.robot}</div><h2>No subagents yet</h2><p>Add members from the desktop team editor.</p></div>`,c.forEach(({pickerScope:l,agent:n})=>{pt(l,()=>qt(e,i)),dt(l,n)})}function Ut(e){return e.inProgress?'<span class="pm-pill running">running</span>':e.success===!0?'<span class="pm-pill active">success</span>':e.success===!1&&e.taskStatus?`<span class="pm-pill orange">${m(String(e.taskStatus))}</span>`:'<span class="pm-pill gray">complete</span>'}async function Ot(e,i){let{runs:u}=await tt(i,30);if(!u.length){e.innerHTML=`<div class="pm-empty"><div class="pm-empty-icon">${b.clock}</div><h2>No runs yet</h2><p>Start a run from the top of this page.</p></div>`;return}e.innerHTML=u.map(f=>`
    <article class="pm-card" style="padding:14px 16px;">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
        <strong style="flex:1;font-size:14px;">${m(f.agentName||f.agentId||"Agent")}</strong>
        ${Ut(f)}
      </div>
      ${f.taskSummary?`<div class="pm-card-body" style="margin-bottom:6px;">${m(String(f.taskSummary).slice(0,200))}${String(f.taskSummary).length>200?"\u2026":""}</div>`:""}
      <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--pm-muted);">
        <span>${m(f.trigger||"manual")} \xB7 ${f.stepCount||0} steps</span>
        <span>${ue(f.startedAt)} \xB7 ${Vt(f.durationMs)}</span>
      </div>
    </article>
  `).join("")}function Wt(e){return e?{type:String(e.type||e.event||""),...e.data||{}}:null}function Kt(e,i,u){if(!e)return;let f=new Set,g=new Set;e.querySelectorAll(".pm-agent-chat-msg").forEach((d,x)=>{d.querySelector(".pm-trace-drawer.open")&&f.add(x),d.querySelectorAll("details.pm-trace-tool-group[open]").forEach((c,L)=>{g.add(`${x}:${c.getAttribute("data-pm-trace-group")||L}`)})}),e.innerHTML=i.map(u).join(""),e.querySelectorAll(".pm-agent-chat-msg").forEach((d,x)=>{let $=d.querySelector(".pm-trace-drawer"),c=d.querySelector('[data-expandable="trace"]');$&&f.has(x)&&($.classList.add("open"),c?.classList.add("expanded")),d.querySelectorAll("details.pm-trace-tool-group").forEach((L,l)=>{let n=`${x}:${L.getAttribute("data-pm-trace-group")||l}`;g.has(n)&&!L.closest('.pm-trace-drawer[data-trace-completed="1"]')&&L.setAttribute("open","")})}),kt(e)}var je={};function Gt(e,i){let u=String(e||"pm-agent-chat"),f=u==="pm-team-chat"||u==="pm-sa-chat";return`
    ${f?`<div class="pm-chat-mode-launcher pm-agent-chat-mode-launcher" id="${u}-mode-launcher" role="group" aria-label="Choose chat input">
      <button type="button" class="pm-chat-mode-button pm-chat-mode-button--voice" id="${u}-mode-voice" aria-label="Start voice mode">${b.micSmall}<span class="pm-chat-mode-button-label">Voice mode</span></button>
      <button type="button" class="pm-chat-mode-button pm-chat-mode-button--keyboard" id="${u}-mode-keyboard" aria-label="Open keyboard composer">${b.keyboard}<span class="pm-chat-mode-button-label">Keyboard composer</span></button>
    </div>`:""}
    <form class="pm-composer pm-agent-chat-composer${f?" pm-composer-mode-hidden":""}" id="${u}-form"${f?' aria-hidden="true" inert':""}>
      <span class="pm-glass-lens" aria-hidden="true"></span>
      <span class="pm-glass-border" aria-hidden="true"></span>
      <input id="${u}-file-input" type="file" multiple accept="image/*,video/*,.mp4,.mov,.m4v,.webm,.avi,.mkv,.txt,.md,.json,.csv,.tsv,.log,.xml,.html,.css,.js,.ts,.tsx,.jsx,.py,.yaml,.yml,application/pdf" hidden />
      <div class="pm-attach-tray" id="${u}-attach-tray" hidden></div>
      <div class="pm-composer-row">
        <button type="button" class="pm-icon-btn" id="${u}-attach-btn" aria-label="Attach files">${b.paperclip}</button>
        <div class="pm-composer-input-wrap" id="${u}-input-wrap">
          <textarea class="pm-composer-input" id="${u}-input" rows="1" placeholder="${m(i)}" aria-label="Message" autocomplete="off" autocapitalize="sentences" enterkeyhint="send"></textarea>
        </div>
        <button type="button" class="pm-icon-btn" id="${u}-mic-btn" aria-label="Voice input">${b.micSmall}</button>
        <button type="submit" class="pm-send" id="${u}-send-btn" aria-label="Send">${b.send}</button>
      </div>
      <div class="pm-chat-voice-shell" id="${u}-voice-shell" hidden>
        <button type="button" class="pm-chat-voice-camera" id="${u}-voice-camera" aria-label="Attach camera image">${b.image}</button>
        <button type="button" class="pm-chat-voice-close" id="${u}-voice-close" aria-label="Close voice mode">&times;</button>
        <div class="pm-chat-voice-inline" id="${u}-voice-inline"></div>
      </div>
    </form>`}function Qt(e,i,{placeholder:u,isBusy:f,onSubmit:g,onAbort:d,draftKey:x="",voiceTarget:$=null,onVoiceSubmit:c=null,openCameraCapture:L=null}){let l=String(i||"pm-agent-chat"),n=e.querySelector(`#${l}-form`),s=e.querySelector(`#${l}-input`),M=e.querySelector(`#${l}-send-btn`),w=e.querySelector(`#${l}-attach-btn`),a=e.querySelector(`#${l}-mic-btn`),y=e.querySelector(`#${l}-voice-shell`),h=e.querySelector(`#${l}-voice-close`),T=e.querySelector(`#${l}-voice-camera`),E=e.querySelector(`#${l}-voice-inline`),U=e.querySelector(`#${l}-file-input`),z=e.querySelector(`#${l}-attach-tray`),Y=e.querySelector(`#${l}-mode-launcher`),ve=e.querySelector(`#${l}-mode-voice`),ie=e.querySelector(`#${l}-mode-keyboard`),te=String(x||"").trim(),q=null;te&&(je[te]||(je[te]={text:"",pending:[]}),q=je[te],Array.isArray(q.pending)||(q.pending=[]));let B=q?q.pending:[],_=!1,H=null,be=null,D=null,J=0;s&&q?.text&&(s.value=q.text);let Z=l==="pm-team-chat"||l==="pm-sa-chat",ae=document.querySelector(".pm-app")||document.body,re=document.querySelector(".pm-tabbar"),R=window.visualViewport,ye=r=>{if(!re)return 0;let p=getComputedStyle(re);if(p.display==="none"||p.visibility==="hidden")return 0;let S=re.getBoundingClientRect?.(),N=Math.max(0,Number(R?.offsetTop||0)),I=Math.max(0,Number(r||0));return!S||S.height<=0||S.bottom<=N||S.top>=I?0:Math.max(0,Math.round(I-Math.max(S.top,N)+16))},O=0,ne=0,W=!1,t="",o=0,v=0,k=Math.max(Number(window.innerHeight||0),Number(R?.height||0)),A=0,P=0,F=e.querySelector?.(".pm-sa-chat-scrollport")||e.closest?.(".pm-page.pm-agent-chat-page")?.querySelector?.(".pm-sa-chat-scrollport")||e,le=0,V=0,X=Number(F?.scrollTop||0),j={passive:!0},we=["position","left","right","top","bottom","z-index"],De=()=>{!n||!Z||(W=!1,t="",o=0,v=0,A=0,P=0,we.forEach(r=>n.style.removeProperty(r)),ae?.classList.remove("pm-keyboard-open","pm-agent-composer-keyboard-open"),ae?.style.removeProperty("--pm-keyboard-offset"),re?.style.removeProperty("display"),O&&cancelAnimationFrame(O),O=0,ne&&window.clearTimeout(ne),ne=0)},Ht=()=>{if(O=0,!n||!Z||!W)return;let r=Math.max(Number(window.innerHeight||0),Number(document.documentElement?.clientHeight||0)),p=Math.max(0,Number(R?.offsetTop||0)),S=Math.max(0,Number(R?.height||r||0)),N=Math.round(p+S),I=R?Math.max(0,Math.round(r-S)):0,se=Math.max(0,Math.round(k-S));if((I>90||se>90)&&!t){let Ke=Number(n.getBoundingClientRect?.().bottom||0);t=Ke>0&&Ke<=N+44?"visual":"layout",t==="visual"&&(o=N,v=S)}else t==="visual"&&Math.abs(S-v)>2&&(o=N,v=S);let ge=t==="visual"?o||N:r,me=Math.max(54,Math.ceil(n.getBoundingClientRect?.().height||n.offsetHeight||54)),ke=ye(ge),Dt=t==="layout"&&I>0?I+8:0,Nt=Math.max(8,ke,Dt),It=Math.max(8,Math.round(ge-Nt-me));n.style.setProperty("position","fixed","important"),n.style.setProperty("left","10px","important"),n.style.setProperty("right","10px","important"),n.style.setProperty("top",`${It}px`,"important"),n.style.setProperty("bottom","auto","important"),n.style.setProperty("z-index","10030","important"),ae?.classList.add("pm-keyboard-open","pm-agent-composer-keyboard-open"),ae?.style.setProperty("--pm-keyboard-offset",`${I}px`)},K=()=>{!Z||!W||O||(O=requestAnimationFrame(()=>{if(O=0,!Z||!W)return;let r=Math.max(Number(window.innerHeight||0),Number(document.documentElement?.clientHeight||0)),p=Math.max(0,Number(R?.height||r||0)),S=Math.max(0,r-p)>90||Math.max(0,k-p)>90,N=performance.now()<A||performance.now()<P;if(!S&&!N){$e();return}Ht()}))},Ne=()=>{Z&&(W=!0,A=performance.now()+1600,k=Math.max(k,Number(window.innerHeight||0),Number(R?.height||0)),t="",o=0,v=0,ae?.classList.add("pm-keyboard-open","pm-agent-composer-keyboard-open"),ae?.style.setProperty("--pm-keyboard-offset","0px"),K(),[80,240,560,1e3].forEach(r=>window.setTimeout(K,r)),ne&&window.clearTimeout(ne),ne=window.setTimeout(()=>{ne=0,K()},1700))},$e=()=>{Z&&(De(),k=Math.max(Number(window.innerHeight||0),Number(R?.height||0)))},ce=()=>{if(!s)return;let r=Math.max(320,Math.round(window.visualViewport?.height||window.innerHeight||640)),p=Math.max(96,Math.min(280,Math.floor(r*.5)-86)),S=Number(s.dataset.maxHeight||p);s.style.height="auto",s.style.height=`${Math.min(S,Math.max(30,s.scrollHeight||30))}px`,s.style.overflowY=s.scrollHeight>S?"auto":"hidden"},de=()=>!!(String(s?.value||"").trim()||B.length),pe=()=>$&&typeof c=="function"&&y&&E,Rt=()=>{if(!Z||!n||n.classList.contains("pm-composer-mode-hidden")||n.classList.contains("is-voice-active"))return!1;let r=W||ae?.classList?.contains("pm-keyboard-open"),p=W||document.activeElement===s;return r||p?!1:!n.classList.contains("has-text")&&!n.classList.contains("has-attachments")&&!n.classList.contains("has-pending-question")},xe=()=>{V=performance.now()+900},Ie=()=>{let r=Number(F?.scrollTop||0),p=r-X;if(X=r,p>=-2)return;let S=performance.now();S<le||S>V||Rt()&&($e(),qe(!1,{animate:!0,reason:"scroll"}))},Se=()=>{n&&(n.classList.toggle("is-focused",document.activeElement===s),n.classList.toggle("has-text",!!String(s?.value||"").trim()),n.classList.toggle("has-attachments",B.length>0))},ze=()=>{if(!(!y||!E)){y.hidden=!0;try{E._pmCleanup?.()}catch{}E.innerHTML="",Mt(),Q?.target?.kind==="subagent"&&Q.target.agentId===$?.agentId&&(Q.target=null,Q.subagentSubmit=null)}},Be=async({autoStart:r=!0}={})=>{if(!pe()){ee("Voice mode is not available for this composer.","error");return}let p={kind:"subagent",agentId:String($.agentId||"").trim(),label:String($.label||$.name||"Subagent").trim(),voice:$.voice&&typeof $.voice=="object"?$.voice:null};Q.target=p,Q.targetSessionId=`subagent_chat_${p.agentId}`,Q.targetSessionLabel=p.label,Q.targetSessionChannel="subagent",Q.targetSessionForced=!0,Q.subagentSubmit=async S=>c({text:String(S||"").trim(),files:[]}),At(p.voice),y.hidden=!1,E.innerHTML="",await Lt(E,{inline:!0,inlineChatSessionId:Q.targetSessionId,inlineChatSessionLabel:p.label,autoStart:r,openCameraCapture:L,cameraButton:T})},qe=(r,{animate:p=!0,reason:S="keyboard"}={})=>{!Z||!n||!Y||(!r&&W&&$e(),n.classList.toggle("pm-composer-mode-hidden",!r),n.setAttribute("aria-hidden",r?"false":"true"),r?n.removeAttribute("inert"):n.setAttribute("inert",""),Y.setAttribute("aria-hidden",r?"true":"false"),Y.classList.toggle("is-transitioning",p),le=performance.now()+(S==="keyboard"?1800:420),p&&setTimeout(()=>Y.classList.remove("is-transitioning"),360))},Fe=()=>{qe(!0,{reason:"keyboard"}),Ne(),window.requestAnimationFrame(()=>s?.focus({preventScroll:!0}))},Ve=async()=>{if(qe(!0,{reason:"voice"}),pe()){await Be({autoStart:!0});return}window.requestAnimationFrame(()=>a?.click())};try{ie&&oe(ie,Fe),ve&&oe(ve,()=>{Ve().catch(()=>{})})}catch(r){console.warn("[mobile agent chat] mode haptic wiring failed:",r),ie?.addEventListener("click",Fe),ve?.addEventListener("click",()=>{Ve().catch(()=>{})})}F?.addEventListener("scroll",Ie,{passive:!0});for(let r of["touchstart","pointerdown","wheel"])F?.addEventListener(r,xe,j),F!==document&&document.addEventListener(r,xe,j);let he=()=>{z&&(z.hidden=B.length===0,z.innerHTML=yt(B,!0),z.querySelectorAll("[data-remove-attachment]").forEach(r=>{r.addEventListener("click",()=>{let p=Number(r.getAttribute("data-remove-attachment"));Number.isFinite(p)&&B.splice(p,1),he(),G()})}),Se())},G=()=>{let r=!!f?.(),p=r&&!de();n&&(n.classList.toggle("is-busy",r),n.setAttribute("aria-busy",r?"true":"false"),n.dataset.composerState=r?p?"stopping":"busy":"idle"),s&&(s.placeholder=r?"Queue a message...":u),M&&(M.disabled=!1,M.classList.toggle("is-abort",p),M.classList.toggle("is-voice",!r&&!de()&&pe()),M.title=p?"Stop":!r&&!de()&&pe()?"Start voice mode":r?"Queue message":"Send",M.setAttribute("aria-label",p?"Stop":!r&&!de()&&pe()?"Start voice mode":r?"Queue message":"Send"),M.setAttribute("aria-busy",r?"true":"false"),M.innerHTML=p?'<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><rect x="7" y="7" width="10" height="10" rx="2"/></svg>':!r&&!de()&&pe()?`<img class="pm-send-voice-icon" src="${mt}" alt="" aria-hidden="true" />`:b.send),Se()},Ue=()=>{let r=String(s?.value||"").trim(),p=B.splice(0,B.length);if(s&&(s.value="",q&&(q.text=""),ce()),_||H||D){_=!1,J+=1,D&&clearTimeout(D),D=null;let S=H;H=null;try{S?.abort?.()}catch{try{S?.stop?.()}catch{}}a?.classList.remove("listening")}return he(),G(),{text:r,files:p}},Oe=({refocus:r=!0}={})=>{_=!1,J+=1,D&&clearTimeout(D),D=null;let p=H;H=null;try{p?.stop?.()}catch{try{p?.abort?.()}catch{}}a?.classList.remove("listening"),r&&s?.focus(),ce(),G()},Pt=(r,p=140)=>{D&&clearTimeout(D),D=null,!(!_||H)&&(D=setTimeout(()=>{D=null,We(r)},p))},We=r=>{if(!(!_||H||!s))try{let p=new r,S=J,N=String(s.value||"").trimEnd();H=p,p.lang=navigator.language||"en-US",p.interimResults=!0,p.continuous=!0,p.onstart=()=>{S===J&&a?.classList.add("listening")},p.onresult=I=>{if(S!==J)return;let se="",He="";for(let me=0;me<I.results.length;me+=1){let ke=String(I.results[me]?.[0]?.transcript||"");I.results[me].isFinal?se+=ke:He+=ke}let ge=`${se}${He}`.trim();s.value=`${N}${N&&ge?" ":""}${ge}`,q&&(q.text=s.value||""),ce(),G()},p.onerror=I=>{if(S!==J)return;let se=String(I?.error||"unknown");["not-allowed","service-not-allowed","audio-capture"].includes(se)?(_=!1,ee(se==="audio-capture"?"The microphone is not available.":"Microphone permission was denied.","error")):["no-speech","aborted"].includes(se)||console.warn("[mobile agent chat] dictation cycle error:",se)},p.onend=()=>{if(S===J){if(H===p&&(H=null),ce(),G(),!_){a?.classList.remove("listening");return}Pt(r)}},p.start()}catch(p){H=null,_=!1,a?.classList.remove("listening"),ee(p?.message||"Could not start dictation.","error")}};s?.addEventListener("input",()=>{q&&(q.text=s.value||""),ce(),G()}),s?.addEventListener("focus",()=>{Se(),Ne()}),s?.addEventListener("blur",()=>window.setTimeout(()=>{Se();let r=document.activeElement,p=!!(r&&n?.contains?.(r)),S=Math.max(Number(window.innerHeight||0),Number(document.documentElement?.clientHeight||0)),N=Math.max(0,Number(R?.height||S||0)),I=Math.max(0,S-N)>90||Math.max(0,k-N)>90;if(p||performance.now()<P||I){W&&K();return}$e()},120)),R?.addEventListener("resize",K),R?.addEventListener("scroll",K),window.addEventListener("resize",K,{passive:!0}),window.addEventListener("orientationchange",K),n?.addEventListener("pointerdown",r=>{r.target?.closest?.("button, .pm-haptic-host")&&(P=performance.now()+700)},{passive:!0}),s?.addEventListener("keydown",r=>{r.key==="Enter"&&!r.shiftKey&&(r.preventDefault(),n?.requestSubmit?.())}),s?.addEventListener("paste",async r=>{let p=Array.from(r.clipboardData?.files||[]);if(!p.length)return;String(r.clipboardData?.getData?.("text/plain")||"").trim()||r.preventDefault();let S=await Promise.all(p.slice(0,8).map(Pe));B.push(...S.filter(Boolean)),he(),G()}),w?.addEventListener("click",()=>U?.click()),a?.addEventListener("click",()=>{let r=window.SpeechRecognition||window.webkitSpeechRecognition;if(!r){ee("Speech dictation is not available in this browser.","error");return}if(_){Oe();return}be=r,_=!0,J+=1,a.classList.add("listening"),ee("Listening until you tap the mic again.","info"),We(r)}),h?.addEventListener("click",ze),T?.addEventListener("click",()=>{typeof L=="function"?L():U?.click()}),U?.addEventListener("change",async()=>{let r=Array.from(U.files||[]).slice(0,8);if(U.value="",!r.length)return;let p=await Promise.all(r.map(Pe));B.push(...p.filter(Boolean)),he(),G()}),n?.addEventListener("submit",async r=>{if(r.preventDefault(),f?.()&&!de()){d?.(),G();return}let p=Ue();if(!p.text&&!p.files.length){await Be({autoStart:!0});return}await g?.(p),G()});let jt=e._pmCleanup;return e._pmCleanup=()=>{O&&cancelAnimationFrame(O),R?.removeEventListener("resize",K),R?.removeEventListener("scroll",K),window.removeEventListener("resize",K),window.removeEventListener("orientationchange",K),F?.removeEventListener("scroll",Ie);for(let r of["touchstart","pointerdown","wheel"])F?.removeEventListener(r,xe,j),F!==document&&document.removeEventListener(r,xe,j);De(),Oe({refocus:!1}),ze(),jt?.()},requestAnimationFrame(()=>{he(),ce(),G()}),{input:s,update:G,consume:Ue,pending:B}}async function Yt(e,i,{standalone:u=!1,team:f=null}={}){e.innerHTML=`
    <div class="${u?"pm-sa-chat-shell pm-team-chat-page-shell":"pm-card"} pm-team-chat-card" id="pm-team-chat-card">
      <div id="pm-team-chat-list" class="pm-team-chat-list${u?" pm-sa-chat-scrollport pm-sa-chat-list":""}" aria-live="polite">
        <div class="pm-team-chat-status">Loading team chat&hellip;</div>
      </div>
      <div id="pm-team-chat-queue" class="pm-mobile-queued-prompts" hidden></div>
      <div id="pm-team-chat-goal" class="pm-mobile-goal-strip pm-mobile-goal-strip-inline" hidden></div>
      ${Gt("pm-team-chat","Message the team manager...")}
    </div>
  `;let g=e.querySelector("#pm-team-chat-list"),d=e.querySelector("#pm-team-chat-queue"),x=e.querySelector("#pm-team-chat-goal");xt(g,()=>{}),vt(x,ut.activeSessionId,{fallbackToLast:!0});let $=[],c=null,L=null,l=0,n="",s=!1,M=!1,w=[],a=[],y=null;function h(t={}){let o=t?.body&&typeof t.body=="object"?t.body:{},v=t?.metadata&&typeof t.metadata=="object"?t.metadata:{},k=String(t?.from||t?.role||"").toLowerCase(),A=k==="user"||k==="you"||k==="human",P=Ft(String(t?.content||t?.message||t?.text||o.text||""));return{...t,role:A?"user":"agent",from:A?"user":k||"manager",fromLabel:t?.fromLabel||t?.fromName||o.sender||(A?"You":"Manager"),content:P,body:{...o,text:P},createdAt:t?.createdAt||t?.timestamp||t?.ts||Date.now(),processEntries:Array.isArray(t?.processEntries)?t.processEntries:Array.isArray(v.processEntries)?v.processEntries:[]}}function T(t,o){if(o?.role==="user")return"";let v=t?.body&&typeof t.body=="object"?t.body:{},k=t?.metadata&&typeof t.metadata=="object"?t.metadata:{},A=String(t?.agentId||t?.subagentId||t?.memberId||t?.fromId||v.agentId||v.subagentId||k.agentId||k.subagentId||o?.from||"").trim().toLowerCase(),P=String(o?.fromLabel||"").trim().toLowerCase(),le=(Array.isArray(f?.members)?f.members:[]).find(X=>{let j=String(X?.id||"").trim().toLowerCase(),we=String(X?.name||"").trim().toLowerCase();return A&&(j===A||we===A)||P&&(j===P||we===P)}),V=String(le?.id||(A&&!["agent","assistant","manager"].includes(A)?A:"manager")).trim();return`<span class="pm-team-sender-icon" aria-hidden="true">${_t(V,{scale:.24})}</span>`}function E(t){let o=h(t),v=T(t,o);try{return St(o,{sender:o.fromLabel,senderIconHtml:v,live:t===c,keepLiveTraceVisible:t===c})}catch(k){console.warn("[mobile team chat] rich message render failed:",k);let A=o.role==="user";return`<div class="pm-msg ${A?"from-user":"from-ai"} pm-agent-chat-msg">
        <div class="pm-bubble">
          ${A?"":`<span class="pm-sender pm-sender-with-icon">${v}<span class="pm-sender-name">${m(o.fromLabel)}</span></span>`}
          <div class="markdown-body">${gt(o.content)}</div>
        </div>
      </div>`}}let U=()=>!!(L||c?.streaming||s),z=(t={})=>{let o=fe(t),v=String(o.sessionId||o.sourceSessionId||"").trim();return!!o.id&&(v.startsWith(`team_dm_manager_${i}___`)||v.startsWith(`team_dm_member_${i}___`)||v===`team_chat_${i}`||String(o.teamId||o.toolArgs?.teamId||"").trim()===String(i))},Y=(t={})=>{if(!z(t))return!1;let o=fe(t),v=a.findIndex(A=>String(A?.approvalRequest?.id||"")===o.id),k={role:"agent",from:"manager",fromLabel:"Manager",content:"",createdAt:Date.now(),approvalRequest:o};return v>=0?a[v]={...a[v],approvalRequest:{...a[v].approvalRequest||{},...o}}:a.push(k),a=a.slice(-8),!0},ve=(t,o,v={})=>{let k=String(t||"").trim();if(!k)return!1;let A=a.findIndex(P=>String(P?.approvalRequest?.id||"")===k);return A<0?!1:(a[A].approvalRequest=fe({...a[A].approvalRequest||{},...v.approval||v,id:k,status:o}),!0)},ie=async()=>{let t=await Qe("pending").catch(()=>[]);(Array.isArray(t)?t:[]).forEach(Y)};function te(){d&&(d.hidden=w.length===0,d.innerHTML=w.length?`<div class="pm-mobile-queued-list">${w.map((t,o)=>`
           <div class="pm-mobile-queued-item">
             <button type="button" class="pm-mobile-queued-text" data-team-queue-edit="${o}">${m(String(t.text||"Attached file(s)").slice(0,120))}${t.files?.length?` <em>+${t.files.length}</em>`:""}</button>
             <div class="pm-mobile-queued-actions">
               <div class="pm-mobile-queued-menu-wrap">
                 <button type="button" class="pm-mobile-queued-icon pm-mobile-queued-menu-trigger" data-team-queue-menu="${o}" aria-label="Queued message actions" title="Actions">${b.dots}</button>
                 <div class="pm-mobile-queued-popover" data-team-queue-menu-popover="${o}" hidden>
                   <button type="button" class="pm-mobile-queued-menu-item pm-mobile-queued-steer" data-team-queue-steer="${o}">${b.target}<span>Steer</span></button>
                   <button type="button" class="pm-mobile-queued-menu-item pm-mobile-queued-remove" data-team-queue-remove="${o}">${b.trash}<span>Delete</span></button>
                 </div>
               </div>
             </div>
           </div>`).join("")}</div>`:"",ht(),d.querySelectorAll("[data-team-queue-edit]").forEach(t=>oe(t,()=>{})),d.querySelectorAll("[data-team-queue-menu]").forEach(t=>oe(t,()=>{let o=Number(t.getAttribute("data-team-queue-menu"));if(!Number.isInteger(o))return;let v=d.querySelector(`[data-team-queue-menu-popover="${o}"]`);if(!v)return;let k=!!v.hidden;Ee(d),v.hidden=!k})),d.querySelectorAll("[data-team-queue-steer]").forEach(t=>oe(t,()=>{let o=Number(t.getAttribute("data-team-queue-steer"));if(Number.isFinite(o)&&o>=0&&o<w.length){let[v]=w.splice(o,1);v&&w.unshift(v)}Ee(d),te(),q()})),d.querySelectorAll("[data-team-queue-remove]").forEach(t=>oe(t,()=>{let o=Number(t.getAttribute("data-team-queue-remove"));Number.isFinite(o)&&w.splice(o,1),Ee(d),te()})))}function q(){if(U()||!w.length){y?.update?.();return}let t=w.shift();te(),W(t).catch(o=>ee(o?.message||"Send failed","error"))}function B(t){let o=c&&!c._done?c:null;$=Array.isArray(t)?t.slice():[],o&&($.some(k=>String(k.content||k.message||k.text||"").trim()&&String(k.content||k.message||k.text||"").trim()===String(o.content||"").trim())||$.push(o))}function _(){let t=a.filter(v=>String(v?.approvalRequest?.status||"pending")==="pending"),o=[...$,...t];if(!o.length){g.innerHTML='<div style="text-align:center;color:var(--pm-muted);padding:24px 8px;font-size:13px;">No messages yet. Send the first one.</div>';return}Kt(g,o,E),g.querySelectorAll("[data-pm-approval-action][data-pm-approval-id]").forEach(ft),Tt(g),g.scrollTop=g.scrollHeight}try{B(await Ae(i,80)),await ie(),_()}catch(t){g.innerHTML=`<div style="color:var(--pm-red);padding:16px;">${m(t.message||"Failed to load chat")}</div>`}async function H({forceHistory:t=!1}={}){try{let o=await at(i,n?l:0);o.stream?.streamId&&o.stream.streamId!==n&&(n=o.stream.streamId,l=0),o.stream?.streamId&&!c&&o.active&&(c={role:"manager",from:"manager",fromLabel:"Manager",content:"",_progress:"Reconnecting...",createdAt:Date.now(),workStartedAt:Date.now(),streaming:!0,processEntries:[]},$.push(c));for(let v of o.events||[])v.streamId&&(n=v.streamId),l=Math.max(l,Number(v.seq||0)),c||(c={role:"manager",from:"manager",fromLabel:"Manager",content:"",_progress:"Reconnecting...",createdAt:Date.now(),workStartedAt:Date.now(),streaming:!0,processEntries:[]},$.push(c)),Ce(c,Wt(v),"Manager");(t||!o.active||c?._done)&&(B(await Ae(i,80)),await ie(),o.active||(c=null)),_()}catch{}}let be=()=>H({forceHistory:!0}),D=()=>{document.hidden||H({forceHistory:!0})},J=async(t={})=>{if(String(t.teamId||"")===String(i))try{B(await Ae(i,80)),c=null,_()}catch{}},Z=(t={})=>{String(t.teamId||"")===String(i)&&(s||(t.streamId&&t.streamId!==n&&(n=t.streamId,l=0),l=Math.max(l,Number(t.seq||0)),c||(c={role:"manager",from:"manager",fromLabel:"Manager",content:"",_progress:"Thinking...",createdAt:Date.now(),workStartedAt:Date.now(),streaming:!0,processEntries:[]},$.push(c)),Ce(c,{type:String(t.event||""),...t.data||{}},"Manager"),_()))},ae=async(t={})=>{let o=t.approval?fe(t.approval,t):await bt(t);Y(o)&&_()},re=t=>(o={})=>{let v=t==="approval_approved"?"approved":t==="approval_denied"?"rejected":t==="approval_expired"?"expired":"failed";ve(o.approvalId||o.id||o.approval?.id,v,o)&&_()},R=re("approval_approved"),ye=re("approval_denied"),O=re("approval_expired"),ne=re("approval_failed");C?.on?.("ws:open",be),C?.on?.("team_chat_message",J),C?.on?.("team_chat_stream_event",Z),C?.on?.("approval_created",ae),C?.on?.("approval_approved",R),C?.on?.("approval_denied",ye),C?.on?.("approval_expired",O),C?.on?.("approval_failed",ne),document.addEventListener("visibilitychange",D),e._pmCleanup=()=>{if(!M){M=!0;try{L?.abort?.()}catch{}C?.off?.("ws:open",be),C?.off?.("team_chat_message",J),C?.off?.("team_chat_stream_event",Z),C?.off?.("approval_created",ae),C?.off?.("approval_approved",R),C?.off?.("approval_denied",ye),C?.off?.("approval_expired",O),C?.off?.("approval_failed",ne),document.removeEventListener("visibilitychange",D)}},H();async function W(t){let o=String(t?.text||"").trim(),v=Array.isArray(t?.files)?t.files:[],k=String(t?.source||"").trim(),A=o||(v.length?"Please review the attached file(s).":"");if(!A&&!v.length)return;if(U()){w.push({text:o,files:v,source:k,speak:t?.speak===!0,voice:t?.voice===!0}),te(),y?.update?.();return}let P=A,F=v;if(v.length){let V=await wt(v);P=`${A}${$t(V)}`,F=V.map((X,j)=>({...v[j]||{},name:X.name||v[j]?.name||"attachment",kind:X.isImage?"image":X.isVideo?"video":v[j]?.kind||"file",workspacePath:X.workspacePath||v[j]?.workspacePath,path:X.workspacePath||v[j]?.path,dataUrl:v[j]?.dataUrl,mimeType:v[j]?.mimeType,sizeLabel:v[j]?.sizeLabel}))}let le={role:"user",from:"user",content:A,body:{text:A,attachments:F},attachmentPreviews:F,createdAt:Date.now()};c={role:"manager",from:"manager",fromLabel:"Manager",content:"",_progress:"Manager is thinking...",createdAt:Date.now(),workStartedAt:Date.now(),streaming:!0,processEntries:[]},$.push(le,c),_(),s=!0,y?.update?.(),L=nt(i,{message:P},{onEvent:V=>{Ce(c,V,"Manager"),_()},onError:V=>{V?.name!=="AbortError"&&(c.content=c.content||`Error: ${V?.message||"stream failed"}`,c._progress="",c.streaming=!1,c.workEndedAt=Date.now(),s=!1,L=null,y?.update?.(),_(),ee(V?.message||"Send failed","error"))},onDone:async()=>{c&&(c._progress="",c.streaming=!1,c.workEndedAt=c.workEndedAt||Date.now(),c.workDurationMs=Math.max(0,c.workEndedAt-Number(c.workStartedAt||c.createdAt||c.workEndedAt))),s=!1,L=null,y?.update?.(),await H({forceHistory:!0}),q()}})}y=Qt(e,"pm-team-chat",{placeholder:"Message the team manager...",draftKey:"team:manager",isBusy:U,onAbort:()=>{try{L?.abort?.()}catch{}c&&(c._progress="Stopping...",c.streaming=!1),L=null,s=!1,_()},onSubmit:W}),te()}async function oa(e,{teamId:i,navigate:u}){e.classList.add("pm-agent-chat-page","pm-team-agent-chat-page"),e.dataset.mobileAgentChatRoute="team",document.body.classList.add("pm-mobile-subagent-chat-locked"),document.body.classList.add("pm-mobile-agent-chat-locked"),e.innerHTML=`
    ${Te({title:"Team Chat",online:!0,leftIcon:"back",hideTitle:!0,hideBrand:!0})}
    <div class="pm-body pm-subagent-chat-body pm-team-chat-page-body" id="pm-team-chat-page-body">
      <div class="pm-card" style="text-align:center;padding:24px;color:var(--pm-muted);">Loading team chat&hellip;</div>
    </div>
  `,_e(e,{onBack:()=>u?.(`#mobile/teams/${encodeURIComponent(i)}`)});let f=e.querySelector("#pm-team-chat-page-body"),g=e.querySelector(".pm-model-badge .pm-model-badge-label"),d=!1;e._pmCleanup=()=>{if(!d){d=!0;try{f?._pmCleanup?.()}catch{}document.body.classList.remove("pm-mobile-agent-chat-locked","pm-mobile-subagent-chat-locked")}};try{let x=await Le(i);if(!x)throw new Error("Team not found");if(d||e.isConnected===!1)return;g&&(g.textContent=`${x.emoji||"\u{1F3E0}"} ${x.name}`),await Yt(f,i,{standalone:!0,team:x})}catch(x){f.innerHTML=`<div class="pm-empty"><div class="pm-empty-icon">${b.users}</div><h2>Couldn\u2019t load team chat</h2><p>${m(x?.message||"Network error")}</p></div>`}}function Jt(e){let i=String(e||"").toLowerCase();return/\.(md|markdown|txt)$/.test(i)?"\u{1F4DD}":/\.(js|ts|tsx|jsx|mjs|cjs)$/.test(i)?"\u{1F4DC}":/\.(json|yaml|yml|toml)$/.test(i)?"\u{1F527}":/\.(png|jpg|jpeg|gif|svg|webp)$/.test(i)?"\u{1F5BC}\uFE0F":/\.(mp4|mov|webm|mkv)$/.test(i)?"\u{1F3AC}":/\.(mp3|wav|ogg|flac)$/.test(i)?"\u{1F3B5}":/\.(html|htm)$/.test(i)?"\u{1F310}":/\.(pdf)$/.test(i)?"\u{1F4C4}":"\u{1F4C3}"}function Zt(e){return!e||e<1024?`${e||0} B`:e<1024*1024?`${(e/1024).toFixed(1)} KB`:`${(e/(1024*1024)).toFixed(2)} MB`}async function Xt(e,i){e.innerHTML='<div class="pm-card" style="text-align:center;padding:24px;color:var(--pm-muted);">Loading workspace\u2026</div>';let u;try{u=await rt(i)}catch(a){e.innerHTML=`<div class="pm-empty"><div class="pm-empty-icon">${b.doc}</div><h2>Couldn\u2019t load workspace</h2><p>${m(a.message||"")}</p></div>`;return}let f=/^(Brain|audit|memory|temp)[\\/]|(^|[\\/])(tool_audit\.log|team-notes\.jsonl|last_run\.json|memory\.json|pending\.json)$/i,g=a=>String(a.relativePath||a.relpath||a.name||a.path||""),d=(u.files||[]).slice().sort((a,y)=>Number(y.modifiedAt||0)-Number(a.modifiedAt||0)),x=d.filter(a=>!f.test(g(a))),$=x.length===0;if(!d.length){e.innerHTML=`<div class="pm-empty"><div class="pm-empty-icon">${b.doc}</div><h2>Workspace is empty</h2><p>Files written by team subagents will appear here.</p></div>`;return}let c=$?d:x;e.innerHTML=`
    <div class="pm-card" style="padding:10px 12px 12px;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
        <strong style="font-size:13px;" id="pm-ws-count"></strong>
        ${d.length>x.length&&x.length?'<button type="button" class="pm-show-more" id="pm-ws-runtime-toggle">Show runtime files</button>':""}
      </div>
      ${u.workspacePath?`<div title="${m(u.workspacePath)}" style="font-size:11px;color:var(--pm-muted);font-family:ui-monospace,monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;direction:rtl;text-align:left;margin-bottom:8px;">${m(u.workspacePath)}</div>`:""}
      <div id="pm-ws-list" style="display:flex;flex-direction:column;gap:6px;"></div>
      <div id="pm-ws-preview" style="margin-top:12px;display:none;"></div>
    </div>
  `;let L=e.querySelector("#pm-ws-list"),l=e.querySelector("#pm-ws-preview"),n=e.querySelector("#pm-ws-count"),s=e.querySelector("#pm-ws-runtime-toggle"),M=()=>{c=$?d:x,n&&(n.textContent=$||!x.length?`${d.length} file${d.length===1?"":"s"}`:`${x.length} project file${x.length===1?"":"s"}`),s&&(s.textContent=$?"Hide runtime files":`Show runtime files (${d.length-x.length})`),L.innerHTML=c.map(a=>{let y=g(a),h=a.size||0,T=a.modifiedAt||a.updatedAt;return`
      <button type="button" data-rel="${m(y)}" style="display:flex;align-items:center;gap:10px;width:100%;text-align:left;color:var(--pm-text);background:var(--pm-bg-soft);border:1px solid var(--pm-border);border-radius:12px;padding:10px 12px;cursor:pointer;font-family:inherit;">
        <span style="font-size:18px;">${Jt(y)}</span>
        <span style="flex:1;min-width:0;overflow:hidden;">
          <span style="display:block;font-weight:700;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${m(y)}</span>
          <span style="display:block;font-size:11px;color:var(--pm-muted);">${Zt(h)}${T?" \xB7 "+ue(typeof T=="number"?T:new Date(T).getTime()):""}</span>
        </span>
        <span style="color:var(--pm-muted);">${b.chev}</span>
      </button>
    `}).join(""),w()};s?.addEventListener("click",()=>{$=!$,M()});function w(){L.querySelectorAll("[data-rel]").forEach(a=>{a.addEventListener("click",async()=>{let y=a.getAttribute("data-rel");l.style.display="block",l.innerHTML=`<div class="pm-card-body" style="padding:14px;color:var(--pm-muted);">Loading ${m(y)}\u2026</div>`;try{let h=await st(i,y),T=h?.content||h?.body||"";l.innerHTML=`
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
            <strong style="flex:1;font-size:13px;">${m(y)}</strong>
            <button class="pm-btn ghost" id="pm-ws-close" style="padding:4px 10px;font-size:12px;">\u2715 Close</button>
          </div>
          <pre style="background:var(--pm-bg-soft);border:1px solid var(--pm-border);border-radius:10px;padding:12px;font-size:12px;line-height:1.5;font-family:ui-monospace,monospace;white-space:pre-wrap;word-break:break-word;max-height:60vh;overflow:auto;margin:0;">${m(String(T).slice(0,5e4))}${String(T).length>5e4?`

\u2026(truncated)`:""}</pre>
        `,l.querySelector("#pm-ws-close").addEventListener("click",()=>{l.style.display="none",l.innerHTML=""}),l.scrollIntoView({behavior:"smooth",block:"nearest"})}catch(h){l.innerHTML=`<div class="pm-card-body" style="color:var(--pm-red);">${m(h.message||"Failed to load file")}</div>`}})})}M()}async function ea(e,i,u){e.innerHTML='<div class="pm-card" style="text-align:center;padding:24px;color:var(--pm-muted);">Loading memory\u2026</div>';let f=null;try{f=await Me(i)}catch{}if(f){let n=a=>String(a||"").replace(/\[DURABLE_TURN_COMMENTARY\][\s\S]*$/,"").replace(/\*\*/g,"").trim(),s=(Array.isArray(f.artifacts)?f.artifacts:[]).slice().reverse().slice(0,12),M=(Array.isArray(f.blockers)?f.blockers:[]).slice().reverse().slice(0,8),w=(Array.isArray(f.recentEvents)?f.recentEvents:[]).filter(a=>a&&a.category!=="tool"&&n(a.content)).slice().reverse().slice(0,15);if(s.length||M.length||w.length){let a=(h,T)=>T?`<div style="font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;color:var(--pm-muted);margin:14px 4px 6px;">${h}</div>${T}`:"",y=h=>h?ue(typeof h=="number"?h:new Date(h).getTime()):"";e.innerHTML=`
        ${a(`Blockers (${M.length})`,M.map(h=>`
          <article class="pm-card" style="padding:10px 12px;border-color:var(--pm-red);">
            <div class="pm-card-body">${m(n(h.content||h.reason||h.title||"Blocker"))}</div>
            <div style="font-size:11px;color:var(--pm-muted);margin-top:4px;">${m(h.agentName||h.agentId||"")} ${y(h.createdAt||h.timestamp)}</div>
          </article>`).join(""))}
        ${a(`Artifacts (${s.length})`,s.map(h=>`
          <article class="pm-card" style="padding:10px 12px;">
            <div style="display:flex;gap:8px;align-items:center;">
              <strong style="flex:1;font-size:13px;line-height:1.3;">${m(h.name||h.title||"Artifact")}</strong>
              <span style="font-size:11px;color:var(--pm-muted);white-space:nowrap;">${y(h.createdAt||h.timestamp)}</span>
            </div>
            ${h.description?`<div class="pm-card-body" style="font-size:13px;margin-top:4px;">${m(String(h.description).slice(0,220))}</div>`:""}
            ${h.path?`<div title="${m(h.path)}" style="font-size:11px;color:var(--pm-muted);font-family:ui-monospace,monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;direction:rtl;text-align:left;margin-top:4px;">${m(h.path)}</div>`:""}
          </article>`).join(""))}
        ${a("Recent activity",w.map(h=>`
          <article class="pm-card" style="padding:10px 12px;">
            <div style="display:flex;gap:8px;align-items:center;margin-bottom:4px;">
              <strong style="flex:1;font-size:13px;">${m(h.actorName||h.actorType||"Team")}</strong>
              <span style="font-size:11px;color:var(--pm-muted);white-space:nowrap;">${y(h.timestamp)}</span>
            </div>
            <div class="pm-card-body" style="font-size:13px;display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden;">${m(n(h.content).slice(0,400))}</div>
          </article>`).join(""))}
      `;return}}let g;try{g=await ot()}catch(n){e.innerHTML=`<div class="pm-empty"><div class="pm-empty-icon">${b.brain}</div><h2>Couldn\u2019t load memory</h2><p>${m(n.message||"")}</p></div>`;return}let d=Array.isArray(g?.nodes)?g.nodes.slice():[],x=String(i).toLowerCase(),$=String(u?.name||"").toLowerCase(),c=n=>{let s=String(n.sourcePath||"").toLowerCase(),M=String(n.projectId||"").toLowerCase();return M&&M.includes(x)||s&&(s.includes(x)||$&&s.includes($))},L=d.filter(c),l=(L.length?L:d).sort((n,s)=>String(s.timestamp||"").localeCompare(String(n.timestamp||""))).slice(0,30);if(!l.length){e.innerHTML=`<div class="pm-empty"><div class="pm-empty-icon">${b.brain}</div><h2>No memory yet</h2><p>As the team works, reflections and memory entries land here.</p></div>`;return}e.innerHTML=`
    <div style="display:flex;align-items:center;gap:8px;padding:6px 4px 10px;color:var(--pm-muted);font-size:12px;">
      <span class="pm-pill ${L.length?"orange":"gray"}">${L.length?"team-scoped":"global feed"}</span>
      <span>${l.length} of ${d.length} entries</span>
    </div>
    ${l.map(n=>`
      <article class="pm-card" style="padding:12px 14px;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
          <strong style="flex:1;font-size:13px;line-height:1.3;">${m(n.label||"Memory")}</strong>
          <span class="pm-pill gray" style="font-family:ui-monospace,monospace;">${m(n.sourceTypeLabel||n.sourceType||"memory")}</span>
        </div>
        ${n.summary?`<div class="pm-card-body" style="margin-bottom:4px;">${m(String(n.summary).slice(0,240))}${String(n.summary).length>240?"\u2026":""}</div>`:""}
        <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--pm-muted);">
          <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:70%;font-family:ui-monospace,monospace;">${m(n.sourcePath||"")}</span>
          <span>${n.timestamp?ue(new Date(n.timestamp).getTime()):""}</span>
        </div>
      </article>
    `).join("")}
  `}export{ra as a,sa as b,Vt as c,Wt as d,Kt as e,Gt as f,Qt as g,oa as h};
