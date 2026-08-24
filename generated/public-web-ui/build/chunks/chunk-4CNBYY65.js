import{E as We,F as Qe,G as Ue,H as Oe,I as ie,L as Ge,c as Ce,f as He,g as Re,h as ne,i as De,j as Pe,l as ee,m as je,n as ze,o as Be,p as de,q as Fe,r as Ie,s as Ne,x as Ve,z as j}from"./chunk-QBFLUKCT.js";import{b as Z}from"./chunk-J5HXEABW.js";import{a as I}from"./chunk-35CAQ6TV.js";import{F as g,G as u,M as Ee,N as ce}from"./chunk-B4S6FUCZ.js";import{e as X}from"./chunk-2L2KLWMY.js";import{$ as Me,Ia as qe,N as oe,O as he,P as le,Q as be,R as ye,S as we,T as $e,U as xe,V as Se,W as Ae,X as re,Z as ke,_ as Le,aa as Te,ba as _e,c as ge,s as fe}from"./chunk-YPZ3VTX5.js";import{a as T}from"./chunk-GBLBNUG2.js";function Je(e){let i=e.house==="blue"?"#4a82d1":"#a4682b";return`
    <button class="pm-team-tile ${e.featured?"featured":""}" data-team="${e.id}">
      ${e.featured?'<span class="pm-star">\u2605</span>':""}
      <span class="pm-house" style="color:${i}">\u{1F3E0}</span>
      <span class="pm-team-name">${u(e.name)}</span>
      <span class="pm-team-agents">${g.users} ${e.agents} agents</span>
    </button>
  `}function Ke(){return`<div class="pm-team-grid">${'<div class="pm-team-tile" style="opacity:.55"><span class="pm-house" style="opacity:.4">\u{1F3E0}</span><span class="pm-team-name" style="background:rgba(0,0,0,.06);color:transparent;border-radius:6px;height:16px;width:80%;">loading</span></div>'.repeat(4)}</div>`}async function vt(e,{navigate:i}){let f=`
    <span class="pm-count-pill" id="pm-teams-count">\u2026</span>
    <span class="pm-spacer"></span>
    <button class="pm-icon-btn" id="pm-teams-refresh" aria-label="Refresh" style="background:var(--pm-surface);border:1px solid var(--pm-border);">${g.refresh}</button>
  `,h=Ee({title:"Teams",online:!1,extras:f});e.innerHTML=`
    ${h}
    <div class="pm-body" id="pm-teams-body">${Ke()}</div>
  `,ce(e,{});let b=e.querySelector("#pm-teams-body"),n=e.querySelector("#pm-teams-count"),a=e.querySelector("#pm-teams-refresh");async function v({force:y=!1}={}){let d=[];try{d=await he({force:y})}catch(S){b.innerHTML=`<div class="pm-empty"><div class="pm-empty-icon">${g.users}</div><h2>Couldn\u2019t load teams</h2><p>${u(S.message||"Network error")}</p></div>`,n.textContent="0 teams";return}if(n.textContent=`${d.length} team${d.length===1?"":"s"}`,!d.length){b.innerHTML=`<div class="pm-empty"><div class="pm-empty-icon">${g.users}</div><h2>No teams yet</h2><p>Create your first team from the desktop app.</p></div>`;return}let w=d.find(S=>S.featured)||d[0],r=null;try{r=await le(w.id)}catch{}let $=r?`
      <div class="pm-team-preview">
        <div class="pm-team-preview-head">
          <span class="pm-mini-house">${u(r.emoji||"\u{1F3E0}")}</span>
          <h3>${u(r.name)}</h3>
          <button class="pm-pill-btn" data-go="${u(r.id)}">View Team ${g.chev}</button>
        </div>
        <div style="font-size:13px;color:var(--pm-muted);font-weight:700;margin-top:4px;">Team members</div>
        <div class="pm-chip-row">
          ${r.members.map(S=>`<span class="pm-member-chip"><span class="pm-avatar" style="background:${S.color}">${S.avatar}</span>${u(S.name)}</span>`).join("")}
        </div>
        <div class="pm-divider"></div>
        <div class="pm-row"><span>\u{1F5C2}\uFE0F Workspace</span><span style="color:var(--pm-muted)">${u(r.workspace)} ${g.chev}</span></div>
        <div class="pm-divider"></div>
        <div class="pm-row" style="flex-direction:column;align-items:stretch;gap:4px;">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <strong>Progress</strong>
            <span style="color:var(--pm-muted)">Recent runs <b style="color:var(--pm-text)">${r.runsDone} / ${r.runsTotal} runs</b></span>
          </div>
          <div class="pm-progress"><span style="width:${r.runsTotal?Math.round(r.runsDone/r.runsTotal*100):0}%"></span></div>
        </div>
      </div>
    `:"";b.innerHTML=`
      <div class="pm-team-grid">${d.map(Je).join("")}</div>
      ${$}
    `,b.querySelectorAll("[data-team]").forEach(S=>{S.addEventListener("click",()=>i(`#mobile/teams/${S.getAttribute("data-team")}`))}),b.querySelectorAll("[data-go]").forEach(S=>{S.addEventListener("click",()=>i(`#mobile/teams/${S.getAttribute("data-go")}`))})}a.addEventListener("click",()=>{oe(),b.innerHTML=Ke(),v({force:!0})});let o=ge("teams_raw",216e5);await v(),Array.isArray(o)&&v({force:!0}).catch(()=>{})}function Xe(){return`
    <div class="pm-detail-head"><span class="pm-house-icon">\u{1F3E0}</span><h1 style="background:rgba(0,0,0,.06);color:transparent;border-radius:8px;height:24px;flex:1;">loading</h1></div>
    <div class="pm-detail-sub">\u2026</div>
    <div class="pm-action-row">
      <button class="pm-action-btn primary">${g.play} Start Run</button>
      <button class="pm-action-btn">${g.pause} Pause</button>
      <button class="pm-action-btn">${g.brain} Review</button>
      <button class="pm-action-btn danger">${g.trash} Delete</button>
    </div>
    <div class="pm-card" style="opacity:.5"><div class="pm-card-head">${g.target} Purpose</div><div class="pm-card-body">Loading team\u2026</div></div>
  `}async function gt(e,{teamId:i,navigate:f,initialTab:h=""}){e.innerHTML=`
    <header class="pm-header">
      <button class="pm-icon-btn" data-action="back" aria-label="Back">${g.back}</button>
            <button class="pm-icon-btn" data-action="settings" aria-label="Settings">${g.gear}</button>
    </header>
    <div class="pm-body" id="pm-detail-body">${Xe()}</div>
  `,ce(e,{onBack:()=>f("#mobile/teams")});let b=e.querySelector("#pm-detail-body"),n=null;try{n=await le(i)}catch(p){b.innerHTML=`<div class="pm-empty"><div class="pm-empty-icon">${g.users}</div><h2>Couldn\u2019t load team</h2><p>${u(p.message||"Network error")}</p></div>`;return}if(!n){b.innerHTML=`<div class="pm-empty"><div class="pm-empty-icon">${g.users}</div><h2>Team not found</h2><p>This team isn\u2019t available right now.</p></div>`;return}let a=["Context","Subagents","Workspace","Memory","Runs","Team Chat"];b.innerHTML=`
    <div class="pm-detail-head">
      <span class="pm-house-icon" style="color:#d8473a">${u(n.emoji||"\u{1F39F}\uFE0F")}</span>
      <h1>${u(n.name)}</h1>
      <button class="pm-icon-btn pm-overflow" aria-label="More">${g.dots}</button>
    </div>
    <div class="pm-detail-sub">${n.subagents} subagents \xB7 ${n.totalRuns} total runs</div>

    <div class="pm-action-row">
      <button class="pm-action-btn primary" data-act="start">${g.play} Start Run</button>
      <button class="pm-action-btn"          data-act="pause">${n.paused?g.play+" Resume":g.pause+" Pause"}</button>
      <button class="pm-action-btn"          data-act="review">${g.brain} Review</button>
      <button class="pm-action-btn danger"   data-act="delete">${g.trash} Delete</button>
    </div>

    <div class="pm-tabs" role="tablist">
      ${a.map((p,A)=>`<button class="${A===0?"active":""}" data-tab="${p}">${u(p)}</button>`).join("")}
    </div>

    <div id="pm-tab-slot"></div>

    <div id="pm-context-slot">
    <div class="pm-team-preview">
      <div class="pm-team-preview-head">
        <span class="pm-mini-house">${u(n.emoji||"\u{1F3E0}")}</span>
        <h3>${u(n.name)}</h3>
      </div>
      <div style="font-size:13px;color:var(--pm-muted);">${n.subagents} subagents \xB7 ${n.totalRuns} total runs</div>
      <div class="pm-chip-row">
        ${n.members.map(p=>`<span class="pm-member-chip"><span class="pm-avatar" style="background:${p.color}">${p.avatar}</span>${u(p.name)}</span>`).join("")}
      </div>
    </div>

    <div class="pm-card">
      <div class="pm-card-head" style="display:flex;justify-content:space-between;align-items:center;">
        <span>${g.target} Purpose</span>
        <button class="pm-show-more" data-toggle-purpose>Show more \u25BE</button>
      </div>
      <div class="pm-card-body" data-purpose data-collapsed="1" style="display:-webkit-box;-webkit-line-clamp:6;-webkit-box-orient:vertical;overflow:hidden;">${u(n.purpose)}</div>
    </div>

    <div class="pm-card-grid">
      <div class="pm-card">
        <div class="pm-card-head">${g.check} Current Task / Goal</div>
        <div class="pm-card-body">${u(n.currentTask)}</div>
      </div>
      <div class="pm-card">
        <div class="pm-card-head">${g.clock} Last Run</div>
        <div class="pm-card-body strong">${u(n.lastRun)}</div>
      </div>
      <div class="pm-card">
        <div class="pm-card-head">${g.users} Member States</div>
        <div class="pm-card-body">${u(n.memberStates)}</div>
      </div>
      <div class="pm-card">
        <div class="pm-card-head">${g.send} Active Dispatches</div>
        <div class="pm-card-body">${u(n.dispatches)}</div>
      </div>
    </div>

    <div class="pm-card">
      <div class="pm-card-head">${g.doc} Context &amp; Reference</div>
      <div class="pm-card-body" style="margin-bottom:10px;">Each save adds a new card. Cards are injected into manager + subagent runtime context.</div>
      <input class="pm-input" id="pm-ref-title" placeholder="Reference title (e.g. Brand Voice, API URL, Posting Rules)" />
      <textarea class="pm-textarea" id="pm-ref-body" placeholder="Reference content\u2026"></textarea>
      <div class="pm-row-buttons">
        <button class="pm-btn ghost" disabled title="Upload coming soon">${g.upload} Upload File</button>
        <button class="pm-btn primary" data-save-ref>${g.check} Save</button>
      </div>
    </div>

    <div class="pm-card">
      <div class="pm-card-head" style="display:flex;justify-content:space-between;align-items:center;">
        <span>\u{1F4C1} Workspace Preview</span>
        <a href="#mobile/teams/${u(i)}/workspace" style="color:var(--pm-orange);font-weight:700;text-decoration:none;font-size:13px;">Open Workspace \u203A</a>
      </div>
      <div class="pm-card-body">${u(n.workspace)}</div>
    </div>
    </div><!-- /pm-context-slot -->
  `;let v=b.querySelector("#pm-context-slot"),o=b.querySelector("#pm-tab-slot");async function y(p){try{o?._pmCleanup?.()}catch{}if(o&&(o._pmCleanup=null),b.querySelectorAll(".pm-tabs button").forEach(A=>A.classList.toggle("active",A.getAttribute("data-tab")===p)),p==="Context"){v.style.display="",o.innerHTML="";return}v.style.display="none",o.innerHTML=`<div class="pm-card" style="text-align:center;padding:24px;color:var(--pm-muted);">Loading ${u(p)}\u2026</div>`;try{p==="Subagents"?await et(o,n):p==="Runs"?await at(o,i):p==="Team Chat"?await ot(o,i):p==="Workspace"?await dt(o,i):p==="Memory"&&await pt(o,i,n)}catch(A){o.innerHTML=`<div class="pm-card"><div class="pm-card-head">${g.users} Error</div><div class="pm-card-body">${u(A.message||"Failed to load")}</div></div>`}}b.querySelectorAll(".pm-tabs button").forEach(p=>{p.addEventListener("click",()=>y(p.getAttribute("data-tab")))});let d=a.find(p=>p.toLowerCase().replace(/\s+/g,"-")===String(h||"").toLowerCase());d&&d!=="Context"&&y(d);let w=b.querySelector("[data-toggle-purpose]"),r=b.querySelector("[data-purpose]");w&&r&&w.addEventListener("click",()=>{r.getAttribute("data-collapsed")==="1"?(r.style.webkitLineClamp="unset",r.style.display="block",r.setAttribute("data-collapsed","0"),w.textContent="Show less \u25B4"):(r.style.display="-webkit-box",r.style.webkitLineClamp="6",r.setAttribute("data-collapsed","1"),w.textContent="Show more \u25BE")});async function $(p,A,D){let W=p.innerHTML;p.disabled=!0,p.style.opacity="0.6";try{let L=await A();if(!L||L.success===!1)throw new Error(L?.error||"Failed");return I(D,"success"),L}catch(L){throw I(L.message||"Action failed","error"),L}finally{p.disabled=!1,p.style.opacity="",p.innerHTML=W}}b.querySelectorAll("[data-act]").forEach(p=>{let A=p.getAttribute("data-act");p.addEventListener("click",async()=>{if(A==="start")await $(p,()=>be(i),"Run started").catch(()=>{});else if(A==="pause"){let D=n.paused;try{await $(p,()=>D?we(i):ye(i),D?"Team resumed":"Team paused"),n.paused=!D,p.innerHTML=n.paused?`${g.play} Resume`:`${g.pause} Pause`}catch{}}else if(A==="review")await $(p,()=>$e(i),"Manager review triggered").catch(()=>{});else if(A==="delete"){if(!window.confirm(`Delete team "${n.name}"? This cannot be undone.`))return;try{await $(p,()=>xe(i),"Team deleted"),oe(),f("#mobile/teams")}catch{}}})});let S=b.querySelector("[data-save-ref]");S&&S.addEventListener("click",async()=>{let p=b.querySelector("#pm-ref-title"),A=b.querySelector("#pm-ref-body"),D=(p.value||"").trim(),W=(A.value||"").trim();if(!D||!W){I("Title and content required","error");return}try{await $(S,()=>qe(i,D,W),"Reference saved"),p.value="",A.value=""}catch{}}),e._pmCleanup=()=>{try{o?._pmCleanup?.()}catch{}}}var Ye={working:{label:"working",cls:"running"},active:{label:"active",cls:"active"},ready:{label:"ready",cls:"active"},idle:{label:"idle",cls:"gray"},blocked:{label:"blocked",cls:"orange"},paused:{label:"paused",cls:"gray"},awaiting:{label:"awaiting",cls:"orange"},offline:{label:"offline",cls:"gray"}};function Ze(e){if(!e||e<0)return"\u2014";let i=Math.floor(e/1e3);return i<60?`${i}s`:`${Math.floor(i/60)}m ${i%60}s`}async function et(e,i){let f=null;try{f=await Se(i.id)}catch{}let h=f?.memberStates||{},b=Array.isArray(f?.activeDispatches)?f.activeDispatches:[],n=new Map;for(let v of b){let o=String(v.agentId||v.subagentId||"").trim();o&&n.set(o,v)}let a=i.members.filter(v=>v.id!=="manager").map(v=>{let o=h[v.id]||{},y=Ye[String(o.status||"idle").toLowerCase()]||Ye.idle,d=n.get(v.id);return`
      <article class="pm-card">
        <div class="pm-schedule-head" style="margin-bottom:8px;">
          <span class="pm-emoji" style="font-size:22px;">${v.avatar}</span>
          <h3 style="margin:0;">${u(v.name)}</h3>
          <span class="pm-pill ${y.cls}">${y.label}</span>
        </div>
        ${o.currentTask?`<div class="pm-card-body" style="margin-bottom:6px;"><strong>Current:</strong> ${u(o.currentTask)}</div>`:""}
        ${o.blockedReason?`<div class="pm-card-body" style="color:var(--pm-red);margin-bottom:6px;"><strong>Blocked:</strong> ${u(o.blockedReason)}</div>`:""}
        ${o.lastResult?`<div class="pm-card-body" style="font-size:13px;color:var(--pm-muted);margin-bottom:6px;">Last: ${u(String(o.lastResult).slice(0,140))}${String(o.lastResult).length>140?"\u2026":""}</div>`:""}
        <div style="display:flex;justify-content:space-between;align-items:center;font-size:12px;color:var(--pm-muted);">
          <span>${d?"\u{1F4E1} dispatched":"Last update"}</span>
          <span>${Z(o.lastUpdateAt||d?.startedAt)}</span>
        </div>
      </article>
    `}).join("");e.innerHTML=a||`<div class="pm-empty"><div class="pm-empty-icon">${g.robot}</div><h2>No subagents yet</h2><p>Add members from the desktop team editor.</p></div>`}function tt(e){return e.inProgress?'<span class="pm-pill running">running</span>':e.success===!0?'<span class="pm-pill active">success</span>':e.success===!1&&e.taskStatus?`<span class="pm-pill orange">${u(String(e.taskStatus))}</span>`:'<span class="pm-pill gray">complete</span>'}async function at(e,i){let{runs:f}=await Ae(i,30);if(!f.length){e.innerHTML=`<div class="pm-empty"><div class="pm-empty-icon">${g.clock}</div><h2>No runs yet</h2><p>Start a run from the top of this page.</p></div>`;return}e.innerHTML=f.map(h=>`
    <article class="pm-card" style="padding:14px 16px;">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
        <strong style="flex:1;font-size:14px;">${u(h.agentName||h.agentId||"Agent")}</strong>
        ${tt(h)}
      </div>
      ${h.taskSummary?`<div class="pm-card-body" style="margin-bottom:6px;">${u(String(h.taskSummary).slice(0,200))}${String(h.taskSummary).length>200?"\u2026":""}</div>`:""}
      <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--pm-muted);">
        <span>${u(h.trigger||"manual")} \xB7 ${h.stepCount||0} steps</span>
        <span>${Z(h.startedAt)} \xB7 ${Ze(h.durationMs)}</span>
      </div>
    </article>
  `).join("")}function st(e){return e?{type:String(e.type||e.event||""),...e.data||{}}:null}function rt(e,i,f){if(!e)return;let h=new Set,b=new Set;e.querySelectorAll(".pm-agent-chat-msg").forEach((n,a)=>{n.querySelector(".pm-trace-drawer.open")&&h.add(a),n.querySelectorAll("details.pm-trace-tool-group[open]").forEach((o,y)=>{b.add(`${a}:${o.getAttribute("data-pm-trace-group")||y}`)})}),e.innerHTML=i.map(f).join(""),e.querySelectorAll(".pm-agent-chat-msg").forEach((n,a)=>{let v=n.querySelector(".pm-trace-drawer"),o=n.querySelector('[data-expandable="trace"]');v&&h.has(a)&&(v.classList.add("open"),o?.classList.add("expanded")),n.querySelectorAll("details.pm-trace-tool-group").forEach((y,d)=>{let w=`${a}:${y.getAttribute("data-pm-trace-group")||d}`;b.has(w)&&!y.closest('.pm-trace-drawer[data-trace-completed="1"]')&&y.setAttribute("open","")})}),Ve(e)}var pe={};function nt(e,i){let f=String(e||"pm-agent-chat");return`
    <form class="pm-composer pm-agent-chat-composer" id="${f}-form" style="position:relative;left:auto;right:auto;bottom:auto;margin:0;border-radius:0;border-left:0;border-right:0;border-bottom:0;box-shadow:none;">
      <span class="pm-glass-lens" aria-hidden="true"></span>
      <span class="pm-glass-border" aria-hidden="true"></span>
      <input id="${f}-file-input" type="file" multiple accept="image/*,video/*,.mp4,.mov,.m4v,.webm,.avi,.mkv,.txt,.md,.json,.csv,.tsv,.log,.xml,.html,.css,.js,.ts,.tsx,.jsx,.py,.yaml,.yml,application/pdf" hidden />
      <div class="pm-attach-tray" id="${f}-attach-tray" hidden></div>
      <div class="pm-composer-row">
        <button type="button" class="pm-icon-btn" id="${f}-attach-btn" aria-label="Attach files">${g.paperclip}</button>
        <div class="pm-composer-input-wrap" id="${f}-input-wrap">
          <textarea class="pm-composer-input" id="${f}-input" rows="1" placeholder="${u(i)}" aria-label="Message" autocomplete="off" autocapitalize="sentences" enterkeyhint="send"></textarea>
        </div>
        <button type="button" class="pm-icon-btn" id="${f}-mic-btn" aria-label="Voice input">${g.micSmall}</button>
        <button type="submit" class="pm-send" id="${f}-send-btn" aria-label="Send">${g.send}</button>
      </div>
      <div class="pm-chat-voice-shell" id="${f}-voice-shell" hidden>
        <button type="button" class="pm-chat-voice-camera" id="${f}-voice-camera" aria-label="Attach camera image">${g.image}</button>
        <button type="button" class="pm-chat-voice-close" id="${f}-voice-close" aria-label="Close voice mode">&times;</button>
        <div class="pm-chat-voice-inline" id="${f}-voice-inline"></div>
      </div>
    </form>`}function it(e,i,{placeholder:f,isBusy:h,onSubmit:b,onAbort:n,draftKey:a="",voiceTarget:v=null,onVoiceSubmit:o=null,openCameraCapture:y=null}){let d=String(i||"pm-agent-chat"),w=e.querySelector(`#${d}-form`),r=e.querySelector(`#${d}-input`),$=e.querySelector(`#${d}-send-btn`),S=e.querySelector(`#${d}-attach-btn`),p=e.querySelector(`#${d}-mic-btn`),A=e.querySelector(`#${d}-voice-shell`),D=e.querySelector(`#${d}-voice-close`),W=e.querySelector(`#${d}-voice-camera`),L=e.querySelector(`#${d}-voice-inline`),G=e.querySelector(`#${d}-file-input`),K=e.querySelector(`#${d}-attach-tray`),N=String(a||"").trim(),_=null;N&&(pe[N]||(pe[N]={text:"",pending:[]}),_=pe[N],Array.isArray(_.pending)||(_.pending=[]));let P=_?_.pending:[],k=!1,q=null,te=null,H=null,z=0;r&&_?.text&&(r.value=_.text);let Q=()=>{if(!r)return;let c=Math.max(320,Math.round(window.visualViewport?.height||window.innerHeight||640)),m=Math.max(96,Math.min(280,Math.floor(c*.5)-86)),E=Number(r.dataset.maxHeight||m);r.style.height="auto",r.style.height=`${Math.min(E,Math.max(30,r.scrollHeight||30))}px`,r.style.overflowY=r.scrollHeight>E?"auto":"hidden"},U=()=>!!(String(r?.value||"").trim()||P.length),V=()=>v&&typeof o=="function"&&A&&L,Y=()=>{w&&(w.classList.toggle("is-focused",document.activeElement===r),w.classList.toggle("has-text",!!String(r?.value||"").trim()),w.classList.toggle("has-attachments",P.length>0))},J=()=>{if(!(!A||!L)){A.hidden=!0;try{L._pmCleanup?.()}catch{}L.innerHTML="",Ue(),j?.target?.kind==="subagent"&&j.target.agentId===v?.agentId&&(j.target=null,j.subagentSubmit=null)}},ae=async({autoStart:c=!0}={})=>{if(!V()){I("Voice mode is not available for this composer.","error");return}let m={kind:"subagent",agentId:String(v.agentId||"").trim(),label:String(v.label||v.name||"Subagent").trim(),voice:v.voice&&typeof v.voice=="object"?v.voice:null};j.target=m,j.targetSessionId=`subagent_chat_${m.agentId}`,j.targetSessionLabel=m.label,j.targetSessionChannel="subagent",j.targetSessionForced=!0,j.subagentSubmit=async E=>o({text:String(E||"").trim(),files:[]}),Oe(m.voice),A.hidden=!1,L.innerHTML="",await We(L,{inline:!0,inlineChatSessionId:j.targetSessionId,inlineChatSessionLabel:m.label,autoStart:c,openCameraCapture:y,cameraButton:W})},O=()=>{K&&(K.hidden=P.length===0,K.innerHTML=Be(P,!0),K.querySelectorAll("[data-remove-attachment]").forEach(c=>{c.addEventListener("click",()=>{let m=Number(c.getAttribute("data-remove-attachment"));Number.isFinite(m)&&P.splice(m,1),O(),R()})}),Y())},R=()=>{let c=!!h?.(),m=c&&!U();w&&(w.classList.toggle("is-busy",c),w.setAttribute("aria-busy",c?"true":"false"),w.dataset.composerState=c?m?"stopping":"busy":"idle"),r&&(r.placeholder=c?"Queue a message...":f),$&&($.disabled=!1,$.classList.toggle("is-abort",m),$.classList.toggle("is-voice",!c&&!U()&&V()),$.title=m?"Stop":!c&&!U()&&V()?"Start voice mode":c?"Queue message":"Send",$.setAttribute("aria-label",m?"Stop":!c&&!U()&&V()?"Start voice mode":c?"Queue message":"Send"),$.setAttribute("aria-busy",c?"true":"false"),$.innerHTML=m?'<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><rect x="7" y="7" width="10" height="10" rx="2"/></svg>':!c&&!U()&&V()?`<img class="pm-send-voice-icon" src="${Ce}" alt="" aria-hidden="true" />`:g.send),Y()},t=()=>{let c=String(r?.value||"").trim(),m=P.splice(0,P.length);if(r&&(r.value="",_&&(_.text=""),Q()),k||q||H){k=!1,z+=1,H&&clearTimeout(H),H=null;let E=q;q=null;try{E?.abort?.()}catch{try{E?.stop?.()}catch{}}p?.classList.remove("listening")}return O(),R(),{text:c,files:m}},s=({refocus:c=!0}={})=>{k=!1,z+=1,H&&clearTimeout(H),H=null;let m=q;q=null;try{m?.stop?.()}catch{try{m?.abort?.()}catch{}}p?.classList.remove("listening"),c&&r?.focus(),Q(),R()},l=(c,m=140)=>{H&&clearTimeout(H),H=null,!(!k||q)&&(H=setTimeout(()=>{H=null,x(c)},m))},x=c=>{if(!(!k||q||!r))try{let m=new c,E=z,B=String(r.value||"").trimEnd();q=m,m.lang=navigator.language||"en-US",m.interimResults=!0,m.continuous=!0,m.onstart=()=>{E===z&&p?.classList.add("listening")},m.onresult=F=>{if(E!==z)return;let C="",me="";for(let se=0;se<F.results.length;se+=1){let ve=String(F.results[se]?.[0]?.transcript||"");F.results[se].isFinal?C+=ve:me+=ve}let ue=`${C}${me}`.trim();r.value=`${B}${B&&ue?" ":""}${ue}`,_&&(_.text=r.value||""),Q(),R()},m.onerror=F=>{if(E!==z)return;let C=String(F?.error||"unknown");["not-allowed","service-not-allowed","audio-capture"].includes(C)?(k=!1,I(C==="audio-capture"?"The microphone is not available.":"Microphone permission was denied.","error")):["no-speech","aborted"].includes(C)||console.warn("[mobile agent chat] dictation cycle error:",C)},m.onend=()=>{if(E===z){if(q===m&&(q=null),Q(),R(),!k){p?.classList.remove("listening");return}l(c)}},m.start()}catch(m){q=null,k=!1,p?.classList.remove("listening"),I(m?.message||"Could not start dictation.","error")}};r?.addEventListener("input",()=>{_&&(_.text=r.value||""),Q(),R()}),r?.addEventListener("focus",Y),r?.addEventListener("blur",()=>setTimeout(Y,0)),r?.addEventListener("keydown",c=>{c.key==="Enter"&&!c.shiftKey&&(c.preventDefault(),w?.requestSubmit?.())}),r?.addEventListener("paste",async c=>{let m=Array.from(c.clipboardData?.files||[]);if(!m.length)return;String(c.clipboardData?.getData?.("text/plain")||"").trim()||c.preventDefault();let E=await Promise.all(m.slice(0,8).map(de));P.push(...E.filter(Boolean)),O(),R()}),S?.addEventListener("click",()=>G?.click()),p?.addEventListener("click",()=>{let c=window.SpeechRecognition||window.webkitSpeechRecognition;if(!c){I("Speech dictation is not available in this browser.","error");return}if(k){s();return}te=c,k=!0,z+=1,p.classList.add("listening"),I("Listening until you tap the mic again.","info"),x(c)}),D?.addEventListener("click",J),W?.addEventListener("click",()=>{typeof y=="function"?y():G?.click()}),G?.addEventListener("change",async()=>{let c=Array.from(G.files||[]).slice(0,8);if(G.value="",!c.length)return;let m=await Promise.all(c.map(de));P.push(...m.filter(Boolean)),O(),R()}),w?.addEventListener("submit",async c=>{if(c.preventDefault(),h?.()&&!U()){n?.(),R();return}let m=t();if(!m.text&&!m.files.length){await ae({autoStart:!0});return}await b?.(m),R()});let M=e._pmCleanup;return e._pmCleanup=()=>{s({refocus:!1}),J(),M?.()},requestAnimationFrame(()=>{O(),Q(),R()}),{input:r,update:R,consume:t,pending:P}}async function ot(e,i){e.innerHTML=`
    <div class="pm-card pm-team-chat-card" id="pm-team-chat-card">
      <div id="pm-team-chat-list" class="pm-team-chat-list" aria-live="polite">
        <div class="pm-team-chat-status">Loading team chat&hellip;</div>
      </div>
      <div id="pm-team-chat-queue" class="pm-mobile-queued-prompts" hidden></div>
      <div id="pm-team-chat-goal" class="pm-mobile-goal-strip pm-mobile-goal-strip-inline" hidden></div>
      ${nt("pm-team-chat","Message the team manager...")}
    </div>
  `;let f=e.querySelector("#pm-team-chat-list"),h=e.querySelector("#pm-team-chat-queue"),b=e.querySelector("#pm-team-chat-goal");Ne(f,()=>{}),Re(b,He.activeSessionId,{fallbackToLast:!0});let n=[],a=null,v=null,o=0,y="",d=!1,w=!1,r=[],$=[],S=null;function p(t={}){let s=t?.body&&typeof t.body=="object"?t.body:{},l=t?.metadata&&typeof t.metadata=="object"?t.metadata:{},x=String(t?.from||t?.role||"").toLowerCase(),M=x==="user"||x==="you"||x==="human",c=String(t?.content||t?.message||t?.text||s.text||"");return{...t,role:M?"user":"agent",from:M?"user":x||"manager",fromLabel:t?.fromLabel||t?.fromName||s.sender||(M?"You":"Manager"),content:c,body:{...s,text:c},createdAt:t?.createdAt||t?.timestamp||t?.ts||Date.now(),processEntries:Array.isArray(t?.processEntries)?t.processEntries:Array.isArray(l.processEntries)?l.processEntries:[]}}function A(t){let s=p(t);try{return Qe(s,{sender:s.fromLabel,live:t===a,keepLiveTraceVisible:t===a})}catch(l){console.warn("[mobile team chat] rich message render failed:",l);let x=s.role==="user";return`<div class="pm-msg ${x?"from-user":"from-ai"} pm-agent-chat-msg">
        <div class="pm-bubble">
          ${x?"":`<span class="pm-sender">${u(s.fromLabel)}</span>`}
          <div class="markdown-body">${Pe(s.content)}</div>
        </div>
      </div>`}}let D=()=>!!(v||a?.streaming||d),W=(t={})=>{let s=ee(t),l=String(s.sessionId||s.sourceSessionId||"").trim();return!!s.id&&(l.startsWith(`team_dm_manager_${i}___`)||l.startsWith(`team_dm_member_${i}___`)||l===`team_chat_${i}`||String(s.teamId||s.toolArgs?.teamId||"").trim()===String(i))},L=(t={})=>{if(!W(t))return!1;let s=ee(t),l=$.findIndex(M=>String(M?.approvalRequest?.id||"")===s.id),x={role:"agent",from:"manager",fromLabel:"Manager",content:"",createdAt:Date.now(),approvalRequest:s};return l>=0?$[l]={...$[l],approvalRequest:{...$[l].approvalRequest||{},...s}}:$.push(x),$=$.slice(-8),!0},G=(t,s,l={})=>{let x=String(t||"").trim();if(!x)return!1;let M=$.findIndex(c=>String(c?.approvalRequest?.id||"")===x);return M<0?!1:($[M].approvalRequest=ee({...$[M].approvalRequest||{},...l.approval||l,id:x,status:s}),!0)},K=async()=>{let t=await fe("pending").catch(()=>[]);(Array.isArray(t)?t:[]).forEach(L)};function N(){h&&(h.hidden=r.length===0,h.innerHTML=r.length?`<div class="pm-mobile-queued-list">${r.map((t,s)=>`
           <div class="pm-mobile-queued-item">
             <button type="button" class="pm-mobile-queued-text" data-team-queue-edit="${s}">${u(String(t.text||"Attached file(s)").slice(0,120))}${t.files?.length?` <em>+${t.files.length}</em>`:""}</button>
             <div class="pm-mobile-queued-actions">
               <div class="pm-mobile-queued-menu-wrap">
                 <button type="button" class="pm-mobile-queued-icon pm-mobile-queued-menu-trigger" data-team-queue-menu="${s}" aria-label="Queued message actions" title="Actions">${g.dots}</button>
                 <div class="pm-mobile-queued-popover" data-team-queue-menu-popover="${s}" hidden>
                   <button type="button" class="pm-mobile-queued-menu-item pm-mobile-queued-steer" data-team-queue-steer="${s}">${g.target}<span>Steer</span></button>
                   <button type="button" class="pm-mobile-queued-menu-item pm-mobile-queued-remove" data-team-queue-remove="${s}">${g.trash}<span>Delete</span></button>
                 </div>
               </div>
             </div>
           </div>`).join("")}</div>`:"",De(),h.querySelectorAll("[data-team-queue-edit]").forEach(t=>X(t,()=>{})),h.querySelectorAll("[data-team-queue-menu]").forEach(t=>X(t,()=>{let s=Number(t.getAttribute("data-team-queue-menu"));if(!Number.isInteger(s))return;let l=h.querySelector(`[data-team-queue-menu-popover="${s}"]`);if(!l)return;let x=!!l.hidden;ne(h),l.hidden=!x})),h.querySelectorAll("[data-team-queue-steer]").forEach(t=>X(t,()=>{let s=Number(t.getAttribute("data-team-queue-steer"));if(Number.isFinite(s)&&s>=0&&s<r.length){let[l]=r.splice(s,1);l&&r.unshift(l)}ne(h),N(),_()})),h.querySelectorAll("[data-team-queue-remove]").forEach(t=>X(t,()=>{let s=Number(t.getAttribute("data-team-queue-remove"));Number.isFinite(s)&&r.splice(s,1),ne(h),N()})))}function _(){if(D()||!r.length){S?.update?.();return}let t=r.shift();N(),R(t).catch(s=>I(s?.message||"Send failed","error"))}function P(t){let s=a&&!a._done?a:null;n=Array.isArray(t)?t.slice():[],s&&(n.some(x=>String(x.content||x.message||x.text||"").trim()&&String(x.content||x.message||x.text||"").trim()===String(s.content||"").trim())||n.push(s))}function k(){let t=$.filter(l=>String(l?.approvalRequest?.status||"pending")==="pending"),s=[...n,...t];if(!s.length){f.innerHTML='<div style="text-align:center;color:var(--pm-muted);padding:24px 8px;font-size:13px;">No messages yet. Send the first one.</div>';return}rt(f,s,A),f.querySelectorAll("[data-pm-approval-action][data-pm-approval-id]").forEach(l=>{l.addEventListener("click",()=>je(l))}),Ge(f),f.scrollTop=f.scrollHeight}try{P(await re(i,80)),await K(),k()}catch(t){f.innerHTML=`<div style="color:var(--pm-red);padding:16px;">${u(t.message||"Failed to load chat")}</div>`}async function q({forceHistory:t=!1}={}){try{let s=await ke(i,y?o:0);s.stream?.streamId&&s.stream.streamId!==y&&(y=s.stream.streamId,o=0),s.stream?.streamId&&!a&&s.active&&(a={role:"manager",from:"manager",fromLabel:"Manager",content:"",_progress:"Reconnecting...",createdAt:Date.now(),workStartedAt:Date.now(),streaming:!0,processEntries:[]},n.push(a));for(let l of s.events||[])l.streamId&&(y=l.streamId),o=Math.max(o,Number(l.seq||0)),a||(a={role:"manager",from:"manager",fromLabel:"Manager",content:"",_progress:"Reconnecting...",createdAt:Date.now(),workStartedAt:Date.now(),streaming:!0,processEntries:[]},n.push(a)),ie(a,st(l),"Manager");(t||!s.active||a?._done)&&(P(await re(i,80)),await K(),s.active||(a=null)),k()}catch{}}let te=()=>q({forceHistory:!0}),H=()=>{document.hidden||q({forceHistory:!0})},z=async(t={})=>{if(String(t.teamId||"")===String(i))try{P(await re(i,80)),a=null,k()}catch{}},Q=(t={})=>{String(t.teamId||"")===String(i)&&(d||(t.streamId&&t.streamId!==y&&(y=t.streamId,o=0),o=Math.max(o,Number(t.seq||0)),a||(a={role:"manager",from:"manager",fromLabel:"Manager",content:"",_progress:"Thinking...",createdAt:Date.now(),workStartedAt:Date.now(),streaming:!0,processEntries:[]},n.push(a)),ie(a,{type:String(t.event||""),...t.data||{}},"Manager"),k()))},U=async(t={})=>{let s=t.approval?ee(t.approval,t):await ze(t);L(s)&&k()},V=t=>(s={})=>{let l=t==="approval_approved"?"approved":t==="approval_denied"?"rejected":t==="approval_expired"?"expired":"failed";G(s.approvalId||s.id||s.approval?.id,l,s)&&k()},Y=V("approval_approved"),J=V("approval_denied"),ae=V("approval_expired"),O=V("approval_failed");T?.on?.("ws:open",te),T?.on?.("team_chat_message",z),T?.on?.("team_chat_stream_event",Q),T?.on?.("approval_created",U),T?.on?.("approval_approved",Y),T?.on?.("approval_denied",J),T?.on?.("approval_expired",ae),T?.on?.("approval_failed",O),document.addEventListener("visibilitychange",H),e._pmCleanup=()=>{if(!w){w=!0;try{v?.abort?.()}catch{}T?.off?.("ws:open",te),T?.off?.("team_chat_message",z),T?.off?.("team_chat_stream_event",Q),T?.off?.("approval_created",U),T?.off?.("approval_approved",Y),T?.off?.("approval_denied",J),T?.off?.("approval_expired",ae),T?.off?.("approval_failed",O),document.removeEventListener("visibilitychange",H)}},q();async function R(t){let s=String(t?.text||"").trim(),l=Array.isArray(t?.files)?t.files:[],x=String(t?.source||"").trim(),M=s||(l.length?"Please review the attached file(s).":"");if(!M&&!l.length)return;if(D()){r.push({text:s,files:l,source:x,speak:t?.speak===!0,voice:t?.voice===!0}),N(),S?.update?.();return}let c=M,m=l;if(l.length){let B=await Fe(l);c=`${M}${Ie(B)}`,m=B.map((F,C)=>({...l[C]||{},name:F.name||l[C]?.name||"attachment",kind:F.isImage?"image":F.isVideo?"video":l[C]?.kind||"file",workspacePath:F.workspacePath||l[C]?.workspacePath,path:F.workspacePath||l[C]?.path,dataUrl:l[C]?.dataUrl,mimeType:l[C]?.mimeType,sizeLabel:l[C]?.sizeLabel}))}let E={role:"user",from:"user",content:M,body:{text:M,attachments:m},attachmentPreviews:m,createdAt:Date.now()};a={role:"manager",from:"manager",fromLabel:"Manager",content:"",_progress:"Manager is thinking...",createdAt:Date.now(),workStartedAt:Date.now(),streaming:!0,processEntries:[]},n.push(E,a),k(),d=!0,S?.update?.(),v=Le(i,{message:c},{onEvent:B=>{ie(a,B,"Manager"),k()},onError:B=>{B?.name!=="AbortError"&&(a.content=a.content||`Error: ${B?.message||"stream failed"}`,a._progress="",a.streaming=!1,a.workEndedAt=Date.now(),d=!1,v=null,S?.update?.(),k(),I(B?.message||"Send failed","error"))},onDone:async()=>{a&&(a._progress="",a.streaming=!1,a.workEndedAt=a.workEndedAt||Date.now(),a.workDurationMs=Math.max(0,a.workEndedAt-Number(a.workStartedAt||a.createdAt||a.workEndedAt))),d=!1,v=null,S?.update?.(),await q({forceHistory:!0}),_()}})}S=it(e,"pm-team-chat",{placeholder:"Message the team manager...",draftKey:"team:manager",isBusy:D,onAbort:()=>{try{v?.abort?.()}catch{}a&&(a._progress="Stopping...",a.streaming=!1),v=null,d=!1,k()},onSubmit:R}),N()}function lt(e){let i=String(e||"").toLowerCase();return/\.(md|markdown|txt)$/.test(i)?"\u{1F4DD}":/\.(js|ts|tsx|jsx|mjs|cjs)$/.test(i)?"\u{1F4DC}":/\.(json|yaml|yml|toml)$/.test(i)?"\u{1F527}":/\.(png|jpg|jpeg|gif|svg|webp)$/.test(i)?"\u{1F5BC}\uFE0F":/\.(mp4|mov|webm|mkv)$/.test(i)?"\u{1F3AC}":/\.(mp3|wav|ogg|flac)$/.test(i)?"\u{1F3B5}":/\.(html|htm)$/.test(i)?"\u{1F310}":/\.(pdf)$/.test(i)?"\u{1F4C4}":"\u{1F4C3}"}function ct(e){return!e||e<1024?`${e||0} B`:e<1024*1024?`${(e/1024).toFixed(1)} KB`:`${(e/(1024*1024)).toFixed(2)} MB`}async function dt(e,i){e.innerHTML='<div class="pm-card" style="text-align:center;padding:24px;color:var(--pm-muted);">Loading workspace\u2026</div>';let f;try{f=await Me(i)}catch(a){e.innerHTML=`<div class="pm-empty"><div class="pm-empty-icon">${g.doc}</div><h2>Couldn\u2019t load workspace</h2><p>${u(a.message||"")}</p></div>`;return}let h=f.files||[];if(!h.length){e.innerHTML=`<div class="pm-empty"><div class="pm-empty-icon">${g.doc}</div><h2>Workspace is empty</h2><p>Files written by team subagents will appear here.</p></div>`;return}e.innerHTML=`
    <div class="pm-card" style="padding:10px 12px 12px;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
        <strong style="font-size:13px;">${h.length} file${h.length===1?"":"s"}</strong>
        ${f.workspacePath?`<span style="font-size:11px;color:var(--pm-muted);font-family:ui-monospace,monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:60%;">${u(f.workspacePath)}</span>`:""}
      </div>
      <div id="pm-ws-list" style="display:flex;flex-direction:column;gap:6px;"></div>
      <div id="pm-ws-preview" style="margin-top:12px;display:none;"></div>
    </div>
  `;let b=e.querySelector("#pm-ws-list"),n=e.querySelector("#pm-ws-preview");b.innerHTML=h.map(a=>{let v=a.relpath||a.path||a.name||"",o=a.size||0,y=a.modifiedAt||a.updatedAt;return`
      <button type="button" data-rel="${u(v)}" style="display:flex;align-items:center;gap:10px;width:100%;text-align:left;background:var(--pm-bg-soft);border:1px solid var(--pm-border);border-radius:12px;padding:10px 12px;cursor:pointer;font-family:inherit;">
        <span style="font-size:18px;">${lt(v)}</span>
        <span style="flex:1;min-width:0;overflow:hidden;">
          <span style="display:block;font-weight:700;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${u(v)}</span>
          <span style="display:block;font-size:11px;color:var(--pm-muted);">${ct(o)}${y?" \xB7 "+Z(typeof y=="number"?y:new Date(y).getTime()):""}</span>
        </span>
        <span style="color:var(--pm-muted);">${g.chev}</span>
      </button>
    `}).join(""),b.querySelectorAll("[data-rel]").forEach(a=>{a.addEventListener("click",async()=>{let v=a.getAttribute("data-rel");n.style.display="block",n.innerHTML=`<div class="pm-card-body" style="padding:14px;color:var(--pm-muted);">Loading ${u(v)}\u2026</div>`;try{let o=await Te(i,v),y=o?.content||o?.body||"";n.innerHTML=`
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
            <strong style="flex:1;font-size:13px;">${u(v)}</strong>
            <button class="pm-btn ghost" id="pm-ws-close" style="padding:4px 10px;font-size:12px;">\u2715 Close</button>
          </div>
          <pre style="background:var(--pm-bg-soft);border:1px solid var(--pm-border);border-radius:10px;padding:12px;font-size:12px;line-height:1.5;font-family:ui-monospace,monospace;white-space:pre-wrap;word-break:break-word;max-height:60vh;overflow:auto;margin:0;">${u(String(y).slice(0,5e4))}${String(y).length>5e4?`

\u2026(truncated)`:""}</pre>
        `,n.querySelector("#pm-ws-close").addEventListener("click",()=>{n.style.display="none",n.innerHTML=""}),n.scrollIntoView({behavior:"smooth",block:"nearest"})}catch(o){n.innerHTML=`<div class="pm-card-body" style="color:var(--pm-red);">${u(o.message||"Failed to load file")}</div>`}})})}async function pt(e,i,f){e.innerHTML='<div class="pm-card" style="text-align:center;padding:24px;color:var(--pm-muted);">Loading memory\u2026</div>';let h;try{h=await _e()}catch(d){e.innerHTML=`<div class="pm-empty"><div class="pm-empty-icon">${g.brain}</div><h2>Couldn\u2019t load memory</h2><p>${u(d.message||"")}</p></div>`;return}let b=Array.isArray(h?.nodes)?h.nodes.slice():[],n=String(i).toLowerCase(),a=String(f?.name||"").toLowerCase(),v=d=>{let w=String(d.sourcePath||"").toLowerCase(),r=String(d.projectId||"").toLowerCase();return r&&r.includes(n)||w&&(w.includes(n)||a&&w.includes(a))},o=b.filter(v),y=(o.length?o:b).sort((d,w)=>String(w.timestamp||"").localeCompare(String(d.timestamp||""))).slice(0,30);if(!y.length){e.innerHTML=`<div class="pm-empty"><div class="pm-empty-icon">${g.brain}</div><h2>No memory yet</h2><p>As the team works, reflections and memory entries land here.</p></div>`;return}e.innerHTML=`
    <div style="display:flex;align-items:center;gap:8px;padding:6px 4px 10px;color:var(--pm-muted);font-size:12px;">
      <span class="pm-pill ${o.length?"orange":"gray"}">${o.length?"team-scoped":"global feed"}</span>
      <span>${y.length} of ${b.length} entries</span>
    </div>
    ${y.map(d=>`
      <article class="pm-card" style="padding:12px 14px;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
          <strong style="flex:1;font-size:13px;line-height:1.3;">${u(d.label||"Memory")}</strong>
          <span class="pm-pill gray" style="font-family:ui-monospace,monospace;">${u(d.sourceTypeLabel||d.sourceType||"memory")}</span>
        </div>
        ${d.summary?`<div class="pm-card-body" style="margin-bottom:4px;">${u(String(d.summary).slice(0,240))}${String(d.summary).length>240?"\u2026":""}</div>`:""}
        <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--pm-muted);">
          <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:70%;font-family:ui-monospace,monospace;">${u(d.sourcePath||"")}</span>
          <span>${d.timestamp?Z(new Date(d.timestamp).getTime()):""}</span>
        </div>
      </article>
    `).join("")}
  `}export{vt as a,gt as b,Ze as c,st as d,rt as e,nt as f,it as g};
