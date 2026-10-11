import{b as q,c as j}from"./chunk-2CXISD5N.js";import{L as C,j as H}from"./chunk-I5YM2C6R.js";import{a as L}from"./chunk-35CAQ6TV.js";import{H as h,I as r,O as k,P as S}from"./chunk-BGL3KPSU.js";import{ta as I,ua as E,va as P,ya as D}from"./chunk-DUITZ26B.js";import{a as M}from"./chunk-DFHP73MY.js";import{a as N}from"./chunk-6FFPACLU.js";function b(e,t=""){let n=Number(e||0);return Number.isFinite(n)?Math.abs(n)>=1e9?`${Math.round(n/1e8)/10}B${t}`:Math.abs(n)>=1e6?`${Math.round(n/1e5)/10}M${t}`:Math.abs(n)>=1e3?`${Math.round(n/100)/10}K${t}`:`${Math.round(n).toLocaleString()}${t}`:t?`0${t}`:"0"}function A(e){if(!e)return"";let t=new Date(e);return Number.isNaN(t.getTime())?"":t.toLocaleString([],{month:"short",day:"numeric",hour:"numeric",minute:"2-digit"})}function Y(e){return String(e?.title||e?.goal||e?.userRequest||e?.summary||e?.id||"Latest goal").trim()}function V(e){return String(e?.summary||e?.result||e?.assistantSummary||e?.description||e?.lastAssistantMessage||"").trim()}function B(e){let t=String(e||"").toLowerCase();return["running","pending","executing"].includes(t)?'<span class="pm-pill running">running</span>':["failed","rejected","denied"].includes(t)?'<span class="pm-pill orange">failed</span>':["complete","completed","done","approved","auto"].includes(t)?'<span class="pm-pill active">complete</span>':`<span class="pm-pill gray">${r(t||"unknown")}</span>`}function F(e,t){let n=String(e||"").toLowerCase();return String(t||"").toLowerCase().includes("proposal")||n.includes("proposal")?"proposal":n.includes("delete")||n.includes("remove")?"delete":n.includes("type")||n.includes("fill")?"type":n.includes("click")||n.includes("press")?"click":n.includes("command")||n==="shell"?"cmd":n.includes("write")||n.includes("edit")||n.includes("create")||n.includes("append")?"edit":n.includes("read")||n.includes("list")||n.includes("search")||n.includes("stat")||n.includes("grep")?"read":"other"}function X(e){let t={total:0,read:0,edit:0,delete:0,type:0,click:0,cmd:0,proposal:0,approved:0,rejected:0,pending:0};for(let n of e||[])for(let o of n.tools||[]){t.total++;let s=F(o.toolName,o.actionType);t[s]!==void 0&&t[s]++;let a=String(o.approvalStatus||"").toLowerCase();a==="approved"?t.approved++:a==="rejected"?t.rejected++:a==="pending"&&t.pending++}return t}function J(e,t=3){let n=new Map;for(let o of e||[]){let s=String(o.toolName||"tool");n.set(s,(n.get(s)||0)+1)}return[...n.entries()].sort((o,s)=>s[1]-o[1]).slice(0,t)}function fe(e){let t=String(e?.priority||"medium").toLowerCase();return`<span class="pm-proposal-badge ${t==="critical"||t==="high"?"orange":t==="low"?"gray":"blue"}">${r(t.toUpperCase())}</span>`}function $e(e){let t=String(e?.status||"pending").toLowerCase();return t==="pending"?'<span class="pm-proposal-status pending">PENDING</span>':t==="executing"||t==="repairing"?'<span class="pm-proposal-status running">RUNNING</span>':t==="executed"||t==="approved"?'<span class="pm-proposal-status complete">APPROVED</span>':t==="denied"||t==="failed"?'<span class="pm-proposal-status denied">DENIED</span>':`<span class="pm-proposal-status">${r(t.toUpperCase())}</span>`}function ke(e,t=2){let n=Array.isArray(e?.affectedFiles)?e.affectedFiles.slice(0,t):[],o=Array.isArray(e?.affectedFiles)?e.affectedFiles.length-n.length:0,s=n.map(a=>`<span>${r(a?.action||"touch")}: ${r(a?.path||"")}</span>`);return o>0&&s.push(`<span>+${o} more</span>`),s.length?`<div class="pm-proposal-files">${s.join("")}</div>`:""}function U(e,t){let n=String(t?.status||t?.state||"").trim().toLowerCase();if(n)return n.replace(/\s+/g,"_");let o=String(e?.status||"").trim().toLowerCase();return["approved","executing","repairing","executed"].includes(o)?"approved":"pending"}function Z(e,t){return t?.approved===!0||t?.isApproved===!0||U(e,t)==="approved"}function Se(e){let t=Array.isArray(e?.executionSteps)?e.executionSteps:[];return t.length?`<section class="pm-card pm-more-section"><div class="pm-card-head">Approved Execution Steps</div><div class="pm-proposal-steps">${t.map((n,o)=>{let s=String(n?.title||n?.description||`Step ${o+1}`),a=String(n?.kind||"").trim(),l=String(n?.successCriteria||n?.success_criteria||"").trim(),p=U(e,n),d=Z(e,n),i=p.replace(/[^a-z0-9_-]/g,"_");return`<div class="pm-proposal-step ${d?"is-approved":""} is-${i}" data-step-status="${r(p)}">
      <b>${o+1}</b>
      <span><span class="pm-proposal-step-title">${r(s)}</span>${l?`<em>Success: ${r(l)}</em>`:""}</span>
      ${a?`<small>${r(a.toUpperCase())}</small>`:""}
    </div>`}).join("")}</div></section>`:""}function we(e){let t=String(e?.details||"").trim();return t?`<section class="pm-card pm-more-section pm-proposal-details">
    <div class="pm-card-head">Details</div>
    <div class="markdown-body">${H(t)}</div>
  </section>`:""}function ee(e,t,n="stdout"){let o=String(e||"").trim(),s=o?document.querySelector(`[data-pm-process-output="${C(o)}"]`):null,a=o?document.querySelector(`[data-pm-process-run="${C(o)}"]`):null;if(!s||!a||!t)return;let l=a.getAttribute("data-pm-process-tab")||"combined";if(l!=="combined"&&l!==n)return;let p=s.scrollHeight-s.scrollTop-s.clientHeight<40,i=`${s.textContent==="No output yet."?"":s.textContent}${t}`;s.textContent=i.length>128*1024?`[Older live output hidden; open the saved log for more.]
${i.slice(-128*1024)}`:i,p&&(s.scrollTop=s.scrollHeight)}function te(){if(window.__pmMobileProcessRunLiveInstalled)return;window.__pmMobileProcessRunLiveInstalled=!0;let e=window.wsEventBus||M;e?.on?.("process_run_output",(t={})=>{let n=String(t.run?.runId||t.runId||"").trim();ee(n,String(t.chunk||""),String(t.stream||"stdout"))}),["process_run_started","process_run_update","process_run_exited"].forEach(t=>{e?.on?.(t,(n={})=>{let o=n.run||{},s=String(o.runId||n.runId||"").trim(),a=s?document.querySelector(`[data-pm-process-run="${C(s)}"]`):null;if(!a)return;let l=String(o.state||o.status||"").toLowerCase(),p=a.querySelector(".pm-process-pill"),d=a.querySelector(".pm-process-live-state");p&&l&&(p.textContent=l,p.className=`pm-process-pill ${l}`),d&&(d.textContent=l==="exited"?"completed":"streaming")})})}te();function ne(e,t=120){return`<div class="pm-memory-orbit" aria-hidden="true"><div class="pm-memory-core"></div>${(Array.isArray(e)?e:[]).slice(0,t).map((s,a)=>{let l=Number(s?.degree||0),p=a*137.5*Math.PI/180,d=8+Math.sqrt(a+1)*7.2,i=50+Math.cos(p)*Math.min(d,43),m=50+Math.sin(p)*Math.min(d,43),c=l>6?"#ff8a2a":l>3?"#a78bfa":"#55c4ff";return`<i style="left:${i.toFixed(2)}%;top:${m.toFixed(2)}%;background:${c};"></i>`}).join("")}</div>`}function oe(){let e=document.getElementById("memory-view");if(!e||e.dataset.pmIdsParked==="1")return()=>{};let t=[];return e.querySelectorAll("[id]").forEach(n=>{let o=n.getAttribute("id");!o||!o.startsWith("memory-")||(n.setAttribute("data-pm-original-id",o),n.setAttribute("id",`desktop-${o}`),t.push(n))}),e.dataset.pmIdsParked="1",()=>{t.forEach(n=>{let o=n.getAttribute("data-pm-original-id");o&&(n.setAttribute("id",o),n.removeAttribute("data-pm-original-id"))}),delete e.dataset.pmIdsParked}}function _(){return'<div class="pm-more-skeleton"><span></span><span></span><span></span></div>'}function se(e={}){return Number(e.totalTokens??e.total??0)||0}function re(e={}){return Number(e.modelCalls??e.messages??0)||0}function T(e,t,{retryOnWsOpen:n=!0}={}){if(!e||typeof t!="function")return;let o=!1,s=!1,a=!1,l=typeof e._pmCleanup=="function"?e._pmCleanup:null,p=async()=>{if(!(a||s||o)){s=!0;try{o=await t()!==!1}finally{s=!1}}},d=setTimeout(()=>requestAnimationFrame(p),0),i=()=>{o||setTimeout(p,120)};n&&M?.on?.("ws:open",i),e._pmCleanup=()=>{a=!0,clearTimeout(d),n&&M?.off?.("ws:open",i),l?.()}}function ae(e,{navigate:t}){let n=`<span class="pm-spacer"></span><button class="pm-icon-btn" id="pm-more-refresh" aria-label="Refresh" style="background:var(--pm-surface);border:1px solid var(--pm-border);">${h.refresh}</button>`;e.innerHTML=`
    ${k({title:"More",online:!0,extras:n,hideTitle:!0,hideBrand:!0})}
    <div class="pm-body pm-more-page" id="pm-more-body">
      ${_()}
    </div>
  `,S(e,{});let o=e.querySelector("#pm-more-body"),s=l=>{let p=Array.isArray(l?.audit?.runs)?l.audit.runs:[],d=Array.isArray(l?.memory?.recent)?l.memory.recent:[];o.innerHTML=`
      <button class="pm-more-card pm-more-card-audit" data-route="#mobile/more/audit" type="button">
        <div class="pm-more-card-top">
          <span class="pm-more-icon">${h.clipboard}</span>
          <span><strong>Audit</strong><em>Recent non-main agent runs</em></span>
          <span class="pm-chev">${h.chev}</span>
        </div>
        <div class="pm-run-mini-list">
          ${p.length?p.slice(0,3).map(i=>`
            <span>
              <b>${r(i.kind||i.agentId||"Agent Run")}</b>
              <em>${r(A(i.endedAt||i.startedAt))}</em>
              ${B(i.status)}
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
          ${ne(d,28)}
          <div class="pm-memory-mini-list">
            ${d.length?d.map(i=>`
              <span><b>${r(i.title)}</b><em>${r(i.type)} - ${r(A(i.timestamp))}</em></span>
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
    `,o.querySelectorAll("[data-route]").forEach(i=>i.addEventListener("click",()=>t(i.getAttribute("data-route")))),o.querySelector("#pm-more-purge")?.addEventListener("click",async()=>{L("Refreshing assets\u2026","info");try{await window.pmPurgeCaches?.()}catch{window.location.reload()}}),o.querySelector("#pm-more-repair")?.addEventListener("click",async()=>{if(confirm("Full reset will clear caches, sign this device out of pairing, and reload. Continue?")){try{localStorage.removeItem("pm_device_token"),localStorage.removeItem("pm_device_id"),localStorage.removeItem("pm_force_mobile")}catch{}try{await window.pmPurgeCaches?.()}catch{window.location.reload()}}})};s(null);let a=async()=>{try{return s(await I()),!0}catch(l){return L(`Could not refresh More: ${l.message||""}`,"error"),!1}};e.querySelector("#pm-more-refresh")?.addEventListener("click",a),T(e,a)}function ie(){let e=null;try{e=N?.()}catch{}let t=String(e?.email||e?.user?.email||"").trim(),o=String(e?.name||e?.displayName||e?.user?.name||t.split("@")[0]||"Prometheus").trim().replace(/^@/,"")||"Prometheus",s=t?t.split("@")[0]:o.toLowerCase().replace(/[^a-z0-9]+/g,"");return{name:o,handle:s?`@${s}`:"@local"}}function le(e=""){let t=String(e||"").trim().split(/\s+/).filter(Boolean);return(t.length>=2?`${t[0][0]||""}${t[1][0]||""}`:String(e||"P").slice(0,2)).toUpperCase()||"PM"}function w(e,t){return`<span><b>${r(String(t))}</b><em>${r(e)}</em></span>`}function R(e,t=!1){let n=t?"Loading latest goal\u2026":e?Y(e):"No goals yet",o=t?"Your most recently updated goal will appear here.":e?V(e)||String(e.status||"In progress"):"Main chat goals will appear here once Prometheus records them.",s=e?A(e.updatedAt||e.completedAt||e.createdAt):"";return`
    <section class="pm-hub-profile-section" id="pm-hub-latest-goal">
      <div class="pm-hub-section-head"><strong>Latest goal</strong><span>${r(s)}</span></div>
      <h2>${r(n)}</h2>
      <p>${r(o)}</p>
    </section>
  `}function ce(e,t){let n=Math.max(0,Number(e)||0);if(n<=0)return 0;let o=n/Math.max(1,Number(t)||1);return Math.min(1,.12+.88*Math.sqrt(o))}function pe(e){let t=String(e?.dataset?.date||""),n=Math.max(0,Number(e?.dataset?.tokens||0));if(!t)return;document.getElementById("pm-token-activity-popover")?.remove();let o=document.createElement("div");o.id="pm-token-activity-popover",o.className="pm-token-activity-popover";let s=new Date(`${t}T00:00:00`).toLocaleDateString(void 0,{weekday:"short",month:"short",day:"numeric",year:"numeric"});o.innerHTML=`<strong>${r(s)}</strong><span>${r(b(n))} tokens</span>`,document.body.appendChild(o);let a=e.getBoundingClientRect(),l=8,p=o.offsetWidth||164,d=o.offsetHeight||52,i=a.left+a.width/2-p/2,m=a.top-d-l;m<l&&(m=a.bottom+l),i=Math.max(l,Math.min(i,window.innerWidth-p-l)),m=Math.max(l,Math.min(m,window.innerHeight-d-l)),o.style.left=`${i}px`,o.style.top=`${m}px`}function de(e){let t=Array.from(e?.querySelectorAll?.(".pm-hub-token-cell[data-date]")||[]);if(!t.length)return;let n=null,o=null,s=()=>{o&&clearTimeout(o),o=null,document.getElementById("pm-token-activity-popover")?.remove()},a=i=>{i&&(o&&clearTimeout(o),pe(i))},l=(i,m)=>document.elementFromPoint(i,m)?.closest?.(".pm-hub-token-cell[data-date]"),p=()=>{n=null,window.removeEventListener("pointermove",d,!0),window.removeEventListener("pointerup",p,!0),window.removeEventListener("pointercancel",p,!0),o=setTimeout(s,850)},d=i=>{if(n!==i.pointerId)return;let m=l(i.clientX,i.clientY);m&&a(m)};t.forEach(i=>{i.addEventListener("pointerdown",m=>{m.pointerType==="mouse"&&m.button!==0||(n=m.pointerId,a(i),window.addEventListener("pointermove",d,!0),window.addEventListener("pointerup",p,!0),window.addEventListener("pointercancel",p,!0))}),i.addEventListener("pointerenter",m=>{m.pointerType==="mouse"&&a(i)}),i.addEventListener("pointerleave",m=>{m.pointerType==="mouse"&&n===null&&s()})})}function me(e={}){let t=Array.isArray(e?.daily)?e.daily:[];if(!t.length)return'<div class="pm-hub-token-empty">No token activity recorded yet.</div>';let n=new Date(`${t[0].date}T00:00:00`),o=Number.isFinite(n.getTime())?n.getDay():0,s=t.map(c=>Math.max(0,Number(c.tokens||c.count||0))),a=Math.max(1,...s),l=Math.ceil((o+t.length)/7),p=["S","M","T","W","T","F","S"].map(c=>`<span>${c}</span>`).join(""),d="";for(let c=0;c<o;c++)d+='<i class="empty"></i>';t.forEach(c=>{let u=Math.max(0,Number(c.tokens||c.count||0)),v=`${c.date}: ${b(u)} tokens`,g=u>0?"true":"false",y=ce(u,a).toFixed(3);d+=`<i class="pm-hub-token-cell" data-date="${r(c.date)}" data-tokens="${u}" data-active="${g}" style="--pm-token-alpha:${y}" aria-label="${r(v)}"></i>`});let i=[],m=new Set;return t.forEach((c,u)=>{let[v,g]=String(c.date||"").split("-"),y=`${v}-${g}`;if(!v||!g||m.has(y))return;m.add(y);let f=new Date(`${c.date}T00:00:00`);i.push(`<span style="grid-column:${Math.floor((o+u)/7)+1}">${r(f.toLocaleDateString(void 0,{month:"short"}))}</span>`)}),`
    <div class="pm-hub-token-calendar" style="--pm-token-weeks:${l}">
        <div class="pm-hub-token-labels">${p}</div>
        <div class="pm-hub-token-grid-wrap">
          <div class="pm-hub-token-months">${i.join("")}</div>
          <div class="pm-hub-token-cells">${d}</div>
        </div>
    </div>
  `}async function ue(e,{navigate:t}={}){let n=`<span class="pm-spacer"></span><button class="pm-icon-btn" id="pm-hub-refresh" aria-label="Refresh" style="background:var(--pm-surface);border:1px solid var(--pm-border);">${h.refresh}</button>`;e.innerHTML=`
    ${k({title:"Hub",online:!0,extras:n,hideTitle:!0,hideBrand:!0})}
    <div class="pm-body pm-hub-profile-page" id="pm-hub-body">${_()}</div>
  `,S(e,{}),await O(e,t,"skills");let o=e.querySelector("#pm-hub-body"),s=0,a=async()=>{try{let l=++s;o.innerHTML=_();let p=await E(),d=ie(),i=p.goals[0],m=p.models||{},c=p.tools||{},u=p.tokenActivity||{daily:[],stats:{}},v=u.stats||{},g=Number(v.totalTokens||se(m))||0,y=Number(v.peakTokens||0)||0,f=Number(v.activeDays||c.activeDays||m.activeDays||0)||0,G=Number(v.current??v.currentStreak??c.currentStreak??m.currentStreak??0)||0,W=Number(v.longest??v.longestStreak??c.longestStreak??m.longestStreak??0)||0,z=Number(c.toolCalls||c.total||0)||0,K=Array.isArray(p.topModels)?p.topModels:[],Q=Array.isArray(p.topTools)?p.topTools:[];return o.innerHTML=`
        <section class="pm-hub-profile-hero">
          <div class="pm-hub-avatar">${r(le(d.name))}</div>
          <h1>${r(d.name)}</h1>
          <p><span>${r(d.handle)}</span><span>Prometheus</span></p>
        </section>
        <section class="pm-hub-profile-stats">
          ${w("Lifetime tokens",b(g))}
          ${w("Peak tokens",b(y))}
          ${w("Model calls",b(re(m)))}
          ${w("Current streak",`${G}d`)}
          ${w("Longest streak",`${W}d`)}
        </section>
        <section class="pm-hub-profile-section">
          <div class="pm-hub-section-head">
            <strong>Token activity</strong>
            <span>${r(b(g))} total</span>
          </div>
          ${me(u)}
        </section>
        <section class="pm-hub-profile-columns">
          <div class="pm-hub-profile-section">
            <div class="pm-hub-section-head"><strong>Activity insights</strong></div>
            <div class="pm-hub-insight-list">
              <span><em>Active days</em><b>${r(b(f))}</b></span>
              <span><em>Tool calls</em><b>${r(b(z))}</b></span>
              <span><em>Sessions</em><b>${r(b(c.chatSessions||m.chatSessions||0))}</b></span>
              <span><em>Peak hour</em><b>${r(String(c.peakHour||m.peakHour||"-"))}</b></span>
            </div>
          </div>
          <div class="pm-hub-profile-section">
            <div class="pm-hub-section-head"><strong>Most used models</strong></div>
            <div class="pm-hub-usage-list">
              ${K.slice(0,4).map($=>`<span><b>${r($.name||"Model")}</b><em>${r(b($.tokens||0))} tokens</em></span>`).join("")||"<p>No model usage yet.</p>"}
            </div>
          </div>
        </section>
        ${R(i,p.goalsLoaded===!1)}
        <section class="pm-hub-profile-section">
          <div class="pm-hub-section-head"><strong>Most used tools</strong></div>
          <div class="pm-hub-usage-list">
            ${Q.slice(0,6).map($=>`<span><b>${r($.name||"Tool")}</b><em>${r(b($.count||0))} calls</em></span>`).join("")||"<p>No tool usage yet.</p>"}
          </div>
        </section>
      `,de(o),p.goalsLoaded===!1&&P().then($=>{if(l!==s||!o.isConnected)return;let x=o.querySelector("#pm-hub-latest-goal");x&&(x.outerHTML=R($[0]||null))}).catch(()=>{}),!0}catch(l){return o.innerHTML=`<div class="pm-empty"><div class="pm-empty-icon">${h.target}</div><h2>Could not load Hub</h2><p>${r(l.message||"")}</p></div>`,!1}};e.querySelector("#pm-hub-refresh")?.addEventListener("click",a),T(e,a)}async function ye(e,{navigate:t}){let n=`<span class="pm-spacer"></span><button class="pm-icon-btn" id="pm-audit-refresh" aria-label="Refresh" style="background:var(--pm-surface);border:1px solid var(--pm-border);">${h.refresh}</button>`;e.innerHTML=`
    ${k({title:"Audit",leftIcon:"back",onBack:()=>t("#mobile/more"),online:!0,extras:n,hideTitle:!0,hideBrand:!0})}
    <div class="pm-body pm-more-page" id="pm-audit-body">${_()}</div>
  `,S(e,{onBack:()=>t("#mobile/more")});let o=e.querySelector("#pm-audit-body"),s="",a=[],l=()=>{let d=X(a);o.innerHTML=`
      <div class="pm-audit-filter-row">
        <label>${h.chat}<input id="pm-audit-search" type="search" placeholder="Filter by tool or activity..." value=""></label>
        <button type="button" id="pm-audit-clear">${h.refresh}</button>
      </div>
      <div class="pm-audit-stat-grid">
        ${[["total",d.total],["read",d.read],["edit",d.edit],["delete",d.delete],["type",d.type],["click",d.click],["cmd",d.cmd],["proposal",d.proposal],["approved",d.approved],["rejected",d.rejected],["pending",d.pending]].map(([c,u])=>`<span class="${c}"><b>${r(b(u))}</b><em>${r(String(c).toUpperCase())}</em></span>`).join("")}
      </div>
      ${a.length?`<div class="pm-audit-run-list">${a.slice(0,40).map(c=>{let u=s===c.key,v=Array.isArray(c.tools)?c.tools.slice().sort((y,f)=>String(f.timestamp||"").localeCompare(String(y.timestamp||""))):[],g=J(v);return`<article class="pm-card pm-audit-run-card" data-run-key="${r(c.key)}">
        <div class="pm-audit-run-top">
          <span><strong>${r(A(c.endedAt||c.startedAt).split(",")[0]||"")}</strong><em>${r(new Date(c.endedAt||c.startedAt).toLocaleDateString([],{month:"short",day:"numeric"}))}</em></span>
          <span><strong>${r(c.kind||"Agent Run")}</strong><em>${r(c.agentId||"agent")}</em></span>
          ${B(c.status)}
        </div>
        <p>${v.length} tools - Top activity: ${r(g.map(([y,f])=>`${y} (${f})`).join(", ")||"none")}</p>
        <div class="pm-more-meta-row"><span>${r(c.sessionId||c.key)}</span><span>${u?"Collapse":"Open"}</span></div>
        ${u?`<div class="pm-audit-tool-stream">
          ${v.map(y=>`<div><b>${r(y.toolName||"tool")}</b><em>${r(y.actionType||"event")} - ${r(A(y.timestamp))}</em><span>${r(F(y.toolName,y.actionType).toUpperCase())}</span>${y.error?`<p>${r(String(y.error).slice(0,240))}</p>`:""}</div>`).join("")}
        </div>`:""}
      </article>`}).join("")}</div>`:`<div class="pm-empty"><div class="pm-empty-icon">${h.clipboard}</div><h2>No agent runs yet</h2><p>Non-main agent activity will show up here.</p></div>`}
    `,o.querySelectorAll("[data-run-key]").forEach(c=>c.addEventListener("click",()=>{let u=c.getAttribute("data-run-key")||"";s=s===u?"":u,l()}));let i=o.querySelector("#pm-audit-search"),m=o.querySelector("#pm-audit-clear");i?.addEventListener("input",()=>{let c=String(i.value||"").trim().toLowerCase();o.querySelectorAll(".pm-audit-run-card").forEach(u=>{u.hidden=c&&!u.textContent.toLowerCase().includes(c)})}),m?.addEventListener("click",p)},p=async()=>{try{return o.innerHTML=_(),a=await D(200),l(),!0}catch(d){return o.innerHTML=`<div class="pm-empty"><div class="pm-empty-icon">${h.clipboard}</div><h2>Could not load Audit</h2><p>${r(d.message||"")}</p></div>`,!1}};e.querySelector("#pm-audit-refresh")?.addEventListener("click",p),T(e,p)}async function ve(e,{navigate:t}){let n=oe(),o=`<span class="pm-spacer"></span><button class="pm-icon-btn" type="button" onclick="refreshMemoryGraph(true)" aria-label="Refresh" style="background:var(--pm-surface);border:1px solid var(--pm-border);">${h.refresh}</button>`;e.innerHTML=`
    ${k({title:"Memory Graph",leftIcon:"back",onBack:()=>t("#mobile/more"),online:!0,extras:o,hideTitle:!0,hideBrand:!0})}
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
  `,S(e,{onBack:()=>t("#mobile/more")}),e._pmCleanup=()=>{q(),n()},requestAnimationFrame(()=>j())}async function O(e,t,n="context"){let{api:o}=await import("./api-E6JRTMDQ.js"),{mountContextReview:s}=await import("./context-review-FEXKUOBC.js"),a=document.createElement("button");a.className="pm-btn",a.type="button",a.textContent="Review context & skill evidence";let l=document.createElement("div");l.style.cssText="width:100%;min-width:0",a.onclick=()=>{if(l.dataset.mounted){l.hidden=!l.hidden;return}l.dataset.mounted="1",s(l,{api:o,mobile:!0,navigate:t,initialTab:n})},e.prepend(l),e.prepend(a)}async function Ae(e,{section:t="",navigate:n}){if(t==="hub"){try{n?.("#mobile/hub")}catch{}return ue(e,{navigate:n})}if(t==="audit"||t==="memory"){await(t==="audit"?ye(e,{navigate:n}):ve(e,{navigate:n})),await O(e,n);return}if(t==="overview")return ae(e,{navigate:n});let{renderMobilePluginsPage:o}=await import("./mobile-plugins-page-2QKF2E4Y.js");return o(e,{navigate:n})}export{A as a,fe as b,$e as c,ke as d,Se as e,we as f,_ as g,ue as h,Ae as i};
