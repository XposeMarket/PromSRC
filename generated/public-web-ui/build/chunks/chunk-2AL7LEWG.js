import{a as ae}from"./chunk-OTZWRXCI.js";import{c as n,x as se}from"./chunk-T2LQAR5W.js";import{b as A}from"./chunk-JF4LWGNM.js";var Me=`
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <rect x="4" y="5" width="16" height="11" rx="2"></rect>
    <path d="M9 20h6"></path>
    <path d="M12 16v4"></path>
  </svg>
`;var R="week",E=!1,V=new Set,O=new Set,X=[],N="",M=[],de=4,ce=4,F=de,C=!1,ue=!1,I="",G=0,q=null,l={suggestions:[],activity:[],pending:0,quarantined:0,appliedActivity:0,observedActivity:0,lowRisk:0,mediumRisk:0,highRisk:0,totalCount:0,offset:0,nextOffset:null,hasMore:!1,loading:!1,loadingMore:!1,actingId:""},L={year:0,month:0,counts:{}},H={daily:[],stats:null},b={mode:"overview",range:"all",tools:null,models:null,loading:!1},_={items:[],loading:!1,loaded:!1};try{let e=localStorage.getItem("hub_stats_mode");(e==="overview"||e==="models")&&(b.mode=e);let t=localStorage.getItem("hub_stats_range");(t==="all"||t==="30d"||t==="7d"||t==="1d")&&(b.range=t)}catch{}try{let e=localStorage.getItem("hub_range");(e==="day"||e==="week"||e==="month")&&(R=e),E=localStorage.getItem("hub_skills_viewall")==="1",N=localStorage.getItem("hub_skill_search")||""}catch{}function B(e){if(!e)return"\u2014";try{let t=new Date(e);return isNaN(t.getTime())?"\u2014":t.toLocaleString()}catch{return"\u2014"}}function D(e){if(!e)return"never";let t=Date.parse(e);if(!isFinite(t))return"never";let s=Date.now()-t,a=Math.floor(s/6e4);if(a<1)return"just now";if(a<60)return a+"m ago";let i=Math.floor(a/60);if(i<24)return i+"h ago";let r=Math.floor(i/24);return r<30?r+"d ago":B(e)}function Le(e,t){if(!e||t<=0)return 0;let s=e/t;return s>.85?5:s>.65?4:s>.45?3:s>.25?2:1}function Te(e){let t=0;for(let s in e)t+=e[s]||0;return t}function T(e){let t=String(e||"").trim();return t?t.replace(/[-_]+/g," ").replace(/\b\w/g,s=>s.toUpperCase()):"Unknown"}function Ce(e){let t=String(e.lifecycle||"").trim(),s=String(e.ownership||"").trim(),a=String(e.status||"").trim(),i=[];return t&&i.push(`<span class="hub-skill-badge lifecycle" data-value="${n(t)}">${n(T(t))}</span>`),s&&i.push(`<span class="hub-skill-badge ownership" data-value="${n(s)}">${n(T(s))}</span>`),!t&&a&&i.push(`<span class="hub-skill-badge status" data-value="${n(a)}">${n(T(a))}</span>`),i.length?`<div class="hub-skill-badges">${i.join("")}</div>`:""}function Ee(e){return String(e||"").replace(/^\s*---\r?\n[\s\S]*?\r?\n---\r?\n?/,"").trimStart()}function ge(e,t=3){let s=Array.isArray(e)?e.slice(0,t):[];return s.length?`
    <div class="hub-skill-change-list">
      ${s.map(a=>{let i=T(a.changeType||"skill_update"),r=D(a.timestamp),o=String(a.reason||"").trim(),u=Array.isArray(a.changedPaths)?a.changedPaths.filter(Boolean):[],c=String(a.appliedBy||"").trim(),d=String(a.evidence||"").trim(),g=a.metadata&&typeof a.metadata=="object"?a.metadata:null,h=JSON.stringify({changeType:a.changeType||"skill_update",timestamp:a.timestamp||"",reason:o,changedPaths:u,evidence:d,appliedBy:c,...g?{metadata:g}:{}},null,2);return`
          <div class="hub-skill-change" data-hub-change-card tabindex="0" role="button" aria-expanded="false">
            <div class="hub-skill-change-main">
              <span class="hub-skill-change-type">${n(i)}</span>
              <span class="hub-skill-change-time" title="${n(B(a.timestamp))}">${n(r)}</span>
            </div>
            ${o?`<div class="hub-skill-change-reason">${n(o)}</div>`:""}
            ${u.length?`<div class="hub-skill-change-paths">${u.slice(0,3).map(m=>`<span>${n(m)}</span>`).join("")}</div>`:""}
            ${c?`<div class="hub-skill-change-by">${n(c)}</div>`:""}
            <div class="hub-skill-change-detail"><pre>${n(h)}</pre></div>
          </div>
        `}).join("")}
    </div>
  `:'<div class="hub-skill-change-empty">No recent skill changes.</div>'}function xe(e){let t=Array.isArray(e?.resources)?e.resources:[];return t.length?`
    <details class="hub-modal-addons">
      <summary><span>Add-ons</span><strong>${t.length} file${t.length===1?"":"s"}</strong></summary>
      <div class="hub-modal-resource-list">
        ${t.map(s=>{let a=String(s?.path||"").trim();if(!a)return"";let i=String(s?.type||"").trim(),r=Number(s?.sizeBytes||0),o=String(s?.description||"").trim();return`
            <button class="hub-modal-resource-item" type="button" data-skill-id="${n(e.id)}" data-resource-path="${n(a)}">
              <span class="hub-modal-resource-path">${n(a)}</span>
              <span class="hub-modal-resource-meta">${n([i,r?`${r.toLocaleString()} bytes`:"",o].filter(Boolean).join(" \xB7 "))}</span>
            </button>
          `}).join("")}
      </div>
      <div id="hub-modal-resource-preview" class="hub-modal-resource-preview">
        <div class="hub-modal-resource-empty">Select a file to preview it.</div>
      </div>
    </details>
  `:""}function Ie(e){let t=V.has(e.id),s=Array.isArray(e.recentChanges)?e.recentChanges:[],a=e.promptSignals||{},i=[Array.isArray(a.phrases)?`${a.phrases.length} phrases`:"",Array.isArray(a.allOf)?`${a.allOf.length} allOf`:"",Array.isArray(a.anyOf)?`${a.anyOf.length} anyOf`:"",Array.isArray(a.noneOf)?`${a.noneOf.length} exclusions`:"",a.minScore!==void 0?`min ${a.minScore}`:""].filter(Boolean).join(" \xB7 ");return`
    <div class="hub-skill-card${t?" open":""}" data-skill-id="${n(e.id)}">
      <div class="hub-skill-card-head" data-action="toggle" data-id="${n(e.id)}">
        <div class="hub-skill-icon">${Me}</div>
        <div class="hub-skill-name" title="${n(e.name)}">${n(e.name)}</div>
        ${Ce(e)}
        <div class="hub-skill-count">${e.count} ${e.count===1?"use":"uses"}</div>
        <div class="hub-skill-preview">${n((e.description||"").slice(0,90))}${(e.description||"").length>90?"\u2026":""}</div>
      </div>
      <div class="hub-skill-card-body">
        <div class="hub-skill-meta-row"><span class="hub-skill-meta-label">Version</span><span class="hub-skill-meta-val">${n(e.version||"\u2014")}</span></div>
        <div class="hub-skill-meta-row"><span class="hub-skill-meta-label">Lifecycle</span><span class="hub-skill-meta-val">${n(T(e.lifecycle||e.status))}</span></div>
        <div class="hub-skill-meta-row"><span class="hub-skill-meta-label">Ownership</span><span class="hub-skill-meta-val">${n(T(e.ownership))}</span></div>
        ${i?`<div class="hub-skill-meta-row"><span class="hub-skill-meta-label">Trigger policy</span><span class="hub-skill-meta-val">${n(i)}</span></div>`:""}
        <div class="hub-skill-meta-row"><span class="hub-skill-meta-label">Last used</span><span class="hub-skill-meta-val" title="${n(B(e.lastUsed))}">${n(D(e.lastUsed))}</span></div>
        <div class="hub-skill-meta-row"><span class="hub-skill-meta-label">Last modified</span><span class="hub-skill-meta-val" title="${n(B(e.lastModified))}">${n(D(e.lastModified))}</span></div>
        <div class="hub-skill-card-changes">
          <div class="hub-skill-card-changes-title">Recent changes</div>
          ${ge(s,2)}
        </div>
        <div class="hub-skill-card-actions">
          <button class="hub-skill-view-btn" data-action="view" data-id="${n(e.id)}" type="button">View</button>
          <button class="hub-skill-view-btn secondary" data-action="edit" data-id="${n(e.id)}" type="button">Edit</button>
        </div>
      </div>
    </div>
  `}function _e(e,t){if(!t)return!0;let s=e.requires||{},a=e.assignment||{},i=e.toolBinding||{};return[e.id,e.name,e.description,e.version,e.lifecycle,e.ownership,e.manifestSource,e.status,e.eligibility?.status,e.safety?.verdict,a.agentId,a.teamId,a.mode,i.mode,...Array.isArray(s.tools)?s.tools:[],...Array.isArray(s.connectors)?s.connectors:[],...Array.isArray(s.plugins)?s.plugins:[],...Array.isArray(e.triggers)?e.triggers:[],JSON.stringify(e.promptSignals||{})].join(" ").toLowerCase().includes(t)}function z(){let e=document.getElementById("hub-skills-grid");if(!e)return;let t=N.trim().toLowerCase(),s=X.filter(i=>_e(i,t)),a=t||E?s:s.slice(0,4);if(!a.length){e.innerHTML=`<div class="hub-empty">${t?"No matching skills found.":"No skills found."}</div>`,e.classList.toggle("hub-skills-grid-all",!!t||E);return}e.innerHTML=a.map(Ie).join(""),e.classList.toggle("hub-skills-grid-all",!!t||E),fe(e),e.querySelectorAll('[data-action="toggle"]').forEach(i=>{i.addEventListener("click",()=>{let r=i.getAttribute("data-id");r&&(V.has(r)?V.delete(r):V.add(r),z())})}),e.querySelectorAll('[data-action="view"]').forEach(i=>{i.addEventListener("click",r=>{r.stopPropagation();let o=i.getAttribute("data-id");o&&be(o)})}),e.querySelectorAll('[data-action="edit"]').forEach(i=>{i.addEventListener("click",r=>{r.stopPropagation();let o=i.getAttribute("data-id");o&&typeof window.editSkill=="function"&&window.editSkill(o)})})}function he(e){return String(e?.id||`${e?.sessionId||"goal"}:${e?.createdAt||e?.updatedAt||""}`)}function j(e="",t="info"){let s=document.getElementById("hub-goals-status");s&&(s.hidden=!e,s.className=`hub-goals-status${t==="error"?" error":""}`,s.setAttribute("role",t==="error"?"alert":"status"),s.setAttribute("aria-live",t==="error"?"assertive":"polite"),s.textContent=e)}function Be(){let e=document.getElementById("hub-goals-refresh");e&&(e.disabled=C,e.setAttribute("aria-busy",C?"true":"false"),e.title=C?"Refreshing goals":"Refresh goals")}function ne(e,t="info"){return`<div class="hub-goals-state${t==="error"?" error":""}" role="${t==="error"?"alert":"status"}" aria-live="${t==="error"?"assertive":"polite"}">${n(e)}</div>`}function Ne(e){let t=String(e?.status||"unknown").trim().toLowerCase()||"unknown",s=he(e),a=O.has(s),i=String(e?.progressSummary||e?.lastReason||e?.blockedReason||e?.pausedReason||e?.failureReason||"").trim(),r=Array.isArray(e?.deniedActions)?e.deniedActions:[],o=r[r.length-1]||null,u=Number(e?.updatedAt||e?.createdAt||0),c=Number.isFinite(u)&&u>0?new Date(u).toISOString():String(e?.updatedAt||e?.createdAt||""),d=e?.goalMetrics&&typeof e.goalMetrics=="object"?e.goalMetrics:null,g=d&&Number.isFinite(Number(d.elapsedMs))?Re(d.elapsedMs):"Not recorded",h=d&&Number.isFinite(Number(d.totalTokens))?Math.max(0,Number(d.totalTokens)).toLocaleString():"Not recorded",m=String(e?.goal||"Untitled goal");return`
    <article class="hub-goal-card${a?" open":""}" data-status="${n(t)}" data-goal-id="${n(s)}" title="${n(m)}" tabindex="0" role="button" aria-label="${n(m)}" aria-expanded="${a?"true":"false"}">
      <div class="hub-goal-card-head">
        <div class="hub-goal-status">${n(t)}${e?.current?" \xB7 current":""}</div>
        <div class="hub-goal-turns">${Number(e?.turnsUsed||0)} turns</div>
      </div>
      <div class="hub-goal-title">${n(m)}</div>
      <div class="hub-goal-meta">
        <span>${n(e?.sessionTitle||e?.sessionId||"session")}</span>
        <span>${n(D(c))}</span>
        <span>Autonomous</span>
        <span>Hard policy</span>
        ${r.length?`<span>${r.length} denied</span>`:""}
      </div>
      ${o?`<div class="hub-goal-denial">${n(`${o.category||"policy"}: ${o.reason||"Blocked by hard policy."}`)}</div>`:""}
      ${i?`<div class="hub-goal-summary">${n(i)}</div>`:""}
      <div class="hub-goal-expand-label">${a?"Hide goal metrics":"View goal metrics"} <span aria-hidden="true">${a?"\u25B4":"\u25BE"}</span></div>
      ${a?`
        <div class="hub-goal-details" aria-label="Goal metrics">
          <div><span>Total goal time</span><strong>${n(g)}</strong></div>
          <div><span>Tokens used</span><strong>${n(h)}</strong></div>
        </div>
      `:""}
    </article>
  `}function ie({focusControl:e=!1}={}){C&&!ue||F>=M.length||(F=Math.min(M.length,F+ce),J(),e&&document.querySelector("[data-goal-load-more]")?.focus())}function J(){let e=document.getElementById("hub-achievements-grid");if(!e)return;let t=e.scrollTop;if(q&&(e.removeEventListener("scroll",q),q=null),e.setAttribute("aria-busy",C?"true":"false"),Be(),C&&!M.length){j(),e.setAttribute("aria-label","Goals loading"),e.innerHTML=ne("Loading goals\u2026"),e.scrollTop=0;return}if(!M.length){j(),e.setAttribute("aria-label",I?"Goals failed to load":"Goals"),e.innerHTML=ne(I?`Unable to load goals. ${I}`:"No main-chat goals yet.",I?"error":"info"),e.scrollTop=0;return}let s=[...O].map(c=>M.findIndex(d=>he(d)===c)).filter(c=>c>=0),a=Math.max(de,F,s.length?Math.max(...s)+1:0),i=Math.min(M.length,a);F=i;let r=M.slice(0,i),o=i<M.length,u=Math.min(ce,M.length-i);C?j("Refreshing goals\u2026"):I?j(`Unable to refresh goals. ${I}`,"error"):j(),e.setAttribute("aria-label",`Goals, showing ${i} of ${M.length}`),e.innerHTML=`${r.map(Ne).join("")}
    ${o?`<button class="hub-goals-load-more" data-goal-load-more type="button" aria-controls="hub-achievements-grid">Show ${u} more goal${u===1?"":"s"} <span>${i} of ${M.length}</span></button>`:""}`,e.scrollTop=t,e.querySelectorAll("[data-goal-id]").forEach(c=>{let d=()=>{let g=c.getAttribute("data-goal-id");if(!g)return;let h=document.activeElement===c;O.has(g)?O.delete(g):O.add(g),J(),h&&[...e.querySelectorAll("[data-goal-id]")].find(m=>m.getAttribute("data-goal-id")===g)?.focus()};c.addEventListener("click",d),c.addEventListener("keydown",g=>{g.key!=="Enter"&&g.key!==" "||(g.preventDefault(),d())})}),e.querySelector("[data-goal-load-more]")?.addEventListener("click",()=>ie({focusControl:!0})),o&&(q=()=>{e.scrollTop+e.clientHeight>=e.scrollHeight-48&&ie()},e.addEventListener("scroll",q,{passive:!0}))}function He(){let e=document.getElementById("hub-heatmap-grid"),t=document.getElementById("hub-heatmap-label");if(!e||!t)return;let s=H.stats||{},a=Array.isArray(H.daily)?H.daily:[],i=Te(Object.fromEntries(a.map(f=>[f.date,f.tokens||f.count||0])));if(t.textContent=`Last 6 months \xB7 ${v(i)} tokens`,!a.length){e.innerHTML='<div class="hub-empty">No token activity recorded yet.</div>';return}let r=["S","M","T","W","T","F","S"],o='<div class="hub-heat-daylabels">';for(let f=0;f<7;f++)o+=`<div class="hub-heat-daylabel">${r[f]}</div>`;o+="</div>";let u=new Date(`${a[0].date}T00:00:00`),c=Number.isFinite(u.getTime())?u.getDay():0,d=a.map(f=>Math.max(0,Number(f.tokens||f.count||0))),g=Math.max(1,...d),h='<div class="hub-heatmap-cells hub-token-activity-cells">';for(let f=0;f<c;f++)h+='<div class="hub-heat-cell hub-heat-empty"></div>';a.forEach(f=>{let y=Math.max(0,Number(f.tokens||f.count||0)),k=Le(y,g),w=`${f.date} \u2014 ${v(y)} token${y===1?"":"s"}`;h+=`<div class="hub-heat-cell" data-level="${k}" title="${n(w)}"></div>`}),h+="</div>";let m=[],$=new Set;a.forEach((f,y)=>{let[k,w]=String(f.date||"").split("-"),S=`${k}-${w}`;if(!k||!w||$.has(S))return;$.add(S);let Z=new Date(`${f.date}T00:00:00`);m.push(`<span style="grid-column:${Math.floor((c+y)/7)+1}">${n(Z.toLocaleDateString(void 0,{month:"short"}))}</span>`)}),e.innerHTML=`<div class="hub-token-activity-wrap">${o}<div><div class="hub-token-months">${m.join("")}</div>${h}</div></div>`}function v(e){let t=Number(e)||0;return Math.abs(t)>=1e9?(t/1e9).toFixed(t>=1e10?0:1)+"B":Math.abs(t)>=1e6?(t/1e6).toFixed(t>=1e7?0:1)+"M":Math.abs(t)>=1e4?(t/1e3).toFixed(0)+"K":Math.abs(t)>=1e3?(t/1e3).toFixed(1)+"K":t.toLocaleString()}function x(e){let s=Math.max(0,Number(e)||0)/1e6;return s<=0?"$0":s>=100?"$"+s.toFixed(0):s>=1?"$"+s.toFixed(2):s>=.01?"$"+s.toFixed(3):"$"+s.toFixed(5)}function Q(e){let t=Math.max(0,Number(e)||0);if(t<=0)return"\u2014";if(t<1e3)return Math.round(t)+"ms";if(t<1e4)return(t/1e3).toFixed(2)+"s";if(t<6e4)return(t/1e3).toFixed(1)+"s";let s=Math.floor(t/6e4),a=Math.round(t%6e4/1e3);return s+"m"+(a?" "+a+"s":"")}function Re(e){let t=Number(e);if(!Number.isFinite(t)||t<0)return"Not recorded";if(t<1e3)return`${Math.round(t)}ms`;if(t<6e4)return`${(t/1e3).toFixed(t<1e4?2:1)}s`;let s=Math.floor(t/6e4),a=Math.round(t%6e4/1e3),i=Math.floor(s/60),r=s%60;return i>0?`${i}h${r?` ${r}m`:""}`:`${s}m${a?` ${a}s`:""}`}function p(e,t,s){return`
    <div class="hub-stat-tile">
      <div class="hub-stat-label">${n(e)}</div>
      <div class="hub-stat-value">${n(String(t))}</div>
      ${s?`<div class="hub-stat-sub">${n(s)}</div>`:""}
    </div>
  `}function De(e){let t=Array.isArray(e.expensiveTools)&&e.expensiveTools.length?e.expensiveTools:Array.isArray(e.topTools)?e.topTools:[];return t.length?`
    <div class="hub-models-table is-tools">
      <div class="hub-models-row hub-models-head">
        <div>Tool</div>
        <div class="hub-models-num">Calls</div>
        <div class="hub-models-num">Context</div>
        <div class="hub-models-num">Avg</div>
        <div class="hub-models-num">Max</div>
        <div class="hub-models-num">Est. Cost</div>
      </div>
      ${t.slice(0,10).map(s=>`
        <div class="hub-models-row">
          <div class="hub-models-name" title="${n(s.name)}">${n(s.name)}</div>
          <div class="hub-models-num">${n(v(Number(s.count)||0))}</div>
          <div class="hub-models-num">${n(v(Number(s.contextTokens)||0))}</div>
          <div class="hub-models-num">${n(Q(s.durationMsAvg))}</div>
          <div class="hub-models-num">${n(Q(s.durationMsMax))}</div>
          <div class="hub-models-num">${n(x(s.totalCostMicros))}</div>
        </div>
      `).join("")}
    </div>
  `:'<div class="hub-empty">No tool telemetry recorded yet.</div>'}function ee(){let e=document.getElementById("hub-stats-tiles"),t=document.getElementById("hub-stats-models"),s=document.getElementById("hub-stats-footnote");if(!e||!t)return;if(b.loading){e.innerHTML='<div class="hub-empty">Loading\u2026</div>',t.style.display="none",s&&(s.textContent="");return}if(b.mode==="overview"){let d=b.tools&&b.tools.stats||{},g=b.models&&b.models.stats||{},h=d.chatSessions||g.chatSessions||0,m=d.messages||0,$=g.totalTokens||0,f=d.activeDays||g.activeDays||0,y=d.currentStreak||0,k=d.peakHour&&d.peakHour!=="\u2014"?d.peakHour:g.peakHour||"\u2014",w=g.favorite&&g.favorite!=="\u2014"?g.favorite:d.favorite||"\u2014",S=Number(g.totalCostMicros||0),Z=Number(d.directCostMicros||0),ke=Number(d.contextCostMicros||0),we=S+Z;if(e.innerHTML=[p("Est. spend",x(we),"model + direct tool"),p("Model cost",x(S),v($)+" tokens"),p("Tool context",x(ke),v(d.contextTokens||0)+" tokens"),p("Avg tool",Q(d.durationMsAvg),"max "+Q(d.durationMsMax)),p("Sessions",v(h)),p("Messages",v(m)),p("Tool calls",v(d.toolCalls||d.total||0)),p("Active days",String(f)),p("Current streak",y+"d"),p("Peak hour",String(k)),p("Favorite model",String(w))].join(""),t.innerHTML=De(b.tools||{}),t.style.display="",s){let Se=b.models&&b.models.summary||"",Ae=b.tools&&b.tools.summary||"";s.textContent=[Se,Ae].filter(Boolean).join(" ")}return}let a=b.models||{},i=a.stats||{},r=Array.isArray(a.topModels)?a.topModels:[],o=Array.isArray(a.topProviders)?a.topProviders:[],u=r.reduce((d,g)=>d+(Number(g.tokens)||0),0)||1;e.innerHTML=[p("Est. cost",x(i.totalCostMicros||0)),p("Total tokens",v(i.totalTokens||0)),p("Input",v(i.inputTokens||0)),p("Output",v(i.outputTokens||0)),p("Reasoning",v(i.reasoningTokens||0)),p("Cache",v(i.cacheTokens||0)),p("Model calls",v(i.messages||0)),p("Model sessions",v(i.modelSessions||i.sessions||0)),p("Favorite",String(i.favorite||"\u2014"))].join("");let c=o.length?`<div class="hub-models-providers">${o.map(d=>`
        <span class="hub-models-chip" title="${n(v(d.tokens)+" tokens \xB7 "+x(d.costMicros))}">
          <span class="hub-models-chip-name">${n(d.name)}</span>
          <span class="hub-models-chip-val">${n(v(d.tokens))}</span>
          <span class="hub-models-chip-val">${n(x(d.costMicros))}</span>
        </span>
      `).join("")}</div>`:"";r.length?t.innerHTML=`
      ${c}
      <div class="hub-models-table is-cost">
        <div class="hub-models-row hub-models-head">
          <div>Model</div>
          <div class="hub-models-num">Calls</div>
          <div class="hub-models-num">Tokens</div>
          <div class="hub-models-num">Cost</div>
          <div class="hub-models-num">Share</div>
          <div class="hub-models-bar-cell"></div>
        </div>
        ${r.map(d=>{let g=Number(d.tokens)||0,h=g/u*100;return`
            <div class="hub-models-row">
              <div class="hub-models-name" title="${n(d.name)}">${n(d.name)}</div>
              <div class="hub-models-num">${n(v(Number(d.calls)||0))}</div>
              <div class="hub-models-num">${n(v(g))}</div>
              <div class="hub-models-num">${n(x(d.costMicros))}</div>
              <div class="hub-models-num">${h.toFixed(1)}%</div>
              <div class="hub-models-bar-cell"><div class="hub-models-bar" style="width:${Math.max(2,Math.min(100,h))}%"></div></div>
            </div>
          `}).join("")}
      </div>
    `:t.innerHTML=`${c}<div class="hub-empty">No model usage recorded yet.</div>`,t.style.display="",s&&(s.textContent=a.summary||"")}function qe(e){let t=Number(e)||0;return t>=90?"crit":t>=75?"warn":"ok"}function je(e){if(e<=0)return"soon";let t=Math.round(e/6e4);if(t<60)return`in ${t}m`;let s=Math.floor(t/60);if(s<48){let a=t%60;return a?`in ${s}h ${a}m`:`in ${s}h`}return`in ${Math.round(s/24)}d`}function Oe(e,t){if(!e)return"";let s=Date.parse(e);if(!Number.isFinite(s))return"";let a=s-Date.now();if(a<=0)return"resets now";let i=new Date(s),r=i.toLocaleTimeString([],{hour:"numeric",minute:"2-digit"}),o=je(a);return/week|day|opus/i.test(String(t||""))||a>=24*3600*1e3?`resets ${i.toLocaleDateString([],{month:"short",day:"numeric"})}, ${r} (${o})`:`resets at ${r} (${o})`}function re(e,t,s){let a=Math.max(0,Math.min(100,Number(t)||0)),i=Oe(s,e);return`
    <div class="usage-gauge">
      <div class="usage-gauge-head">
        <span class="usage-gauge-label">${n(e)}</span>
        <span class="usage-gauge-pct">${a}%</span>
      </div>
      <div class="usage-gauge-track"><div class="usage-gauge-fill ${qe(a)}" style="width:${a}%"></div></div>
      ${i?`<div class="usage-gauge-reset">${n(i)}</div>`:""}
    </div>
  `}function Fe(e){let t=Array.isArray(e.windows)?e.windows:[],s=e.tokens||{},a="";t.length?a+=t.map(o=>re(o.label,o.used_percent,o.reset_at)+(o.detail?`<div class="usage-gauge-reset">${n(o.detail)}</div>`:"")).join(""):e.usage_scope==="model"?a='<div class="usage-provider-note">Codex Spark limit data is currently unavailable.</div>':e.budget&&e.budget.limit_tokens>0?a=re("Monthly budget",e.budget.used_percent,null)+`<div class="usage-gauge-reset">${v(e.budget.used_tokens)} / ${v(e.budget.limit_tokens)} tokens</div>`:e.error?a='<div class="usage-provider-note">Live limits unavailable</div>':a='<div class="usage-provider-note">No limit data \u2014 tracking tokens only</div>';let i=e.source==="live"?'<span class="usage-provider-badge live">live</span>':'<span class="usage-provider-badge">tracked</span>',r=e.error?`<div class="usage-provider-err">${n(e.error)}</div>`:"";return`
    <div class="usage-provider-card" data-provider="${n(e.provider)}"${e.account_id?` data-account="${n(e.account_id)}"`:""}>
      <div class="usage-provider-head">
        <span class="usage-provider-name">${n(e.account_label?`${e.label||e.provider} \xB7 ${e.account_label}`:e.label||e.provider)}</span>
        ${i}
      </div>
      ${a}
      ${r}
      <div class="usage-provider-foot">${e.plan_label?`${n(e.plan_label)} \xB7 `:""}${v(s.total||0)} tokens \xB7 ${v(s.calls||0)} calls</div>
    </div>
  `}function oe(){let e=document.getElementById("hub-providers-grid"),t=document.getElementById("hub-providers-section");if(!e)return;if(_.loading&&!_.loaded){e.innerHTML='<div class="hub-empty">Loading\u2026</div>';return}let s=_.items||[];if(!s.length){t&&(t.style.display="none");return}t&&(t.style.display=""),e.innerHTML=s.map(Fe).join("")}async function me(){_.loading=!0,oe();try{let e=await A("/api/usage/limits",{timeoutMs:3e4});_.items=e&&Array.isArray(e.providers)?e.providers:[]}catch{_.items=[]}finally{_.loading=!1,_.loaded=!0,oe()}}function K(e){let t=String(e||"pending").toLowerCase();return t==="applied"?"applied":t==="rejected"?"rejected":t==="quarantined"?"quarantined":"pending"}function Y(e,t){let s=String(e||"");if(!s)return"";let a=String(t||"").trim().toLowerCase(),i=s.split(/\r?\n/),r=i.findIndex(u=>{let c=u.match(/^##\s+(.+?)\s*$/);return c&&c[1].trim().toLowerCase()===a});if(r<0)return"";let o=i.length;for(let u=r+1;u<i.length;u+=1)if(/^##\s+/.test(i[u])){o=u;break}return i.slice(r+1,o).join(`
`).trim()}function W(e,t=""){let s=String(e||"").replace(/\s+/g," ").trim();if(!s)return t;let a=s.match(/^(.{30,220}?[.!?])(?:\s|$)/);return a?a[1].trim():s.slice(0,220)}function Pe(e){let t=Y(e,"Tool Sequence");if(!t)return"";let s=Array.from(t.matchAll(/^\s*[-*]\s*`?([a-zA-Z0-9_.:-]+)`?/gm)).map(i=>i[1]),a=[...new Set(s)].slice(0,5);return a.length?`Captures a reusable tool sequence: ${a.join(", ")}${s.length>a.length?`, +${s.length-a.length} more`:""}.`:""}function Ue(e,t){if(e?.learnedBehavior)return String(e.learnedBehavior);let s=Y(t,"Suggested Action"),a=Y(t,"Outcome Excerpt"),i=Y(t,"Request Excerpt"),r=Pe(t),o=String(e?.change?.kind||"").toLowerCase();if(o==="write_resource"){let u=W(s||e?.reason,"Adds a reusable skill note from a completed run."),c=W(a||i,"");return[u,r||c].filter(Boolean).join(" ")}return o==="manifest_overlay"?W(s||e?.reason,"Updates the skill manifest metadata so Prometheus can route to this skill more reliably."):W(s||e?.reason,"Reviews a proposed skill improvement from Brain.")}function Ge(e){if(e?.approvePreview)return String(e.approvePreview);let t=e?.change||{},s=String(t.kind||"").toLowerCase(),a=String(e?.skillId||"this skill"),i=String(t.path||"").trim();return s==="write_resource"?`Approve will add ${i||"a resource file"} to ${a}.`:s==="manifest_overlay"?`Approve will update ${a}'s manifest metadata.`:s==="review_only"?"Approve will mark this daily skill-change audit accepted without changing skill files.":`Approve will apply this suggested change to ${a}.`}function We(e){let t=String(e||"").trim();return t?t.replace(/[_-]+/g," ").replace(/\b\w/g,s=>s.toUpperCase()):"Skill change"}function Ve(e){let t=String(e||"").toLowerCase();return t.includes("/recovery/")?"Recovery note":t.includes("/styles/")?"Style reference":t.includes("/workflows/")?"Workflow recipe":t.includes("/examples/")?"Example":t.includes("/templates/")?"Template":"Skill resource"}function Ke(e,t){let s=e?.change||{},a=String(s.kind||"").toLowerCase(),i=String(e?.skillId||"unknown skill").trim(),r=String(s.path||"").trim();if(a==="write_resource"){let o=Ve(r);return{action:`Create ${o.toLowerCase()}`,targetLabel:"Will write",target:r?`skill:${i}/${r}`:`skill:${i}/(new resource file)`,scope:`${o} for ${i}.`,writeNote:"Adds a reference file. It does not create a new skill or edit SKILL.md.",teachLabel:"Will teach",teach:t||e?.learnedBehavior||"A reusable behavior captured from Brain evidence."}}return a==="manifest_overlay"?{action:"Update skill routing metadata",targetLabel:"Will write",target:`skill:${i}/skill.json overlay`,scope:"Adds or adjusts trigger words so this skill is found earlier.",writeNote:"No instruction body or resource markdown is changed.",teachLabel:"Routing change",teach:t||e?.learnedBehavior||"Prometheus should route matching requests to this skill sooner."}:a==="review_only"?{action:"Accept daily skill-change audit",targetLabel:"File change",target:"No files written",scope:"Marks a self-improvement audit item as reviewed.",writeNote:"This accepts the audit record only.",teachLabel:"Audit purpose",teach:t||e?.learnedBehavior||"Checks that recent skill mutations were evidence-backed and safe."}:{action:"Apply suggested skill change",targetLabel:"Target",target:r?`skill:${i}/${r}`:`skill:${i}`,scope:"Applies a Brain skill suggestion.",writeNote:"Review the technical details before approving.",teachLabel:"Will teach",teach:t||e?.learnedBehavior||"A reusable skill behavior from Brain evidence."}}function Ye(e){let t=String(e?.change?.kind||"").toLowerCase();return t==="review_only"?"Accept audit":t==="manifest_overlay"?"Update trigger":t==="write_resource"?"Create file":"Apply change"}function ze(e){let t=K(e.status),s=String(e.risk||"low").toLowerCase(),a=e.change||{},i=Array.isArray(e.evidence)?e.evidence:[],r=Array.isArray(e.scan?.findings)?e.scan.findings:[],o=String(a.content||"").trim(),u=Ue(e,o),c=Ge(e),d=Ke(e,u),g=We(e.lessonType||a.kind),h=t==="pending",m=l.actingId===e.id;return`
    <article class="hub-curator-card" data-status="${n(t)}" data-risk="${n(s)}">
      <div class="hub-curator-card-head">
        <div class="hub-curator-title-wrap">
          <div class="hub-curator-title">${n(e.title||"Untitled suggestion")}</div>
          <div class="hub-curator-meta">
            <span>${n(e.skillId||"unknown skill")}</span>
            <span>${n(e.lessonType||a.kind||"change")}</span>
            <span title="${n(B(e.updatedAt))}">${n(D(e.updatedAt))}</span>
          </div>
        </div>
        <div class="hub-curator-badges">
          <span class="hub-curator-badge kind">${n(g)}</span>
          <span class="hub-curator-badge status">${n(t)}</span>
          <span class="hub-curator-badge risk">${n(s)} risk</span>
          <span class="hub-curator-badge scan">${n(e.scan?.verdict||"unscanned")}</span>
        </div>
      </div>
      <div class="hub-curator-apply-preview">
        <span>Approve action</span>
        <strong>${n(d.action)}</strong>
        <small>${n(d.scope)}</small>
      </div>
      <div class="hub-curator-decision-grid">
        <div>
          <span>${n(d.targetLabel)}</span>
          <code title="${n(d.target)}">${n(d.target)}</code>
          <small>${n(d.writeNote)}</small>
        </div>
        <div>
          <span>${n(d.teachLabel)}</span>
          <strong>${n(d.teach)}</strong>
        </div>
        ${e.futureTrigger?`<div><span>Use when</span><strong>${n(e.futureTrigger)}</strong></div>`:""}
      </div>
      ${e.whyUseful?`<div class="hub-curator-why"><strong>Why keep it</strong> ${n(e.whyUseful)}</div>`:""}
      ${e.reason?`<div class="hub-curator-reason"><strong>Curator reason</strong> ${n(e.reason)}</div>`:""}
      <div class="hub-curator-path" title="${n(d.target)}"><span>Target</span>${n(d.target)}</div>
      ${i.length?`
        <div class="hub-curator-evidence-block">
          <span>Evidence sources</span>
          <div class="hub-curator-evidence">
          ${i.slice(0,4).map($=>`<span title="${n($)}">${n($)}</span>`).join("")}
          ${i.length>4?`<span>+${i.length-4} more</span>`:""}
          </div>
        </div>
      `:""}
      <details class="hub-curator-details">
        <summary>Technical evidence, raw file preview, and scan results</summary>
        <div class="hub-curator-detail-grid">
          <div><span>ID</span><code>${n(e.id||"")}</code></div>
          <div><span>Created</span><code>${n(B(e.createdAt))}</code></div>
          <div><span>Updated</span><code>${n(B(e.updatedAt))}</code></div>
          <div><span>Scan hash</span><code>${n(e.scan?.contentHash||"")}</code></div>
          <div><span>Quality</span><code>${n(String(e.qualityScore??"legacy"))}</code></div>
          <div><span>Auto</span><code>${n(e.autoApplyEligible?"eligible":"review")}</code></div>
          <div><span>Backend preview</span><code>${n(c)}</code></div>
          <div><span>Change kind</span><code>${n(a.kind||"unknown")}</code></div>
        </div>
        ${e.autoDecisionReason?`<div class="hub-curator-findings">${n(e.autoDecisionReason)}</div>`:""}
        ${r.length?`<div class="hub-curator-findings">${r.map($=>`<div>${n($.message||JSON.stringify($))}</div>`).join("")}</div>`:""}
        ${o?`<pre class="hub-curator-content">${n(o.slice(0,2400))}${o.length>2400?`
\u2026`:""}</pre>`:""}
      </details>
      <div class="hub-curator-card-actions">
        ${h?`
          <button class="hub-curator-btn approve" data-curator-action="apply" data-id="${n(e.id)}" type="button" ${m?"disabled":""}>${n(Ye(e))}</button>
          <button class="hub-curator-btn deny" data-curator-action="reject" data-id="${n(e.id)}" type="button" ${m?"disabled":""}>Deny</button>
        `:`<span class="hub-curator-resolved">${n(t)}</span>`}
      </div>
    </article>
  `}function Je(e){let t=String(e?.status||"observed").toLowerCase()==="applied"?"applied":"observed",s=String(e?.appliedBy||e?.source||"brain").trim(),a=String(e?.risk||"").trim(),i=Array.isArray(e?.changedPaths)?e.changedPaths.filter(Boolean):[],r=Array.isArray(e?.evidence)?e.evidence.filter(Boolean):[],o=Array.isArray(e?.toolSequence)?e.toolSequence.filter(Boolean):[],u=String(e?.summary||e?.reason||e?.suggestedAction||"").trim();return`
    <article class="hub-curator-activity-card" data-status="${n(t)}">
      <div class="hub-curator-card-head">
        <div class="hub-curator-title-wrap">
          <div class="hub-curator-title">${n(e?.title||"Skill activity")}</div>
          <div class="hub-curator-meta">
            <span>${n(e?.skillId||"unassigned signal")}</span>
            <span>${n(e?.changeType||e?.source||"activity")}</span>
            <span title="${n(B(e?.timestamp))}">${n(D(e?.timestamp))}</span>
          </div>
        </div>
        <div class="hub-curator-badges">
          <span class="hub-curator-badge status">${n(t==="applied"?"applied":"observed")}</span>
          ${s?`<span class="hub-curator-badge scan">${n(s)}</span>`:""}
          ${a?`<span class="hub-curator-badge risk">${n(a)} risk</span>`:""}
        </div>
      </div>
      ${u?`<div class="hub-curator-lesson">${n(u)}</div>`:""}
      ${e?.requestExcerpt?`<div class="hub-curator-why"><strong>Observed</strong> ${n(e.requestExcerpt)}</div>`:""}
      ${e?.finalResponseExcerpt?`<div class="hub-curator-why"><strong>Outcome</strong> ${n(e.finalResponseExcerpt)}</div>`:""}
      ${i.length?`<div class="hub-curator-path" title="${n(i.join(", "))}"><span>Changed</span>${i.slice(0,4).map(n).join(", ")}${i.length>4?`, +${i.length-4} more`:""}</div>`:""}
      ${o.length?`<div class="hub-curator-evidence">${o.slice(0,6).map(c=>`<span title="${n(c)}">${n(c)}</span>`).join("")}${o.length>6?`<span>+${o.length-6} tools</span>`:""}</div>`:""}
      ${r.length?`
        <details class="hub-curator-details">
          <summary>Evidence</summary>
          <div class="hub-curator-evidence">
            ${r.slice(0,10).map(c=>`<span title="${n(c)}">${n(c)}</span>`).join("")}
            ${r.length>10?`<span>+${r.length-10} more</span>`:""}
          </div>
        </details>
      `:""}
    </article>
  `}function P(){let e=document.getElementById("hub-curator-list"),t=document.getElementById("hub-curator-summary"),s=document.getElementById("hub-curator-subtitle");if(!e)return;let a=Array.isArray(l.suggestions)?l.suggestions:[],i=Array.isArray(l.activity)?l.activity:[],r=a.length+i.length,o=Math.max(r,Number(l.totalCount||0)),u=a.reduce((y,k)=>{let w=K(k.status);return y[w]=(y[w]||0)+1,y},{}),c=Number(l.appliedActivity||0)||i.filter(y=>String(y?.status||"").toLowerCase()==="applied").length,d=Number(l.observedActivity||0)||Math.max(0,i.length-c),g=Number(l.pending||0)||u.pending||0,h=Number(l.quarantined||0)||u.quarantined||0;if(s&&(s.textContent=l.loading?"Loading Brain skill suggestions and Thought/Dream activity...":`${r} of ${o} shown \xB7 ${g} pending, ${h} quarantined, ${c} applied updates, ${d} observed signals`),t){let y=Number(l.lowRisk||0)||a.filter(S=>String(S.risk||"").toLowerCase()==="low").length,k=Number(l.mediumRisk||0)||a.filter(S=>String(S.risk||"").toLowerCase()==="medium").length,w=Number(l.highRisk||0)||a.filter(S=>String(S.risk||"").toLowerCase()==="high").length;t.innerHTML=[p("Pending",v(g)),p("Quarantined",v(h)),p("Applied Updates",v(c)),p("Observed Signals",v(d)),p("Low risk",v(y)),p("Medium risk",v(k)),p("High risk",v(w)),p("Total",v(a.length+i.length))].join("")}if(l.loading&&!a.length&&!i.length){e.innerHTML='<div class="hub-empty">Loading curator suggestions and activity...</div>';return}if(!a.length&&!i.length){e.innerHTML='<div class="hub-empty">No skill curator suggestions or Thought/Dream activity yet.</div>';return}let m=a.slice().sort((y,k)=>{let w=K(y.status)==="pending"?0:1,S=K(k.status)==="pending"?0:1;return w-S||String(k.updatedAt||"").localeCompare(String(y.updatedAt||""))}),$=i.slice().sort((y,k)=>String(k.timestamp||"").localeCompare(String(y.timestamp||"")));e.innerHTML=[m.length?`<div class="hub-curator-group-title">Review Queue</div>${m.map(ze).join("")}`:"",$.length?`<div class="hub-curator-group-title">Thought and Dream Activity</div>${$.map(Je).join("")}`:"",l.hasMore?`<button class="hub-curator-load-more" id="hub-curator-load-more" type="button" ${l.loadingMore?"disabled":""}>${l.loadingMore?"Loading\u2026":`Show ${Math.min(5,Math.max(1,o-r))} more`}</button>`:""].filter(Boolean).join(""),e.querySelectorAll("[data-curator-action]").forEach(y=>{y.addEventListener("click",k=>{k.stopPropagation(),Ze(y.getAttribute("data-id"),y.getAttribute("data-curator-action"),y)})});let f=e.querySelector("#hub-curator-load-more");f&&f.addEventListener("click",()=>U({reset:!1}))}async function U({reset:e=!0}={}){if(!e&&(l.loadingMore||!l.hasMore))return;e?(l.loading=!0,l.loadingMore=!1,l.suggestions=[],l.activity=[],l.pending=0,l.quarantined=0,l.appliedActivity=0,l.observedActivity=0,l.lowRisk=0,l.mediumRisk=0,l.highRisk=0,l.totalCount=0,l.offset=0,l.nextOffset=null,l.hasMore=!1):l.loadingMore=!0,P();let t=e?0:Number(l.nextOffset??l.offset??0);try{let s=await A(`/api/hub/skills/review?limit=5&offset=${encodeURIComponent(t)}`,{timeoutMs:3e4}),a=Array.isArray(s?.suggestions)?s.suggestions:[],i=Array.isArray(s?.activity)?s.activity:[];if(e)l.suggestions=a,l.activity=i;else{let r=new Set(l.suggestions.map(u=>String(u?.id||"")).filter(Boolean)),o=new Set(l.activity.map(u=>String(u?.id||"")).filter(Boolean));l.suggestions=l.suggestions.concat(a.filter(u=>{let c=String(u?.id||"");return!c||!r.has(c)})),l.activity=l.activity.concat(i.filter(u=>{let c=String(u?.id||"");return!c||!o.has(c)}))}l.pending=Number(s?.pending||0),l.quarantined=Number(s?.quarantined||0),l.appliedActivity=Number(s?.appliedActivity||0),l.observedActivity=Number(s?.observedActivity||0),l.lowRisk=Number(s?.lowRisk||0),l.mediumRisk=Number(s?.mediumRisk||0),l.highRisk=Number(s?.highRisk||0),l.totalCount=Number(s?.totalCount||l.suggestions.length+l.activity.length),l.offset=Number(s?.offset??t),l.nextOffset=s?.nextOffset==null?null:Number(s.nextOffset),l.hasMore=s?.hasMore===!0||l.nextOffset!==null}catch{e?(l.suggestions=[],l.activity=[],l.totalCount=0):window.showToast?.("Could not load more curator activity","Try again in a moment.","error")}finally{l.loading=!1,l.loadingMore=!1,l.actingId="",P()}}async function Qe(){l.loading=!0,P();try{await A("/api/hub/skills/review/run",{method:"POST",body:{mode:"pending"},timeoutMs:6e4})}catch(e){window.showToast?.("Skill curator run failed",e?.message||String(e),"error")}finally{await U()}}async function Ze(e,t,s){let a=String(e||"").trim(),i=String(t||"").trim();if(!(!a||!i)){l.actingId=a,s&&(s.disabled=!0),P();try{await A(`/api/hub/skills/review/${encodeURIComponent(a)}/${i==="apply"?"apply":"reject"}`,{method:"POST",body:{},timeoutMs:3e4}),await U(),ve()}catch(r){window.showToast?.("Skill curator action failed",r?.message||String(r),"error"),l.actingId="",P()}}}async function Xe(){b.loading=!(b.tools||b.models),ee();let e=encodeURIComponent(b.range);try{let[t,s]=await Promise.allSettled([A(`/api/hub/tools/overview?range=${e}`,{timeoutMs:3e4}),A(`/api/hub/models/overview?range=${e}`,{timeoutMs:3e4})]);t.status==="fulfilled"&&t.value&&t.value.success!==!1&&(b.tools=t.value),s.status==="fulfilled"&&s.value&&s.value.success!==!1&&(b.models=s.value)}finally{b.loading=!1,ee()}}async function ve(){try{let e=await A(`/api/hub/skills/usage?range=${encodeURIComponent(R)}`);X=Array.isArray(e?.skills)?e.skills:[]}catch{X=[]}z()}async function pe({force:e=!1}={}){if(C&&!e)return;let t=++G;C=!0,I="",J();try{let s=await A("/api/hub/goals");if(t!==G)return;if(s?.success===!1)throw new Error(s.error||"The goals endpoint returned an error.");M=Array.isArray(s?.goals)?s.goals:[],ue=!0}catch(s){if(t!==G)return;I=s?.message||String(s)}finally{if(t!==G)return;C=!1,J()}}async function le(){try{let e=await A("/api/hub/tokens/activity?range=6m",{timeoutMs:3e4});H.daily=Array.isArray(e?.daily)?e.daily:[],H.stats=e?.stats||null}catch{H.daily=[],H.stats=null}He()}async function be(e){let t=document.getElementById("hub-skill-modal"),s=document.getElementById("hub-modal-body"),a=document.getElementById("hub-modal-name"),i=document.getElementById("hub-modal-version");if(!(!t||!s)){s.innerHTML='<div class="hub-empty">Loading\u2026</div>',t.style.display="flex";try{let o=(await A(`/api/hub/skills/${encodeURIComponent(e)}/content`))?.skill||{};a&&(a.textContent=o.name||e),i&&(i.textContent=o.version?`v${o.version}`:"");let u=Ee(o.content),c=`
      <div class="hub-modal-skill-meta">
        <div class="hub-modal-skill-meta-item"><span>Status</span><strong>${n(T(o.status))}</strong></div>
        <div class="hub-modal-skill-meta-item"><span>Lifecycle</span><strong>${n(T(o.lifecycle||o.status))}</strong></div>
        <div class="hub-modal-skill-meta-item"><span>Ownership</span><strong>${n(T(o.ownership))}</strong></div>
        <div class="hub-modal-skill-meta-item"><span>Manifest</span><strong>${n(T(o.manifestSource))}</strong></div>
      </div>
        <div class="hub-modal-change-panel">
          <div class="hub-modal-section-title">Recent skill changes</div>
          ${ge(o.recentChanges,8)}
        </div>
        ${xe(o)}
      `,d;try{d=se(u)}catch{d=`<pre>${n(u)}</pre>`}s.innerHTML=`${c}<div class="hub-modal-markdown">${d}</div>`,fe(s),et(s)}catch(r){s.innerHTML=`<div class="hub-empty">Failed to load skill: ${n(r?.message||String(r))}</div>`}}}function te(e){if(!e)return;let t=e.classList.toggle("open");e.setAttribute("aria-expanded",t?"true":"false")}function fe(e=document){e.querySelectorAll("[data-hub-change-card]").forEach(t=>{t.dataset.changeBound!=="1"&&(t.dataset.changeBound="1",t.addEventListener("click",s=>{s.target.closest("a,button")||te(t)}),t.addEventListener("keydown",s=>{s.key!=="Enter"&&s.key!==" "||(s.preventDefault(),te(t))}))})}function et(e=document){e.querySelectorAll(".hub-modal-resource-item[data-skill-id][data-resource-path]").forEach(t=>{t.dataset.resourceBound!=="1"&&(t.dataset.resourceBound="1",t.addEventListener("click",s=>{s.preventDefault(),s.stopPropagation(),ye(t.dataset.skillId||"",t.dataset.resourcePath||"")}))})}async function ye(e,t){let s=document.getElementById("hub-modal-resource-preview");if(s){s.innerHTML=`<div class="hub-modal-resource-empty">Loading ${n(t)}...</div>`;try{let i=(await A(`/api/hub/skills/${encodeURIComponent(e)}/resources/content?path=${encodeURIComponent(t)}`))?.resource||{};s.innerHTML=`
      <div class="hub-modal-resource-preview-head">
        <strong>${n(i.path||t)}</strong>
        ${i.truncated?"<span>Truncated</span>":""}
      </div>
      <pre>${n(i.content||"")}</pre>
    `}catch(a){s.innerHTML=`<div class="hub-modal-resource-empty">Failed to load file: ${n(a?.message||String(a))}</div>`}}}function $e(){let e=document.getElementById("hub-skill-modal");e&&(e.style.display="none")}function tt(){let e=document.getElementById("hub-range-seg");e&&!e._wired&&(e._wired=!0,e.querySelectorAll(".hub-seg-btn").forEach(h=>{h.addEventListener("click",()=>{let m=h.getAttribute("data-range");if(!(!m||m===R)){R=m;try{localStorage.setItem("hub_range",R)}catch{}e.querySelectorAll(".hub-seg-btn").forEach($=>$.classList.toggle("active",$===h)),ve()}})}),e.querySelectorAll(".hub-seg-btn").forEach(h=>{h.classList.toggle("active",h.getAttribute("data-range")===R)}));let t=document.getElementById("hub-viewall-btn");t&&!t._wired&&(t._wired=!0,t.addEventListener("click",()=>{E=!E;try{localStorage.setItem("hub_skills_viewall",E?"1":"0")}catch{}t.textContent=E?"Show top 4 \u25B4":"View all skills \u25BE",z()}),t.textContent=E?"Show top 4 \u25B4":"View all skills \u25BE");let s=document.getElementById("hub-skill-search");s&&!s._wired?(s._wired=!0,s.value=N,s.addEventListener("input",()=>{N=s.value||"";try{localStorage.setItem("hub_skill_search",N)}catch{}z()})):s&&s.value!==N&&(s.value=N);let a=document.getElementById("hub-stats-tabs");a&&!a._wired&&(a._wired=!0,a.querySelectorAll(".hub-stats-tab").forEach(h=>{h.classList.toggle("active",h.getAttribute("data-mode")===b.mode),h.addEventListener("click",()=>{let m=h.getAttribute("data-mode");if(!(!m||m===b.mode)){b.mode=m;try{localStorage.setItem("hub_stats_mode",m)}catch{}a.querySelectorAll(".hub-stats-tab").forEach($=>$.classList.toggle("active",$===h)),ee()}})}));let i=document.getElementById("hub-stats-range");i&&!i._wired&&(i._wired=!0,i.querySelectorAll(".hub-stats-range-btn").forEach(h=>{h.classList.toggle("active",h.getAttribute("data-range")===b.range),h.addEventListener("click",()=>{let m=h.getAttribute("data-range");if(!(!m||m===b.range)){b.range=m;try{localStorage.setItem("hub_stats_range",m)}catch{}i.querySelectorAll(".hub-stats-range-btn").forEach($=>$.classList.toggle("active",$===h)),Xe()}})}));let r=document.getElementById("hub-heatmap-prev"),o=document.getElementById("hub-heatmap-next");r&&!r._wired&&(r._wired=!0,r.addEventListener("click",()=>{L.month-=1,L.month<1&&(L.month=12,L.year-=1),le()})),o&&!o._wired&&(o._wired=!0,o.addEventListener("click",()=>{L.month+=1,L.month>12&&(L.month=1,L.year+=1),le()}));let u=document.getElementById("hub-curator-refresh-btn");u&&!u._wired&&(u._wired=!0,u.addEventListener("click",U));let c=document.getElementById("hub-curator-run-btn");c&&!c._wired&&(c._wired=!0,c.addEventListener("click",Qe));let d=document.getElementById("hub-goals-refresh");d&&!d._wired&&(d._wired=!0,d.addEventListener("click",()=>pe({force:!0})));let g=document.getElementById("hub-providers-refresh");g&&!g._wired&&(g._wired=!0,g.addEventListener("click",me))}function st(){if(tt(),!L.year){let e=new Date;L.year=e.getFullYear(),L.month=e.getMonth()+1}me(),pe(),ae()}window.hubPageActivate=st;window.openHubSkillModal=be;window.closeHubSkillModal=$e;window.toggleHubSkillChangeCard=te;window.openHubSkillResource=ye;window.loadCuratorSuggestions=U;document.addEventListener("keydown",e=>{if(e.key==="Escape"){let t=document.getElementById("hub-skill-modal");t&&t.style.display==="flex"&&$e()}});export{Fe as a,st as b};
