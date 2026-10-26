import{N as f,j as T}from"./chunk-MQOVGBQY.js";import{a as k}from"./chunk-35CAQ6TV.js";import{b as I,c as E}from"./chunk-SARLB2WL.js";import{H as m,I as i,O as v,P as h}from"./chunk-5EVPYLUY.js";import{ta as C,va as L,ya as x}from"./chunk-AXH4665B.js";import{a as b}from"./chunk-4RINRH4P.js";function H(e,n=""){let t=Number(e||0);return Number.isFinite(t)?Math.abs(t)>=1e9?`${Math.round(t/1e8)/10}B${n}`:Math.abs(t)>=1e6?`${Math.round(t/1e5)/10}M${n}`:Math.abs(t)>=1e3?`${Math.round(t/100)/10}K${n}`:`${Math.round(t).toLocaleString()}${n}`:n?`0${n}`:"0"}function g(e){if(!e)return"";let n=new Date(e);return Number.isNaN(n.getTime())?"":n.toLocaleString([],{month:"short",day:"numeric",hour:"numeric",minute:"2-digit"})}function j(e){return String(e?.title||e?.goal||e?.userRequest||e?.summary||e?.id||"Latest goal").trim()}function B(e){return String(e?.summary||e?.result||e?.assistantSummary||e?.description||e?.lastAssistantMessage||"").trim()}function M(e){let n=String(e||"").toLowerCase();return["running","pending","executing"].includes(n)?'<span class="pm-pill running">running</span>':["failed","rejected","denied"].includes(n)?'<span class="pm-pill orange">failed</span>':["complete","completed","done","approved","auto"].includes(n)?'<span class="pm-pill active">complete</span>':`<span class="pm-pill gray">${i(n||"unknown")}</span>`}function N(e,n){let t=String(e||"").toLowerCase();return String(n||"").toLowerCase().includes("proposal")||t.includes("proposal")?"proposal":t.includes("delete")||t.includes("remove")?"delete":t.includes("type")||t.includes("fill")?"type":t.includes("click")||t.includes("press")?"click":t.includes("command")||t==="shell"?"cmd":t.includes("write")||t.includes("edit")||t.includes("create")||t.includes("append")?"edit":t.includes("read")||t.includes("list")||t.includes("search")||t.includes("stat")||t.includes("grep")?"read":"other"}function R(e){let n={total:0,read:0,edit:0,delete:0,type:0,click:0,cmd:0,proposal:0,approved:0,rejected:0,pending:0};for(let t of e||[])for(let r of t.tools||[]){n.total++;let o=N(r.toolName,r.actionType);n[o]!==void 0&&n[o]++;let s=String(r.approvalStatus||"").toLowerCase();s==="approved"?n.approved++:s==="rejected"?n.rejected++:s==="pending"&&n.pending++}return n}function F(e,n=3){let t=new Map;for(let r of e||[]){let o=String(r.toolName||"tool");t.set(o,(t.get(o)||0)+1)}return[...t.entries()].sort((r,o)=>o[1]-r[1]).slice(0,n)}function re(e){let n=String(e?.priority||"medium").toLowerCase();return`<span class="pm-proposal-badge ${n==="critical"||n==="high"?"orange":n==="low"?"gray":"blue"}">${i(n.toUpperCase())}</span>`}function oe(e){let n=String(e?.status||"pending").toLowerCase();return n==="pending"?'<span class="pm-proposal-status pending">PENDING</span>':n==="executing"||n==="repairing"?'<span class="pm-proposal-status running">RUNNING</span>':n==="executed"||n==="approved"?'<span class="pm-proposal-status complete">APPROVED</span>':n==="denied"||n==="failed"?'<span class="pm-proposal-status denied">DENIED</span>':`<span class="pm-proposal-status">${i(n.toUpperCase())}</span>`}function se(e,n=2){let t=Array.isArray(e?.affectedFiles)?e.affectedFiles.slice(0,n):[],r=Array.isArray(e?.affectedFiles)?e.affectedFiles.length-t.length:0,o=t.map(s=>`<span>${i(s?.action||"touch")}: ${i(s?.path||"")}</span>`);return r>0&&o.push(`<span>+${r} more</span>`),o.length?`<div class="pm-proposal-files">${o.join("")}</div>`:""}function P(e,n){let t=String(n?.status||n?.state||"").trim().toLowerCase();if(t)return t.replace(/\s+/g,"_");let r=String(e?.status||"").trim().toLowerCase();return["approved","executing","repairing","executed"].includes(r)?"approved":"pending"}function U(e,n){return n?.approved===!0||n?.isApproved===!0||P(e,n)==="approved"}function ae(e){let n=Array.isArray(e?.executionSteps)?e.executionSteps:[];return n.length?`<section class="pm-card pm-more-section"><div class="pm-card-head">Approved Execution Steps</div><div class="pm-proposal-steps">${n.map((t,r)=>{let o=String(t?.title||t?.description||`Step ${r+1}`),s=String(t?.kind||"").trim(),a=String(t?.successCriteria||t?.success_criteria||"").trim(),p=P(e,t),l=U(e,t),c=p.replace(/[^a-z0-9_-]/g,"_");return`<div class="pm-proposal-step ${l?"is-approved":""} is-${c}" data-step-status="${i(p)}">
      <b>${r+1}</b>
      <span><span class="pm-proposal-step-title">${i(o)}</span>${a?`<em>Success: ${i(a)}</em>`:""}</span>
      ${s?`<small>${i(s.toUpperCase())}</small>`:""}
    </div>`}).join("")}</div></section>`:""}function ie(e){let n=String(e?.details||"").trim();return n?`<section class="pm-card pm-more-section pm-proposal-details">
    <div class="pm-card-head">Details</div>
    <div class="markdown-body">${T(n)}</div>
  </section>`:""}function G(e,n,t="stdout"){let r=String(e||"").trim(),o=r?document.querySelector(`[data-pm-process-output="${f(r)}"]`):null,s=r?document.querySelector(`[data-pm-process-run="${f(r)}"]`):null;if(!o||!s||!n)return;let a=s.getAttribute("data-pm-process-tab")||"combined";if(a!=="combined"&&a!==t)return;let p=o.scrollHeight-o.scrollTop-o.clientHeight<40,c=`${o.textContent==="No output yet."?"":o.textContent}${n}`;o.textContent=c.length>128*1024?`[Older live output hidden; open the saved log for more.]
${c.slice(-128*1024)}`:c,p&&(o.scrollTop=o.scrollHeight)}function O(){if(window.__pmMobileProcessRunLiveInstalled)return;window.__pmMobileProcessRunLiveInstalled=!0;let e=window.wsEventBus||b;e?.on?.("process_run_output",(n={})=>{let t=String(n.run?.runId||n.runId||"").trim();G(t,String(n.chunk||""),String(n.stream||"stdout"))}),["process_run_started","process_run_update","process_run_exited"].forEach(n=>{e?.on?.(n,(t={})=>{let r=t.run||{},o=String(r.runId||t.runId||"").trim(),s=o?document.querySelector(`[data-pm-process-run="${f(o)}"]`):null;if(!s)return;let a=String(r.state||r.status||"").toLowerCase(),p=s.querySelector(".pm-process-pill"),l=s.querySelector(".pm-process-live-state");p&&a&&(p.textContent=a,p.className=`pm-process-pill ${a}`),l&&(l.textContent=a==="exited"?"completed":"streaming")})})}O();function W(e,n=120){return`<div class="pm-memory-orbit" aria-hidden="true"><div class="pm-memory-core"></div>${(Array.isArray(e)?e:[]).slice(0,n).map((o,s)=>{let a=Number(o?.degree||0),p=s*137.5*Math.PI/180,l=8+Math.sqrt(s+1)*7.2,c=50+Math.cos(p)*Math.min(l,43),$=50+Math.sin(p)*Math.min(l,43),d=a>6?"#ff8a2a":a>3?"#a78bfa":"#55c4ff";return`<i style="left:${c.toFixed(2)}%;top:${$.toFixed(2)}%;background:${d};"></i>`}).join("")}</div>`}function z(){let e=document.getElementById("memory-view");if(!e||e.dataset.pmIdsParked==="1")return()=>{};let n=[];return e.querySelectorAll("[id]").forEach(t=>{let r=t.getAttribute("id");!r||!r.startsWith("memory-")||(t.setAttribute("data-pm-original-id",r),t.setAttribute("id",`desktop-${r}`),n.push(t))}),e.dataset.pmIdsParked="1",()=>{n.forEach(t=>{let r=t.getAttribute("data-pm-original-id");r&&(t.setAttribute("id",r),t.removeAttribute("data-pm-original-id"))}),delete e.dataset.pmIdsParked}}function _(){return'<div class="pm-more-skeleton"><span></span><span></span><span></span></div>'}function D(e,n,{retryOnWsOpen:t=!0}={}){if(!e||typeof n!="function")return;let r=!1,o=!1,s=!1,a=typeof e._pmCleanup=="function"?e._pmCleanup:null,p=async()=>{if(!(s||o||r)){o=!0;try{r=await n()!==!1}finally{o=!1}}},l=setTimeout(()=>requestAnimationFrame(p),0),c=()=>{r||setTimeout(p,120)};t&&b?.on?.("ws:open",c),e._pmCleanup=()=>{s=!0,clearTimeout(l),t&&b?.off?.("ws:open",c),a?.()}}function K(e,{navigate:n}){let t=`<span class="pm-spacer"></span><button class="pm-icon-btn" id="pm-more-refresh" aria-label="Refresh" style="background:var(--pm-surface);border:1px solid var(--pm-border);">${m.refresh}</button>`;e.innerHTML=`
    ${v({title:"More",online:!0,extras:t,hideTitle:!0,hideBrand:!0})}
    <div class="pm-body pm-more-page" id="pm-more-body">
      ${_()}
    </div>
  `,h(e,{});let r=e.querySelector("#pm-more-body"),o=a=>{let p=Array.isArray(a?.audit?.runs)?a.audit.runs:[],l=Array.isArray(a?.memory?.recent)?a.memory.recent:[];r.innerHTML=`
      <button class="pm-more-card pm-more-card-audit" data-route="#mobile/more/audit" type="button">
        <div class="pm-more-card-top">
          <span class="pm-more-icon">${m.clipboard}</span>
          <span><strong>Audit</strong><em>Recent non-main agent runs</em></span>
          <span class="pm-chev">${m.chev}</span>
        </div>
        <div class="pm-run-mini-list">
          ${p.length?p.slice(0,3).map(c=>`
            <span>
              <b>${i(c.kind||c.agentId||"Agent Run")}</b>
              <em>${i(g(c.endedAt||c.startedAt))}</em>
              ${M(c.status)}
            </span>
          `).join(""):"<p>No agent runs recorded yet.</p>"}
        </div>
      </button>

      <button class="pm-more-card pm-more-card-memory" data-route="#mobile/more/memory" type="button">
        <div class="pm-more-card-top">
          <span class="pm-more-icon">${m.brain}</span>
          <span><strong>Memory</strong><em>Latest graph additions</em></span>
          <span class="pm-chev">${m.chev}</span>
        </div>
        <div class="pm-memory-mini">
          ${W(l,28)}
          <div class="pm-memory-mini-list">
            ${l.length?l.map(c=>`
              <span><b>${i(c.title)}</b><em>${i(c.type)} - ${i(g(c.timestamp))}</em></span>
            `).join(""):"<p>No non-chat memory graph items yet.</p>"}
          </div>
        </div>
      </button>

      <div class="pm-more-card" style="cursor:default;">
        <div class="pm-more-card-top">
          <span class="pm-more-icon">${m.refresh}</span>
          <span><strong>App health</strong><em>Force a fresh asset reload if the app feels stuck</em></span>
        </div>
        <div style="display:flex;flex-direction:column;gap:8px;padding-top:6px;">
          <button class="pm-btn ghost" id="pm-more-purge" type="button" style="justify-content:center;">\u21BB Reload latest assets</button>
          <button class="pm-btn ghost" id="pm-more-repair" type="button" style="justify-content:center;color:var(--pm-red);">\u{1F691} Full reset (re-pair required)</button>
          <span style="font-size:11px;color:var(--pm-muted);line-height:1.5;">Use this if a refresh sends you to the desktop UI, scanning a QR shows the desktop site, or actions stop working after a gateway restart.</span>
        </div>
      </div>
    `,r.querySelectorAll("[data-route]").forEach(c=>c.addEventListener("click",()=>n(c.getAttribute("data-route")))),r.querySelector("#pm-more-purge")?.addEventListener("click",async()=>{k("Refreshing assets\u2026","info");try{await window.pmPurgeCaches?.()}catch{window.location.reload()}}),r.querySelector("#pm-more-repair")?.addEventListener("click",async()=>{if(confirm("Full reset will clear caches, sign this device out of pairing, and reload. Continue?")){try{localStorage.removeItem("pm_device_token"),localStorage.removeItem("pm_device_id"),localStorage.removeItem("pm_force_mobile")}catch{}try{await window.pmPurgeCaches?.()}catch{window.location.reload()}}})};o(null);let s=async()=>{try{return o(await C()),!0}catch(a){return k(`Could not refresh More: ${a.message||""}`,"error"),!1}};e.querySelector("#pm-more-refresh")?.addEventListener("click",s),D(e,s)}function A(e,{loading:n=!1,error:t=""}={}){return n?'<div class="hub-goals-state" role="status">Loading goals\u2026</div>':t?`<div class="hub-goals-state error" role="alert">Unable to load goals. ${i(t)}</div>`:e.length?`<div class="hub-achievements-grid" aria-label="Goals, ${e.length} total">${e.slice(0,20).map(r=>{let o=B(r);return`<article class="hub-goal-card"><div class="hub-goal-title">${i(j(r))}</div>${o?`<div class="hub-goal-body">${i(o.slice(0,240))}</div>`:""}<div class="hub-goal-meta">${M(r?.status)} ${i(g(r?.updatedAt||r?.createdAt))}</div></article>`}).join("")}</div>`:'<div class="hub-goals-state" role="status">No main-chat goals yet.</div>'}async function Q(e,{navigate:n}={}){if(e.innerHTML=`${v({title:"Hub",online:!0})}<div class="pm-body pm-hub-analytics"><section id="hub-goals" class="hub-section" aria-label="Goals"><div class="hub-goals-header"><div class="hub-section-title">Goals</div></div><div id="hub-goals-body">${A([],{loading:!0})}</div></section><section id="hub-usage" class="hub-usage" aria-label="Usage analytics"></section></div>`,h(e,{}),!document.querySelector("link[data-hub-analytics]")){let o=document.createElement("link");o.rel="stylesheet",o.href="/src/styles/hub.css",o.dataset.hubAnalytics="true",document.head.appendChild(o)}let t=e.querySelector("#hub-goals-body");L().then(o=>{t?.isConnected&&(t.innerHTML=A(o))}).catch(o=>{t?.isConnected&&(t.innerHTML=A([],{error:o?.message||String(o)}))});let{activateHubUsage:r}=await import("./HubUsage-LWEUPSP2.js");e.isConnected&&r()}async function Y(e,{navigate:n}){let t=`<span class="pm-spacer"></span><button class="pm-icon-btn" id="pm-audit-refresh" aria-label="Refresh" style="background:var(--pm-surface);border:1px solid var(--pm-border);">${m.refresh}</button>`;e.innerHTML=`
    ${v({title:"Audit",leftIcon:"back",onBack:()=>n("#mobile/more"),online:!0,extras:t,hideTitle:!0,hideBrand:!0})}
    <div class="pm-body pm-more-page" id="pm-audit-body">${_()}</div>
  `,h(e,{onBack:()=>n("#mobile/more")});let r=e.querySelector("#pm-audit-body"),o="",s=[],a=()=>{let l=R(s);r.innerHTML=`
      <div class="pm-audit-filter-row">
        <label>${m.chat}<input id="pm-audit-search" type="search" placeholder="Filter by tool or activity..." value=""></label>
        <button type="button" id="pm-audit-clear">${m.refresh}</button>
      </div>
      <div class="pm-audit-stat-grid">
        ${[["total",l.total],["read",l.read],["edit",l.edit],["delete",l.delete],["type",l.type],["click",l.click],["cmd",l.cmd],["proposal",l.proposal],["approved",l.approved],["rejected",l.rejected],["pending",l.pending]].map(([d,y])=>`<span class="${d}"><b>${i(H(y))}</b><em>${i(String(d).toUpperCase())}</em></span>`).join("")}
      </div>
      ${s.length?`<div class="pm-audit-run-list">${s.slice(0,40).map(d=>{let y=o===d.key,w=Array.isArray(d.tools)?d.tools.slice().sort((u,S)=>String(S.timestamp||"").localeCompare(String(u.timestamp||""))):[],q=F(w);return`<article class="pm-card pm-audit-run-card" data-run-key="${i(d.key)}">
        <div class="pm-audit-run-top">
          <span><strong>${i(g(d.endedAt||d.startedAt).split(",")[0]||"")}</strong><em>${i(new Date(d.endedAt||d.startedAt).toLocaleDateString([],{month:"short",day:"numeric"}))}</em></span>
          <span><strong>${i(d.kind||"Agent Run")}</strong><em>${i(d.agentId||"agent")}</em></span>
          ${M(d.status)}
        </div>
        <p>${w.length} tools - Top activity: ${i(q.map(([u,S])=>`${u} (${S})`).join(", ")||"none")}</p>
        <div class="pm-more-meta-row"><span>${i(d.sessionId||d.key)}</span><span>${y?"Collapse":"Open"}</span></div>
        ${y?`<div class="pm-audit-tool-stream">
          ${w.map(u=>`<div><b>${i(u.toolName||"tool")}</b><em>${i(u.actionType||"event")} - ${i(g(u.timestamp))}</em><span>${i(N(u.toolName,u.actionType).toUpperCase())}</span>${u.error?`<p>${i(String(u.error).slice(0,240))}</p>`:""}</div>`).join("")}
        </div>`:""}
      </article>`}).join("")}</div>`:`<div class="pm-empty"><div class="pm-empty-icon">${m.clipboard}</div><h2>No agent runs yet</h2><p>Non-main agent activity will show up here.</p></div>`}
    `,r.querySelectorAll("[data-run-key]").forEach(d=>d.addEventListener("click",()=>{let y=d.getAttribute("data-run-key")||"";o=o===y?"":y,a()}));let c=r.querySelector("#pm-audit-search"),$=r.querySelector("#pm-audit-clear");c?.addEventListener("input",()=>{let d=String(c.value||"").trim().toLowerCase();r.querySelectorAll(".pm-audit-run-card").forEach(y=>{y.hidden=d&&!y.textContent.toLowerCase().includes(d)})}),$?.addEventListener("click",p)},p=async()=>{try{return r.innerHTML=_(),s=await x(200),a(),!0}catch(l){return r.innerHTML=`<div class="pm-empty"><div class="pm-empty-icon">${m.clipboard}</div><h2>Could not load Audit</h2><p>${i(l.message||"")}</p></div>`,!1}};e.querySelector("#pm-audit-refresh")?.addEventListener("click",p),D(e,p)}async function V(e,{navigate:n}){let t=z(),r=`<span class="pm-spacer"></span><button class="pm-icon-btn" type="button" onclick="refreshMemoryGraph(true)" aria-label="Refresh" style="background:var(--pm-surface);border:1px solid var(--pm-border);">${m.refresh}</button>`;e.innerHTML=`
    ${v({title:"Memory Graph",leftIcon:"back",onBack:()=>n("#mobile/more"),online:!0,extras:r,hideTitle:!0,hideBrand:!0})}
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
  `,h(e,{onBack:()=>n("#mobile/more")}),e._pmCleanup=()=>{I(),t()},requestAnimationFrame(()=>E())}async function X(e,n,t="context"){let{api:r}=await import("./api-E6JRTMDQ.js"),{mountContextReview:o}=await import("./context-review-FEXKUOBC.js"),s=document.createElement("button");s.className="pm-evidence-launch",s.type="button",s.textContent=t==="skills"?"Skill evidence":"Context evidence",s.title="Review context & skill evidence";let a=document.createElement("div");a.style.cssText="width:100%;min-width:0",s.onclick=()=>{if(a.dataset.mounted){a.hidden=!a.hidden;return}a.dataset.mounted="1",o(a,{api:r,mobile:!0,navigate:n,initialTab:t})};let p=e.querySelector(".pm-title-row")||e.querySelector(".pm-header");p?p.after(s,a):(e.prepend(a),e.prepend(s))}async function le(e,{section:n="",navigate:t}){if(n==="hub"){try{t?.("#mobile/hub")}catch{}return Q(e,{navigate:t})}if(n==="audit"||n==="memory"){await(n==="audit"?Y(e,{navigate:t}):V(e,{navigate:t})),await X(e,t);return}if(n==="overview")return K(e,{navigate:t});let{renderMobilePluginsPage:r}=await import("./mobile-plugins-page-G4TAPI7X.js");return r(e,{navigate:t})}export{g as a,re as b,oe as c,se as d,ae as e,ie as f,_ as g,Q as h,le as i};
