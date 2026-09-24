import{A as kt,C as K,H as Mt,I as Lt,J as At,M as Tt,O as _t,c as mt,f as ut,g as vt,h as _e,i as ht,j as bt,l as fe,m as ft,o as gt,p as yt,q as Re,r as wt,s as $t,t as xt,u as Ce,v as St}from"./chunk-HE6WLYEV.js";import{b as be}from"./chunk-J5HXEABW.js";import{a as Y}from"./chunk-35CAQ6TV.js";import{H as h,I as u,O as Ae,P as Te}from"./chunk-OQF22TQ2.js";import{e as oe}from"./chunk-N2ZRGWK7.js";import{a as ct,b as dt,c as pt}from"./chunk-244SKORA.js";import{$ as rt,Ia as lt,N as He,O as Ge,P as Me,Q as Ye,R as Ze,S as Je,U as Xe,V as et,W as tt,X as Le,Z as at,_ as nt,aa as ot,ba as st,c as Oe,da as it,s as Qe}from"./chunk-FE2DGIO6.js";import{a as T}from"./chunk-GRAK6S3F.js";function zt(t){let c=t.house==="blue"?"#4a82d1":"#a4682b";return`
    <button class="pm-team-tile ${t.featured?"featured":""}" data-team="${t.id}">
      ${t.featured?'<span class="pm-star">\u2605</span>':""}
      <span class="pm-house" style="color:${c}">\u{1F3E0}</span>
      <span class="pm-team-name">${u(t.name)}</span>
      <span class="pm-team-agents">${h.users} ${t.agents} agents</span>
    </button>
  `}function Ct(){return`<div class="pm-team-grid">${'<div class="pm-team-tile" style="opacity:.55"><span class="pm-house" style="opacity:.4">\u{1F3E0}</span><span class="pm-team-name" style="background:rgba(0,0,0,.06);color:transparent;border-radius:6px;height:16px;width:80%;">loading</span></div>'.repeat(4)}</div>`}async function na(t,{navigate:c}){let v=`
    <span class="pm-count-pill" id="pm-teams-count">\u2026</span>
    <span class="pm-spacer"></span>
    <button class="pm-icon-btn" id="pm-teams-refresh" aria-label="Refresh" style="background:var(--pm-surface);border:1px solid var(--pm-border);">${h.refresh}</button>
  `,f=Ae({title:"Teams",online:!1,extras:v});t.innerHTML=`
    ${f}
    <div class="pm-body" id="pm-teams-body">${Ct()}</div>
  `,Te(t,{});let b=t.querySelector("#pm-teams-body"),i=t.querySelector("#pm-teams-count"),y=t.querySelector("#pm-teams-refresh");async function g({force:$=!1}={}){let o=[];try{o=await Ge({force:$})}catch(x){b.innerHTML=`<div class="pm-empty"><div class="pm-empty-icon">${h.users}</div><h2>Couldn\u2019t load teams</h2><p>${u(x.message||"Network error")}</p></div>`,i.textContent="0 teams";return}if(i.textContent=`${o.length} team${o.length===1?"":"s"}`,!o.length){b.innerHTML=`<div class="pm-empty"><div class="pm-empty-icon">${h.users}</div><h2>No teams yet</h2><p>Create your first team from the desktop app.</p></div>`;return}let s=o.find(x=>x.featured)||o[0],l=null;try{l=await Me(s.id)}catch{}let L=l?`
      <div class="pm-team-preview">
        <div class="pm-team-preview-head">
          <span class="pm-mini-house">${u(l.emoji||"\u{1F3E0}")}</span>
          <h3>${u(l.name)}</h3>
          <button class="pm-pill-btn" data-go="${u(l.id)}">View Team ${h.chev}</button>
        </div>
        <div style="font-size:13px;color:var(--pm-muted);font-weight:700;margin-top:4px;">Team members</div>
        <div class="pm-chip-row">
          ${l.members.map(x=>`<span class="pm-member-chip"><span class="pm-avatar" style="background:${x.color}">${x.avatar}</span>${u(x.name)}</span>`).join("")}
        </div>
        <div class="pm-divider"></div>
        <div class="pm-row"><span>\u{1F5C2}\uFE0F Workspace</span><span style="color:var(--pm-muted)">${u(l.workspace)} ${h.chev}</span></div>
        <div class="pm-divider"></div>
        <div class="pm-row" style="flex-direction:column;align-items:stretch;gap:4px;">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <strong>Progress</strong>
            <span style="color:var(--pm-muted)">Recent runs <b style="color:var(--pm-text)">${l.runsDone} / ${l.runsTotal} runs</b></span>
          </div>
          <div class="pm-progress"><span style="width:${l.runsTotal?Math.round(l.runsDone/l.runsTotal*100):0}%"></span></div>
        </div>
      </div>
    `:"";b.innerHTML=`
      <div class="pm-team-grid">${o.map(zt).join("")}</div>
      ${L}
    `,b.querySelectorAll("[data-team]").forEach(x=>{x.addEventListener("click",()=>c(`#mobile/teams/${x.getAttribute("data-team")}`))}),b.querySelectorAll("[data-go]").forEach(x=>{x.addEventListener("click",()=>c(`#mobile/teams/${x.getAttribute("data-go")}`))})}y.addEventListener("click",()=>{He(),b.innerHTML=Ct(),g({force:!0})});let n=Oe("teams_raw",216e5);await g(),Array.isArray(n)&&g({force:!0}).catch(()=>{})}function Bt(){return`
    <div class="pm-detail-head"><span class="pm-house-icon">\u{1F3E0}</span><h1 style="background:rgba(0,0,0,.06);color:transparent;border-radius:8px;height:24px;flex:1;">loading</h1></div>
    <div class="pm-detail-sub">\u2026</div>
    <div class="pm-action-row">
      <button class="pm-action-btn primary">${h.play} Start Run</button>
      <button class="pm-action-btn">${h.pause} Pause</button>
      <button class="pm-action-btn">${h.brain} Review</button>
      <button class="pm-action-btn danger">${h.trash} Delete</button>
    </div>
    <div class="pm-card" style="opacity:.5"><div class="pm-card-head">${h.target} Purpose</div><div class="pm-card-body">Loading team\u2026</div></div>
  `}async function ra(t,{teamId:c,navigate:v,initialTab:f=""}){t.innerHTML=`
    ${Ae({title:"Team",online:!0,leftIcon:"back",hideTitle:!0,hideBrand:!0})}
    <div class="pm-body pm-subagent-detail-body pm-team-detail-body" id="pm-detail-body">${Bt()}</div>
  `,Te(t,{onBack:()=>v("#mobile/teams")});let b=t.querySelector("#pm-detail-body"),i=null;try{i=await Me(c)}catch(d){b.innerHTML=`<div class="pm-empty"><div class="pm-empty-icon">${h.users}</div><h2>Couldn\u2019t load team</h2><p>${u(d.message||"Network error")}</p></div>`;return}if(!i){b.innerHTML=`<div class="pm-empty"><div class="pm-empty-icon">${h.users}</div><h2>Team not found</h2><p>This team isn\u2019t available right now.</p></div>`;return}let y=["Context","Subagents","Workspace","Memory","Runs","Team Chat"];b.innerHTML=`
    <div class="pm-detail-head">
      <span class="pm-house-icon" style="color:#d8473a">${u(i.emoji||"\u{1F39F}\uFE0F")}</span>
      <h1>${u(i.name)}</h1>
      <button class="pm-icon-btn pm-overflow" aria-label="More">${h.dots}</button>
    </div>
    <div class="pm-detail-sub">${i.subagents} subagents \xB7 ${i.totalRuns} total runs</div>

    <div class="pm-action-row">
      <button class="pm-action-btn primary" data-act="start">${h.play} Start Run</button>
      <button class="pm-action-btn"          data-act="pause">${i.paused?h.play+" Resume":h.pause+" Pause"}</button>
      <button class="pm-action-btn"          data-act="chat">${h.chat} Chat</button>
      <button class="pm-action-btn danger"   data-act="delete">${h.trash} Delete</button>
    </div>

    <div class="pm-tabs" role="tablist">
      ${y.map((d,M)=>`<button class="${M===0?"active":""}" data-tab="${d}">${u(d)}</button>`).join("")}
    </div>

    <div id="pm-tab-slot"></div>

    <div id="pm-context-slot">
    <div class="pm-team-preview">
      <div class="pm-team-preview-head">
        <span class="pm-mini-house">${u(i.emoji||"\u{1F3E0}")}</span>
        <h3>${u(i.name)}</h3>
      </div>
      <div style="font-size:13px;color:var(--pm-muted);">${i.subagents} subagents \xB7 ${i.totalRuns} total runs</div>
      <div class="pm-chip-row">
        ${i.members.map(d=>`<span class="pm-member-chip"><span class="pm-avatar" style="background:${d.color}">${d.avatar}</span>${u(d.name)}</span>`).join("")}
      </div>
    </div>

    <div class="pm-card">
      <div class="pm-card-head" style="display:flex;justify-content:space-between;align-items:center;">
        <span>${h.target} Purpose</span>
        <button class="pm-show-more" data-toggle-purpose>Show more \u25BE</button>
      </div>
      <div class="pm-card-body" data-purpose data-collapsed="1" style="display:-webkit-box;-webkit-line-clamp:6;-webkit-box-orient:vertical;overflow:hidden;">${u(i.purpose)}</div>
    </div>

    <div class="pm-card-grid">
      <div class="pm-card">
        <div class="pm-card-head">${h.check} Current Task / Goal</div>
        <div class="pm-card-body">${u(i.currentTask)}</div>
      </div>
      <div class="pm-card">
        <div class="pm-card-head">${h.clock} Last Run</div>
        <div class="pm-card-body strong">${u(i.lastRun)}</div>
      </div>
      <div class="pm-card">
        <div class="pm-card-head">${h.users} Member States</div>
        <div class="pm-card-body">${u(i.memberStates)}</div>
      </div>
      <div class="pm-card">
        <div class="pm-card-head">${h.send} Active Dispatches</div>
        <div class="pm-card-body">${u(i.dispatches)}</div>
      </div>
    </div>

    <div class="pm-card">
      <div class="pm-card-head">${h.doc} Context &amp; Reference</div>
      <div class="pm-card-body" style="margin-bottom:10px;">Each save adds a new card. Cards are injected into manager + subagent runtime context.</div>
      <input class="pm-input" id="pm-ref-title" placeholder="Reference title (e.g. Brand Voice, API URL, Posting Rules)" />
      <textarea class="pm-textarea" id="pm-ref-body" placeholder="Reference content\u2026"></textarea>
      <div class="pm-row-buttons">
        <button class="pm-btn ghost" disabled title="Upload coming soon">${h.upload} Upload File</button>
        <button class="pm-btn primary" data-save-ref>${h.check} Save</button>
      </div>
    </div>

    <div class="pm-card">
      <div class="pm-card-head" style="display:flex;justify-content:space-between;align-items:center;">
        <span>\u{1F4C1} Workspace Preview</span>
        <a href="#mobile/teams/${u(c)}/workspace" style="color:var(--pm-orange);font-weight:700;text-decoration:none;font-size:13px;">Open Workspace \u203A</a>
      </div>
      <div class="pm-card-body">${u(i.workspace)}</div>
    </div>
    </div><!-- /pm-context-slot -->
  `;let g=b.querySelector("#pm-context-slot"),n=b.querySelector("#pm-tab-slot");async function $(d){try{n?._pmCleanup?.()}catch{}if(n&&(n._pmCleanup=null),b.querySelectorAll(".pm-tabs button").forEach(M=>M.classList.toggle("active",M.getAttribute("data-tab")===d)),d==="Context"){g.style.display="",n.innerHTML="";return}g.style.display="none",n.innerHTML=`<div class="pm-card" style="text-align:center;padding:24px;color:var(--pm-muted);">Loading ${u(d)}\u2026</div>`;try{if(d==="Subagents")await qt(n,i);else if(d==="Runs")await Ut(n,c);else if(d==="Team Chat"){v(`#mobile/teams/${encodeURIComponent(c)}/chat`);return}else d==="Workspace"?await Jt(n,c):d==="Memory"&&await Xt(n,c,i)}catch(M){n.innerHTML=`<div class="pm-card"><div class="pm-card-head">${h.users} Error</div><div class="pm-card-body">${u(M.message||"Failed to load")}</div></div>`}}b.querySelectorAll(".pm-tabs button").forEach(d=>{d.addEventListener("click",()=>$(d.getAttribute("data-tab")))});let o=y.find(d=>d.toLowerCase().replace(/\s+/g,"-")===String(f||"").toLowerCase());o&&o!=="Context"&&$(o);let s=b.querySelector("[data-toggle-purpose]"),l=b.querySelector("[data-purpose]");s&&l&&s.addEventListener("click",()=>{l.getAttribute("data-collapsed")==="1"?(l.style.webkitLineClamp="unset",l.style.display="block",l.setAttribute("data-collapsed","0"),s.textContent="Show less \u25B4"):(l.style.display="-webkit-box",l.style.webkitLineClamp="6",l.setAttribute("data-collapsed","1"),s.textContent="Show more \u25BE")});async function L(d,M,B){let ee=d.innerHTML;d.disabled=!0,d.style.opacity="0.6";try{let _=await M();if(!_||_.success===!1)throw new Error(_?.error||"Failed");return Y(B,"success"),_}catch(_){throw Y(_.message||"Action failed","error"),_}finally{d.disabled=!1,d.style.opacity="",d.innerHTML=ee}}b.querySelectorAll("[data-act]").forEach(d=>{let M=d.getAttribute("data-act");d.addEventListener("click",async()=>{if(M==="start")await L(d,()=>Ye(c),"Run started").catch(()=>{});else if(M==="pause"){let B=i.paused;try{await L(d,()=>B?Je(c):Ze(c),B?"Team resumed":"Team paused"),i.paused=!B,d.innerHTML=i.paused?`${h.play} Resume`:`${h.pause} Pause`}catch{}}else if(M==="chat")v(`#mobile/teams/${encodeURIComponent(c)}/chat`);else if(M==="delete"){if(!window.confirm(`Delete team "${i.name}"? This cannot be undone.`))return;try{await L(d,()=>Xe(c),"Team deleted"),He(),v("#mobile/teams")}catch{}}})});let x=b.querySelector("[data-save-ref]");x&&x.addEventListener("click",async()=>{let d=b.querySelector("#pm-ref-title"),M=b.querySelector("#pm-ref-body"),B=(d.value||"").trim(),ee=(M.value||"").trim();if(!B||!ee){Y("Title and content required","error");return}try{await L(x,()=>lt(c,B,ee),"Reference saved"),d.value="",M.value=""}catch{}}),t._pmCleanup=()=>{try{n?._pmCleanup?.()}catch{}}}var Et={working:{label:"working",cls:"running"},active:{label:"active",cls:"active"},ready:{label:"ready",cls:"active"},idle:{label:"idle",cls:"gray"},blocked:{label:"blocked",cls:"orange"},paused:{label:"paused",cls:"gray"},awaiting:{label:"awaiting",cls:"orange"},offline:{label:"offline",cls:"gray"}};function Vt(t){if(!t||t<0)return"\u2014";let c=Math.floor(t/1e3);return c<60?`${c}s`:`${Math.floor(c/60)}m ${c%60}s`}async function qt(t,c){let v=null;try{v=await et(c.id)}catch{}let f=v?.memberStates||{},b=Array.isArray(v?.activeDispatches)?v.activeDispatches:[],i=new Map;for(let o of b){let s=String(o.agentId||o.subagentId||"").trim();s&&i.set(s,o)}let y=c.members.filter(o=>o.id!=="manager"),g=new Map((await Promise.all(y.map(async o=>{let s=await it(o.id).catch(()=>null);return[o.id,s]}))).filter(([,o])=>o)),n=[],$=y.map(o=>{let s=f[o.id]||{},l=Et[String(s.status||"idle").toLowerCase()]||Et.idle,L=i.get(o.id),x=g.get(o.id),d=`pm-team-member-model-${c.id}-${o.id}`.replace(/[^a-zA-Z0-9_-]/g,"-");return x&&n.push({pickerScope:d,agent:x}),`
      <article class="pm-card pm-team-member-card">
        <div class="pm-schedule-head" style="margin-bottom:8px;">
          <span class="pm-emoji" style="font-size:22px;">${o.avatar}</span>
          <h3 style="margin:0;">${u(o.name)}</h3>
          <span class="pm-pill ${l.cls}">${l.label}</span>
        </div>
        ${s.currentTask?`<div class="pm-card-body" style="margin-bottom:6px;"><strong>Current:</strong> ${u(s.currentTask)}</div>`:""}
        ${s.blockedReason?`<div class="pm-card-body" style="color:var(--pm-red);margin-bottom:6px;"><strong>Blocked:</strong> ${u(s.blockedReason)}</div>`:""}
        ${s.lastResult?`<div class="pm-card-body" style="font-size:13px;color:var(--pm-muted);margin-bottom:6px;">Last: ${u(String(s.lastResult).slice(0,140))}${String(s.lastResult).length>140?"\u2026":""}</div>`:""}
        <div style="display:flex;justify-content:space-between;align-items:center;font-size:12px;color:var(--pm-muted);">
          <span>${L?"\u{1F4E1} dispatched":"Last update"}</span>
          <span>${be(s.lastUpdateAt||L?.startedAt)}</span>
        </div>
        ${x?ct(x,d):""}
      </article>
    `}).join("");t.innerHTML=$||`<div class="pm-empty"><div class="pm-empty-icon">${h.robot}</div><h2>No subagents yet</h2><p>Add members from the desktop team editor.</p></div>`,n.forEach(({pickerScope:o,agent:s})=>{pt(o,()=>qt(t,c)),dt(o,s)})}function Ft(t){return t.inProgress?'<span class="pm-pill running">running</span>':t.success===!0?'<span class="pm-pill active">success</span>':t.success===!1&&t.taskStatus?`<span class="pm-pill orange">${u(String(t.taskStatus))}</span>`:'<span class="pm-pill gray">complete</span>'}async function Ut(t,c){let{runs:v}=await tt(c,30);if(!v.length){t.innerHTML=`<div class="pm-empty"><div class="pm-empty-icon">${h.clock}</div><h2>No runs yet</h2><p>Start a run from the top of this page.</p></div>`;return}t.innerHTML=v.map(f=>`
    <article class="pm-card" style="padding:14px 16px;">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
        <strong style="flex:1;font-size:14px;">${u(f.agentName||f.agentId||"Agent")}</strong>
        ${Ft(f)}
      </div>
      ${f.taskSummary?`<div class="pm-card-body" style="margin-bottom:6px;">${u(String(f.taskSummary).slice(0,200))}${String(f.taskSummary).length>200?"\u2026":""}</div>`:""}
      <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--pm-muted);">
        <span>${u(f.trigger||"manual")} \xB7 ${f.stepCount||0} steps</span>
        <span>${be(f.startedAt)} \xB7 ${Vt(f.durationMs)}</span>
      </div>
    </article>
  `).join("")}function Wt(t){return t?{type:String(t.type||t.event||""),...t.data||{}}:null}function Kt(t,c,v){if(!t)return;let f=new Set,b=new Set;t.querySelectorAll(".pm-agent-chat-msg").forEach((i,y)=>{i.querySelector(".pm-trace-drawer.open")&&f.add(y),i.querySelectorAll("details.pm-trace-tool-group[open]").forEach((n,$)=>{b.add(`${y}:${n.getAttribute("data-pm-trace-group")||$}`)})}),t.innerHTML=c.map(v).join(""),t.querySelectorAll(".pm-agent-chat-msg").forEach((i,y)=>{let g=i.querySelector(".pm-trace-drawer"),n=i.querySelector('[data-expandable="trace"]');g&&f.has(y)&&(g.classList.add("open"),n?.classList.add("expanded")),i.querySelectorAll("details.pm-trace-tool-group").forEach(($,o)=>{let s=`${y}:${$.getAttribute("data-pm-trace-group")||o}`;b.has(s)&&!$.closest('.pm-trace-drawer[data-trace-completed="1"]')&&$.setAttribute("open","")})}),kt(t)}var Pe={};function Ot(t,c){let v=String(t||"pm-agent-chat"),f=v==="pm-team-chat"||v==="pm-sa-chat";return`
    ${f?`<div class="pm-chat-mode-launcher pm-agent-chat-mode-launcher" id="${v}-mode-launcher" role="group" aria-label="Choose chat input">
      <button type="button" class="pm-chat-mode-button pm-chat-mode-button--voice" id="${v}-mode-voice" aria-label="Start voice mode">${h.micSmall}<span class="pm-chat-mode-button-label">Voice mode</span></button>
      <button type="button" class="pm-chat-mode-button pm-chat-mode-button--keyboard" id="${v}-mode-keyboard" aria-label="Open keyboard composer">${h.keyboard}<span class="pm-chat-mode-button-label">Keyboard composer</span></button>
    </div>`:""}
    <form class="pm-composer pm-agent-chat-composer${f?" pm-composer-mode-hidden":""}" id="${v}-form"${f?' aria-hidden="true" inert':""}>
      <span class="pm-glass-lens" aria-hidden="true"></span>
      <span class="pm-glass-border" aria-hidden="true"></span>
      <input id="${v}-file-input" type="file" multiple accept="image/*,video/*,.mp4,.mov,.m4v,.webm,.avi,.mkv,.txt,.md,.json,.csv,.tsv,.log,.xml,.html,.css,.js,.ts,.tsx,.jsx,.py,.yaml,.yml,application/pdf" hidden />
      <div class="pm-attach-tray" id="${v}-attach-tray" hidden></div>
      <div class="pm-composer-row">
        <button type="button" class="pm-icon-btn" id="${v}-attach-btn" aria-label="Attach files">${h.paperclip}</button>
        <div class="pm-composer-input-wrap" id="${v}-input-wrap">
          <textarea class="pm-composer-input" id="${v}-input" rows="1" placeholder="${u(c)}" aria-label="Message" autocomplete="off" autocapitalize="sentences" enterkeyhint="send"></textarea>
        </div>
        <button type="button" class="pm-icon-btn" id="${v}-mic-btn" aria-label="Voice input">${h.micSmall}</button>
        <button type="submit" class="pm-send" id="${v}-send-btn" aria-label="Send">${h.send}</button>
      </div>
      <div class="pm-chat-voice-shell" id="${v}-voice-shell" hidden>
        <button type="button" class="pm-chat-voice-camera" id="${v}-voice-camera" aria-label="Attach camera image">${h.image}</button>
        <button type="button" class="pm-chat-voice-close" id="${v}-voice-close" aria-label="Close voice mode">&times;</button>
        <div class="pm-chat-voice-inline" id="${v}-voice-inline"></div>
      </div>
    </form>`}function Qt(t,c,{placeholder:v,isBusy:f,onSubmit:b,onAbort:i,draftKey:y="",voiceTarget:g=null,onVoiceSubmit:n=null,openCameraCapture:$=null}){let o=String(c||"pm-agent-chat"),s=t.querySelector(`#${o}-form`),l=t.querySelector(`#${o}-input`),L=t.querySelector(`#${o}-send-btn`),x=t.querySelector(`#${o}-attach-btn`),d=t.querySelector(`#${o}-mic-btn`),M=t.querySelector(`#${o}-voice-shell`),B=t.querySelector(`#${o}-voice-close`),ee=t.querySelector(`#${o}-voice-camera`),_=t.querySelector(`#${o}-voice-inline`),te=t.querySelector(`#${o}-file-input`),se=t.querySelector(`#${o}-attach-tray`),re=t.querySelector(`#${o}-mode-launcher`),ue=t.querySelector(`#${o}-mode-voice`),ie=t.querySelector(`#${o}-mode-keyboard`),Z=String(y||"").trim(),C=null;Z&&(Pe[Z]||(Pe[Z]={text:"",pending:[]}),C=Pe[Z],Array.isArray(C.pending)||(C.pending=[]));let N=C?C.pending:[],A=!1,E=null,ge=null,P=null,O=0;l&&C?.text&&(l.value=C.text);let Q=o==="pm-team-chat"||o==="pm-sa-chat",J=document.querySelector(".pm-app")||document.body,ae=document.querySelector(".pm-tabbar"),q=window.visualViewport,ye=a=>{if(!ae)return 0;let p=getComputedStyle(ae);if(p.display==="none"||p.visibility==="hidden")return 0;let w=ae.getBoundingClientRect?.(),D=Math.max(0,Number(q?.offsetTop||0)),I=Math.max(0,Number(a||0));return!w||w.height<=0||w.bottom<=D||w.top>=I?0:Math.max(0,Math.round(I-Math.max(w.top,D)+16))},V=0,X=0,F=!1,e="",r=0,m=0,S=Math.max(Number(window.innerHeight||0),Number(q?.height||0)),k=0,H=0,j=t.querySelector?.(".pm-sa-chat-scrollport")||t.closest?.(".pm-page.pm-agent-chat-page")?.querySelector?.(".pm-sa-chat-scrollport")||t,le=0,z=0,G=Number(j?.scrollTop||0),R={passive:!0},we=["position","left","right","top","bottom","z-index"],De=()=>{!s||!Q||(F=!1,e="",r=0,m=0,k=0,H=0,we.forEach(a=>s.style.removeProperty(a)),J?.classList.remove("pm-keyboard-open","pm-agent-composer-keyboard-open"),J?.style.removeProperty("--pm-keyboard-offset"),ae?.style.removeProperty("display"),V&&cancelAnimationFrame(V),V=0,X&&window.clearTimeout(X),X=0)},Ht=()=>{if(V=0,!s||!Q||!F)return;let a=Math.max(Number(window.innerHeight||0),Number(document.documentElement?.clientHeight||0)),p=Math.max(0,Number(q?.offsetTop||0)),w=Math.max(0,Number(q?.height||a||0)),D=Math.round(p+w),I=q?Math.max(0,Math.round(a-w)):0,ne=Math.max(0,Math.round(S-w));if((I>90||ne>90)&&!e){let Ke=Number(s.getBoundingClientRect?.().bottom||0);e=Ke>0&&Ke<=D+44?"visual":"layout",e==="visual"&&(r=D,m=w)}else e==="visual"&&Math.abs(w-m)>2&&(r=D,m=w);let he=e==="visual"?r||D:a,me=Math.max(54,Math.ceil(s.getBoundingClientRect?.().height||s.offsetHeight||54)),ke=ye(he),It=e==="layout"&&I>0?I+8:0,Nt=Math.max(8,ke,It),jt=Math.max(8,Math.round(he-Nt-me));s.style.setProperty("position","fixed","important"),s.style.setProperty("left","10px","important"),s.style.setProperty("right","10px","important"),s.style.setProperty("top",`${jt}px`,"important"),s.style.setProperty("bottom","auto","important"),s.style.setProperty("z-index","10030","important"),J?.classList.add("pm-keyboard-open","pm-agent-composer-keyboard-open"),J?.style.setProperty("--pm-keyboard-offset",`${I}px`)},U=()=>{!Q||!F||V||(V=requestAnimationFrame(()=>{if(V=0,!Q||!F)return;let a=Math.max(Number(window.innerHeight||0),Number(document.documentElement?.clientHeight||0)),p=Math.max(0,Number(q?.height||a||0)),w=Math.max(0,a-p)>90||Math.max(0,S-p)>90,D=performance.now()<k||performance.now()<H;if(!w&&!D){$e();return}Ht()}))},Ie=()=>{Q&&(F=!0,k=performance.now()+1600,S=Math.max(S,Number(window.innerHeight||0),Number(q?.height||0)),e="",r=0,m=0,J?.classList.add("pm-keyboard-open","pm-agent-composer-keyboard-open"),J?.style.setProperty("--pm-keyboard-offset","0px"),U(),[80,240,560,1e3].forEach(a=>window.setTimeout(U,a)),X&&window.clearTimeout(X),X=window.setTimeout(()=>{X=0,U()},1700))},$e=()=>{Q&&(De(),S=Math.max(Number(window.innerHeight||0),Number(q?.height||0)))},ce=()=>{if(!l)return;let a=Math.max(320,Math.round(window.visualViewport?.height||window.innerHeight||640)),p=Math.max(96,Math.min(280,Math.floor(a*.5)-86)),w=Number(l.dataset.maxHeight||p);l.style.height="auto",l.style.height=`${Math.min(w,Math.max(30,l.scrollHeight||30))}px`,l.style.overflowY=l.scrollHeight>w?"auto":"hidden"},de=()=>!!(String(l?.value||"").trim()||N.length),pe=()=>g&&typeof n=="function"&&M&&_,Rt=()=>{if(!Q||!s||s.classList.contains("pm-composer-mode-hidden")||s.classList.contains("is-voice-active"))return!1;let a=F||J?.classList?.contains("pm-keyboard-open"),p=F||document.activeElement===l;return a||p?!1:!s.classList.contains("has-text")&&!s.classList.contains("has-attachments")&&!s.classList.contains("has-pending-question")},xe=()=>{z=performance.now()+900},Ne=()=>{let a=Number(j?.scrollTop||0),p=a-G;if(G=a,p>=-2)return;let w=performance.now();w<le||w>z||Rt()&&($e(),Ee(!1,{animate:!0,reason:"scroll"}))},Se=()=>{s&&(s.classList.toggle("is-focused",document.activeElement===l),s.classList.toggle("has-text",!!String(l?.value||"").trim()),s.classList.toggle("has-attachments",N.length>0))},je=()=>{if(!(!M||!_)){M.hidden=!0;try{_._pmCleanup?.()}catch{}_.innerHTML="",Lt(),K?.target?.kind==="subagent"&&K.target.agentId===g?.agentId&&(K.target=null,K.subagentSubmit=null)}},ze=async({autoStart:a=!0}={})=>{if(!pe()){Y("Voice mode is not available for this composer.","error");return}let p={kind:"subagent",agentId:String(g.agentId||"").trim(),label:String(g.label||g.name||"Subagent").trim(),voice:g.voice&&typeof g.voice=="object"?g.voice:null};K.target=p,K.targetSessionId=`subagent_chat_${p.agentId}`,K.targetSessionLabel=p.label,K.targetSessionChannel="subagent",K.targetSessionForced=!0,K.subagentSubmit=async w=>n({text:String(w||"").trim(),files:[]}),At(p.voice),M.hidden=!1,_.innerHTML="",await Mt(_,{inline:!0,inlineChatSessionId:K.targetSessionId,inlineChatSessionLabel:p.label,autoStart:a,openCameraCapture:$,cameraButton:ee})},Ee=(a,{animate:p=!0,reason:w="keyboard"}={})=>{!Q||!s||!re||(!a&&F&&$e(),s.classList.toggle("pm-composer-mode-hidden",!a),s.setAttribute("aria-hidden",a?"false":"true"),a?s.removeAttribute("inert"):s.setAttribute("inert",""),re.setAttribute("aria-hidden",a?"true":"false"),re.classList.toggle("is-transitioning",p),le=performance.now()+(w==="keyboard"?1800:420),p&&setTimeout(()=>re.classList.remove("is-transitioning"),360))},Be=()=>{Ee(!0,{reason:"keyboard"}),Ie(),window.requestAnimationFrame(()=>l?.focus({preventScroll:!0}))},Ve=async()=>{if(Ee(!0,{reason:"voice"}),pe()){await ze({autoStart:!0});return}window.requestAnimationFrame(()=>d?.click())};try{ie&&oe(ie,Be),ue&&oe(ue,()=>{Ve().catch(()=>{})})}catch(a){console.warn("[mobile agent chat] mode haptic wiring failed:",a),ie?.addEventListener("click",Be),ue?.addEventListener("click",()=>{Ve().catch(()=>{})})}j?.addEventListener("scroll",Ne,{passive:!0});for(let a of["touchstart","pointerdown","wheel"])j?.addEventListener(a,xe,R),j!==document&&document.addEventListener(a,xe,R);let ve=()=>{se&&(se.hidden=N.length===0,se.innerHTML=yt(N,!0),se.querySelectorAll("[data-remove-attachment]").forEach(a=>{a.addEventListener("click",()=>{let p=Number(a.getAttribute("data-remove-attachment"));Number.isFinite(p)&&N.splice(p,1),ve(),W()})}),Se())},W=()=>{let a=!!f?.(),p=a&&!de();s&&(s.classList.toggle("is-busy",a),s.setAttribute("aria-busy",a?"true":"false"),s.dataset.composerState=a?p?"stopping":"busy":"idle"),l&&(l.placeholder=a?"Queue a message...":v),L&&(L.disabled=!1,L.classList.toggle("is-abort",p),L.classList.toggle("is-voice",!a&&!de()&&pe()),L.title=p?"Stop":!a&&!de()&&pe()?"Start voice mode":a?"Queue message":"Send",L.setAttribute("aria-label",p?"Stop":!a&&!de()&&pe()?"Start voice mode":a?"Queue message":"Send"),L.setAttribute("aria-busy",a?"true":"false"),L.innerHTML=p?'<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><rect x="7" y="7" width="10" height="10" rx="2"/></svg>':!a&&!de()&&pe()?`<img class="pm-send-voice-icon" src="${mt}" alt="" aria-hidden="true" />`:h.send),Se()},Fe=()=>{let a=String(l?.value||"").trim(),p=N.splice(0,N.length);if(l&&(l.value="",C&&(C.text=""),ce()),A||E||P){A=!1,O+=1,P&&clearTimeout(P),P=null;let w=E;E=null;try{w?.abort?.()}catch{try{w?.stop?.()}catch{}}d?.classList.remove("listening")}return ve(),W(),{text:a,files:p}},Ue=({refocus:a=!0}={})=>{A=!1,O+=1,P&&clearTimeout(P),P=null;let p=E;E=null;try{p?.stop?.()}catch{try{p?.abort?.()}catch{}}d?.classList.remove("listening"),a&&l?.focus(),ce(),W()},Pt=(a,p=140)=>{P&&clearTimeout(P),P=null,!(!A||E)&&(P=setTimeout(()=>{P=null,We(a)},p))},We=a=>{if(!(!A||E||!l))try{let p=new a,w=O,D=String(l.value||"").trimEnd();E=p,p.lang=navigator.language||"en-US",p.interimResults=!0,p.continuous=!0,p.onstart=()=>{w===O&&d?.classList.add("listening")},p.onresult=I=>{if(w!==O)return;let ne="",qe="";for(let me=0;me<I.results.length;me+=1){let ke=String(I.results[me]?.[0]?.transcript||"");I.results[me].isFinal?ne+=ke:qe+=ke}let he=`${ne}${qe}`.trim();l.value=`${D}${D&&he?" ":""}${he}`,C&&(C.text=l.value||""),ce(),W()},p.onerror=I=>{if(w!==O)return;let ne=String(I?.error||"unknown");["not-allowed","service-not-allowed","audio-capture"].includes(ne)?(A=!1,Y(ne==="audio-capture"?"The microphone is not available.":"Microphone permission was denied.","error")):["no-speech","aborted"].includes(ne)||console.warn("[mobile agent chat] dictation cycle error:",ne)},p.onend=()=>{if(w===O){if(E===p&&(E=null),ce(),W(),!A){d?.classList.remove("listening");return}Pt(a)}},p.start()}catch(p){E=null,A=!1,d?.classList.remove("listening"),Y(p?.message||"Could not start dictation.","error")}};l?.addEventListener("input",()=>{C&&(C.text=l.value||""),ce(),W()}),l?.addEventListener("focus",()=>{Se(),Ie()}),l?.addEventListener("blur",()=>window.setTimeout(()=>{Se();let a=document.activeElement,p=!!(a&&s?.contains?.(a)),w=Math.max(Number(window.innerHeight||0),Number(document.documentElement?.clientHeight||0)),D=Math.max(0,Number(q?.height||w||0)),I=Math.max(0,w-D)>90||Math.max(0,S-D)>90;if(p||performance.now()<H||I){F&&U();return}$e()},120)),q?.addEventListener("resize",U),q?.addEventListener("scroll",U),window.addEventListener("resize",U,{passive:!0}),window.addEventListener("orientationchange",U),s?.addEventListener("pointerdown",a=>{a.target?.closest?.("button, .pm-haptic-host")&&(H=performance.now()+700)},{passive:!0}),l?.addEventListener("keydown",a=>{a.key==="Enter"&&!a.shiftKey&&(a.preventDefault(),s?.requestSubmit?.())}),l?.addEventListener("paste",async a=>{let p=Array.from(a.clipboardData?.files||[]);if(!p.length)return;String(a.clipboardData?.getData?.("text/plain")||"").trim()||a.preventDefault();let w=await Promise.all(p.slice(0,8).map(Re));N.push(...w.filter(Boolean)),ve(),W()}),x?.addEventListener("click",()=>te?.click()),d?.addEventListener("click",()=>{let a=window.SpeechRecognition||window.webkitSpeechRecognition;if(!a){Y("Speech dictation is not available in this browser.","error");return}if(A){Ue();return}ge=a,A=!0,O+=1,d.classList.add("listening"),Y("Listening until you tap the mic again.","info"),We(a)}),B?.addEventListener("click",je),ee?.addEventListener("click",()=>{typeof $=="function"?$():te?.click()}),te?.addEventListener("change",async()=>{let a=Array.from(te.files||[]).slice(0,8);if(te.value="",!a.length)return;let p=await Promise.all(a.map(Re));N.push(...p.filter(Boolean)),ve(),W()}),s?.addEventListener("submit",async a=>{if(a.preventDefault(),f?.()&&!de()){i?.(),W();return}let p=Fe();if(!p.text&&!p.files.length){await ze({autoStart:!0});return}await b?.(p),W()});let Dt=t._pmCleanup;return t._pmCleanup=()=>{V&&cancelAnimationFrame(V),q?.removeEventListener("resize",U),q?.removeEventListener("scroll",U),window.removeEventListener("resize",U),window.removeEventListener("orientationchange",U),j?.removeEventListener("scroll",Ne);for(let a of["touchstart","pointerdown","wheel"])j?.removeEventListener(a,xe,R),j!==document&&document.removeEventListener(a,xe,R);De(),Ue({refocus:!1}),je(),Dt?.()},requestAnimationFrame(()=>{ve(),ce(),W()}),{input:l,update:W,consume:Fe,pending:N}}async function Gt(t,c,{standalone:v=!1,team:f=null}={}){t.innerHTML=`
    <div class="${v?"pm-sa-chat-shell pm-team-chat-page-shell":"pm-card"} pm-team-chat-card" id="pm-team-chat-card">
      <div id="pm-team-chat-list" class="pm-team-chat-list${v?" pm-sa-chat-scrollport pm-sa-chat-list":""}" aria-live="polite">
        <div class="pm-team-chat-status">Loading team chat&hellip;</div>
      </div>
      <div id="pm-team-chat-queue" class="pm-mobile-queued-prompts" hidden></div>
      <div id="pm-team-chat-goal" class="pm-mobile-goal-strip pm-mobile-goal-strip-inline" hidden></div>
      ${Ot("pm-team-chat","Message the team manager...")}
    </div>
  `;let b=t.querySelector("#pm-team-chat-list"),i=t.querySelector("#pm-team-chat-queue"),y=t.querySelector("#pm-team-chat-goal");xt(b,()=>{}),vt(y,ut.activeSessionId,{fallbackToLast:!0});let g=[],n=null,$=null,o=0,s="",l=!1,L=!1,x=[],d=[],M=null;function B(e={}){let r=e?.body&&typeof e.body=="object"?e.body:{},m=e?.metadata&&typeof e.metadata=="object"?e.metadata:{},S=String(e?.from||e?.role||"").toLowerCase(),k=S==="user"||S==="you"||S==="human",H=String(e?.content||e?.message||e?.text||r.text||"");return{...e,role:k?"user":"agent",from:k?"user":S||"manager",fromLabel:e?.fromLabel||e?.fromName||r.sender||(k?"You":"Manager"),content:H,body:{...r,text:H},createdAt:e?.createdAt||e?.timestamp||e?.ts||Date.now(),processEntries:Array.isArray(e?.processEntries)?e.processEntries:Array.isArray(m.processEntries)?m.processEntries:[]}}function ee(e,r){if(r?.role==="user")return"";let m=e?.body&&typeof e.body=="object"?e.body:{},S=e?.metadata&&typeof e.metadata=="object"?e.metadata:{},k=String(e?.agentId||e?.subagentId||e?.memberId||e?.fromId||m.agentId||m.subagentId||S.agentId||S.subagentId||r?.from||"").trim().toLowerCase(),H=String(r?.fromLabel||"").trim().toLowerCase(),le=(Array.isArray(f?.members)?f.members:[]).find(G=>{let R=String(G?.id||"").trim().toLowerCase(),we=String(G?.name||"").trim().toLowerCase();return k&&(R===k||we===k)||H&&(R===H||we===H)}),z=String(le?.id||(k&&!["agent","assistant","manager"].includes(k)?k:"manager")).trim();return`<span class="pm-team-sender-icon" aria-hidden="true">${_t(z,{scale:.24})}</span>`}function _(e){let r=B(e),m=ee(e,r);try{return St(r,{sender:r.fromLabel,senderIconHtml:m,live:e===n,keepLiveTraceVisible:e===n})}catch(S){console.warn("[mobile team chat] rich message render failed:",S);let k=r.role==="user";return`<div class="pm-msg ${k?"from-user":"from-ai"} pm-agent-chat-msg">
        <div class="pm-bubble">
          ${k?"":`<span class="pm-sender pm-sender-with-icon">${m}<span class="pm-sender-name">${u(r.fromLabel)}</span></span>`}
          <div class="markdown-body">${bt(r.content)}</div>
        </div>
      </div>`}}let te=()=>!!($||n?.streaming||l),se=(e={})=>{let r=fe(e),m=String(r.sessionId||r.sourceSessionId||"").trim();return!!r.id&&(m.startsWith(`team_dm_manager_${c}___`)||m.startsWith(`team_dm_member_${c}___`)||m===`team_chat_${c}`||String(r.teamId||r.toolArgs?.teamId||"").trim()===String(c))},re=(e={})=>{if(!se(e))return!1;let r=fe(e),m=d.findIndex(k=>String(k?.approvalRequest?.id||"")===r.id),S={role:"agent",from:"manager",fromLabel:"Manager",content:"",createdAt:Date.now(),approvalRequest:r};return m>=0?d[m]={...d[m],approvalRequest:{...d[m].approvalRequest||{},...r}}:d.push(S),d=d.slice(-8),!0},ue=(e,r,m={})=>{let S=String(e||"").trim();if(!S)return!1;let k=d.findIndex(H=>String(H?.approvalRequest?.id||"")===S);return k<0?!1:(d[k].approvalRequest=fe({...d[k].approvalRequest||{},...m.approval||m,id:S,status:r}),!0)},ie=async()=>{let e=await Qe("pending").catch(()=>[]);(Array.isArray(e)?e:[]).forEach(re)};function Z(){i&&(i.hidden=x.length===0,i.innerHTML=x.length?`<div class="pm-mobile-queued-list">${x.map((e,r)=>`
           <div class="pm-mobile-queued-item">
             <button type="button" class="pm-mobile-queued-text" data-team-queue-edit="${r}">${u(String(e.text||"Attached file(s)").slice(0,120))}${e.files?.length?` <em>+${e.files.length}</em>`:""}</button>
             <div class="pm-mobile-queued-actions">
               <div class="pm-mobile-queued-menu-wrap">
                 <button type="button" class="pm-mobile-queued-icon pm-mobile-queued-menu-trigger" data-team-queue-menu="${r}" aria-label="Queued message actions" title="Actions">${h.dots}</button>
                 <div class="pm-mobile-queued-popover" data-team-queue-menu-popover="${r}" hidden>
                   <button type="button" class="pm-mobile-queued-menu-item pm-mobile-queued-steer" data-team-queue-steer="${r}">${h.target}<span>Steer</span></button>
                   <button type="button" class="pm-mobile-queued-menu-item pm-mobile-queued-remove" data-team-queue-remove="${r}">${h.trash}<span>Delete</span></button>
                 </div>
               </div>
             </div>
           </div>`).join("")}</div>`:"",ht(),i.querySelectorAll("[data-team-queue-edit]").forEach(e=>oe(e,()=>{})),i.querySelectorAll("[data-team-queue-menu]").forEach(e=>oe(e,()=>{let r=Number(e.getAttribute("data-team-queue-menu"));if(!Number.isInteger(r))return;let m=i.querySelector(`[data-team-queue-menu-popover="${r}"]`);if(!m)return;let S=!!m.hidden;_e(i),m.hidden=!S})),i.querySelectorAll("[data-team-queue-steer]").forEach(e=>oe(e,()=>{let r=Number(e.getAttribute("data-team-queue-steer"));if(Number.isFinite(r)&&r>=0&&r<x.length){let[m]=x.splice(r,1);m&&x.unshift(m)}_e(i),Z(),C()})),i.querySelectorAll("[data-team-queue-remove]").forEach(e=>oe(e,()=>{let r=Number(e.getAttribute("data-team-queue-remove"));Number.isFinite(r)&&x.splice(r,1),_e(i),Z()})))}function C(){if(te()||!x.length){M?.update?.();return}let e=x.shift();Z(),F(e).catch(r=>Y(r?.message||"Send failed","error"))}function N(e){let r=n&&!n._done?n:null;g=Array.isArray(e)?e.slice():[],r&&(g.some(S=>String(S.content||S.message||S.text||"").trim()&&String(S.content||S.message||S.text||"").trim()===String(r.content||"").trim())||g.push(r))}function A(){let e=d.filter(m=>String(m?.approvalRequest?.status||"pending")==="pending"),r=[...g,...e];if(!r.length){b.innerHTML='<div style="text-align:center;color:var(--pm-muted);padding:24px 8px;font-size:13px;">No messages yet. Send the first one.</div>';return}Kt(b,r,_),b.querySelectorAll("[data-pm-approval-action][data-pm-approval-id]").forEach(ft),Tt(b),b.scrollTop=b.scrollHeight}try{N(await Le(c,80)),await ie(),A()}catch(e){b.innerHTML=`<div style="color:var(--pm-red);padding:16px;">${u(e.message||"Failed to load chat")}</div>`}async function E({forceHistory:e=!1}={}){try{let r=await at(c,s?o:0);r.stream?.streamId&&r.stream.streamId!==s&&(s=r.stream.streamId,o=0),r.stream?.streamId&&!n&&r.active&&(n={role:"manager",from:"manager",fromLabel:"Manager",content:"",_progress:"Reconnecting...",createdAt:Date.now(),workStartedAt:Date.now(),streaming:!0,processEntries:[]},g.push(n));for(let m of r.events||[])m.streamId&&(s=m.streamId),o=Math.max(o,Number(m.seq||0)),n||(n={role:"manager",from:"manager",fromLabel:"Manager",content:"",_progress:"Reconnecting...",createdAt:Date.now(),workStartedAt:Date.now(),streaming:!0,processEntries:[]},g.push(n)),Ce(n,Wt(m),"Manager");(e||!r.active||n?._done)&&(N(await Le(c,80)),await ie(),r.active||(n=null)),A()}catch{}}let ge=()=>E({forceHistory:!0}),P=()=>{document.hidden||E({forceHistory:!0})},O=async(e={})=>{if(String(e.teamId||"")===String(c))try{N(await Le(c,80)),n=null,A()}catch{}},Q=(e={})=>{String(e.teamId||"")===String(c)&&(l||(e.streamId&&e.streamId!==s&&(s=e.streamId,o=0),o=Math.max(o,Number(e.seq||0)),n||(n={role:"manager",from:"manager",fromLabel:"Manager",content:"",_progress:"Thinking...",createdAt:Date.now(),workStartedAt:Date.now(),streaming:!0,processEntries:[]},g.push(n)),Ce(n,{type:String(e.event||""),...e.data||{}},"Manager"),A()))},J=async(e={})=>{let r=e.approval?fe(e.approval,e):await gt(e);re(r)&&A()},ae=e=>(r={})=>{let m=e==="approval_approved"?"approved":e==="approval_denied"?"rejected":e==="approval_expired"?"expired":"failed";ue(r.approvalId||r.id||r.approval?.id,m,r)&&A()},q=ae("approval_approved"),ye=ae("approval_denied"),V=ae("approval_expired"),X=ae("approval_failed");T?.on?.("ws:open",ge),T?.on?.("team_chat_message",O),T?.on?.("team_chat_stream_event",Q),T?.on?.("approval_created",J),T?.on?.("approval_approved",q),T?.on?.("approval_denied",ye),T?.on?.("approval_expired",V),T?.on?.("approval_failed",X),document.addEventListener("visibilitychange",P),t._pmCleanup=()=>{if(!L){L=!0;try{$?.abort?.()}catch{}T?.off?.("ws:open",ge),T?.off?.("team_chat_message",O),T?.off?.("team_chat_stream_event",Q),T?.off?.("approval_created",J),T?.off?.("approval_approved",q),T?.off?.("approval_denied",ye),T?.off?.("approval_expired",V),T?.off?.("approval_failed",X),document.removeEventListener("visibilitychange",P)}},E();async function F(e){let r=String(e?.text||"").trim(),m=Array.isArray(e?.files)?e.files:[],S=String(e?.source||"").trim(),k=r||(m.length?"Please review the attached file(s).":"");if(!k&&!m.length)return;if(te()){x.push({text:r,files:m,source:S,speak:e?.speak===!0,voice:e?.voice===!0}),Z(),M?.update?.();return}let H=k,j=m;if(m.length){let z=await wt(m);H=`${k}${$t(z)}`,j=z.map((G,R)=>({...m[R]||{},name:G.name||m[R]?.name||"attachment",kind:G.isImage?"image":G.isVideo?"video":m[R]?.kind||"file",workspacePath:G.workspacePath||m[R]?.workspacePath,path:G.workspacePath||m[R]?.path,dataUrl:m[R]?.dataUrl,mimeType:m[R]?.mimeType,sizeLabel:m[R]?.sizeLabel}))}let le={role:"user",from:"user",content:k,body:{text:k,attachments:j},attachmentPreviews:j,createdAt:Date.now()};n={role:"manager",from:"manager",fromLabel:"Manager",content:"",_progress:"Manager is thinking...",createdAt:Date.now(),workStartedAt:Date.now(),streaming:!0,processEntries:[]},g.push(le,n),A(),l=!0,M?.update?.(),$=nt(c,{message:H},{onEvent:z=>{Ce(n,z,"Manager"),A()},onError:z=>{z?.name!=="AbortError"&&(n.content=n.content||`Error: ${z?.message||"stream failed"}`,n._progress="",n.streaming=!1,n.workEndedAt=Date.now(),l=!1,$=null,M?.update?.(),A(),Y(z?.message||"Send failed","error"))},onDone:async()=>{n&&(n._progress="",n.streaming=!1,n.workEndedAt=n.workEndedAt||Date.now(),n.workDurationMs=Math.max(0,n.workEndedAt-Number(n.workStartedAt||n.createdAt||n.workEndedAt))),l=!1,$=null,M?.update?.(),await E({forceHistory:!0}),C()}})}M=Qt(t,"pm-team-chat",{placeholder:"Message the team manager...",draftKey:"team:manager",isBusy:te,onAbort:()=>{try{$?.abort?.()}catch{}n&&(n._progress="Stopping...",n.streaming=!1),$=null,l=!1,A()},onSubmit:F}),Z()}async function oa(t,{teamId:c,navigate:v}){t.classList.add("pm-agent-chat-page","pm-team-agent-chat-page"),t.dataset.mobileAgentChatRoute="team",document.body.classList.add("pm-mobile-subagent-chat-locked"),document.body.classList.add("pm-mobile-agent-chat-locked"),t.innerHTML=`
    ${Ae({title:"Team Chat",online:!0,leftIcon:"back",hideTitle:!0,hideBrand:!0})}
    <div class="pm-body pm-subagent-chat-body pm-team-chat-page-body" id="pm-team-chat-page-body">
      <div class="pm-card" style="text-align:center;padding:24px;color:var(--pm-muted);">Loading team chat&hellip;</div>
    </div>
  `,Te(t,{onBack:()=>v?.(`#mobile/teams/${encodeURIComponent(c)}`)});let f=t.querySelector("#pm-team-chat-page-body"),b=t.querySelector(".pm-model-badge .pm-model-badge-label"),i=!1;t._pmCleanup=()=>{if(!i){i=!0;try{f?._pmCleanup?.()}catch{}document.body.classList.remove("pm-mobile-agent-chat-locked","pm-mobile-subagent-chat-locked")}};try{let y=await Me(c);if(!y)throw new Error("Team not found");if(i||t.isConnected===!1)return;b&&(b.textContent=`${y.emoji||"\u{1F3E0}"} ${y.name}`),await Gt(f,c,{standalone:!0,team:y})}catch(y){f.innerHTML=`<div class="pm-empty"><div class="pm-empty-icon">${h.users}</div><h2>Couldn\u2019t load team chat</h2><p>${u(y?.message||"Network error")}</p></div>`}}function Yt(t){let c=String(t||"").toLowerCase();return/\.(md|markdown|txt)$/.test(c)?"\u{1F4DD}":/\.(js|ts|tsx|jsx|mjs|cjs)$/.test(c)?"\u{1F4DC}":/\.(json|yaml|yml|toml)$/.test(c)?"\u{1F527}":/\.(png|jpg|jpeg|gif|svg|webp)$/.test(c)?"\u{1F5BC}\uFE0F":/\.(mp4|mov|webm|mkv)$/.test(c)?"\u{1F3AC}":/\.(mp3|wav|ogg|flac)$/.test(c)?"\u{1F3B5}":/\.(html|htm)$/.test(c)?"\u{1F310}":/\.(pdf)$/.test(c)?"\u{1F4C4}":"\u{1F4C3}"}function Zt(t){return!t||t<1024?`${t||0} B`:t<1024*1024?`${(t/1024).toFixed(1)} KB`:`${(t/(1024*1024)).toFixed(2)} MB`}async function Jt(t,c){t.innerHTML='<div class="pm-card" style="text-align:center;padding:24px;color:var(--pm-muted);">Loading workspace\u2026</div>';let v;try{v=await rt(c)}catch(y){t.innerHTML=`<div class="pm-empty"><div class="pm-empty-icon">${h.doc}</div><h2>Couldn\u2019t load workspace</h2><p>${u(y.message||"")}</p></div>`;return}let f=v.files||[];if(!f.length){t.innerHTML=`<div class="pm-empty"><div class="pm-empty-icon">${h.doc}</div><h2>Workspace is empty</h2><p>Files written by team subagents will appear here.</p></div>`;return}t.innerHTML=`
    <div class="pm-card" style="padding:10px 12px 12px;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
        <strong style="font-size:13px;">${f.length} file${f.length===1?"":"s"}</strong>
        ${v.workspacePath?`<span style="font-size:11px;color:var(--pm-muted);font-family:ui-monospace,monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:60%;">${u(v.workspacePath)}</span>`:""}
      </div>
      <div id="pm-ws-list" style="display:flex;flex-direction:column;gap:6px;"></div>
      <div id="pm-ws-preview" style="margin-top:12px;display:none;"></div>
    </div>
  `;let b=t.querySelector("#pm-ws-list"),i=t.querySelector("#pm-ws-preview");b.innerHTML=f.map(y=>{let g=y.relpath||y.path||y.name||"",n=y.size||0,$=y.modifiedAt||y.updatedAt;return`
      <button type="button" data-rel="${u(g)}" style="display:flex;align-items:center;gap:10px;width:100%;text-align:left;background:var(--pm-bg-soft);border:1px solid var(--pm-border);border-radius:12px;padding:10px 12px;cursor:pointer;font-family:inherit;">
        <span style="font-size:18px;">${Yt(g)}</span>
        <span style="flex:1;min-width:0;overflow:hidden;">
          <span style="display:block;font-weight:700;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${u(g)}</span>
          <span style="display:block;font-size:11px;color:var(--pm-muted);">${Zt(n)}${$?" \xB7 "+be(typeof $=="number"?$:new Date($).getTime()):""}</span>
        </span>
        <span style="color:var(--pm-muted);">${h.chev}</span>
      </button>
    `}).join(""),b.querySelectorAll("[data-rel]").forEach(y=>{y.addEventListener("click",async()=>{let g=y.getAttribute("data-rel");i.style.display="block",i.innerHTML=`<div class="pm-card-body" style="padding:14px;color:var(--pm-muted);">Loading ${u(g)}\u2026</div>`;try{let n=await ot(c,g),$=n?.content||n?.body||"";i.innerHTML=`
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
            <strong style="flex:1;font-size:13px;">${u(g)}</strong>
            <button class="pm-btn ghost" id="pm-ws-close" style="padding:4px 10px;font-size:12px;">\u2715 Close</button>
          </div>
          <pre style="background:var(--pm-bg-soft);border:1px solid var(--pm-border);border-radius:10px;padding:12px;font-size:12px;line-height:1.5;font-family:ui-monospace,monospace;white-space:pre-wrap;word-break:break-word;max-height:60vh;overflow:auto;margin:0;">${u(String($).slice(0,5e4))}${String($).length>5e4?`

\u2026(truncated)`:""}</pre>
        `,i.querySelector("#pm-ws-close").addEventListener("click",()=>{i.style.display="none",i.innerHTML=""}),i.scrollIntoView({behavior:"smooth",block:"nearest"})}catch(n){i.innerHTML=`<div class="pm-card-body" style="color:var(--pm-red);">${u(n.message||"Failed to load file")}</div>`}})})}async function Xt(t,c,v){t.innerHTML='<div class="pm-card" style="text-align:center;padding:24px;color:var(--pm-muted);">Loading memory\u2026</div>';let f;try{f=await st()}catch(o){t.innerHTML=`<div class="pm-empty"><div class="pm-empty-icon">${h.brain}</div><h2>Couldn\u2019t load memory</h2><p>${u(o.message||"")}</p></div>`;return}let b=Array.isArray(f?.nodes)?f.nodes.slice():[],i=String(c).toLowerCase(),y=String(v?.name||"").toLowerCase(),g=o=>{let s=String(o.sourcePath||"").toLowerCase(),l=String(o.projectId||"").toLowerCase();return l&&l.includes(i)||s&&(s.includes(i)||y&&s.includes(y))},n=b.filter(g),$=(n.length?n:b).sort((o,s)=>String(s.timestamp||"").localeCompare(String(o.timestamp||""))).slice(0,30);if(!$.length){t.innerHTML=`<div class="pm-empty"><div class="pm-empty-icon">${h.brain}</div><h2>No memory yet</h2><p>As the team works, reflections and memory entries land here.</p></div>`;return}t.innerHTML=`
    <div style="display:flex;align-items:center;gap:8px;padding:6px 4px 10px;color:var(--pm-muted);font-size:12px;">
      <span class="pm-pill ${n.length?"orange":"gray"}">${n.length?"team-scoped":"global feed"}</span>
      <span>${$.length} of ${b.length} entries</span>
    </div>
    ${$.map(o=>`
      <article class="pm-card" style="padding:12px 14px;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
          <strong style="flex:1;font-size:13px;line-height:1.3;">${u(o.label||"Memory")}</strong>
          <span class="pm-pill gray" style="font-family:ui-monospace,monospace;">${u(o.sourceTypeLabel||o.sourceType||"memory")}</span>
        </div>
        ${o.summary?`<div class="pm-card-body" style="margin-bottom:4px;">${u(String(o.summary).slice(0,240))}${String(o.summary).length>240?"\u2026":""}</div>`:""}
        <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--pm-muted);">
          <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:70%;font-family:ui-monospace,monospace;">${u(o.sourcePath||"")}</span>
          <span>${o.timestamp?be(new Date(o.timestamp).getTime()):""}</span>
        </div>
      </article>
    `).join("")}
  `}export{na as a,ra as b,Vt as c,Wt as d,Kt as e,Ot as f,Qt as g,oa as h};
