import{A as kt,C as K,H as Mt,I as Lt,J as At,M as Tt,O as _t,c as mt,f as ut,g as vt,h as _e,i as ht,j as ft,l as ge,m as gt,o as bt,p as yt,q as Pe,r as wt,s as $t,t as xt,u as Ee,v as St}from"./chunk-WXAUUCDB.js";import{b as ue}from"./chunk-J5HXEABW.js";import{a as Z}from"./chunk-35CAQ6TV.js";import{H as f,I as m,O as Ae,P as Te}from"./chunk-ZPN7O3XJ.js";import{e as oe}from"./chunk-ZRKTAVNO.js";import{a as ct,b as dt,c as pt}from"./chunk-PHXVQCOK.js";import{La as lt,Q as He,R as Ye,S as Me,T as Ze,U as Je,V as Xe,X as et,Y as Re,Z as tt,_ as Le,aa as at,ba as nt,c as Qe,ca as rt,da as ot,ea as st,ga as it,s as Ge}from"./chunk-ZELBOCU2.js";import{a as E}from"./chunk-DFHP73MY.js";function zt(e){let d=e.house==="blue"?"#4a82d1":"#a4682b";return`
    <button class="pm-team-tile ${e.featured?"featured":""}" data-team="${e.id}">
      ${e.featured?'<span class="pm-star">\u2605</span>':""}
      <span class="pm-house" style="color:${d}">\u{1F3E0}</span>
      <span class="pm-team-name">${m(e.name)}</span>
      <span class="pm-team-agents">${f.users} ${e.agents} agents</span>
    </button>
  `}function Et(){return`<div class="pm-team-grid">${'<div class="pm-team-tile" style="opacity:.55"><span class="pm-house" style="opacity:.4">\u{1F3E0}</span><span class="pm-team-name" style="background:rgba(0,0,0,.06);color:transparent;border-radius:6px;height:16px;width:80%;">loading</span></div>'.repeat(4)}</div>`}async function na(e,{navigate:d}){let v=`
    <span class="pm-count-pill" id="pm-teams-count">\u2026</span>
    <span class="pm-spacer"></span>
    <button class="pm-icon-btn" id="pm-teams-refresh" aria-label="Refresh" style="background:var(--pm-surface);border:1px solid var(--pm-border);">${f.refresh}</button>
  `,b=Ae({title:"Teams",online:!1,extras:v});e.innerHTML=`
    ${b}
    <div class="pm-body" id="pm-teams-body">${Et()}</div>
  `,Te(e,{});let g=e.querySelector("#pm-teams-body"),c=e.querySelector("#pm-teams-count"),x=e.querySelector("#pm-teams-refresh");async function w({force:M=!1}={}){let i=[];try{i=await Ye({force:M})}catch($){g.innerHTML=`<div class="pm-empty"><div class="pm-empty-icon">${f.users}</div><h2>Couldn\u2019t load teams</h2><p>${m($.message||"Network error")}</p></div>`,c.textContent="0 teams";return}if(c.textContent=`${i.length} team${i.length===1?"":"s"}`,!i.length){g.innerHTML=`<div class="pm-empty"><div class="pm-empty-icon">${f.users}</div><h2>No teams yet</h2><p>Create your first team from the desktop app.</p></div>`;return}let n=i.find($=>$.featured)||i[0],o=null;try{o=await Me(n.id)}catch{}let L=o?`
      <div class="pm-team-preview">
        <div class="pm-team-preview-head">
          <span class="pm-mini-house">${m(o.emoji||"\u{1F3E0}")}</span>
          <h3>${m(o.name)}</h3>
          <button class="pm-pill-btn" data-go="${m(o.id)}">View Team ${f.chev}</button>
        </div>
        <div style="font-size:13px;color:var(--pm-muted);font-weight:700;margin-top:4px;">Team members</div>
        <div class="pm-chip-row">
          ${o.members.map($=>`<span class="pm-member-chip"><span class="pm-avatar" style="background:${$.color}">${$.avatar}</span>${m($.name)}</span>`).join("")}
        </div>
        <div class="pm-divider"></div>
        <div class="pm-row"><span>\u{1F5C2}\uFE0F Workspace</span><span style="color:var(--pm-muted)">${m(o.workspace)} ${f.chev}</span></div>
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
      <div class="pm-team-grid">${i.map(zt).join("")}</div>
      ${L}
    `,g.querySelectorAll("[data-team]").forEach($=>{$.addEventListener("click",()=>d(`#mobile/teams/${$.getAttribute("data-team")}`))}),g.querySelectorAll("[data-go]").forEach($=>{$.addEventListener("click",()=>d(`#mobile/teams/${$.getAttribute("data-go")}`))})}x.addEventListener("click",()=>{He(),g.innerHTML=Et(),w({force:!0})});let l=Qe("teams_raw",216e5);await w(),Array.isArray(l)&&w({force:!0}).catch(()=>{})}function Bt(){return`
    <div class="pm-detail-head"><span class="pm-house-icon">\u{1F3E0}</span><h1 style="background:rgba(0,0,0,.06);color:transparent;border-radius:8px;height:24px;flex:1;">loading</h1></div>
    <div class="pm-detail-sub">\u2026</div>
    <div class="pm-action-row">
      <button class="pm-action-btn primary">${f.play} Start Run</button>
      <button class="pm-action-btn">${f.pause} Pause</button>
      <button class="pm-action-btn">${f.brain} Review</button>
      <button class="pm-action-btn danger">${f.trash} Delete</button>
    </div>
    <div class="pm-card" style="opacity:.5"><div class="pm-card-head">${f.target} Purpose</div><div class="pm-card-body">Loading team\u2026</div></div>
  `}async function ra(e,{teamId:d,navigate:v,initialTab:b=""}){e.innerHTML=`
    ${Ae({title:"Team",online:!0,leftIcon:"back",hideTitle:!0,hideBrand:!0})}
    <div class="pm-body pm-subagent-detail-body pm-team-detail-body" id="pm-detail-body">${Bt()}</div>
  `,Te(e,{onBack:()=>v("#mobile/teams")});let g=e.querySelector("#pm-detail-body"),c=null;try{c=await Me(d)}catch(a){g.innerHTML=`<div class="pm-empty"><div class="pm-empty-icon">${f.users}</div><h2>Couldn\u2019t load team</h2><p>${m(a.message||"Network error")}</p></div>`;return}if(!c){g.innerHTML=`<div class="pm-empty"><div class="pm-empty-icon">${f.users}</div><h2>Team not found</h2><p>This team isn\u2019t available right now.</p></div>`;return}let x=["Context","Subagents","Workspace","Memory","Runs","Team Chat"];g.innerHTML=`
    <div class="pm-detail-head">
      <span class="pm-house-icon">${m(c.emoji||"\u{1F3E0}")}</span>
      <h1>${m(c.name)}</h1>
      <button class="pm-icon-btn pm-overflow" aria-label="More">${f.dots}</button>
    </div>
    <div class="pm-detail-sub">${c.subagents} subagents \xB7 ${c.totalRuns} total runs</div>

    <div class="pm-action-row">
      <button class="pm-action-btn primary" data-act="start">${f.play} Start Run</button>
      <button class="pm-action-btn"          data-act="pause">${c.paused?f.play+" Resume":f.pause+" Pause"}</button>
      <button class="pm-action-btn"          data-act="chat">${f.chat} Chat</button>
      <button class="pm-action-btn danger"   data-act="delete">${f.trash} Delete</button>
    </div>

    <div class="pm-tabs" role="tablist">
      ${x.map((a,y)=>`<button class="${y===0?"active":""}" data-tab="${a}">${m(a)}</button>`).join("")}
    </div>

    <div id="pm-tab-slot"></div>

    <div id="pm-context-slot">
    <div class="pm-team-preview">
      <div class="pm-team-preview-head">
        <span class="pm-mini-house">${m(c.emoji||"\u{1F3E0}")}</span>
        <h3>${m(c.name)}</h3>
      </div>
      <div style="font-size:13px;color:var(--pm-muted);">${c.subagents} subagents \xB7 ${c.totalRuns} total runs</div>
      <div class="pm-chip-row">
        ${c.members.map(a=>`<span class="pm-member-chip"><span class="pm-avatar" style="background:${a.color}">${a.avatar}</span>${m(a.name)}</span>`).join("")}
      </div>
    </div>

    <div class="pm-card">
      <div class="pm-card-head" style="display:flex;justify-content:space-between;align-items:center;">
        <span>${f.target} Purpose</span>
        <button class="pm-show-more" data-toggle-purpose>Show more \u25BE</button>
      </div>
      <div class="pm-card-body" data-purpose data-collapsed="1" style="display:-webkit-box;-webkit-line-clamp:6;-webkit-box-orient:vertical;overflow:hidden;">${m(c.purpose)}</div>
    </div>

    <div class="pm-card-grid">
      <div class="pm-card">
        <div class="pm-card-head">${f.check} Current Task / Goal</div>
        <div class="pm-card-body">${m(c.currentTask)}</div>
      </div>
      <div class="pm-card">
        <div class="pm-card-head">${f.clock} Last Run</div>
        <div class="pm-card-body strong">${m(c.lastRun)}</div>
      </div>
      <div class="pm-card">
        <div class="pm-card-head">${f.users} Member States</div>
        <div class="pm-card-body">${m(c.memberStates)}</div>
      </div>
      <div class="pm-card">
        <div class="pm-card-head">${f.send} Active Dispatches</div>
        <div class="pm-card-body">${m(c.dispatches)}</div>
      </div>
    </div>

    <div class="pm-card">
      <div class="pm-card-head">${f.doc} Context &amp; Reference</div>
      <div class="pm-card-body" style="margin-bottom:10px;">Each save adds a new card. Cards are injected into manager + subagent runtime context.</div>
      <input class="pm-input" id="pm-ref-title" placeholder="Reference title (e.g. Brand Voice, API URL, Posting Rules)" />
      <textarea class="pm-textarea" id="pm-ref-body" placeholder="Reference content\u2026"></textarea>
      <div class="pm-row-buttons">
        <button class="pm-btn ghost" disabled title="Upload coming soon">${f.upload} Upload File</button>
        <button class="pm-btn primary" data-save-ref>${f.check} Save</button>
      </div>
    </div>

    <div class="pm-card">
      <div class="pm-card-head" style="display:flex;justify-content:space-between;align-items:center;">
        <span>\u{1F4C1} Workspace Preview</span>
        <a href="#mobile/teams/${m(d)}/workspace" style="color:var(--pm-orange);font-weight:700;text-decoration:none;font-size:13px;">Open Workspace \u203A</a>
      </div>
      <div class="pm-card-body">${m(c.workspace)}</div>
    </div>
    </div><!-- /pm-context-slot -->
  `;let w=g.querySelector("#pm-context-slot"),l=g.querySelector("#pm-tab-slot");async function M(a){try{l?._pmCleanup?.()}catch{}if(l&&(l._pmCleanup=null),g.querySelectorAll(".pm-tabs button").forEach(y=>y.classList.toggle("active",y.getAttribute("data-tab")===a)),a==="Context"){w.style.display="",l.innerHTML="";return}w.style.display="none",l.innerHTML=`<div class="pm-card" style="text-align:center;padding:24px;color:var(--pm-muted);">Loading ${m(a)}\u2026</div>`;try{if(a==="Subagents")await qt(l,c);else if(a==="Runs")await Ut(l,d);else if(a==="Team Chat"){v(`#mobile/teams/${encodeURIComponent(d)}/chat`);return}else a==="Workspace"?await Jt(l,d):a==="Memory"&&await Xt(l,d,c)}catch(y){l.innerHTML=`<div class="pm-card"><div class="pm-card-head">${f.users} Error</div><div class="pm-card-body">${m(y.message||"Failed to load")}</div></div>`}}g.querySelectorAll(".pm-tabs button").forEach(a=>{a.addEventListener("click",()=>M(a.getAttribute("data-tab")))});let i=x.find(a=>a.toLowerCase().replace(/\s+/g,"-")===String(b||"").toLowerCase());i&&i!=="Context"&&M(i);let n=g.querySelector("[data-toggle-purpose]"),o=g.querySelector("[data-purpose]");n&&o&&n.addEventListener("click",()=>{o.getAttribute("data-collapsed")==="1"?(o.style.webkitLineClamp="unset",o.style.display="block",o.setAttribute("data-collapsed","0"),n.textContent="Show less \u25B4"):(o.style.display="-webkit-box",o.style.webkitLineClamp="6",o.setAttribute("data-collapsed","1"),n.textContent="Show more \u25BE")});async function L(a,y,h){let _=a.innerHTML;a.disabled=!0,a.style.opacity="0.6";try{let C=await y();if(!C||C.success===!1)throw new Error(C?.error||"Failed");return Z(h,"success"),C}catch(C){throw Z(C.message||"Action failed","error"),C}finally{a.disabled=!1,a.style.opacity="",a.innerHTML=_}}g.querySelectorAll("[data-act]").forEach(a=>{let y=a.getAttribute("data-act");a.addEventListener("click",async()=>{if(y==="start")await L(a,()=>Ze(d),"Run started").catch(()=>{});else if(y==="pause"){let h=c.paused;try{await L(a,()=>h?Xe(d):Je(d),h?"Team resumed":"Team paused"),c.paused=!h,a.innerHTML=c.paused?`${f.play} Resume`:`${f.pause} Pause`}catch{}}else if(y==="chat")v(`#mobile/teams/${encodeURIComponent(d)}/chat`);else if(y==="delete"){if(!window.confirm(`Delete team "${c.name}"? This cannot be undone.`))return;try{await L(a,()=>et(d),"Team deleted"),He(),v("#mobile/teams")}catch{}}})});let $=g.querySelector("[data-save-ref]");$&&$.addEventListener("click",async()=>{let a=g.querySelector("#pm-ref-title"),y=g.querySelector("#pm-ref-body"),h=(a.value||"").trim(),_=(y.value||"").trim();if(!h||!_){Z("Title and content required","error");return}try{await L($,()=>lt(d,h,_),"Reference saved"),a.value="",y.value=""}catch{}}),e._pmCleanup=()=>{try{l?._pmCleanup?.()}catch{}}}var Ct={working:{label:"working",cls:"running"},active:{label:"active",cls:"active"},ready:{label:"ready",cls:"active"},idle:{label:"idle",cls:"gray"},blocked:{label:"blocked",cls:"orange"},paused:{label:"paused",cls:"gray"},awaiting:{label:"awaiting",cls:"orange"},offline:{label:"offline",cls:"gray"}};function Ft(e){if(!e||e<0)return"\u2014";let d=Math.floor(e/1e3);return d<60?`${d}s`:`${Math.floor(d/60)}m ${d%60}s`}async function qt(e,d){let v=null;try{v=await Re(d.id)}catch{}let b=v?.memberStates||{},g=Array.isArray(v?.activeDispatches)?v.activeDispatches:[],c=new Map;for(let i of g){let n=String(i.agentId||i.subagentId||"").trim();n&&c.set(n,i)}let x=d.members.filter(i=>i.id!=="manager"),w=new Map((await Promise.all(x.map(async i=>{let n=await it(i.id).catch(()=>null);return[i.id,n]}))).filter(([,i])=>i)),l=[],M=x.map(i=>{let n=b[i.id]||{},o=Ct[String(n.status||"idle").toLowerCase()]||Ct.idle,L=c.get(i.id),$=w.get(i.id),a=`pm-team-member-model-${d.id}-${i.id}`.replace(/[^a-zA-Z0-9_-]/g,"-");return $&&l.push({pickerScope:a,agent:$}),`
      <article class="pm-card pm-team-member-card">
        <div class="pm-schedule-head" style="margin-bottom:8px;">
          <span class="pm-emoji" style="font-size:22px;">${i.avatar}</span>
          <h3 style="margin:0;">${m(i.name)}</h3>
          <span class="pm-pill ${o.cls}">${o.label}</span>
        </div>
        ${n.currentTask?`<div class="pm-card-body" style="margin-bottom:6px;"><strong>Current:</strong> ${m(n.currentTask)}</div>`:""}
        ${n.blockedReason?`<div class="pm-card-body" style="color:var(--pm-red);margin-bottom:6px;"><strong>Blocked:</strong> ${m(n.blockedReason)}</div>`:""}
        ${n.lastResult?`<div class="pm-card-body" style="font-size:13px;color:var(--pm-muted);margin-bottom:6px;">Last: ${m(String(n.lastResult).slice(0,140))}${String(n.lastResult).length>140?"\u2026":""}</div>`:""}
        <div style="display:flex;justify-content:space-between;align-items:center;font-size:12px;color:var(--pm-muted);">
          <span>${L?"\u{1F4E1} dispatched":"Last update"}</span>
          <span>${ue(n.lastUpdateAt||L?.startedAt)}</span>
        </div>
        ${$?ct($,a):""}
      </article>
    `}).join("");e.innerHTML=M||`<div class="pm-empty"><div class="pm-empty-icon">${f.robot}</div><h2>No subagents yet</h2><p>Add members from the desktop team editor.</p></div>`,l.forEach(({pickerScope:i,agent:n})=>{pt(i,()=>qt(e,d)),dt(i,n)})}function Vt(e){return e.inProgress?'<span class="pm-pill running">running</span>':e.success===!0?'<span class="pm-pill active">success</span>':e.success===!1&&e.taskStatus?`<span class="pm-pill orange">${m(String(e.taskStatus))}</span>`:'<span class="pm-pill gray">complete</span>'}async function Ut(e,d){let{runs:v}=await tt(d,30);if(!v.length){e.innerHTML=`<div class="pm-empty"><div class="pm-empty-icon">${f.clock}</div><h2>No runs yet</h2><p>Start a run from the top of this page.</p></div>`;return}e.innerHTML=v.map(b=>`
    <article class="pm-card" style="padding:14px 16px;">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
        <strong style="flex:1;font-size:14px;">${m(b.agentName||b.agentId||"Agent")}</strong>
        ${Vt(b)}
      </div>
      ${b.taskSummary?`<div class="pm-card-body" style="margin-bottom:6px;">${m(String(b.taskSummary).slice(0,200))}${String(b.taskSummary).length>200?"\u2026":""}</div>`:""}
      <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--pm-muted);">
        <span>${m(b.trigger||"manual")} \xB7 ${b.stepCount||0} steps</span>
        <span>${ue(b.startedAt)} \xB7 ${Ft(b.durationMs)}</span>
      </div>
    </article>
  `).join("")}function Ot(e){return e?{type:String(e.type||e.event||""),...e.data||{}}:null}function Wt(e,d,v){if(!e)return;let b=new Set,g=new Set;e.querySelectorAll(".pm-agent-chat-msg").forEach((c,x)=>{c.querySelector(".pm-trace-drawer.open")&&b.add(x),c.querySelectorAll("details.pm-trace-tool-group[open]").forEach((l,M)=>{g.add(`${x}:${l.getAttribute("data-pm-trace-group")||M}`)})}),e.innerHTML=d.map(v).join(""),e.querySelectorAll(".pm-agent-chat-msg").forEach((c,x)=>{let w=c.querySelector(".pm-trace-drawer"),l=c.querySelector('[data-expandable="trace"]');w&&b.has(x)&&(w.classList.add("open"),l?.classList.add("expanded")),c.querySelectorAll("details.pm-trace-tool-group").forEach((M,i)=>{let n=`${x}:${M.getAttribute("data-pm-trace-group")||i}`;g.has(n)&&!M.closest('.pm-trace-drawer[data-trace-completed="1"]')&&M.setAttribute("open","")})}),kt(e)}var De={};function Kt(e,d){let v=String(e||"pm-agent-chat"),b=v==="pm-team-chat"||v==="pm-sa-chat";return`
    ${b?`<div class="pm-chat-mode-launcher pm-agent-chat-mode-launcher" id="${v}-mode-launcher" role="group" aria-label="Choose chat input">
      <button type="button" class="pm-chat-mode-button pm-chat-mode-button--voice" id="${v}-mode-voice" aria-label="Start voice mode">${f.micSmall}<span class="pm-chat-mode-button-label">Voice mode</span></button>
      <button type="button" class="pm-chat-mode-button pm-chat-mode-button--keyboard" id="${v}-mode-keyboard" aria-label="Open keyboard composer">${f.keyboard}<span class="pm-chat-mode-button-label">Keyboard composer</span></button>
    </div>`:""}
    <form class="pm-composer pm-agent-chat-composer${b?" pm-composer-mode-hidden":""}" id="${v}-form"${b?' aria-hidden="true" inert':""}>
      <span class="pm-glass-lens" aria-hidden="true"></span>
      <span class="pm-glass-border" aria-hidden="true"></span>
      <input id="${v}-file-input" type="file" multiple accept="image/*,video/*,.mp4,.mov,.m4v,.webm,.avi,.mkv,.txt,.md,.json,.csv,.tsv,.log,.xml,.html,.css,.js,.ts,.tsx,.jsx,.py,.yaml,.yml,application/pdf" hidden />
      <div class="pm-attach-tray" id="${v}-attach-tray" hidden></div>
      <div class="pm-composer-row">
        <button type="button" class="pm-icon-btn" id="${v}-attach-btn" aria-label="Attach files">${f.paperclip}</button>
        <div class="pm-composer-input-wrap" id="${v}-input-wrap">
          <textarea class="pm-composer-input" id="${v}-input" rows="1" placeholder="${m(d)}" aria-label="Message" autocomplete="off" autocapitalize="sentences" enterkeyhint="send"></textarea>
        </div>
        <button type="button" class="pm-icon-btn" id="${v}-mic-btn" aria-label="Voice input">${f.micSmall}</button>
        <button type="submit" class="pm-send" id="${v}-send-btn" aria-label="Send">${f.send}</button>
      </div>
      <div class="pm-chat-voice-shell" id="${v}-voice-shell" hidden>
        <button type="button" class="pm-chat-voice-camera" id="${v}-voice-camera" aria-label="Attach camera image">${f.image}</button>
        <button type="button" class="pm-chat-voice-close" id="${v}-voice-close" aria-label="Close voice mode">&times;</button>
        <div class="pm-chat-voice-inline" id="${v}-voice-inline"></div>
      </div>
    </form>`}function Qt(e,d,{placeholder:v,isBusy:b,onSubmit:g,onAbort:c,draftKey:x="",voiceTarget:w=null,onVoiceSubmit:l=null,openCameraCapture:M=null}){let i=String(d||"pm-agent-chat"),n=e.querySelector(`#${i}-form`),o=e.querySelector(`#${i}-input`),L=e.querySelector(`#${i}-send-btn`),$=e.querySelector(`#${i}-attach-btn`),a=e.querySelector(`#${i}-mic-btn`),y=e.querySelector(`#${i}-voice-shell`),h=e.querySelector(`#${i}-voice-close`),_=e.querySelector(`#${i}-voice-camera`),C=e.querySelector(`#${i}-voice-inline`),te=e.querySelector(`#${i}-file-input`),se=e.querySelector(`#${i}-attach-tray`),re=e.querySelector(`#${i}-mode-launcher`),ve=e.querySelector(`#${i}-mode-voice`),ie=e.querySelector(`#${i}-mode-keyboard`),J=String(x||"").trim(),q=null;J&&(De[J]||(De[J]={text:"",pending:[]}),q=De[J],Array.isArray(q.pending)||(q.pending=[]));let z=q?q.pending:[],T=!1,H=null,be=null,j=null,Q=0;o&&q?.text&&(o.value=q.text);let G=i==="pm-team-chat"||i==="pm-sa-chat",X=document.querySelector(".pm-app")||document.body,ae=document.querySelector(".pm-tabbar"),R=window.visualViewport,ye=r=>{if(!ae)return 0;let p=getComputedStyle(ae);if(p.display==="none"||p.visibility==="hidden")return 0;let S=ae.getBoundingClientRect?.(),N=Math.max(0,Number(R?.offsetTop||0)),I=Math.max(0,Number(r||0));return!S||S.height<=0||S.bottom<=N||S.top>=I?0:Math.max(0,Math.round(I-Math.max(S.top,N)+16))},V=0,ee=0,U=!1,t="",s=0,u=0,k=Math.max(Number(window.innerHeight||0),Number(R?.height||0)),A=0,P=0,B=e.querySelector?.(".pm-sa-chat-scrollport")||e.closest?.(".pm-page.pm-agent-chat-page")?.querySelector?.(".pm-sa-chat-scrollport")||e,le=0,F=0,Y=Number(B?.scrollTop||0),D={passive:!0},we=["position","left","right","top","bottom","z-index"],je=()=>{!n||!G||(U=!1,t="",s=0,u=0,A=0,P=0,we.forEach(r=>n.style.removeProperty(r)),X?.classList.remove("pm-keyboard-open","pm-agent-composer-keyboard-open"),X?.style.removeProperty("--pm-keyboard-offset"),ae?.style.removeProperty("display"),V&&cancelAnimationFrame(V),V=0,ee&&window.clearTimeout(ee),ee=0)},Ht=()=>{if(V=0,!n||!G||!U)return;let r=Math.max(Number(window.innerHeight||0),Number(document.documentElement?.clientHeight||0)),p=Math.max(0,Number(R?.offsetTop||0)),S=Math.max(0,Number(R?.height||r||0)),N=Math.round(p+S),I=R?Math.max(0,Math.round(r-S)):0,ne=Math.max(0,Math.round(k-S));if((I>90||ne>90)&&!t){let Ke=Number(n.getBoundingClientRect?.().bottom||0);t=Ke>0&&Ke<=N+44?"visual":"layout",t==="visual"&&(s=N,u=S)}else t==="visual"&&Math.abs(S-u)>2&&(s=N,u=S);let fe=t==="visual"?s||N:r,me=Math.max(54,Math.ceil(n.getBoundingClientRect?.().height||n.offsetHeight||54)),ke=ye(fe),jt=t==="layout"&&I>0?I+8:0,Nt=Math.max(8,ke,jt),It=Math.max(8,Math.round(fe-Nt-me));n.style.setProperty("position","fixed","important"),n.style.setProperty("left","10px","important"),n.style.setProperty("right","10px","important"),n.style.setProperty("top",`${It}px`,"important"),n.style.setProperty("bottom","auto","important"),n.style.setProperty("z-index","10030","important"),X?.classList.add("pm-keyboard-open","pm-agent-composer-keyboard-open"),X?.style.setProperty("--pm-keyboard-offset",`${I}px`)},O=()=>{!G||!U||V||(V=requestAnimationFrame(()=>{if(V=0,!G||!U)return;let r=Math.max(Number(window.innerHeight||0),Number(document.documentElement?.clientHeight||0)),p=Math.max(0,Number(R?.height||r||0)),S=Math.max(0,r-p)>90||Math.max(0,k-p)>90,N=performance.now()<A||performance.now()<P;if(!S&&!N){$e();return}Ht()}))},Ne=()=>{G&&(U=!0,A=performance.now()+1600,k=Math.max(k,Number(window.innerHeight||0),Number(R?.height||0)),t="",s=0,u=0,X?.classList.add("pm-keyboard-open","pm-agent-composer-keyboard-open"),X?.style.setProperty("--pm-keyboard-offset","0px"),O(),[80,240,560,1e3].forEach(r=>window.setTimeout(O,r)),ee&&window.clearTimeout(ee),ee=window.setTimeout(()=>{ee=0,O()},1700))},$e=()=>{G&&(je(),k=Math.max(Number(window.innerHeight||0),Number(R?.height||0)))},ce=()=>{if(!o)return;let r=Math.max(320,Math.round(window.visualViewport?.height||window.innerHeight||640)),p=Math.max(96,Math.min(280,Math.floor(r*.5)-86)),S=Number(o.dataset.maxHeight||p);o.style.height="auto",o.style.height=`${Math.min(S,Math.max(30,o.scrollHeight||30))}px`,o.style.overflowY=o.scrollHeight>S?"auto":"hidden"},de=()=>!!(String(o?.value||"").trim()||z.length),pe=()=>w&&typeof l=="function"&&y&&C,Rt=()=>{if(!G||!n||n.classList.contains("pm-composer-mode-hidden")||n.classList.contains("is-voice-active"))return!1;let r=U||X?.classList?.contains("pm-keyboard-open"),p=U||document.activeElement===o;return r||p?!1:!n.classList.contains("has-text")&&!n.classList.contains("has-attachments")&&!n.classList.contains("has-pending-question")},xe=()=>{F=performance.now()+900},Ie=()=>{let r=Number(B?.scrollTop||0),p=r-Y;if(Y=r,p>=-2)return;let S=performance.now();S<le||S>F||Rt()&&($e(),Ce(!1,{animate:!0,reason:"scroll"}))},Se=()=>{n&&(n.classList.toggle("is-focused",document.activeElement===o),n.classList.toggle("has-text",!!String(o?.value||"").trim()),n.classList.toggle("has-attachments",z.length>0))},ze=()=>{if(!(!y||!C)){y.hidden=!0;try{C._pmCleanup?.()}catch{}C.innerHTML="",Lt(),K?.target?.kind==="subagent"&&K.target.agentId===w?.agentId&&(K.target=null,K.subagentSubmit=null)}},Be=async({autoStart:r=!0}={})=>{if(!pe()){Z("Voice mode is not available for this composer.","error");return}let p={kind:"subagent",agentId:String(w.agentId||"").trim(),label:String(w.label||w.name||"Subagent").trim(),voice:w.voice&&typeof w.voice=="object"?w.voice:null};K.target=p,K.targetSessionId=`subagent_chat_${p.agentId}`,K.targetSessionLabel=p.label,K.targetSessionChannel="subagent",K.targetSessionForced=!0,K.subagentSubmit=async S=>l({text:String(S||"").trim(),files:[]}),At(p.voice),y.hidden=!1,C.innerHTML="",await Mt(C,{inline:!0,inlineChatSessionId:K.targetSessionId,inlineChatSessionLabel:p.label,autoStart:r,openCameraCapture:M,cameraButton:_})},Ce=(r,{animate:p=!0,reason:S="keyboard"}={})=>{!G||!n||!re||(!r&&U&&$e(),n.classList.toggle("pm-composer-mode-hidden",!r),n.setAttribute("aria-hidden",r?"false":"true"),r?n.removeAttribute("inert"):n.setAttribute("inert",""),re.setAttribute("aria-hidden",r?"true":"false"),re.classList.toggle("is-transitioning",p),le=performance.now()+(S==="keyboard"?1800:420),p&&setTimeout(()=>re.classList.remove("is-transitioning"),360))},Fe=()=>{Ce(!0,{reason:"keyboard"}),Ne(),window.requestAnimationFrame(()=>o?.focus({preventScroll:!0}))},Ve=async()=>{if(Ce(!0,{reason:"voice"}),pe()){await Be({autoStart:!0});return}window.requestAnimationFrame(()=>a?.click())};try{ie&&oe(ie,Fe),ve&&oe(ve,()=>{Ve().catch(()=>{})})}catch(r){console.warn("[mobile agent chat] mode haptic wiring failed:",r),ie?.addEventListener("click",Fe),ve?.addEventListener("click",()=>{Ve().catch(()=>{})})}B?.addEventListener("scroll",Ie,{passive:!0});for(let r of["touchstart","pointerdown","wheel"])B?.addEventListener(r,xe,D),B!==document&&document.addEventListener(r,xe,D);let he=()=>{se&&(se.hidden=z.length===0,se.innerHTML=yt(z,!0),se.querySelectorAll("[data-remove-attachment]").forEach(r=>{r.addEventListener("click",()=>{let p=Number(r.getAttribute("data-remove-attachment"));Number.isFinite(p)&&z.splice(p,1),he(),W()})}),Se())},W=()=>{let r=!!b?.(),p=r&&!de();n&&(n.classList.toggle("is-busy",r),n.setAttribute("aria-busy",r?"true":"false"),n.dataset.composerState=r?p?"stopping":"busy":"idle"),o&&(o.placeholder=r?"Queue a message...":v),L&&(L.disabled=!1,L.classList.toggle("is-abort",p),L.classList.toggle("is-voice",!r&&!de()&&pe()),L.title=p?"Stop":!r&&!de()&&pe()?"Start voice mode":r?"Queue message":"Send",L.setAttribute("aria-label",p?"Stop":!r&&!de()&&pe()?"Start voice mode":r?"Queue message":"Send"),L.setAttribute("aria-busy",r?"true":"false"),L.innerHTML=p?'<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><rect x="7" y="7" width="10" height="10" rx="2"/></svg>':!r&&!de()&&pe()?`<img class="pm-send-voice-icon" src="${mt}" alt="" aria-hidden="true" />`:f.send),Se()},Ue=()=>{let r=String(o?.value||"").trim(),p=z.splice(0,z.length);if(o&&(o.value="",q&&(q.text=""),ce()),T||H||j){T=!1,Q+=1,j&&clearTimeout(j),j=null;let S=H;H=null;try{S?.abort?.()}catch{try{S?.stop?.()}catch{}}a?.classList.remove("listening")}return he(),W(),{text:r,files:p}},Oe=({refocus:r=!0}={})=>{T=!1,Q+=1,j&&clearTimeout(j),j=null;let p=H;H=null;try{p?.stop?.()}catch{try{p?.abort?.()}catch{}}a?.classList.remove("listening"),r&&o?.focus(),ce(),W()},Pt=(r,p=140)=>{j&&clearTimeout(j),j=null,!(!T||H)&&(j=setTimeout(()=>{j=null,We(r)},p))},We=r=>{if(!(!T||H||!o))try{let p=new r,S=Q,N=String(o.value||"").trimEnd();H=p,p.lang=navigator.language||"en-US",p.interimResults=!0,p.continuous=!0,p.onstart=()=>{S===Q&&a?.classList.add("listening")},p.onresult=I=>{if(S!==Q)return;let ne="",qe="";for(let me=0;me<I.results.length;me+=1){let ke=String(I.results[me]?.[0]?.transcript||"");I.results[me].isFinal?ne+=ke:qe+=ke}let fe=`${ne}${qe}`.trim();o.value=`${N}${N&&fe?" ":""}${fe}`,q&&(q.text=o.value||""),ce(),W()},p.onerror=I=>{if(S!==Q)return;let ne=String(I?.error||"unknown");["not-allowed","service-not-allowed","audio-capture"].includes(ne)?(T=!1,Z(ne==="audio-capture"?"The microphone is not available.":"Microphone permission was denied.","error")):["no-speech","aborted"].includes(ne)||console.warn("[mobile agent chat] dictation cycle error:",ne)},p.onend=()=>{if(S===Q){if(H===p&&(H=null),ce(),W(),!T){a?.classList.remove("listening");return}Pt(r)}},p.start()}catch(p){H=null,T=!1,a?.classList.remove("listening"),Z(p?.message||"Could not start dictation.","error")}};o?.addEventListener("input",()=>{q&&(q.text=o.value||""),ce(),W()}),o?.addEventListener("focus",()=>{Se(),Ne()}),o?.addEventListener("blur",()=>window.setTimeout(()=>{Se();let r=document.activeElement,p=!!(r&&n?.contains?.(r)),S=Math.max(Number(window.innerHeight||0),Number(document.documentElement?.clientHeight||0)),N=Math.max(0,Number(R?.height||S||0)),I=Math.max(0,S-N)>90||Math.max(0,k-N)>90;if(p||performance.now()<P||I){U&&O();return}$e()},120)),R?.addEventListener("resize",O),R?.addEventListener("scroll",O),window.addEventListener("resize",O,{passive:!0}),window.addEventListener("orientationchange",O),n?.addEventListener("pointerdown",r=>{r.target?.closest?.("button, .pm-haptic-host")&&(P=performance.now()+700)},{passive:!0}),o?.addEventListener("keydown",r=>{r.key==="Enter"&&!r.shiftKey&&(r.preventDefault(),n?.requestSubmit?.())}),o?.addEventListener("paste",async r=>{let p=Array.from(r.clipboardData?.files||[]);if(!p.length)return;String(r.clipboardData?.getData?.("text/plain")||"").trim()||r.preventDefault();let S=await Promise.all(p.slice(0,8).map(Pe));z.push(...S.filter(Boolean)),he(),W()}),$?.addEventListener("click",()=>te?.click()),a?.addEventListener("click",()=>{let r=window.SpeechRecognition||window.webkitSpeechRecognition;if(!r){Z("Speech dictation is not available in this browser.","error");return}if(T){Oe();return}be=r,T=!0,Q+=1,a.classList.add("listening"),Z("Listening until you tap the mic again.","info"),We(r)}),h?.addEventListener("click",ze),_?.addEventListener("click",()=>{typeof M=="function"?M():te?.click()}),te?.addEventListener("change",async()=>{let r=Array.from(te.files||[]).slice(0,8);if(te.value="",!r.length)return;let p=await Promise.all(r.map(Pe));z.push(...p.filter(Boolean)),he(),W()}),n?.addEventListener("submit",async r=>{if(r.preventDefault(),b?.()&&!de()){c?.(),W();return}let p=Ue();if(!p.text&&!p.files.length){await Be({autoStart:!0});return}await g?.(p),W()});let Dt=e._pmCleanup;return e._pmCleanup=()=>{V&&cancelAnimationFrame(V),R?.removeEventListener("resize",O),R?.removeEventListener("scroll",O),window.removeEventListener("resize",O),window.removeEventListener("orientationchange",O),B?.removeEventListener("scroll",Ie);for(let r of["touchstart","pointerdown","wheel"])B?.removeEventListener(r,xe,D),B!==document&&document.removeEventListener(r,xe,D);je(),Oe({refocus:!1}),ze(),Dt?.()},requestAnimationFrame(()=>{he(),ce(),W()}),{input:o,update:W,consume:Ue,pending:z}}async function Gt(e,d,{standalone:v=!1,team:b=null}={}){e.innerHTML=`
    <div class="${v?"pm-sa-chat-shell pm-team-chat-page-shell":"pm-card"} pm-team-chat-card" id="pm-team-chat-card">
      <div id="pm-team-chat-list" class="pm-team-chat-list${v?" pm-sa-chat-scrollport pm-sa-chat-list":""}" aria-live="polite">
        <div class="pm-team-chat-status">Loading team chat&hellip;</div>
      </div>
      <div id="pm-team-chat-queue" class="pm-mobile-queued-prompts" hidden></div>
      <div id="pm-team-chat-goal" class="pm-mobile-goal-strip pm-mobile-goal-strip-inline" hidden></div>
      ${Kt("pm-team-chat","Message the team manager...")}
    </div>
  `;let g=e.querySelector("#pm-team-chat-list"),c=e.querySelector("#pm-team-chat-queue"),x=e.querySelector("#pm-team-chat-goal");xt(g,()=>{}),vt(x,ut.activeSessionId,{fallbackToLast:!0});let w=[],l=null,M=null,i=0,n="",o=!1,L=!1,$=[],a=[],y=null;function h(t={}){let s=t?.body&&typeof t.body=="object"?t.body:{},u=t?.metadata&&typeof t.metadata=="object"?t.metadata:{},k=String(t?.from||t?.role||"").toLowerCase(),A=k==="user"||k==="you"||k==="human",P=String(t?.content||t?.message||t?.text||s.text||"");return{...t,role:A?"user":"agent",from:A?"user":k||"manager",fromLabel:t?.fromLabel||t?.fromName||s.sender||(A?"You":"Manager"),content:P,body:{...s,text:P},createdAt:t?.createdAt||t?.timestamp||t?.ts||Date.now(),processEntries:Array.isArray(t?.processEntries)?t.processEntries:Array.isArray(u.processEntries)?u.processEntries:[]}}function _(t,s){if(s?.role==="user")return"";let u=t?.body&&typeof t.body=="object"?t.body:{},k=t?.metadata&&typeof t.metadata=="object"?t.metadata:{},A=String(t?.agentId||t?.subagentId||t?.memberId||t?.fromId||u.agentId||u.subagentId||k.agentId||k.subagentId||s?.from||"").trim().toLowerCase(),P=String(s?.fromLabel||"").trim().toLowerCase(),le=(Array.isArray(b?.members)?b.members:[]).find(Y=>{let D=String(Y?.id||"").trim().toLowerCase(),we=String(Y?.name||"").trim().toLowerCase();return A&&(D===A||we===A)||P&&(D===P||we===P)}),F=String(le?.id||(A&&!["agent","assistant","manager"].includes(A)?A:"manager")).trim();return`<span class="pm-team-sender-icon" aria-hidden="true">${_t(F,{scale:.24})}</span>`}function C(t){let s=h(t),u=_(t,s);try{return St(s,{sender:s.fromLabel,senderIconHtml:u,live:t===l,keepLiveTraceVisible:t===l})}catch(k){console.warn("[mobile team chat] rich message render failed:",k);let A=s.role==="user";return`<div class="pm-msg ${A?"from-user":"from-ai"} pm-agent-chat-msg">
        <div class="pm-bubble">
          ${A?"":`<span class="pm-sender pm-sender-with-icon">${u}<span class="pm-sender-name">${m(s.fromLabel)}</span></span>`}
          <div class="markdown-body">${ft(s.content)}</div>
        </div>
      </div>`}}let te=()=>!!(M||l?.streaming||o),se=(t={})=>{let s=ge(t),u=String(s.sessionId||s.sourceSessionId||"").trim();return!!s.id&&(u.startsWith(`team_dm_manager_${d}___`)||u.startsWith(`team_dm_member_${d}___`)||u===`team_chat_${d}`||String(s.teamId||s.toolArgs?.teamId||"").trim()===String(d))},re=(t={})=>{if(!se(t))return!1;let s=ge(t),u=a.findIndex(A=>String(A?.approvalRequest?.id||"")===s.id),k={role:"agent",from:"manager",fromLabel:"Manager",content:"",createdAt:Date.now(),approvalRequest:s};return u>=0?a[u]={...a[u],approvalRequest:{...a[u].approvalRequest||{},...s}}:a.push(k),a=a.slice(-8),!0},ve=(t,s,u={})=>{let k=String(t||"").trim();if(!k)return!1;let A=a.findIndex(P=>String(P?.approvalRequest?.id||"")===k);return A<0?!1:(a[A].approvalRequest=ge({...a[A].approvalRequest||{},...u.approval||u,id:k,status:s}),!0)},ie=async()=>{let t=await Ge("pending").catch(()=>[]);(Array.isArray(t)?t:[]).forEach(re)};function J(){c&&(c.hidden=$.length===0,c.innerHTML=$.length?`<div class="pm-mobile-queued-list">${$.map((t,s)=>`
           <div class="pm-mobile-queued-item">
             <button type="button" class="pm-mobile-queued-text" data-team-queue-edit="${s}">${m(String(t.text||"Attached file(s)").slice(0,120))}${t.files?.length?` <em>+${t.files.length}</em>`:""}</button>
             <div class="pm-mobile-queued-actions">
               <div class="pm-mobile-queued-menu-wrap">
                 <button type="button" class="pm-mobile-queued-icon pm-mobile-queued-menu-trigger" data-team-queue-menu="${s}" aria-label="Queued message actions" title="Actions">${f.dots}</button>
                 <div class="pm-mobile-queued-popover" data-team-queue-menu-popover="${s}" hidden>
                   <button type="button" class="pm-mobile-queued-menu-item pm-mobile-queued-steer" data-team-queue-steer="${s}">${f.target}<span>Steer</span></button>
                   <button type="button" class="pm-mobile-queued-menu-item pm-mobile-queued-remove" data-team-queue-remove="${s}">${f.trash}<span>Delete</span></button>
                 </div>
               </div>
             </div>
           </div>`).join("")}</div>`:"",ht(),c.querySelectorAll("[data-team-queue-edit]").forEach(t=>oe(t,()=>{})),c.querySelectorAll("[data-team-queue-menu]").forEach(t=>oe(t,()=>{let s=Number(t.getAttribute("data-team-queue-menu"));if(!Number.isInteger(s))return;let u=c.querySelector(`[data-team-queue-menu-popover="${s}"]`);if(!u)return;let k=!!u.hidden;_e(c),u.hidden=!k})),c.querySelectorAll("[data-team-queue-steer]").forEach(t=>oe(t,()=>{let s=Number(t.getAttribute("data-team-queue-steer"));if(Number.isFinite(s)&&s>=0&&s<$.length){let[u]=$.splice(s,1);u&&$.unshift(u)}_e(c),J(),q()})),c.querySelectorAll("[data-team-queue-remove]").forEach(t=>oe(t,()=>{let s=Number(t.getAttribute("data-team-queue-remove"));Number.isFinite(s)&&$.splice(s,1),_e(c),J()})))}function q(){if(te()||!$.length){y?.update?.();return}let t=$.shift();J(),U(t).catch(s=>Z(s?.message||"Send failed","error"))}function z(t){let s=l&&!l._done?l:null;w=Array.isArray(t)?t.slice():[],s&&(w.some(k=>String(k.content||k.message||k.text||"").trim()&&String(k.content||k.message||k.text||"").trim()===String(s.content||"").trim())||w.push(s))}function T(){let t=a.filter(u=>String(u?.approvalRequest?.status||"pending")==="pending"),s=[...w,...t];if(!s.length){g.innerHTML='<div style="text-align:center;color:var(--pm-muted);padding:24px 8px;font-size:13px;">No messages yet. Send the first one.</div>';return}Wt(g,s,C),g.querySelectorAll("[data-pm-approval-action][data-pm-approval-id]").forEach(gt),Tt(g),g.scrollTop=g.scrollHeight}try{z(await Le(d,80)),await ie(),T()}catch(t){g.innerHTML=`<div style="color:var(--pm-red);padding:16px;">${m(t.message||"Failed to load chat")}</div>`}async function H({forceHistory:t=!1}={}){try{let s=await at(d,n?i:0);s.stream?.streamId&&s.stream.streamId!==n&&(n=s.stream.streamId,i=0),s.stream?.streamId&&!l&&s.active&&(l={role:"manager",from:"manager",fromLabel:"Manager",content:"",_progress:"Reconnecting...",createdAt:Date.now(),workStartedAt:Date.now(),streaming:!0,processEntries:[]},w.push(l));for(let u of s.events||[])u.streamId&&(n=u.streamId),i=Math.max(i,Number(u.seq||0)),l||(l={role:"manager",from:"manager",fromLabel:"Manager",content:"",_progress:"Reconnecting...",createdAt:Date.now(),workStartedAt:Date.now(),streaming:!0,processEntries:[]},w.push(l)),Ee(l,Ot(u),"Manager");(t||!s.active||l?._done)&&(z(await Le(d,80)),await ie(),s.active||(l=null)),T()}catch{}}let be=()=>H({forceHistory:!0}),j=()=>{document.hidden||H({forceHistory:!0})},Q=async(t={})=>{if(String(t.teamId||"")===String(d))try{z(await Le(d,80)),l=null,T()}catch{}},G=(t={})=>{String(t.teamId||"")===String(d)&&(o||(t.streamId&&t.streamId!==n&&(n=t.streamId,i=0),i=Math.max(i,Number(t.seq||0)),l||(l={role:"manager",from:"manager",fromLabel:"Manager",content:"",_progress:"Thinking...",createdAt:Date.now(),workStartedAt:Date.now(),streaming:!0,processEntries:[]},w.push(l)),Ee(l,{type:String(t.event||""),...t.data||{}},"Manager"),T()))},X=async(t={})=>{let s=t.approval?ge(t.approval,t):await bt(t);re(s)&&T()},ae=t=>(s={})=>{let u=t==="approval_approved"?"approved":t==="approval_denied"?"rejected":t==="approval_expired"?"expired":"failed";ve(s.approvalId||s.id||s.approval?.id,u,s)&&T()},R=ae("approval_approved"),ye=ae("approval_denied"),V=ae("approval_expired"),ee=ae("approval_failed");E?.on?.("ws:open",be),E?.on?.("team_chat_message",Q),E?.on?.("team_chat_stream_event",G),E?.on?.("approval_created",X),E?.on?.("approval_approved",R),E?.on?.("approval_denied",ye),E?.on?.("approval_expired",V),E?.on?.("approval_failed",ee),document.addEventListener("visibilitychange",j),e._pmCleanup=()=>{if(!L){L=!0;try{M?.abort?.()}catch{}E?.off?.("ws:open",be),E?.off?.("team_chat_message",Q),E?.off?.("team_chat_stream_event",G),E?.off?.("approval_created",X),E?.off?.("approval_approved",R),E?.off?.("approval_denied",ye),E?.off?.("approval_expired",V),E?.off?.("approval_failed",ee),document.removeEventListener("visibilitychange",j)}},H();async function U(t){let s=String(t?.text||"").trim(),u=Array.isArray(t?.files)?t.files:[],k=String(t?.source||"").trim(),A=s||(u.length?"Please review the attached file(s).":"");if(!A&&!u.length)return;if(te()){$.push({text:s,files:u,source:k,speak:t?.speak===!0,voice:t?.voice===!0}),J(),y?.update?.();return}let P=A,B=u;if(u.length){let F=await wt(u);P=`${A}${$t(F)}`,B=F.map((Y,D)=>({...u[D]||{},name:Y.name||u[D]?.name||"attachment",kind:Y.isImage?"image":Y.isVideo?"video":u[D]?.kind||"file",workspacePath:Y.workspacePath||u[D]?.workspacePath,path:Y.workspacePath||u[D]?.path,dataUrl:u[D]?.dataUrl,mimeType:u[D]?.mimeType,sizeLabel:u[D]?.sizeLabel}))}let le={role:"user",from:"user",content:A,body:{text:A,attachments:B},attachmentPreviews:B,createdAt:Date.now()};l={role:"manager",from:"manager",fromLabel:"Manager",content:"",_progress:"Manager is thinking...",createdAt:Date.now(),workStartedAt:Date.now(),streaming:!0,processEntries:[]},w.push(le,l),T(),o=!0,y?.update?.(),M=nt(d,{message:P},{onEvent:F=>{Ee(l,F,"Manager"),T()},onError:F=>{F?.name!=="AbortError"&&(l.content=l.content||`Error: ${F?.message||"stream failed"}`,l._progress="",l.streaming=!1,l.workEndedAt=Date.now(),o=!1,M=null,y?.update?.(),T(),Z(F?.message||"Send failed","error"))},onDone:async()=>{l&&(l._progress="",l.streaming=!1,l.workEndedAt=l.workEndedAt||Date.now(),l.workDurationMs=Math.max(0,l.workEndedAt-Number(l.workStartedAt||l.createdAt||l.workEndedAt))),o=!1,M=null,y?.update?.(),await H({forceHistory:!0}),q()}})}y=Qt(e,"pm-team-chat",{placeholder:"Message the team manager...",draftKey:"team:manager",isBusy:te,onAbort:()=>{try{M?.abort?.()}catch{}l&&(l._progress="Stopping...",l.streaming=!1),M=null,o=!1,T()},onSubmit:U}),J()}async function oa(e,{teamId:d,navigate:v}){e.classList.add("pm-agent-chat-page","pm-team-agent-chat-page"),e.dataset.mobileAgentChatRoute="team",document.body.classList.add("pm-mobile-subagent-chat-locked"),document.body.classList.add("pm-mobile-agent-chat-locked"),e.innerHTML=`
    ${Ae({title:"Team Chat",online:!0,leftIcon:"back",hideTitle:!0,hideBrand:!0})}
    <div class="pm-body pm-subagent-chat-body pm-team-chat-page-body" id="pm-team-chat-page-body">
      <div class="pm-card" style="text-align:center;padding:24px;color:var(--pm-muted);">Loading team chat&hellip;</div>
    </div>
  `,Te(e,{onBack:()=>v?.(`#mobile/teams/${encodeURIComponent(d)}`)});let b=e.querySelector("#pm-team-chat-page-body"),g=e.querySelector(".pm-model-badge .pm-model-badge-label"),c=!1;e._pmCleanup=()=>{if(!c){c=!0;try{b?._pmCleanup?.()}catch{}document.body.classList.remove("pm-mobile-agent-chat-locked","pm-mobile-subagent-chat-locked")}};try{let x=await Me(d);if(!x)throw new Error("Team not found");if(c||e.isConnected===!1)return;g&&(g.textContent=`${x.emoji||"\u{1F3E0}"} ${x.name}`),await Gt(b,d,{standalone:!0,team:x})}catch(x){b.innerHTML=`<div class="pm-empty"><div class="pm-empty-icon">${f.users}</div><h2>Couldn\u2019t load team chat</h2><p>${m(x?.message||"Network error")}</p></div>`}}function Yt(e){let d=String(e||"").toLowerCase();return/\.(md|markdown|txt)$/.test(d)?"\u{1F4DD}":/\.(js|ts|tsx|jsx|mjs|cjs)$/.test(d)?"\u{1F4DC}":/\.(json|yaml|yml|toml)$/.test(d)?"\u{1F527}":/\.(png|jpg|jpeg|gif|svg|webp)$/.test(d)?"\u{1F5BC}\uFE0F":/\.(mp4|mov|webm|mkv)$/.test(d)?"\u{1F3AC}":/\.(mp3|wav|ogg|flac)$/.test(d)?"\u{1F3B5}":/\.(html|htm)$/.test(d)?"\u{1F310}":/\.(pdf)$/.test(d)?"\u{1F4C4}":"\u{1F4C3}"}function Zt(e){return!e||e<1024?`${e||0} B`:e<1024*1024?`${(e/1024).toFixed(1)} KB`:`${(e/(1024*1024)).toFixed(2)} MB`}async function Jt(e,d){e.innerHTML='<div class="pm-card" style="text-align:center;padding:24px;color:var(--pm-muted);">Loading workspace\u2026</div>';let v;try{v=await rt(d)}catch(a){e.innerHTML=`<div class="pm-empty"><div class="pm-empty-icon">${f.doc}</div><h2>Couldn\u2019t load workspace</h2><p>${m(a.message||"")}</p></div>`;return}let b=/^(Brain|audit|memory|temp)[\\/]|(^|[\\/])(tool_audit\.log|team-notes\.jsonl|last_run\.json|memory\.json|pending\.json)$/i,g=a=>String(a.relativePath||a.relpath||a.name||a.path||""),c=(v.files||[]).slice().sort((a,y)=>Number(y.modifiedAt||0)-Number(a.modifiedAt||0)),x=c.filter(a=>!b.test(g(a))),w=x.length===0;if(!c.length){e.innerHTML=`<div class="pm-empty"><div class="pm-empty-icon">${f.doc}</div><h2>Workspace is empty</h2><p>Files written by team subagents will appear here.</p></div>`;return}let l=w?c:x;e.innerHTML=`
    <div class="pm-card" style="padding:10px 12px 12px;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
        <strong style="font-size:13px;" id="pm-ws-count"></strong>
        ${c.length>x.length&&x.length?'<button type="button" class="pm-show-more" id="pm-ws-runtime-toggle">Show runtime files</button>':""}
      </div>
      ${v.workspacePath?`<div title="${m(v.workspacePath)}" style="font-size:11px;color:var(--pm-muted);font-family:ui-monospace,monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;direction:rtl;text-align:left;margin-bottom:8px;">${m(v.workspacePath)}</div>`:""}
      <div id="pm-ws-list" style="display:flex;flex-direction:column;gap:6px;"></div>
      <div id="pm-ws-preview" style="margin-top:12px;display:none;"></div>
    </div>
  `;let M=e.querySelector("#pm-ws-list"),i=e.querySelector("#pm-ws-preview"),n=e.querySelector("#pm-ws-count"),o=e.querySelector("#pm-ws-runtime-toggle"),L=()=>{l=w?c:x,n&&(n.textContent=w||!x.length?`${c.length} file${c.length===1?"":"s"}`:`${x.length} project file${x.length===1?"":"s"}`),o&&(o.textContent=w?"Hide runtime files":`Show runtime files (${c.length-x.length})`),M.innerHTML=l.map(a=>{let y=g(a),h=a.size||0,_=a.modifiedAt||a.updatedAt;return`
      <button type="button" data-rel="${m(y)}" style="display:flex;align-items:center;gap:10px;width:100%;text-align:left;background:var(--pm-bg-soft);border:1px solid var(--pm-border);border-radius:12px;padding:10px 12px;cursor:pointer;font-family:inherit;">
        <span style="font-size:18px;">${Yt(y)}</span>
        <span style="flex:1;min-width:0;overflow:hidden;">
          <span style="display:block;font-weight:700;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${m(y)}</span>
          <span style="display:block;font-size:11px;color:var(--pm-muted);">${Zt(h)}${_?" \xB7 "+ue(typeof _=="number"?_:new Date(_).getTime()):""}</span>
        </span>
        <span style="color:var(--pm-muted);">${f.chev}</span>
      </button>
    `}).join(""),$()};o?.addEventListener("click",()=>{w=!w,L()});function $(){M.querySelectorAll("[data-rel]").forEach(a=>{a.addEventListener("click",async()=>{let y=a.getAttribute("data-rel");i.style.display="block",i.innerHTML=`<div class="pm-card-body" style="padding:14px;color:var(--pm-muted);">Loading ${m(y)}\u2026</div>`;try{let h=await ot(d,y),_=h?.content||h?.body||"";i.innerHTML=`
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
            <strong style="flex:1;font-size:13px;">${m(y)}</strong>
            <button class="pm-btn ghost" id="pm-ws-close" style="padding:4px 10px;font-size:12px;">\u2715 Close</button>
          </div>
          <pre style="background:var(--pm-bg-soft);border:1px solid var(--pm-border);border-radius:10px;padding:12px;font-size:12px;line-height:1.5;font-family:ui-monospace,monospace;white-space:pre-wrap;word-break:break-word;max-height:60vh;overflow:auto;margin:0;">${m(String(_).slice(0,5e4))}${String(_).length>5e4?`

\u2026(truncated)`:""}</pre>
        `,i.querySelector("#pm-ws-close").addEventListener("click",()=>{i.style.display="none",i.innerHTML=""}),i.scrollIntoView({behavior:"smooth",block:"nearest"})}catch(h){i.innerHTML=`<div class="pm-card-body" style="color:var(--pm-red);">${m(h.message||"Failed to load file")}</div>`}})})}L()}async function Xt(e,d,v){e.innerHTML='<div class="pm-card" style="text-align:center;padding:24px;color:var(--pm-muted);">Loading memory\u2026</div>';let b=null;try{b=await Re(d)}catch{}if(b){let n=a=>String(a||"").replace(/\[DURABLE_TURN_COMMENTARY\][\s\S]*$/,"").replace(/\*\*/g,"").trim(),o=(Array.isArray(b.artifacts)?b.artifacts:[]).slice().reverse().slice(0,12),L=(Array.isArray(b.blockers)?b.blockers:[]).slice().reverse().slice(0,8),$=(Array.isArray(b.recentEvents)?b.recentEvents:[]).filter(a=>a&&a.category!=="tool"&&n(a.content)).slice().reverse().slice(0,15);if(o.length||L.length||$.length){let a=(h,_)=>_?`<div style="font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;color:var(--pm-muted);margin:14px 4px 6px;">${h}</div>${_}`:"",y=h=>h?ue(typeof h=="number"?h:new Date(h).getTime()):"";e.innerHTML=`
        ${a(`Blockers (${L.length})`,L.map(h=>`
          <article class="pm-card" style="padding:10px 12px;border-color:var(--pm-red);">
            <div class="pm-card-body">${m(n(h.content||h.reason||h.title||"Blocker"))}</div>
            <div style="font-size:11px;color:var(--pm-muted);margin-top:4px;">${m(h.agentName||h.agentId||"")} ${y(h.createdAt||h.timestamp)}</div>
          </article>`).join(""))}
        ${a(`Artifacts (${o.length})`,o.map(h=>`
          <article class="pm-card" style="padding:10px 12px;">
            <div style="display:flex;gap:8px;align-items:center;">
              <strong style="flex:1;font-size:13px;line-height:1.3;">${m(h.name||h.title||"Artifact")}</strong>
              <span style="font-size:11px;color:var(--pm-muted);white-space:nowrap;">${y(h.createdAt||h.timestamp)}</span>
            </div>
            ${h.description?`<div class="pm-card-body" style="font-size:13px;margin-top:4px;">${m(String(h.description).slice(0,220))}</div>`:""}
            ${h.path?`<div title="${m(h.path)}" style="font-size:11px;color:var(--pm-muted);font-family:ui-monospace,monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;direction:rtl;text-align:left;margin-top:4px;">${m(h.path)}</div>`:""}
          </article>`).join(""))}
        ${a("Recent activity",$.map(h=>`
          <article class="pm-card" style="padding:10px 12px;">
            <div style="display:flex;gap:8px;align-items:center;margin-bottom:4px;">
              <strong style="flex:1;font-size:13px;">${m(h.actorName||h.actorType||"Team")}</strong>
              <span style="font-size:11px;color:var(--pm-muted);white-space:nowrap;">${y(h.timestamp)}</span>
            </div>
            <div class="pm-card-body" style="font-size:13px;display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden;">${m(n(h.content).slice(0,400))}</div>
          </article>`).join(""))}
      `;return}}let g;try{g=await st()}catch(n){e.innerHTML=`<div class="pm-empty"><div class="pm-empty-icon">${f.brain}</div><h2>Couldn\u2019t load memory</h2><p>${m(n.message||"")}</p></div>`;return}let c=Array.isArray(g?.nodes)?g.nodes.slice():[],x=String(d).toLowerCase(),w=String(v?.name||"").toLowerCase(),l=n=>{let o=String(n.sourcePath||"").toLowerCase(),L=String(n.projectId||"").toLowerCase();return L&&L.includes(x)||o&&(o.includes(x)||w&&o.includes(w))},M=c.filter(l),i=(M.length?M:c).sort((n,o)=>String(o.timestamp||"").localeCompare(String(n.timestamp||""))).slice(0,30);if(!i.length){e.innerHTML=`<div class="pm-empty"><div class="pm-empty-icon">${f.brain}</div><h2>No memory yet</h2><p>As the team works, reflections and memory entries land here.</p></div>`;return}e.innerHTML=`
    <div style="display:flex;align-items:center;gap:8px;padding:6px 4px 10px;color:var(--pm-muted);font-size:12px;">
      <span class="pm-pill ${M.length?"orange":"gray"}">${M.length?"team-scoped":"global feed"}</span>
      <span>${i.length} of ${c.length} entries</span>
    </div>
    ${i.map(n=>`
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
  `}export{na as a,ra as b,Ft as c,Ot as d,Wt as e,Kt as f,Qt as g,oa as h};
