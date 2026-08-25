import{b as q,c as j}from"./chunk-XSXQLBFJ.js";import{K as L,j as H}from"./chunk-4NJ7OFKB.js";import{a as C}from"./chunk-35CAQ6TV.js";import{F as h,G as o,M as k,N as S}from"./chunk-O5C7MZFW.js";import{qa as I,ra as P,sa as E,va as D}from"./chunk-K25O5QNI.js";import{a as M}from"./chunk-GBLBNUG2.js";import{a as N}from"./chunk-36KIJFV6.js";function g(e,t=""){let n=Number(e||0);return Number.isFinite(n)?Math.abs(n)>=1e9?`${Math.round(n/1e8)/10}B${t}`:Math.abs(n)>=1e6?`${Math.round(n/1e5)/10}M${t}`:Math.abs(n)>=1e3?`${Math.round(n/100)/10}K${t}`:`${Math.round(n).toLocaleString()}${t}`:t?`0${t}`:"0"}function A(e){if(!e)return"";let t=new Date(e);return Number.isNaN(t.getTime())?"":t.toLocaleString([],{month:"short",day:"numeric",hour:"numeric",minute:"2-digit"})}function Q(e){return String(e?.title||e?.goal||e?.userRequest||e?.summary||e?.id||"Latest goal").trim()}function Y(e){return String(e?.summary||e?.result||e?.assistantSummary||e?.description||e?.lastAssistantMessage||"").trim()}function F(e){let t=String(e||"").toLowerCase();return["running","pending","executing"].includes(t)?'<span class="pm-pill running">running</span>':["failed","rejected","denied"].includes(t)?'<span class="pm-pill orange">failed</span>':["complete","completed","done","approved","auto"].includes(t)?'<span class="pm-pill active">complete</span>':`<span class="pm-pill gray">${o(t||"unknown")}</span>`}function R(e,t){let n=String(e||"").toLowerCase();return String(t||"").toLowerCase().includes("proposal")||n.includes("proposal")?"proposal":n.includes("delete")||n.includes("remove")?"delete":n.includes("type")||n.includes("fill")?"type":n.includes("click")||n.includes("press")?"click":n.includes("command")||n==="shell"?"cmd":n.includes("write")||n.includes("edit")||n.includes("create")||n.includes("append")?"edit":n.includes("read")||n.includes("list")||n.includes("search")||n.includes("stat")||n.includes("grep")?"read":"other"}function V(e){let t={total:0,read:0,edit:0,delete:0,type:0,click:0,cmd:0,proposal:0,approved:0,rejected:0,pending:0};for(let n of e||[])for(let r of n.tools||[]){t.total++;let s=R(r.toolName,r.actionType);t[s]!==void 0&&t[s]++;let l=String(r.approvalStatus||"").toLowerCase();l==="approved"?t.approved++:l==="rejected"?t.rejected++:l==="pending"&&t.pending++}return t}function X(e,t=3){let n=new Map;for(let r of e||[]){let s=String(r.toolName||"tool");n.set(s,(n.get(s)||0)+1)}return[...n.entries()].sort((r,s)=>s[1]-r[1]).slice(0,t)}function be(e){let t=String(e?.priority||"medium").toLowerCase();return`<span class="pm-proposal-badge ${t==="critical"||t==="high"?"orange":t==="low"?"gray":"blue"}">${o(t.toUpperCase())}</span>`}function fe(e){let t=String(e?.status||"pending").toLowerCase();return t==="pending"?'<span class="pm-proposal-status pending">PENDING</span>':t==="executing"||t==="repairing"?'<span class="pm-proposal-status running">RUNNING</span>':t==="executed"||t==="approved"?'<span class="pm-proposal-status complete">APPROVED</span>':t==="denied"||t==="failed"?'<span class="pm-proposal-status denied">DENIED</span>':`<span class="pm-proposal-status">${o(t.toUpperCase())}</span>`}function $e(e,t=2){let n=Array.isArray(e?.affectedFiles)?e.affectedFiles.slice(0,t):[],r=Array.isArray(e?.affectedFiles)?e.affectedFiles.length-n.length:0,s=n.map(l=>`<span>${o(l?.action||"touch")}: ${o(l?.path||"")}</span>`);return r>0&&s.push(`<span>+${r} more</span>`),s.length?`<div class="pm-proposal-files">${s.join("")}</div>`:""}function U(e,t){let n=String(t?.status||t?.state||"").trim().toLowerCase();if(n)return n.replace(/\s+/g,"_");let r=String(e?.status||"").trim().toLowerCase();return["approved","executing","repairing","executed"].includes(r)?"approved":"pending"}function J(e,t){return t?.approved===!0||t?.isApproved===!0||U(e,t)==="approved"}function ke(e){let t=Array.isArray(e?.executionSteps)?e.executionSteps:[];return t.length?`<section class="pm-card pm-more-section"><div class="pm-card-head">Approved Execution Steps</div><div class="pm-proposal-steps">${t.map((n,r)=>{let s=String(n?.title||n?.description||`Step ${r+1}`),l=String(n?.kind||"").trim(),p=String(n?.successCriteria||n?.success_criteria||"").trim(),c=U(e,n),d=J(e,n),i=c.replace(/[^a-z0-9_-]/g,"_");return`<div class="pm-proposal-step ${d?"is-approved":""} is-${i}" data-step-status="${o(c)}">
      <b>${r+1}</b>
      <span><span class="pm-proposal-step-title">${o(s)}</span>${p?`<em>Success: ${o(p)}</em>`:""}</span>
      ${l?`<small>${o(l.toUpperCase())}</small>`:""}
    </div>`}).join("")}</div></section>`:""}function Se(e){let t=String(e?.details||"").trim();return t?`<section class="pm-card pm-more-section pm-proposal-details">
    <div class="pm-card-head">Details</div>
    <div class="markdown-body">${H(t)}</div>
  </section>`:""}function Z(e,t,n="stdout"){let r=String(e||"").trim(),s=r?document.querySelector(`[data-pm-process-output="${L(r)}"]`):null,l=r?document.querySelector(`[data-pm-process-run="${L(r)}"]`):null;if(!s||!l||!t)return;let p=l.getAttribute("data-pm-process-tab")||"combined";if(p!=="combined"&&p!==n)return;let c=s.scrollHeight-s.scrollTop-s.clientHeight<40;s.textContent=`${s.textContent==="No output yet."?"":s.textContent}${t}`,c&&(s.scrollTop=s.scrollHeight)}function ee(){if(window.__pmMobileProcessRunLiveInstalled)return;window.__pmMobileProcessRunLiveInstalled=!0;let e=window.wsEventBus||M;e?.on?.("process_run_output",(t={})=>{let n=String(t.run?.runId||t.runId||"").trim();Z(n,String(t.chunk||""),String(t.stream||"stdout"))}),["process_run_started","process_run_update","process_run_exited"].forEach(t=>{e?.on?.(t,(n={})=>{let r=n.run||{},s=String(r.runId||n.runId||"").trim(),l=s?document.querySelector(`[data-pm-process-run="${L(s)}"]`):null;if(!l)return;let p=String(r.state||r.status||"").toLowerCase(),c=l.querySelector(".pm-process-pill"),d=l.querySelector(".pm-process-live-state");c&&p&&(c.textContent=p,c.className=`pm-process-pill ${p}`),d&&(d.textContent=p==="exited"?"completed":"streaming")})})}ee();function te(e,t=120){return`<div class="pm-memory-orbit" aria-hidden="true"><div class="pm-memory-core"></div>${(Array.isArray(e)?e:[]).slice(0,t).map((s,l)=>{let p=Number(s?.degree||0),c=l*137.5*Math.PI/180,d=8+Math.sqrt(l+1)*7.2,i=50+Math.cos(c)*Math.min(d,43),m=50+Math.sin(c)*Math.min(d,43),a=p>6?"#ff8a2a":p>3?"#a78bfa":"#55c4ff";return`<i style="left:${i.toFixed(2)}%;top:${m.toFixed(2)}%;background:${a};"></i>`}).join("")}</div>`}function ne(){let e=document.getElementById("memory-view");if(!e||e.dataset.pmIdsParked==="1")return()=>{};let t=[];return e.querySelectorAll("[id]").forEach(n=>{let r=n.getAttribute("id");!r||!r.startsWith("memory-")||(n.setAttribute("data-pm-original-id",r),n.setAttribute("id",`desktop-${r}`),t.push(n))}),e.dataset.pmIdsParked="1",()=>{t.forEach(n=>{let r=n.getAttribute("data-pm-original-id");r&&(n.setAttribute("id",r),n.removeAttribute("data-pm-original-id"))}),delete e.dataset.pmIdsParked}}function _(){return'<div class="pm-more-skeleton"><span></span><span></span><span></span></div>'}function re(e={}){return Number(e.totalTokens??e.total??0)||0}function se(e={}){return Number(e.modelCalls??e.messages??0)||0}function T(e,t,{retryOnWsOpen:n=!0}={}){if(!e||typeof t!="function")return;let r=!1,s=!1,l=!1,p=typeof e._pmCleanup=="function"?e._pmCleanup:null,c=async()=>{if(!(l||s||r)){s=!0;try{r=await t()!==!1}finally{s=!1}}},d=setTimeout(()=>requestAnimationFrame(c),0),i=()=>{r||setTimeout(c,120)};n&&M?.on?.("ws:open",i),e._pmCleanup=()=>{l=!0,clearTimeout(d),n&&M?.off?.("ws:open",i),p?.()}}function oe(e,{navigate:t}){let n=`<span class="pm-spacer"></span><button class="pm-icon-btn" id="pm-more-refresh" aria-label="Refresh" style="background:var(--pm-surface);border:1px solid var(--pm-border);">${h.refresh}</button>`;e.innerHTML=`
    ${k({title:"More",online:!0,extras:n,hideTitle:!0,hideBrand:!0})}
    <div class="pm-body pm-more-page" id="pm-more-body">
      ${_()}
    </div>
  `,S(e,{});let r=e.querySelector("#pm-more-body"),s=p=>{let c=Array.isArray(p?.audit?.runs)?p.audit.runs:[],d=Array.isArray(p?.memory?.recent)?p.memory.recent:[];r.innerHTML=`
      <button class="pm-more-card pm-more-card-audit" data-route="#mobile/more/audit" type="button">
        <div class="pm-more-card-top">
          <span class="pm-more-icon">${h.clipboard}</span>
          <span><strong>Audit</strong><em>Recent non-main agent runs</em></span>
          <span class="pm-chev">${h.chev}</span>
        </div>
        <div class="pm-run-mini-list">
          ${c.length?c.slice(0,3).map(i=>`
            <span>
              <b>${o(i.kind||i.agentId||"Agent Run")}</b>
              <em>${o(A(i.endedAt||i.startedAt))}</em>
              ${F(i.status)}
            </span>
          `).join(""):"<p>No agent runs recorded yet.</p>"}
        </div>
      </button>

      <button class="pm-more-card pm-more-card-memory" data-route="#mobile/more/memory" type="button">
        <div class="pm-more-card-top">
          <span class="pm-more-icon">${h.brain}</span>
          <span><strong>Memory</strong><em>Latest graph additions</em></span>
          <span class="pm-chev">${h.chev}</span>
        </div>
        <div class="pm-memory-mini">
          ${te(d,28)}
          <div class="pm-memory-mini-list">
            ${d.length?d.map(i=>`
              <span><b>${o(i.title)}</b><em>${o(i.type)} - ${o(A(i.timestamp))}</em></span>
            `).join(""):"<p>No non-chat memory graph items yet.</p>"}
          </div>
        </div>
      </button>

      <div class="pm-more-card" style="cursor:default;">
        <div class="pm-more-card-top">
          <span class="pm-more-icon">${h.refresh}</span>
          <span><strong>App health</strong><em>Force a fresh asset reload if the app feels stuck</em></span>
        </div>
        <div style="display:flex;flex-direction:column;gap:8px;padding-top:6px;">
          <button class="pm-btn ghost" id="pm-more-purge" type="button" style="justify-content:center;">\u21BB Reload latest assets</button>
          <button class="pm-btn ghost" id="pm-more-repair" type="button" style="justify-content:center;color:var(--pm-red);">\u{1F691} Full reset (re-pair required)</button>
          <span style="font-size:11px;color:var(--pm-muted);line-height:1.5;">Use this if a refresh sends you to the desktop UI, scanning a QR shows the desktop site, or actions stop working after a gateway restart.</span>
        </div>
      </div>
    `,r.querySelectorAll("[data-route]").forEach(i=>i.addEventListener("click",()=>t(i.getAttribute("data-route")))),r.querySelector("#pm-more-purge")?.addEventListener("click",async()=>{C("Refreshing assets\u2026","info");try{await window.pmPurgeCaches?.()}catch{window.location.reload()}}),r.querySelector("#pm-more-repair")?.addEventListener("click",async()=>{if(confirm("Full reset will clear caches, sign this device out of pairing, and reload. Continue?")){try{localStorage.removeItem("pm_device_token"),localStorage.removeItem("pm_device_id"),localStorage.removeItem("pm_force_mobile")}catch{}try{await window.pmPurgeCaches?.()}catch{window.location.reload()}}})};s(null);let l=async()=>{try{return s(await I()),!0}catch(p){return C(`Could not refresh More: ${p.message||""}`,"error"),!1}};e.querySelector("#pm-more-refresh")?.addEventListener("click",l),T(e,l)}function ae(){let e=null;try{e=N?.()}catch{}let t=String(e?.email||e?.user?.email||"").trim(),r=String(e?.name||e?.displayName||e?.user?.name||t.split("@")[0]||"Prometheus").trim().replace(/^@/,"")||"Prometheus",s=t?t.split("@")[0]:r.toLowerCase().replace(/[^a-z0-9]+/g,"");return{name:r,handle:s?`@${s}`:"@local"}}function ie(e=""){let t=String(e||"").trim().split(/\s+/).filter(Boolean);return(t.length>=2?`${t[0][0]||""}${t[1][0]||""}`:String(e||"P").slice(0,2)).toUpperCase()||"PM"}function w(e,t){return`<span><b>${o(String(t))}</b><em>${o(e)}</em></span>`}function B(e,t=!1){let n=t?"Loading latest goal\u2026":e?Q(e):"No goals yet",r=t?"Your most recently updated goal will appear here.":e?Y(e)||String(e.status||"In progress"):"Main chat goals will appear here once Prometheus records them.",s=e?A(e.updatedAt||e.completedAt||e.createdAt):"";return`
    <section class="pm-hub-profile-section" id="pm-hub-latest-goal">
      <div class="pm-hub-section-head"><strong>Latest goal</strong><span>${o(s)}</span></div>
      <h2>${o(n)}</h2>
      <p>${o(r)}</p>
    </section>
  `}function le(e,t){let n=Math.max(0,Number(e)||0);if(n<=0)return 0;let r=n/Math.max(1,Number(t)||1);return Math.min(1,.12+.88*Math.sqrt(r))}function ce(e){let t=String(e?.dataset?.date||""),n=Math.max(0,Number(e?.dataset?.tokens||0));if(!t)return;document.getElementById("pm-token-activity-popover")?.remove();let r=document.createElement("div");r.id="pm-token-activity-popover",r.className="pm-token-activity-popover";let s=new Date(`${t}T00:00:00`).toLocaleDateString(void 0,{weekday:"short",month:"short",day:"numeric",year:"numeric"});r.innerHTML=`<strong>${o(s)}</strong><span>${o(g(n))} tokens</span>`,document.body.appendChild(r);let l=e.getBoundingClientRect(),p=8,c=r.offsetWidth||164,d=r.offsetHeight||52,i=l.left+l.width/2-c/2,m=l.top-d-p;m<p&&(m=l.bottom+p),i=Math.max(p,Math.min(i,window.innerWidth-c-p)),m=Math.max(p,Math.min(m,window.innerHeight-d-p)),r.style.left=`${i}px`,r.style.top=`${m}px`}function pe(e){let t=Array.from(e?.querySelectorAll?.(".pm-hub-token-cell[data-date]")||[]);if(!t.length)return;let n=null,r=null,s=()=>{r&&clearTimeout(r),r=null,document.getElementById("pm-token-activity-popover")?.remove()},l=i=>{i&&(r&&clearTimeout(r),ce(i))},p=(i,m)=>document.elementFromPoint(i,m)?.closest?.(".pm-hub-token-cell[data-date]"),c=()=>{n=null,window.removeEventListener("pointermove",d,!0),window.removeEventListener("pointerup",c,!0),window.removeEventListener("pointercancel",c,!0),r=setTimeout(s,850)},d=i=>{if(n!==i.pointerId)return;let m=p(i.clientX,i.clientY);m&&l(m)};t.forEach(i=>{i.addEventListener("pointerdown",m=>{m.pointerType==="mouse"&&m.button!==0||(n=m.pointerId,l(i),window.addEventListener("pointermove",d,!0),window.addEventListener("pointerup",c,!0),window.addEventListener("pointercancel",c,!0))}),i.addEventListener("pointerenter",m=>{m.pointerType==="mouse"&&l(i)}),i.addEventListener("pointerleave",m=>{m.pointerType==="mouse"&&n===null&&s()})})}function de(e={}){let t=Array.isArray(e?.daily)?e.daily:[];if(!t.length)return'<div class="pm-hub-token-empty">No token activity recorded yet.</div>';let n=new Date(`${t[0].date}T00:00:00`),r=Number.isFinite(n.getTime())?n.getDay():0,s=t.map(a=>Math.max(0,Number(a.tokens||a.count||0))),l=Math.max(1,...s),p=Math.ceil((r+t.length)/7),c=["S","M","T","W","T","F","S"].map(a=>`<span>${a}</span>`).join(""),d="";for(let a=0;a<r;a++)d+='<i class="empty"></i>';t.forEach(a=>{let u=Math.max(0,Number(a.tokens||a.count||0)),v=`${a.date}: ${g(u)} tokens`,b=u>0?"true":"false",y=le(u,l).toFixed(3);d+=`<i class="pm-hub-token-cell" data-date="${o(a.date)}" data-tokens="${u}" data-active="${b}" style="--pm-token-alpha:${y}" aria-label="${o(v)}"></i>`});let i=[],m=new Set;return t.forEach((a,u)=>{let[v,b]=String(a.date||"").split("-"),y=`${v}-${b}`;if(!v||!b||m.has(y))return;m.add(y);let f=new Date(`${a.date}T00:00:00`);i.push(`<span style="grid-column:${Math.floor((r+u)/7)+1}">${o(f.toLocaleDateString(void 0,{month:"short"}))}</span>`)}),`
    <div class="pm-hub-token-calendar" style="--pm-token-weeks:${p}">
        <div class="pm-hub-token-labels">${c}</div>
        <div class="pm-hub-token-grid-wrap">
          <div class="pm-hub-token-months">${i.join("")}</div>
          <div class="pm-hub-token-cells">${d}</div>
        </div>
    </div>
  `}async function me(e,{navigate:t}={}){let n=`<span class="pm-spacer"></span><button class="pm-icon-btn" id="pm-hub-refresh" aria-label="Refresh" style="background:var(--pm-surface);border:1px solid var(--pm-border);">${h.refresh}</button>`;e.innerHTML=`
    ${k({title:"Hub",online:!0,extras:n,hideTitle:!0,hideBrand:!0})}
    <div class="pm-body pm-hub-profile-page" id="pm-hub-body">${_()}</div>
  `,S(e,{});let r=e.querySelector("#pm-hub-body"),s=0,l=async()=>{try{let p=++s;r.innerHTML=_();let c=await P(),d=ae(),i=c.goals[0],m=c.models||{},a=c.tools||{},u=c.tokenActivity||{daily:[],stats:{}},v=u.stats||{},b=Number(v.totalTokens||re(m))||0,y=Number(v.peakTokens||0)||0,f=Number(v.activeDays||a.activeDays||m.activeDays||0)||0,O=Number(v.current??v.currentStreak??a.currentStreak??m.currentStreak??0)||0,G=Number(v.longest??v.longestStreak??a.longestStreak??m.longestStreak??0)||0,W=Number(a.toolCalls||a.total||0)||0,z=Array.isArray(c.topModels)?c.topModels:[],K=Array.isArray(c.topTools)?c.topTools:[];return r.innerHTML=`
        <section class="pm-hub-profile-hero">
          <div class="pm-hub-avatar">${o(ie(d.name))}</div>
          <h1>${o(d.name)}</h1>
          <p><span>${o(d.handle)}</span><span>Prometheus</span></p>
        </section>
        <section class="pm-hub-profile-stats">
          ${w("Lifetime tokens",g(b))}
          ${w("Peak tokens",g(y))}
          ${w("Model calls",g(se(m)))}
          ${w("Current streak",`${O}d`)}
          ${w("Longest streak",`${G}d`)}
        </section>
        <section class="pm-hub-profile-section">
          <div class="pm-hub-section-head">
            <strong>Token activity</strong>
            <span>${o(g(b))} total</span>
          </div>
          ${de(u)}
        </section>
        <section class="pm-hub-profile-columns">
          <div class="pm-hub-profile-section">
            <div class="pm-hub-section-head"><strong>Activity insights</strong></div>
            <div class="pm-hub-insight-list">
              <span><em>Active days</em><b>${o(g(f))}</b></span>
              <span><em>Tool calls</em><b>${o(g(W))}</b></span>
              <span><em>Sessions</em><b>${o(g(a.chatSessions||m.chatSessions||0))}</b></span>
              <span><em>Peak hour</em><b>${o(String(a.peakHour||m.peakHour||"-"))}</b></span>
            </div>
          </div>
          <div class="pm-hub-profile-section">
            <div class="pm-hub-section-head"><strong>Most used models</strong></div>
            <div class="pm-hub-usage-list">
              ${z.slice(0,4).map($=>`<span><b>${o($.name||"Model")}</b><em>${o(g($.tokens||0))} tokens</em></span>`).join("")||"<p>No model usage yet.</p>"}
            </div>
          </div>
        </section>
        ${B(i,c.goalsLoaded===!1)}
        <section class="pm-hub-profile-section">
          <div class="pm-hub-section-head"><strong>Most used tools</strong></div>
          <div class="pm-hub-usage-list">
            ${K.slice(0,6).map($=>`<span><b>${o($.name||"Tool")}</b><em>${o(g($.count||0))} calls</em></span>`).join("")||"<p>No tool usage yet.</p>"}
          </div>
        </section>
      `,pe(r),c.goalsLoaded===!1&&E().then($=>{if(p!==s||!r.isConnected)return;let x=r.querySelector("#pm-hub-latest-goal");x&&(x.outerHTML=B($[0]||null))}).catch(()=>{}),!0}catch(p){return r.innerHTML=`<div class="pm-empty"><div class="pm-empty-icon">${h.target}</div><h2>Could not load Hub</h2><p>${o(p.message||"")}</p></div>`,!1}};e.querySelector("#pm-hub-refresh")?.addEventListener("click",l),T(e,l)}async function ue(e,{navigate:t}){let n=`<span class="pm-spacer"></span><button class="pm-icon-btn" id="pm-audit-refresh" aria-label="Refresh" style="background:var(--pm-surface);border:1px solid var(--pm-border);">${h.refresh}</button>`;e.innerHTML=`
    ${k({title:"Audit",leftIcon:"back",onBack:()=>t("#mobile/more"),online:!0,extras:n,hideTitle:!0,hideBrand:!0})}
    <div class="pm-body pm-more-page" id="pm-audit-body">${_()}</div>
  `,S(e,{onBack:()=>t("#mobile/more")});let r=e.querySelector("#pm-audit-body"),s="",l=[],p=()=>{let d=V(l);r.innerHTML=`
      <div class="pm-audit-filter-row">
        <label>${h.chat}<input id="pm-audit-search" type="search" placeholder="Filter by tool or activity..." value=""></label>
        <button type="button" id="pm-audit-clear">${h.refresh}</button>
      </div>
      <div class="pm-audit-stat-grid">
        ${[["total",d.total],["read",d.read],["edit",d.edit],["delete",d.delete],["type",d.type],["click",d.click],["cmd",d.cmd],["proposal",d.proposal],["approved",d.approved],["rejected",d.rejected],["pending",d.pending]].map(([a,u])=>`<span class="${a}"><b>${o(g(u))}</b><em>${o(String(a).toUpperCase())}</em></span>`).join("")}
      </div>
      ${l.length?`<div class="pm-audit-run-list">${l.slice(0,40).map(a=>{let u=s===a.key,v=Array.isArray(a.tools)?a.tools.slice().sort((y,f)=>String(f.timestamp||"").localeCompare(String(y.timestamp||""))):[],b=X(v);return`<article class="pm-card pm-audit-run-card" data-run-key="${o(a.key)}">
        <div class="pm-audit-run-top">
          <span><strong>${o(A(a.endedAt||a.startedAt).split(",")[0]||"")}</strong><em>${o(new Date(a.endedAt||a.startedAt).toLocaleDateString([],{month:"short",day:"numeric"}))}</em></span>
          <span><strong>${o(a.kind||"Agent Run")}</strong><em>${o(a.agentId||"agent")}</em></span>
          ${F(a.status)}
        </div>
        <p>${v.length} tools - Top activity: ${o(b.map(([y,f])=>`${y} (${f})`).join(", ")||"none")}</p>
        <div class="pm-more-meta-row"><span>${o(a.sessionId||a.key)}</span><span>${u?"Collapse":"Open"}</span></div>
        ${u?`<div class="pm-audit-tool-stream">
          ${v.map(y=>`<div><b>${o(y.toolName||"tool")}</b><em>${o(y.actionType||"event")} - ${o(A(y.timestamp))}</em><span>${o(R(y.toolName,y.actionType).toUpperCase())}</span>${y.error?`<p>${o(String(y.error).slice(0,240))}</p>`:""}</div>`).join("")}
        </div>`:""}
      </article>`}).join("")}</div>`:`<div class="pm-empty"><div class="pm-empty-icon">${h.clipboard}</div><h2>No agent runs yet</h2><p>Non-main agent activity will show up here.</p></div>`}
    `,r.querySelectorAll("[data-run-key]").forEach(a=>a.addEventListener("click",()=>{let u=a.getAttribute("data-run-key")||"";s=s===u?"":u,p()}));let i=r.querySelector("#pm-audit-search"),m=r.querySelector("#pm-audit-clear");i?.addEventListener("input",()=>{let a=String(i.value||"").trim().toLowerCase();r.querySelectorAll(".pm-audit-run-card").forEach(u=>{u.hidden=a&&!u.textContent.toLowerCase().includes(a)})}),m?.addEventListener("click",c)},c=async()=>{try{return r.innerHTML=_(),l=await D(200),p(),!0}catch(d){return r.innerHTML=`<div class="pm-empty"><div class="pm-empty-icon">${h.clipboard}</div><h2>Could not load Audit</h2><p>${o(d.message||"")}</p></div>`,!1}};e.querySelector("#pm-audit-refresh")?.addEventListener("click",c),T(e,c)}async function ye(e,{navigate:t}){let n=ne(),r=`<span class="pm-spacer"></span><button class="pm-icon-btn" type="button" onclick="refreshMemoryGraph(true)" aria-label="Refresh" style="background:var(--pm-surface);border:1px solid var(--pm-border);">${h.refresh}</button>`;e.innerHTML=`
    ${k({title:"Memory Graph",leftIcon:"back",onBack:()=>t("#mobile/more"),online:!0,extras:r,hideTitle:!0,hideBrand:!0})}
    <div class="pm-body pm-mobile-memory-body" id="pm-memory-body">
      <div class="memory-page-shell pm-mobile-memory-shell">
        <div class="memory-page-header pm-mobile-memory-actions">
          <input id="memory-image-input" type="file" accept="image/*" style="display:none" />
          <button class="memory-action-btn memory-action-btn--primary" type="button" onclick="openAddMemoryDrawer()">+ Add Memory</button>
          <button class="memory-action-btn" type="button" onclick="triggerMemoryImageInput()">Image Shape</button>
          <button id="memory-set-default-btn" class="memory-action-btn" type="button" style="opacity:0.4" onclick="toggleDefaultShape()">Set Image Default</button>
        </div>
        <div class="memory-page-body">
          <div class="memory-graph-panel">
            <div class="memory-graph-toolbar">
              <input id="memory-search-input" class="memory-search-input" type="text" placeholder="Search nodes, summaries, paths..." />
              <div id="memory-graph-stats" class="memory-graph-stats">Loading graph...</div>
            </div>
            <div id="memory-graph-stage" class="memory-graph-stage">
              <canvas id="memory-graph-canvas"></canvas>
              <div id="memory-graph-tooltip" class="memory-graph-tooltip" style="display:none"></div>
              <div id="memory-graph-empty" class="memory-graph-empty">Loading memory graph...</div>
              <div id="memory-drop-overlay" class="memory-drop-overlay" style="display:none">Drop image to reshape node outline</div>
            </div>
          </div>
          <aside id="memory-side-panel" class="memory-side-panel">
            <div class="memory-side-panel-header">
              <div class="memory-side-panel-title">Controls</div>
              <button class="memory-panel-collapse-btn" type="button" onclick="toggleMemoryControlsPanel()">&times;</button>
            </div>
            <section class="memory-panel-card memory-particle-controls">
              <div class="memory-panel-header-line">
                <div class="memory-panel-title">Controls</div>
                <div class="memory-panel-hint">live shaderless canvas</div>
              </div>
              <div class="memory-particle-modes">
                <button class="memory-particle-mode-btn active" type="button" data-memory-particle-mode="galaxy">Galaxy</button>
                <button class="memory-particle-mode-btn" type="button" data-memory-particle-mode="sphere">Sphere</button>
                <button class="memory-particle-mode-btn" type="button" data-memory-particle-mode="wave">Wave</button>
                <button class="memory-particle-mode-btn" type="button" data-memory-particle-mode="tunnel">Tunnel</button>
              </div>
              <div class="memory-control-stack">
                <label class="memory-control memory-control-row">
                  <span>Speed</span>
                  <input id="memory-particle-speed" type="range" min="0" max="200" step="1" value="35" />
                  <div id="memory-particle-speed-value" class="memory-control-value">35</div>
                </label>
                <label class="memory-control memory-control-row">
                  <span>Depth</span>
                  <input id="memory-particle-depth" type="range" min="160" max="900" step="10" value="740" />
                  <div id="memory-particle-depth-value" class="memory-control-value">740</div>
                </label>
                <label class="memory-control memory-control-row">
                  <span>Glow</span>
                  <input id="memory-particle-glow" type="range" min="0" max="100" step="1" value="20" />
                  <div id="memory-particle-glow-value" class="memory-control-value">20</div>
                </label>
              </div>
            </section>
            <section class="memory-panel-card">
              <div class="memory-panel-title">Filters</div>
              <div class="memory-control-stack">
                <label class="memory-control">
                  <span>Source Type</span>
                  <select id="memory-type-filter"><option value="">All records</option></select>
                </label>
                <label class="memory-control">
                  <span>Minimum edge weight</span>
                  <input id="memory-edge-weight" type="range" min="0" max="100" step="1" value="34" />
                  <div id="memory-edge-weight-value" class="memory-control-hint">0.34+</div>
                </label>
                <label class="memory-control memory-check">
                  <input id="memory-show-labels" type="checkbox" />
                  <span>Show labels for important nodes</span>
                </label>
                <label class="memory-control memory-check">
                  <input id="memory-organize-type" type="checkbox" />
                  <span>Organize by type</span>
                </label>
                <label class="memory-control memory-check memory-sub-check">
                  <input id="memory-separate-type" type="checkbox" />
                  <span>Separate</span>
                </label>
                <button id="memory-save-settings" class="memory-filter-save-btn" type="button">Save Settings</button>
              </div>
            </section>
          </aside>
          <button id="memory-controls-fab" class="memory-controls-fab" type="button" style="display:none" onclick="toggleMemoryControlsPanel()">Filters</button>
          <aside id="memory-detail-drawer" class="memory-detail-drawer" style="display:none">
            <div class="memory-detail-drawer-header">
              <div id="memory-drawer-title" class="memory-side-panel-title">Node Detail</div>
              <button class="memory-panel-collapse-btn" type="button" onclick="closeMemoryDetailDrawer()">&times;</button>
            </div>
            <div id="memory-detail-panel" class="memory-detail-panel">
              <div class="memory-detail-empty">Select a node to inspect its summary, source, and related records.</div>
            </div>
          </aside>
        </div>
      </div>
    </div>
  `,S(e,{onBack:()=>t("#mobile/more")}),e._pmCleanup=()=>{q(),n()},requestAnimationFrame(()=>j())}async function we(e,{section:t="",navigate:n}){if(t==="hub"){try{n?.("#mobile/hub")}catch{}return me(e,{navigate:n})}return t==="audit"?ue(e,{navigate:n}):t==="memory"?ye(e,{navigate:n}):oe(e,{navigate:n})}export{A as a,be as b,fe as c,$e as d,ke as e,Se as f,_ as g,me as h,we as i};
