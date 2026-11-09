import{b as L,c as x}from"./chunk-NRSWEN5F.js";import{N as f,j as M}from"./chunk-FFNDGXMJ.js";import{a as k}from"./chunk-35CAQ6TV.js";import{H as m,I as p,O as h,P as g}from"./chunk-GJ6VRBEH.js";import{ta as _,ya as C}from"./chunk-SM4JVQBB.js";import{a as b}from"./chunk-YF7XQ7HF.js";function D(n,e=""){let t=Number(n||0);return Number.isFinite(t)?Math.abs(t)>=1e9?`${Math.round(t/1e8)/10}B${e}`:Math.abs(t)>=1e6?`${Math.round(t/1e5)/10}M${e}`:Math.abs(t)>=1e3?`${Math.round(t/100)/10}K${e}`:`${Math.round(t).toLocaleString()}${e}`:e?`0${e}`:"0"}function $(n){if(!n)return"";let e=new Date(n);return Number.isNaN(e.getTime())?"":e.toLocaleString([],{month:"short",day:"numeric",hour:"numeric",minute:"2-digit"})}function T(n){let e=String(n||"").toLowerCase();return["running","pending","executing"].includes(e)?'<span class="pm-pill running">running</span>':["failed","rejected","denied"].includes(e)?'<span class="pm-pill orange">failed</span>':["complete","completed","done","approved","auto"].includes(e)?'<span class="pm-pill active">complete</span>':`<span class="pm-pill gray">${p(e||"unknown")}</span>`}function I(n,e){let t=String(n||"").toLowerCase();return String(e||"").toLowerCase().includes("proposal")||t.includes("proposal")?"proposal":t.includes("delete")||t.includes("remove")?"delete":t.includes("type")||t.includes("fill")?"type":t.includes("click")||t.includes("press")?"click":t.includes("command")||t==="shell"?"cmd":t.includes("write")||t.includes("edit")||t.includes("create")||t.includes("append")?"edit":t.includes("read")||t.includes("list")||t.includes("search")||t.includes("stat")||t.includes("grep")?"read":"other"}function q(n){let e={total:0,read:0,edit:0,delete:0,type:0,click:0,cmd:0,proposal:0,approved:0,rejected:0,pending:0};for(let t of n||[])for(let r of t.tools||[]){e.total++;let o=I(r.toolName,r.actionType);e[o]!==void 0&&e[o]++;let s=String(r.approvalStatus||"").toLowerCase();s==="approved"?e.approved++:s==="rejected"?e.rejected++:s==="pending"&&e.pending++}return e}function H(n,e=3){let t=new Map;for(let r of n||[]){let o=String(r.toolName||"tool");t.set(o,(t.get(o)||0)+1)}return[...t.entries()].sort((r,o)=>o[1]-r[1]).slice(0,e)}function Z(n){let e=String(n?.priority||"medium").toLowerCase();return`<span class="pm-proposal-badge ${e==="critical"||e==="high"?"orange":e==="low"?"gray":"blue"}">${p(e.toUpperCase())}</span>`}function ee(n){let e=String(n?.status||"pending").toLowerCase();return e==="pending"?'<span class="pm-proposal-status pending">PENDING</span>':e==="executing"||e==="repairing"?'<span class="pm-proposal-status running">RUNNING</span>':e==="executed"||e==="approved"?'<span class="pm-proposal-status complete">APPROVED</span>':e==="denied"||e==="failed"?'<span class="pm-proposal-status denied">DENIED</span>':`<span class="pm-proposal-status">${p(e.toUpperCase())}</span>`}function te(n,e=2){let t=Array.isArray(n?.affectedFiles)?n.affectedFiles.slice(0,e):[],r=Array.isArray(n?.affectedFiles)?n.affectedFiles.length-t.length:0,o=t.map(s=>`<span>${p(s?.action||"touch")}: ${p(s?.path||"")}</span>`);return r>0&&o.push(`<span>+${r} more</span>`),o.length?`<div class="pm-proposal-files">${o.join("")}</div>`:""}function E(n,e){let t=String(e?.status||e?.state||"").trim().toLowerCase();if(t)return t.replace(/\s+/g,"_");let r=String(n?.status||"").trim().toLowerCase();return["approved","executing","repairing","executed"].includes(r)?"approved":"pending"}function j(n,e){return e?.approved===!0||e?.isApproved===!0||E(n,e)==="approved"}function ne(n){let e=Array.isArray(n?.executionSteps)?n.executionSteps:[];return e.length?`<section class="pm-card pm-more-section"><div class="pm-card-head">Approved Execution Steps</div><div class="pm-proposal-steps">${e.map((t,r)=>{let o=String(t?.title||t?.description||`Step ${r+1}`),s=String(t?.kind||"").trim(),a=String(t?.successCriteria||t?.success_criteria||"").trim(),d=E(n,t),c=j(n,t),l=d.replace(/[^a-z0-9_-]/g,"_");return`<div class="pm-proposal-step ${c?"is-approved":""} is-${l}" data-step-status="${p(d)}">
      <b>${r+1}</b>
      <span><span class="pm-proposal-step-title">${p(o)}</span>${a?`<em>Success: ${p(a)}</em>`:""}</span>
      ${s?`<small>${p(s.toUpperCase())}</small>`:""}
    </div>`}).join("")}</div></section>`:""}function re(n){let e=String(n?.details||"").trim();return e?`<section class="pm-card pm-more-section pm-proposal-details">
    <div class="pm-card-head">Details</div>
    <div class="markdown-body">${M(e)}</div>
  </section>`:""}function R(n,e,t="stdout"){let r=String(n||"").trim(),o=r?document.querySelector(`[data-pm-process-output="${f(r)}"]`):null,s=r?document.querySelector(`[data-pm-process-run="${f(r)}"]`):null;if(!o||!s||!e)return;let a=s.getAttribute("data-pm-process-tab")||"combined";if(a!=="combined"&&a!==t)return;let d=o.scrollHeight-o.scrollTop-o.clientHeight<40,l=`${o.textContent==="No output yet."?"":o.textContent}${e}`;o.textContent=l.length>128*1024?`[Older live output hidden; open the saved log for more.]
${l.slice(-128*1024)}`:l,d&&(o.scrollTop=o.scrollHeight)}function U(){if(window.__pmMobileProcessRunLiveInstalled)return;window.__pmMobileProcessRunLiveInstalled=!0;let n=window.wsEventBus||b;n?.on?.("process_run_output",(e={})=>{let t=String(e.run?.runId||e.runId||"").trim();R(t,String(e.chunk||""),String(e.stream||"stdout"))}),["process_run_started","process_run_update","process_run_exited"].forEach(e=>{n?.on?.(e,(t={})=>{let r=t.run||{},o=String(r.runId||t.runId||"").trim(),s=o?document.querySelector(`[data-pm-process-run="${f(o)}"]`):null;if(!s)return;let a=String(r.state||r.status||"").toLowerCase(),d=s.querySelector(".pm-process-pill"),c=s.querySelector(".pm-process-live-state");d&&a&&(d.textContent=a,d.className=`pm-process-pill ${a}`),c&&(c.textContent=a==="exited"?"completed":"streaming")})})}U();function B(n,e=120){return`<div class="pm-memory-orbit" aria-hidden="true"><div class="pm-memory-core"></div>${(Array.isArray(n)?n:[]).slice(0,e).map((o,s)=>{let a=Number(o?.degree||0),d=s*137.5*Math.PI/180,c=8+Math.sqrt(s+1)*7.2,l=50+Math.cos(d)*Math.min(c,43),v=50+Math.sin(d)*Math.min(c,43),i=a>6?"#ff8a2a":a>3?"#a78bfa":"#55c4ff";return`<i style="left:${l.toFixed(2)}%;top:${v.toFixed(2)}%;background:${i};"></i>`}).join("")}</div>`}function F(){let n=document.getElementById("memory-view");if(!n||n.dataset.pmIdsParked==="1")return()=>{};let e=[];return n.querySelectorAll("[id]").forEach(t=>{let r=t.getAttribute("id");!r||!r.startsWith("memory-")||(t.setAttribute("data-pm-original-id",r),t.setAttribute("id",`desktop-${r}`),e.push(t))}),n.dataset.pmIdsParked="1",()=>{e.forEach(t=>{let r=t.getAttribute("data-pm-original-id");r&&(t.setAttribute("id",r),t.removeAttribute("data-pm-original-id"))}),delete n.dataset.pmIdsParked}}function A(){return'<div class="pm-more-skeleton"><span></span><span></span><span></span></div>'}function N(n,e,{retryOnWsOpen:t=!0}={}){if(!n||typeof e!="function")return;let r=!1,o=!1,s=!1,a=typeof n._pmCleanup=="function"?n._pmCleanup:null,d=async()=>{if(!(s||o||r)){o=!0;try{r=await e()!==!1}finally{o=!1}}},c=setTimeout(()=>requestAnimationFrame(d),0),l=()=>{r||setTimeout(d,120)};t&&b?.on?.("ws:open",l),n._pmCleanup=()=>{s=!0,clearTimeout(c),t&&b?.off?.("ws:open",l),a?.()}}function O(n,{navigate:e}){let t=`<span class="pm-spacer"></span><button class="pm-icon-btn" id="pm-more-refresh" aria-label="Refresh" style="background:var(--pm-surface);border:1px solid var(--pm-border);">${m.refresh}</button>`;n.innerHTML=`
    ${h({title:"More",online:!0,extras:t,hideTitle:!0,hideBrand:!0})}
    <div class="pm-body pm-more-page" id="pm-more-body">
      ${A()}
    </div>
  `,g(n,{});let r=n.querySelector("#pm-more-body"),o=a=>{let d=Array.isArray(a?.audit?.runs)?a.audit.runs:[],c=Array.isArray(a?.memory?.recent)?a.memory.recent:[];r.innerHTML=`
      <button class="pm-more-card pm-more-card-audit" data-route="#mobile/more/audit" type="button">
        <div class="pm-more-card-top">
          <span class="pm-more-icon">${m.clipboard}</span>
          <span><strong>Audit</strong><em>Recent non-main agent runs</em></span>
          <span class="pm-chev">${m.chev}</span>
        </div>
        <div class="pm-run-mini-list">
          ${d.length?d.slice(0,3).map(l=>`
            <span>
              <b>${p(l.kind||l.agentId||"Agent Run")}</b>
              <em>${p($(l.endedAt||l.startedAt))}</em>
              ${T(l.status)}
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
          ${B(c,28)}
          <div class="pm-memory-mini-list">
            ${c.length?c.map(l=>`
              <span><b>${p(l.title)}</b><em>${p(l.type)} - ${p($(l.timestamp))}</em></span>
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
    `,r.querySelectorAll("[data-route]").forEach(l=>l.addEventListener("click",()=>e(l.getAttribute("data-route")))),r.querySelector("#pm-more-purge")?.addEventListener("click",async()=>{k("Refreshing assets\u2026","info");try{await window.pmPurgeCaches?.()}catch{window.location.reload()}}),r.querySelector("#pm-more-repair")?.addEventListener("click",async()=>{if(confirm("Full reset will clear caches, sign this device out of pairing, and reload. Continue?")){try{localStorage.removeItem("pm_device_token"),localStorage.removeItem("pm_device_id"),localStorage.removeItem("pm_force_mobile")}catch{}try{await window.pmPurgeCaches?.()}catch{window.location.reload()}}})};o(null);let s=async()=>{try{return o(await _()),!0}catch(a){return k(`Could not refresh More: ${a.message||""}`,"error"),!1}};n.querySelector("#pm-more-refresh")?.addEventListener("click",s),N(n,s)}async function W(n,{navigate:e}={}){if(n.innerHTML=`${h({title:"Hub",online:!0})}<div class="pm-body pm-hub-analytics"><section class="settings-models-usage pm-hub-limits" aria-label="Usage & Limits"><div class="settings-models-usage-title">Usage & Limits<button type="button" class="hub-providers-refresh" data-limits-refresh aria-label="Refresh account limits">\u21BB</button></div><div data-limits-status role="status"></div><div class="hub-providers-grid" data-limits-grid><div class="hub-empty">Loading account limits\u2026</div></div></section><section id="hub-usage" class="hub-usage" aria-label="Usage analytics"></section></div>`,g(n,{}),!document.querySelector("link[data-hub-analytics]")){let i=document.createElement("link");i.rel="stylesheet",i.href="/src/styles/hub.css",i.dataset.hubAnalytics="true",document.head.appendChild(i)}let[{activateHubUsage:t},{renderProviderUsageCard:r},{api:o}]=await Promise.all([import("./HubUsage-C7UBHC3X.js"),import("./provider-usage-card-JIULXAWY.js"),import("./api-EIA7WHBO.js")]);if(!n.isConnected)return;let s=n.querySelector("[data-limits-grid]"),a=n.querySelector("[data-limits-status]"),d=!1,c=!1,l=async()=>{if(!(d||!s.isConnected)){d=!0;try{let i=await o("/api/usage/limits",{timeoutMs:3e4});if(i?.success===!1||!Array.isArray(i?.providers))throw new Error("Usage unavailable");if(!s.isConnected)return;s.innerHTML=i.providers.map(r).join("")||'<div class="hub-empty">No connected account usage yet. Connect an account in Settings \u2192 Models.</div>',c=!0,a.textContent=""}catch{if(!s.isConnected)return;c||(s.innerHTML=""),a.textContent=`Couldn't refresh account limits. ${c?"Showing previous limits. ":""}Your connections are unaffected. Tap refresh to retry.`}finally{d=!1}}};n.querySelector("[data-limits-refresh]").onclick=l,l();let v=setInterval(()=>{if(!s.isConnected){clearInterval(v);return}document.hidden||l()},3e4);t()}async function z(n,{navigate:e}){let t=`<span class="pm-spacer"></span><button class="pm-icon-btn" id="pm-audit-refresh" aria-label="Refresh" style="background:var(--pm-surface);border:1px solid var(--pm-border);">${m.refresh}</button>`;n.innerHTML=`
    ${h({title:"Audit",leftIcon:"back",onBack:()=>e("#mobile/more"),online:!0,extras:t,hideTitle:!0,hideBrand:!0})}
    <div class="pm-body pm-more-page" id="pm-audit-body">${A()}</div>
  `,g(n,{onBack:()=>e("#mobile/more")});let r=n.querySelector("#pm-audit-body"),o="",s=[],a=()=>{let c=q(s);r.innerHTML=`
      <div class="pm-audit-filter-row">
        <label>${m.chat}<input id="pm-audit-search" type="search" placeholder="Filter by tool or activity..." value=""></label>
        <button type="button" id="pm-audit-clear">${m.refresh}</button>
      </div>
      <div class="pm-audit-stat-grid">
        ${[["total",c.total],["read",c.read],["edit",c.edit],["delete",c.delete],["type",c.type],["click",c.click],["cmd",c.cmd],["proposal",c.proposal],["approved",c.approved],["rejected",c.rejected],["pending",c.pending]].map(([i,y])=>`<span class="${i}"><b>${p(D(y))}</b><em>${p(String(i).toUpperCase())}</em></span>`).join("")}
      </div>
      ${s.length?`<div class="pm-audit-run-list">${s.slice(0,40).map(i=>{let y=o===i.key,w=Array.isArray(i.tools)?i.tools.slice().sort((u,S)=>String(S.timestamp||"").localeCompare(String(u.timestamp||""))):[],P=H(w);return`<article class="pm-card pm-audit-run-card" data-run-key="${p(i.key)}">
        <div class="pm-audit-run-top">
          <span><strong>${p($(i.endedAt||i.startedAt).split(",")[0]||"")}</strong><em>${p(new Date(i.endedAt||i.startedAt).toLocaleDateString([],{month:"short",day:"numeric"}))}</em></span>
          <span><strong>${p(i.kind||"Agent Run")}</strong><em>${p(i.agentId||"agent")}</em></span>
          ${T(i.status)}
        </div>
        <p>${w.length} tools - Top activity: ${p(P.map(([u,S])=>`${u} (${S})`).join(", ")||"none")}</p>
        <div class="pm-more-meta-row"><span>${p(i.sessionId||i.key)}</span><span>${y?"Collapse":"Open"}</span></div>
        ${y?`<div class="pm-audit-tool-stream">
          ${w.map(u=>`<div><b>${p(u.toolName||"tool")}</b><em>${p(u.actionType||"event")} - ${p($(u.timestamp))}</em><span>${p(I(u.toolName,u.actionType).toUpperCase())}</span>${u.error?`<p>${p(String(u.error).slice(0,240))}</p>`:""}</div>`).join("")}
        </div>`:""}
      </article>`}).join("")}</div>`:`<div class="pm-empty"><div class="pm-empty-icon">${m.clipboard}</div><h2>No agent runs yet</h2><p>Non-main agent activity will show up here.</p></div>`}
    `,r.querySelectorAll("[data-run-key]").forEach(i=>i.addEventListener("click",()=>{let y=i.getAttribute("data-run-key")||"";o=o===y?"":y,a()}));let l=r.querySelector("#pm-audit-search"),v=r.querySelector("#pm-audit-clear");l?.addEventListener("input",()=>{let i=String(l.value||"").trim().toLowerCase();r.querySelectorAll(".pm-audit-run-card").forEach(y=>{y.hidden=i&&!y.textContent.toLowerCase().includes(i)})}),v?.addEventListener("click",d)},d=async()=>{try{return r.innerHTML=A(),s=await C(200),a(),!0}catch(c){return r.innerHTML=`<div class="pm-empty"><div class="pm-empty-icon">${m.clipboard}</div><h2>Could not load Audit</h2><p>${p(c.message||"")}</p></div>`,!1}};n.querySelector("#pm-audit-refresh")?.addEventListener("click",d),N(n,d)}async function G(n,{navigate:e}){let t=F(),r=`<span class="pm-spacer"></span><button class="pm-icon-btn" type="button" onclick="refreshMemoryGraph(true)" aria-label="Refresh" style="background:var(--pm-surface);border:1px solid var(--pm-border);">${m.refresh}</button>`;n.innerHTML=`
    ${h({title:"Memory Graph",leftIcon:"back",onBack:()=>e("#mobile/more"),online:!0,extras:r,hideTitle:!0,hideBrand:!0})}
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
  `,g(n,{onBack:()=>e("#mobile/more")}),n._pmCleanup=()=>{L(),t()},requestAnimationFrame(()=>x())}async function K(n,e,t="context"){let{api:r}=await import("./api-EIA7WHBO.js"),{mountContextReview:o}=await import("./context-review-FEXKUOBC.js"),s=document.createElement("button");s.className="pm-evidence-launch",s.type="button",s.textContent=t==="skills"?"Skill evidence":"Context evidence",s.title="Review context & skill evidence";let a=document.createElement("div");a.style.cssText="width:100%;min-width:0",s.onclick=()=>{if(a.dataset.mounted){a.hidden=!a.hidden;return}a.dataset.mounted="1",o(a,{api:r,mobile:!0,navigate:e,initialTab:t})};let d=n.querySelector(".pm-title-row")||n.querySelector(".pm-header");d?d.after(s,a):(n.prepend(a),n.prepend(s))}async function se(n,{section:e="",navigate:t}){if(e==="hub"){try{t?.("#mobile/hub")}catch{}return W(n,{navigate:t})}if(e==="audit"||e==="memory"){await(e==="audit"?z(n,{navigate:t}):G(n,{navigate:t})),await K(n,t);return}if(e==="overview")return O(n,{navigate:t});let{renderMobilePluginsPage:r}=await import("./mobile-plugins-page-ZHRUM73D.js");return r(n,{navigate:t})}export{$ as a,Z as b,ee as c,te as d,ne as e,re as f,A as g,W as h,se as i};
