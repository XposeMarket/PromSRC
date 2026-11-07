import{a as ae}from"./chunk-CWTU2L6E.js";import{a as ne}from"./chunk-MJNFGZ4Q.js";import{c as a,x as se}from"./chunk-JKXNXHXL.js";import{e as A}from"./chunk-GH6XZMJG.js";var Me=`
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <rect x="4" y="5" width="16" height="11" rx="2"></rect>
    <path d="M9 20h6"></path>
    <path d="M12 16v4"></path>
  </svg>
`;var R="week",C=!1,V=new Set,O=new Set,X=[],N="",M=[],de=4,ce=4,F=de,E=!1,ue=!1,I="",G=0,q=null,o={suggestions:[],activity:[],pending:0,quarantined:0,appliedActivity:0,observedActivity:0,lowRisk:0,mediumRisk:0,highRisk:0,totalCount:0,offset:0,nextOffset:null,hasMore:!1,loading:!1,loadingMore:!1,actingId:""},L={year:0,month:0,counts:{}},H={daily:[],stats:null},b={mode:"overview",range:"all",tools:null,models:null,loading:!1},_={items:[],loading:!1,loaded:!1};try{let e=localStorage.getItem("hub_stats_mode");(e==="overview"||e==="models")&&(b.mode=e);let t=localStorage.getItem("hub_stats_range");(t==="all"||t==="30d"||t==="7d"||t==="1d")&&(b.range=t)}catch{}try{let e=localStorage.getItem("hub_range");(e==="day"||e==="week"||e==="month")&&(R=e),C=localStorage.getItem("hub_skills_viewall")==="1",N=localStorage.getItem("hub_skill_search")||""}catch{}function B(e){if(!e)return"\u2014";try{let t=new Date(e);return isNaN(t.getTime())?"\u2014":t.toLocaleString()}catch{return"\u2014"}}function D(e){if(!e)return"never";let t=Date.parse(e);if(!isFinite(t))return"never";let s=Date.now()-t,n=Math.floor(s/6e4);if(n<1)return"just now";if(n<60)return n+"m ago";let i=Math.floor(n/60);if(i<24)return i+"h ago";let r=Math.floor(i/24);return r<30?r+"d ago":B(e)}function Le(e,t){if(!e||t<=0)return 0;let s=e/t;return s>.85?5:s>.65?4:s>.45?3:s>.25?2:1}function Te(e){let t=0;for(let s in e)t+=e[s]||0;return t}function T(e){let t=String(e||"").trim();return t?t.replace(/[-_]+/g," ").replace(/\b\w/g,s=>s.toUpperCase()):"Unknown"}function Ee(e){let t=String(e.lifecycle||"").trim(),s=String(e.ownership||"").trim(),n=String(e.status||"").trim(),i=[];return t&&i.push(`<span class="hub-skill-badge lifecycle" data-value="${a(t)}">${a(T(t))}</span>`),s&&i.push(`<span class="hub-skill-badge ownership" data-value="${a(s)}">${a(T(s))}</span>`),!t&&n&&i.push(`<span class="hub-skill-badge status" data-value="${a(n)}">${a(T(n))}</span>`),i.length?`<div class="hub-skill-badges">${i.join("")}</div>`:""}function Ce(e){return String(e||"").replace(/^\s*---\r?\n[\s\S]*?\r?\n---\r?\n?/,"").trimStart()}function he(e,t=3){let s=Array.isArray(e)?e.slice(0,t):[];return s.length?`
    <div class="hub-skill-change-list">
      ${s.map(n=>{let i=T(n.changeType||"skill_update"),r=D(n.timestamp),d=String(n.reason||"").trim(),u=Array.isArray(n.changedPaths)?n.changedPaths.filter(Boolean):[],c=String(n.appliedBy||"").trim(),l=String(n.evidence||"").trim(),h=n.metadata&&typeof n.metadata=="object"?n.metadata:null,g=JSON.stringify({changeType:n.changeType||"skill_update",timestamp:n.timestamp||"",reason:d,changedPaths:u,evidence:l,appliedBy:c,...h?{metadata:h}:{}},null,2);return`
          <div class="hub-skill-change" data-hub-change-card tabindex="0" role="button" aria-expanded="false">
            <div class="hub-skill-change-main">
              <span class="hub-skill-change-type">${a(i)}</span>
              <span class="hub-skill-change-time" title="${a(B(n.timestamp))}">${a(r)}</span>
            </div>
            ${d?`<div class="hub-skill-change-reason">${a(d)}</div>`:""}
            ${u.length?`<div class="hub-skill-change-paths">${u.slice(0,3).map(m=>`<span>${a(m)}</span>`).join("")}</div>`:""}
            ${c?`<div class="hub-skill-change-by">${a(c)}</div>`:""}
            <div class="hub-skill-change-detail"><pre>${a(g)}</pre></div>
          </div>
        `}).join("")}
    </div>
  `:'<div class="hub-skill-change-empty">No recent skill changes.</div>'}function xe(e){let t=Array.isArray(e?.resources)?e.resources:[];return t.length?`
    <details class="hub-modal-addons">
      <summary><span>Add-ons</span><strong>${t.length} file${t.length===1?"":"s"}</strong></summary>
      <div class="hub-modal-resource-list">
        ${t.map(s=>{let n=String(s?.path||"").trim();if(!n)return"";let i=String(s?.type||"").trim(),r=Number(s?.sizeBytes||0),d=String(s?.description||"").trim();return`
            <button class="hub-modal-resource-item" type="button" data-skill-id="${a(e.id)}" data-resource-path="${a(n)}">
              <span class="hub-modal-resource-path">${a(n)}</span>
              <span class="hub-modal-resource-meta">${a([i,r?`${r.toLocaleString()} bytes`:"",d].filter(Boolean).join(" \xB7 "))}</span>
            </button>
          `}).join("")}
      </div>
      <div id="hub-modal-resource-preview" class="hub-modal-resource-preview">
        <div class="hub-modal-resource-empty">Select a file to preview it.</div>
      </div>
    </details>
  `:""}function Ie(e){let t=V.has(e.id),s=Array.isArray(e.recentChanges)?e.recentChanges:[],n=e.promptSignals||{},i=[Array.isArray(n.phrases)?`${n.phrases.length} phrases`:"",Array.isArray(n.allOf)?`${n.allOf.length} allOf`:"",Array.isArray(n.anyOf)?`${n.anyOf.length} anyOf`:"",Array.isArray(n.noneOf)?`${n.noneOf.length} exclusions`:"",n.minScore!==void 0?`min ${n.minScore}`:""].filter(Boolean).join(" \xB7 ");return`
    <div class="hub-skill-card${t?" open":""}" data-skill-id="${a(e.id)}">
      <div class="hub-skill-card-head" data-action="toggle" data-id="${a(e.id)}">
        <div class="hub-skill-icon">${Me}</div>
        <div class="hub-skill-name" title="${a(e.name)}">${a(e.name)}</div>
        ${Ee(e)}
        <div class="hub-skill-count">${e.count} ${e.count===1?"use":"uses"}</div>
        <div class="hub-skill-preview">${a((e.description||"").slice(0,90))}${(e.description||"").length>90?"\u2026":""}</div>
      </div>
      <div class="hub-skill-card-body">
        <div class="hub-skill-meta-row"><span class="hub-skill-meta-label">Version</span><span class="hub-skill-meta-val">${a(e.version||"\u2014")}</span></div>
        <div class="hub-skill-meta-row"><span class="hub-skill-meta-label">Lifecycle</span><span class="hub-skill-meta-val">${a(T(e.lifecycle||e.status))}</span></div>
        <div class="hub-skill-meta-row"><span class="hub-skill-meta-label">Ownership</span><span class="hub-skill-meta-val">${a(T(e.ownership))}</span></div>
        ${i?`<div class="hub-skill-meta-row"><span class="hub-skill-meta-label">Trigger policy</span><span class="hub-skill-meta-val">${a(i)}</span></div>`:""}
        <div class="hub-skill-meta-row"><span class="hub-skill-meta-label">Last used</span><span class="hub-skill-meta-val" title="${a(B(e.lastUsed))}">${a(D(e.lastUsed))}</span></div>
        <div class="hub-skill-meta-row"><span class="hub-skill-meta-label">Last modified</span><span class="hub-skill-meta-val" title="${a(B(e.lastModified))}">${a(D(e.lastModified))}</span></div>
        <div class="hub-skill-card-changes">
          <div class="hub-skill-card-changes-title">Recent changes</div>
          ${he(s,2)}
        </div>
        <div class="hub-skill-card-actions">
          <button class="hub-skill-view-btn" data-action="view" data-id="${a(e.id)}" type="button">View</button>
          <button class="hub-skill-view-btn secondary" data-action="edit" data-id="${a(e.id)}" type="button">Edit</button>
        </div>
      </div>
    </div>
  `}function _e(e,t){if(!t)return!0;let s=e.requires||{},n=e.assignment||{},i=e.toolBinding||{};return[e.id,e.name,e.description,e.version,e.lifecycle,e.ownership,e.manifestSource,e.status,e.eligibility?.status,e.safety?.verdict,n.agentId,n.teamId,n.mode,i.mode,...Array.isArray(s.tools)?s.tools:[],...Array.isArray(s.connectors)?s.connectors:[],...Array.isArray(s.plugins)?s.plugins:[],...Array.isArray(e.triggers)?e.triggers:[],JSON.stringify(e.promptSignals||{})].join(" ").toLowerCase().includes(t)}function z(){let e=document.getElementById("hub-skills-grid");if(!e)return;let t=N.trim().toLowerCase(),s=X.filter(i=>_e(i,t)),n=t||C?s:s.slice(0,4);if(!n.length){e.innerHTML=`<div class="hub-empty">${t?"No matching skills found.":"No skills found."}</div>`,e.classList.toggle("hub-skills-grid-all",!!t||C);return}e.innerHTML=n.map(Ie).join(""),e.classList.toggle("hub-skills-grid-all",!!t||C),fe(e),e.querySelectorAll('[data-action="toggle"]').forEach(i=>{i.addEventListener("click",()=>{let r=i.getAttribute("data-id");r&&(V.has(r)?V.delete(r):V.add(r),z())})}),e.querySelectorAll('[data-action="view"]').forEach(i=>{i.addEventListener("click",r=>{r.stopPropagation();let d=i.getAttribute("data-id");d&&be(d)})}),e.querySelectorAll('[data-action="edit"]').forEach(i=>{i.addEventListener("click",r=>{r.stopPropagation();let d=i.getAttribute("data-id");d&&typeof window.editSkill=="function"&&window.editSkill(d)})})}function ge(e){return String(e?.id||`${e?.sessionId||"goal"}:${e?.createdAt||e?.updatedAt||""}`)}function j(e="",t="info"){let s=document.getElementById("hub-goals-status");s&&(s.hidden=!e,s.className=`hub-goals-status${t==="error"?" error":""}`,s.setAttribute("role",t==="error"?"alert":"status"),s.setAttribute("aria-live",t==="error"?"assertive":"polite"),s.textContent=e)}function Be(){let e=document.getElementById("hub-goals-refresh");e&&(e.disabled=E,e.setAttribute("aria-busy",E?"true":"false"),e.title=E?"Refreshing goals":"Refresh goals")}function ie(e,t="info"){return`<div class="hub-goals-state${t==="error"?" error":""}" role="${t==="error"?"alert":"status"}" aria-live="${t==="error"?"assertive":"polite"}">${a(e)}</div>`}function Ne(e){let t=String(e?.status||"unknown").trim().toLowerCase()||"unknown",s=ge(e),n=O.has(s),i=String(e?.progressSummary||e?.lastReason||e?.blockedReason||e?.pausedReason||e?.failureReason||"").trim(),r=Array.isArray(e?.deniedActions)?e.deniedActions:[],d=r[r.length-1]||null,u=Number(e?.updatedAt||e?.createdAt||0),c=Number.isFinite(u)&&u>0?new Date(u).toISOString():String(e?.updatedAt||e?.createdAt||""),l=e?.goalMetrics&&typeof e.goalMetrics=="object"?e.goalMetrics:null,h=l&&Number.isFinite(Number(l.elapsedMs))?Re(l.elapsedMs):"Not recorded",g=l&&Number.isFinite(Number(l.totalTokens))?Math.max(0,Number(l.totalTokens)).toLocaleString():"Not recorded",m=String(e?.goal||"Untitled goal");return`
    <article class="hub-goal-card${n?" open":""}" data-status="${a(t)}" data-goal-id="${a(s)}" title="${a(m)}" tabindex="0" role="button" aria-label="${a(m)}" aria-expanded="${n?"true":"false"}">
      <div class="hub-goal-card-head">
        <div class="hub-goal-status">${a(t)}${e?.current?" \xB7 current":""}</div>
        <div class="hub-goal-turns">${Number(e?.turnsUsed||0)} turns</div>
      </div>
      <div class="hub-goal-title">${a(m)}</div>
      <div class="hub-goal-meta">
        <span>${a(e?.sessionTitle||e?.sessionId||"session")}</span>
        <span>${a(D(c))}</span>
        <span>Autonomous</span>
        <span>Hard policy</span>
        ${r.length?`<span>${r.length} denied</span>`:""}
      </div>
      ${d?`<div class="hub-goal-denial">${a(`${d.category||"policy"}: ${d.reason||"Blocked by hard policy."}`)}</div>`:""}
      ${i?`<div class="hub-goal-summary">${a(i)}</div>`:""}
      <div class="hub-goal-expand-label">${n?"Hide goal metrics":"View goal metrics"} <span aria-hidden="true">${n?"\u25B4":"\u25BE"}</span></div>
      ${n?`
        <div class="hub-goal-details" aria-label="Goal metrics">
          <div><span>Total goal time</span><strong>${a(h)}</strong></div>
          <div><span>Tokens used</span><strong>${a(g)}</strong></div>
        </div>
      `:""}
    </article>
  `}function re({focusControl:e=!1}={}){E&&!ue||F>=M.length||(F=Math.min(M.length,F+ce),J(),e&&document.querySelector("[data-goal-load-more]")?.focus())}function J(){let e=document.getElementById("hub-achievements-grid");if(!e)return;let t=e.scrollTop;if(q&&(e.removeEventListener("scroll",q),q=null),e.setAttribute("aria-busy",E?"true":"false"),Be(),E&&!M.length){j(),e.setAttribute("aria-label","Goals loading"),e.innerHTML=ie("Loading goals\u2026"),e.scrollTop=0;return}if(!M.length){j(),e.setAttribute("aria-label",I?"Goals failed to load":"Goals"),e.innerHTML=ie(I?`Unable to load goals. ${I}`:"No main-chat goals yet.",I?"error":"info"),e.scrollTop=0;return}let s=[...O].map(c=>M.findIndex(l=>ge(l)===c)).filter(c=>c>=0),n=Math.max(de,F,s.length?Math.max(...s)+1:0),i=Math.min(M.length,n);F=i;let r=M.slice(0,i),d=i<M.length,u=Math.min(ce,M.length-i);E?j("Refreshing goals\u2026"):I?j(`Unable to refresh goals. ${I}`,"error"):j(),e.setAttribute("aria-label",`Goals, showing ${i} of ${M.length}`),e.innerHTML=`${r.map(Ne).join("")}
    ${d?`<button class="hub-goals-load-more" data-goal-load-more type="button" aria-controls="hub-achievements-grid">Show ${u} more goal${u===1?"":"s"} <span>${i} of ${M.length}</span></button>`:""}`,e.scrollTop=t,e.querySelectorAll("[data-goal-id]").forEach(c=>{let l=()=>{let h=c.getAttribute("data-goal-id");if(!h)return;let g=document.activeElement===c;O.has(h)?O.delete(h):O.add(h),J(),g&&[...e.querySelectorAll("[data-goal-id]")].find(m=>m.getAttribute("data-goal-id")===h)?.focus()};c.addEventListener("click",l),c.addEventListener("keydown",h=>{h.key!=="Enter"&&h.key!==" "||(h.preventDefault(),l())})}),e.querySelector("[data-goal-load-more]")?.addEventListener("click",()=>re({focusControl:!0})),d&&(q=()=>{e.scrollTop+e.clientHeight>=e.scrollHeight-48&&re()},e.addEventListener("scroll",q,{passive:!0}))}function He(){let e=document.getElementById("hub-heatmap-grid"),t=document.getElementById("hub-heatmap-label");if(!e||!t)return;let s=H.stats||{},n=Array.isArray(H.daily)?H.daily:[],i=Te(Object.fromEntries(n.map(f=>[f.date,f.tokens||f.count||0])));if(t.textContent=`Last 6 months \xB7 ${p(i)} tokens`,!n.length){e.innerHTML='<div class="hub-empty">No token activity recorded yet.</div>';return}let r=["S","M","T","W","T","F","S"],d='<div class="hub-heat-daylabels">';for(let f=0;f<7;f++)d+=`<div class="hub-heat-daylabel">${r[f]}</div>`;d+="</div>";let u=new Date(`${n[0].date}T00:00:00`),c=Number.isFinite(u.getTime())?u.getDay():0,l=n.map(f=>Math.max(0,Number(f.tokens||f.count||0))),h=Math.max(1,...l),g='<div class="hub-heatmap-cells hub-token-activity-cells">';for(let f=0;f<c;f++)g+='<div class="hub-heat-cell hub-heat-empty"></div>';n.forEach(f=>{let y=Math.max(0,Number(f.tokens||f.count||0)),k=Le(y,h),w=`${f.date} \u2014 ${p(y)} token${y===1?"":"s"}`;g+=`<div class="hub-heat-cell" data-level="${k}" title="${a(w)}"></div>`}),g+="</div>";let m=[],$=new Set;n.forEach((f,y)=>{let[k,w]=String(f.date||"").split("-"),S=`${k}-${w}`;if(!k||!w||$.has(S))return;$.add(S);let Z=new Date(`${f.date}T00:00:00`);m.push(`<span style="grid-column:${Math.floor((c+y)/7)+1}">${a(Z.toLocaleDateString(void 0,{month:"short"}))}</span>`)}),e.innerHTML=`<div class="hub-token-activity-wrap">${d}<div><div class="hub-token-months">${m.join("")}</div>${g}</div></div>`}function p(e){let t=Number(e)||0;return Math.abs(t)>=1e9?(t/1e9).toFixed(t>=1e10?0:1)+"B":Math.abs(t)>=1e6?(t/1e6).toFixed(t>=1e7?0:1)+"M":Math.abs(t)>=1e4?(t/1e3).toFixed(0)+"K":Math.abs(t)>=1e3?(t/1e3).toFixed(1)+"K":t.toLocaleString()}function x(e){let s=Math.max(0,Number(e)||0)/1e6;return s<=0?"$0":s>=100?"$"+s.toFixed(0):s>=1?"$"+s.toFixed(2):s>=.01?"$"+s.toFixed(3):"$"+s.toFixed(5)}function Q(e){let t=Math.max(0,Number(e)||0);if(t<=0)return"\u2014";if(t<1e3)return Math.round(t)+"ms";if(t<1e4)return(t/1e3).toFixed(2)+"s";if(t<6e4)return(t/1e3).toFixed(1)+"s";let s=Math.floor(t/6e4),n=Math.round(t%6e4/1e3);return s+"m"+(n?" "+n+"s":"")}function Re(e){let t=Number(e);if(!Number.isFinite(t)||t<0)return"Not recorded";if(t<1e3)return`${Math.round(t)}ms`;if(t<6e4)return`${(t/1e3).toFixed(t<1e4?2:1)}s`;let s=Math.floor(t/6e4),n=Math.round(t%6e4/1e3),i=Math.floor(s/60),r=s%60;return i>0?`${i}h${r?` ${r}m`:""}`:`${s}m${n?` ${n}s`:""}`}function v(e,t,s){return`
    <div class="hub-stat-tile">
      <div class="hub-stat-label">${a(e)}</div>
      <div class="hub-stat-value">${a(String(t))}</div>
      ${s?`<div class="hub-stat-sub">${a(s)}</div>`:""}
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
          <div class="hub-models-name" title="${a(s.name)}">${a(s.name)}</div>
          <div class="hub-models-num">${a(p(Number(s.count)||0))}</div>
          <div class="hub-models-num">${a(p(Number(s.contextTokens)||0))}</div>
          <div class="hub-models-num">${a(Q(s.durationMsAvg))}</div>
          <div class="hub-models-num">${a(Q(s.durationMsMax))}</div>
          <div class="hub-models-num">${a(x(s.totalCostMicros))}</div>
        </div>
      `).join("")}
    </div>
  `:'<div class="hub-empty">No tool telemetry recorded yet.</div>'}function ee(){let e=document.getElementById("hub-stats-tiles"),t=document.getElementById("hub-stats-models"),s=document.getElementById("hub-stats-footnote");if(!e||!t)return;if(b.loading){e.innerHTML='<div class="hub-empty">Loading\u2026</div>',t.style.display="none",s&&(s.textContent="");return}if(b.mode==="overview"){let l=b.tools&&b.tools.stats||{},h=b.models&&b.models.stats||{},g=l.chatSessions||h.chatSessions||0,m=l.messages||0,$=h.totalTokens||0,f=l.activeDays||h.activeDays||0,y=l.currentStreak||0,k=l.peakHour&&l.peakHour!=="\u2014"?l.peakHour:h.peakHour||"\u2014",w=h.favorite&&h.favorite!=="\u2014"?h.favorite:l.favorite||"\u2014",S=Number(h.totalCostMicros||0),Z=Number(l.directCostMicros||0),ke=Number(l.contextCostMicros||0),we=S+Z;if(e.innerHTML=[v("Est. spend",x(we),"model + direct tool"),v("Model cost",x(S),p($)+" tokens"),v("Tool context",x(ke),p(l.contextTokens||0)+" tokens"),v("Avg tool",Q(l.durationMsAvg),"max "+Q(l.durationMsMax)),v("Sessions",p(g)),v("Messages",p(m)),v("Tool calls",p(l.toolCalls||l.total||0)),v("Active days",String(f)),v("Current streak",y+"d"),v("Peak hour",String(k)),v("Favorite model",String(w))].join(""),t.innerHTML=De(b.tools||{}),t.style.display="",s){let Se=b.models&&b.models.summary||"",Ae=b.tools&&b.tools.summary||"";s.textContent=[Se,Ae].filter(Boolean).join(" ")}return}let n=b.models||{},i=n.stats||{},r=Array.isArray(n.topModels)?n.topModels:[],d=Array.isArray(n.topProviders)?n.topProviders:[],u=r.reduce((l,h)=>l+(Number(h.tokens)||0),0)||1;e.innerHTML=[v("Est. cost",x(i.totalCostMicros||0)),v("Total tokens",p(i.totalTokens||0)),v("Input",p(i.inputTokens||0)),v("Output",p(i.outputTokens||0)),v("Reasoning",p(i.reasoningTokens||0)),v("Cache",p(i.cacheTokens||0)),v("Model calls",p(i.messages||0)),v("Model sessions",p(i.modelSessions||i.sessions||0)),v("Favorite",String(i.favorite||"\u2014"))].join("");let c=d.length?`<div class="hub-models-providers">${d.map(l=>`
        <span class="hub-models-chip" title="${a(p(l.tokens)+" tokens \xB7 "+x(l.costMicros))}">
          <span class="hub-models-chip-name">${a(l.name)}</span>
          <span class="hub-models-chip-val">${a(p(l.tokens))}</span>
          <span class="hub-models-chip-val">${a(x(l.costMicros))}</span>
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
        ${r.map(l=>{let h=Number(l.tokens)||0,g=h/u*100;return`
            <div class="hub-models-row">
              <div class="hub-models-name" title="${a(l.name)}">${a(l.name)}</div>
              <div class="hub-models-num">${a(p(Number(l.calls)||0))}</div>
              <div class="hub-models-num">${a(p(h))}</div>
              <div class="hub-models-num">${a(x(l.costMicros))}</div>
              <div class="hub-models-num">${g.toFixed(1)}%</div>
              <div class="hub-models-bar-cell"><div class="hub-models-bar" style="width:${Math.max(2,Math.min(100,g))}%"></div></div>
            </div>
          `}).join("")}
      </div>
    `:t.innerHTML=`${c}<div class="hub-empty">No model usage recorded yet.</div>`,t.style.display="",s&&(s.textContent=n.summary||"")}function oe(){let e=document.getElementById("hub-providers-grid"),t=document.getElementById("hub-providers-section");if(!e)return;if(_.loading&&!_.loaded){e.innerHTML='<div class="hub-empty">Loading\u2026</div>';return}let s=_.items||[];if(!s.length){t&&(t.style.display="none");return}t&&(t.style.display=""),e.innerHTML=s.map(ne).join("")}async function me(){_.loading=!0,oe();try{let e=await A("/api/usage/limits",{timeoutMs:3e4});_.items=e&&Array.isArray(e.providers)?e.providers:[]}catch{_.items=[]}finally{_.loading=!1,_.loaded=!0,oe()}}function K(e){let t=String(e||"pending").toLowerCase();return t==="applied"?"applied":t==="rejected"?"rejected":t==="quarantined"?"quarantined":"pending"}function Y(e,t){let s=String(e||"");if(!s)return"";let n=String(t||"").trim().toLowerCase(),i=s.split(/\r?\n/),r=i.findIndex(u=>{let c=u.match(/^##\s+(.+?)\s*$/);return c&&c[1].trim().toLowerCase()===n});if(r<0)return"";let d=i.length;for(let u=r+1;u<i.length;u+=1)if(/^##\s+/.test(i[u])){d=u;break}return i.slice(r+1,d).join(`
`).trim()}function W(e,t=""){let s=String(e||"").replace(/\s+/g," ").trim();if(!s)return t;let n=s.match(/^(.{30,220}?[.!?])(?:\s|$)/);return n?n[1].trim():s.slice(0,220)}function qe(e){let t=Y(e,"Tool Sequence");if(!t)return"";let s=Array.from(t.matchAll(/^\s*[-*]\s*`?([a-zA-Z0-9_.:-]+)`?/gm)).map(i=>i[1]),n=[...new Set(s)].slice(0,5);return n.length?`Captures a reusable tool sequence: ${n.join(", ")}${s.length>n.length?`, +${s.length-n.length} more`:""}.`:""}function je(e,t){if(e?.learnedBehavior)return String(e.learnedBehavior);let s=Y(t,"Suggested Action"),n=Y(t,"Outcome Excerpt"),i=Y(t,"Request Excerpt"),r=qe(t),d=String(e?.change?.kind||"").toLowerCase();if(d==="write_resource"){let u=W(s||e?.reason,"Adds a reusable skill note from a completed run."),c=W(n||i,"");return[u,r||c].filter(Boolean).join(" ")}return d==="manifest_overlay"?W(s||e?.reason,"Updates the skill manifest metadata so Prometheus can route to this skill more reliably."):W(s||e?.reason,"Reviews a proposed skill improvement from Brain.")}function Oe(e){if(e?.approvePreview)return String(e.approvePreview);let t=e?.change||{},s=String(t.kind||"").toLowerCase(),n=String(e?.skillId||"this skill"),i=String(t.path||"").trim();return s==="write_resource"?`Approve will add ${i||"a resource file"} to ${n}.`:s==="manifest_overlay"?`Approve will update ${n}'s manifest metadata.`:s==="review_only"?"Approve will mark this daily skill-change audit accepted without changing skill files.":`Approve will apply this suggested change to ${n}.`}function Fe(e){let t=String(e||"").trim();return t?t.replace(/[_-]+/g," ").replace(/\b\w/g,s=>s.toUpperCase()):"Skill change"}function Pe(e){let t=String(e||"").toLowerCase();return t.includes("/recovery/")?"Recovery note":t.includes("/styles/")?"Style reference":t.includes("/workflows/")?"Workflow recipe":t.includes("/examples/")?"Example":t.includes("/templates/")?"Template":"Skill resource"}function Ue(e,t){let s=e?.change||{},n=String(s.kind||"").toLowerCase(),i=String(e?.skillId||"unknown skill").trim(),r=String(s.path||"").trim();if(n==="write_resource"){let d=Pe(r);return{action:`Create ${d.toLowerCase()}`,targetLabel:"Will write",target:r?`skill:${i}/${r}`:`skill:${i}/(new resource file)`,scope:`${d} for ${i}.`,writeNote:"Adds a reference file. It does not create a new skill or edit SKILL.md.",teachLabel:"Will teach",teach:t||e?.learnedBehavior||"A reusable behavior captured from Brain evidence."}}return n==="manifest_overlay"?{action:"Update skill routing metadata",targetLabel:"Will write",target:`skill:${i}/skill.json overlay`,scope:"Adds or adjusts trigger words so this skill is found earlier.",writeNote:"No instruction body or resource markdown is changed.",teachLabel:"Routing change",teach:t||e?.learnedBehavior||"Prometheus should route matching requests to this skill sooner."}:n==="review_only"?{action:"Accept daily skill-change audit",targetLabel:"File change",target:"No files written",scope:"Marks a self-improvement audit item as reviewed.",writeNote:"This accepts the audit record only.",teachLabel:"Audit purpose",teach:t||e?.learnedBehavior||"Checks that recent skill mutations were evidence-backed and safe."}:{action:"Apply suggested skill change",targetLabel:"Target",target:r?`skill:${i}/${r}`:`skill:${i}`,scope:"Applies a Brain skill suggestion.",writeNote:"Review the technical details before approving.",teachLabel:"Will teach",teach:t||e?.learnedBehavior||"A reusable skill behavior from Brain evidence."}}function Ge(e){let t=String(e?.change?.kind||"").toLowerCase();return t==="review_only"?"Accept audit":t==="manifest_overlay"?"Update trigger":t==="write_resource"?"Create file":"Apply change"}function We(e){let t=K(e.status),s=String(e.risk||"low").toLowerCase(),n=e.change||{},i=Array.isArray(e.evidence)?e.evidence:[],r=Array.isArray(e.scan?.findings)?e.scan.findings:[],d=String(n.content||"").trim(),u=je(e,d),c=Oe(e),l=Ue(e,u),h=Fe(e.lessonType||n.kind),g=t==="pending",m=o.actingId===e.id;return`
    <article class="hub-curator-card" data-status="${a(t)}" data-risk="${a(s)}">
      <div class="hub-curator-card-head">
        <div class="hub-curator-title-wrap">
          <div class="hub-curator-title">${a(e.title||"Untitled suggestion")}</div>
          <div class="hub-curator-meta">
            <span>${a(e.skillId||"unknown skill")}</span>
            <span>${a(e.lessonType||n.kind||"change")}</span>
            <span title="${a(B(e.updatedAt))}">${a(D(e.updatedAt))}</span>
          </div>
        </div>
        <div class="hub-curator-badges">
          <span class="hub-curator-badge kind">${a(h)}</span>
          <span class="hub-curator-badge status">${a(t)}</span>
          <span class="hub-curator-badge risk">${a(s)} risk</span>
          <span class="hub-curator-badge scan">${a(e.scan?.verdict||"unscanned")}</span>
        </div>
      </div>
      <div class="hub-curator-apply-preview">
        <span>Approve action</span>
        <strong>${a(l.action)}</strong>
        <small>${a(l.scope)}</small>
      </div>
      <div class="hub-curator-decision-grid">
        <div>
          <span>${a(l.targetLabel)}</span>
          <code title="${a(l.target)}">${a(l.target)}</code>
          <small>${a(l.writeNote)}</small>
        </div>
        <div>
          <span>${a(l.teachLabel)}</span>
          <strong>${a(l.teach)}</strong>
        </div>
        ${e.futureTrigger?`<div><span>Use when</span><strong>${a(e.futureTrigger)}</strong></div>`:""}
      </div>
      ${e.whyUseful?`<div class="hub-curator-why"><strong>Why keep it</strong> ${a(e.whyUseful)}</div>`:""}
      ${e.reason?`<div class="hub-curator-reason"><strong>Curator reason</strong> ${a(e.reason)}</div>`:""}
      <div class="hub-curator-path" title="${a(l.target)}"><span>Target</span>${a(l.target)}</div>
      ${i.length?`
        <div class="hub-curator-evidence-block">
          <span>Evidence sources</span>
          <div class="hub-curator-evidence">
          ${i.slice(0,4).map($=>`<span title="${a($)}">${a($)}</span>`).join("")}
          ${i.length>4?`<span>+${i.length-4} more</span>`:""}
          </div>
        </div>
      `:""}
      <details class="hub-curator-details">
        <summary>Technical evidence, raw file preview, and scan results</summary>
        <div class="hub-curator-detail-grid">
          <div><span>ID</span><code>${a(e.id||"")}</code></div>
          <div><span>Created</span><code>${a(B(e.createdAt))}</code></div>
          <div><span>Updated</span><code>${a(B(e.updatedAt))}</code></div>
          <div><span>Scan hash</span><code>${a(e.scan?.contentHash||"")}</code></div>
          <div><span>Quality</span><code>${a(String(e.qualityScore??"legacy"))}</code></div>
          <div><span>Auto</span><code>${a(e.autoApplyEligible?"eligible":"review")}</code></div>
          <div><span>Backend preview</span><code>${a(c)}</code></div>
          <div><span>Change kind</span><code>${a(n.kind||"unknown")}</code></div>
        </div>
        ${e.autoDecisionReason?`<div class="hub-curator-findings">${a(e.autoDecisionReason)}</div>`:""}
        ${r.length?`<div class="hub-curator-findings">${r.map($=>`<div>${a($.message||JSON.stringify($))}</div>`).join("")}</div>`:""}
        ${d?`<pre class="hub-curator-content">${a(d.slice(0,2400))}${d.length>2400?`
\u2026`:""}</pre>`:""}
      </details>
      <div class="hub-curator-card-actions">
        ${g?`
          <button class="hub-curator-btn approve" data-curator-action="apply" data-id="${a(e.id)}" type="button" ${m?"disabled":""}>${a(Ge(e))}</button>
          <button class="hub-curator-btn deny" data-curator-action="reject" data-id="${a(e.id)}" type="button" ${m?"disabled":""}>Deny</button>
        `:`<span class="hub-curator-resolved">${a(t)}</span>`}
      </div>
    </article>
  `}function Ve(e){let t=String(e?.status||"observed").toLowerCase()==="applied"?"applied":"observed",s=String(e?.appliedBy||e?.source||"brain").trim(),n=String(e?.risk||"").trim(),i=Array.isArray(e?.changedPaths)?e.changedPaths.filter(Boolean):[],r=Array.isArray(e?.evidence)?e.evidence.filter(Boolean):[],d=Array.isArray(e?.toolSequence)?e.toolSequence.filter(Boolean):[],u=String(e?.summary||e?.reason||e?.suggestedAction||"").trim();return`
    <article class="hub-curator-activity-card" data-status="${a(t)}">
      <div class="hub-curator-card-head">
        <div class="hub-curator-title-wrap">
          <div class="hub-curator-title">${a(e?.title||"Skill activity")}</div>
          <div class="hub-curator-meta">
            <span>${a(e?.skillId||"unassigned signal")}</span>
            <span>${a(e?.changeType||e?.source||"activity")}</span>
            <span title="${a(B(e?.timestamp))}">${a(D(e?.timestamp))}</span>
          </div>
        </div>
        <div class="hub-curator-badges">
          <span class="hub-curator-badge status">${a(t==="applied"?"applied":"observed")}</span>
          ${s?`<span class="hub-curator-badge scan">${a(s)}</span>`:""}
          ${n?`<span class="hub-curator-badge risk">${a(n)} risk</span>`:""}
        </div>
      </div>
      ${u?`<div class="hub-curator-lesson">${a(u)}</div>`:""}
      ${e?.requestExcerpt?`<div class="hub-curator-why"><strong>Observed</strong> ${a(e.requestExcerpt)}</div>`:""}
      ${e?.finalResponseExcerpt?`<div class="hub-curator-why"><strong>Outcome</strong> ${a(e.finalResponseExcerpt)}</div>`:""}
      ${i.length?`<div class="hub-curator-path" title="${a(i.join(", "))}"><span>Changed</span>${i.slice(0,4).map(a).join(", ")}${i.length>4?`, +${i.length-4} more`:""}</div>`:""}
      ${d.length?`<div class="hub-curator-evidence">${d.slice(0,6).map(c=>`<span title="${a(c)}">${a(c)}</span>`).join("")}${d.length>6?`<span>+${d.length-6} tools</span>`:""}</div>`:""}
      ${r.length?`
        <details class="hub-curator-details">
          <summary>Evidence</summary>
          <div class="hub-curator-evidence">
            ${r.slice(0,10).map(c=>`<span title="${a(c)}">${a(c)}</span>`).join("")}
            ${r.length>10?`<span>+${r.length-10} more</span>`:""}
          </div>
        </details>
      `:""}
    </article>
  `}function P(){let e=document.getElementById("hub-curator-list"),t=document.getElementById("hub-curator-summary"),s=document.getElementById("hub-curator-subtitle");if(!e)return;let n=Array.isArray(o.suggestions)?o.suggestions:[],i=Array.isArray(o.activity)?o.activity:[],r=n.length+i.length,d=Math.max(r,Number(o.totalCount||0)),u=n.reduce((y,k)=>{let w=K(k.status);return y[w]=(y[w]||0)+1,y},{}),c=Number(o.appliedActivity||0)||i.filter(y=>String(y?.status||"").toLowerCase()==="applied").length,l=Number(o.observedActivity||0)||Math.max(0,i.length-c),h=Number(o.pending||0)||u.pending||0,g=Number(o.quarantined||0)||u.quarantined||0;if(s&&(s.textContent=o.loading?"Loading Brain skill suggestions and Thought/Dream activity...":`${r} of ${d} shown \xB7 ${h} pending, ${g} quarantined, ${c} applied updates, ${l} observed signals`),t){let y=Number(o.lowRisk||0)||n.filter(S=>String(S.risk||"").toLowerCase()==="low").length,k=Number(o.mediumRisk||0)||n.filter(S=>String(S.risk||"").toLowerCase()==="medium").length,w=Number(o.highRisk||0)||n.filter(S=>String(S.risk||"").toLowerCase()==="high").length;t.innerHTML=[v("Pending",p(h)),v("Quarantined",p(g)),v("Applied Updates",p(c)),v("Observed Signals",p(l)),v("Low risk",p(y)),v("Medium risk",p(k)),v("High risk",p(w)),v("Total",p(n.length+i.length))].join("")}if(o.loading&&!n.length&&!i.length){e.innerHTML='<div class="hub-empty">Loading curator suggestions and activity...</div>';return}if(!n.length&&!i.length){e.innerHTML='<div class="hub-empty">No skill curator suggestions or Thought/Dream activity yet.</div>';return}let m=n.slice().sort((y,k)=>{let w=K(y.status)==="pending"?0:1,S=K(k.status)==="pending"?0:1;return w-S||String(k.updatedAt||"").localeCompare(String(y.updatedAt||""))}),$=i.slice().sort((y,k)=>String(k.timestamp||"").localeCompare(String(y.timestamp||"")));e.innerHTML=[m.length?`<div class="hub-curator-group-title">Review Queue</div>${m.map(We).join("")}`:"",$.length?`<div class="hub-curator-group-title">Thought and Dream Activity</div>${$.map(Ve).join("")}`:"",o.hasMore?`<button class="hub-curator-load-more" id="hub-curator-load-more" type="button" ${o.loadingMore?"disabled":""}>${o.loadingMore?"Loading\u2026":`Show ${Math.min(5,Math.max(1,d-r))} more`}</button>`:""].filter(Boolean).join(""),e.querySelectorAll("[data-curator-action]").forEach(y=>{y.addEventListener("click",k=>{k.stopPropagation(),Ye(y.getAttribute("data-id"),y.getAttribute("data-curator-action"),y)})});let f=e.querySelector("#hub-curator-load-more");f&&f.addEventListener("click",()=>U({reset:!1}))}async function U({reset:e=!0}={}){if(!e&&(o.loadingMore||!o.hasMore))return;e?(o.loading=!0,o.loadingMore=!1,o.suggestions=[],o.activity=[],o.pending=0,o.quarantined=0,o.appliedActivity=0,o.observedActivity=0,o.lowRisk=0,o.mediumRisk=0,o.highRisk=0,o.totalCount=0,o.offset=0,o.nextOffset=null,o.hasMore=!1):o.loadingMore=!0,P();let t=e?0:Number(o.nextOffset??o.offset??0);try{let s=await A(`/api/hub/skills/review?limit=5&offset=${encodeURIComponent(t)}`,{timeoutMs:3e4}),n=Array.isArray(s?.suggestions)?s.suggestions:[],i=Array.isArray(s?.activity)?s.activity:[];if(e)o.suggestions=n,o.activity=i;else{let r=new Set(o.suggestions.map(u=>String(u?.id||"")).filter(Boolean)),d=new Set(o.activity.map(u=>String(u?.id||"")).filter(Boolean));o.suggestions=o.suggestions.concat(n.filter(u=>{let c=String(u?.id||"");return!c||!r.has(c)})),o.activity=o.activity.concat(i.filter(u=>{let c=String(u?.id||"");return!c||!d.has(c)}))}o.pending=Number(s?.pending||0),o.quarantined=Number(s?.quarantined||0),o.appliedActivity=Number(s?.appliedActivity||0),o.observedActivity=Number(s?.observedActivity||0),o.lowRisk=Number(s?.lowRisk||0),o.mediumRisk=Number(s?.mediumRisk||0),o.highRisk=Number(s?.highRisk||0),o.totalCount=Number(s?.totalCount||o.suggestions.length+o.activity.length),o.offset=Number(s?.offset??t),o.nextOffset=s?.nextOffset==null?null:Number(s.nextOffset),o.hasMore=s?.hasMore===!0||o.nextOffset!==null}catch{e?(o.suggestions=[],o.activity=[],o.totalCount=0):window.showToast?.("Could not load more curator activity","Try again in a moment.","error")}finally{o.loading=!1,o.loadingMore=!1,o.actingId="",P()}}async function Ke(){o.loading=!0,P();try{await A("/api/hub/skills/review/run",{method:"POST",body:{mode:"pending"},timeoutMs:6e4})}catch(e){window.showToast?.("Skill curator run failed",e?.message||String(e),"error")}finally{await U()}}async function Ye(e,t,s){let n=String(e||"").trim(),i=String(t||"").trim();if(!(!n||!i)){o.actingId=n,s&&(s.disabled=!0),P();try{await A(`/api/hub/skills/review/${encodeURIComponent(n)}/${i==="apply"?"apply":"reject"}`,{method:"POST",body:{},timeoutMs:3e4}),await U(),ve()}catch(r){window.showToast?.("Skill curator action failed",r?.message||String(r),"error"),o.actingId="",P()}}}async function ze(){b.loading=!(b.tools||b.models),ee();let e=encodeURIComponent(b.range);try{let[t,s]=await Promise.allSettled([A(`/api/hub/tools/overview?range=${e}`,{timeoutMs:3e4}),A(`/api/hub/models/overview?range=${e}`,{timeoutMs:3e4})]);t.status==="fulfilled"&&t.value&&t.value.success!==!1&&(b.tools=t.value),s.status==="fulfilled"&&s.value&&s.value.success!==!1&&(b.models=s.value)}finally{b.loading=!1,ee()}}async function ve(){try{let e=await A(`/api/hub/skills/usage?range=${encodeURIComponent(R)}`);X=Array.isArray(e?.skills)?e.skills:[]}catch{X=[]}z()}async function pe({force:e=!1}={}){if(E&&!e)return;let t=++G;E=!0,I="",J();try{let s=await A("/api/hub/goals");if(t!==G)return;if(s?.success===!1)throw new Error(s.error||"The goals endpoint returned an error.");M=Array.isArray(s?.goals)?s.goals:[],ue=!0}catch(s){if(t!==G)return;I=s?.message||String(s)}finally{if(t!==G)return;E=!1,J()}}async function le(){try{let e=await A("/api/hub/tokens/activity?range=6m",{timeoutMs:3e4});H.daily=Array.isArray(e?.daily)?e.daily:[],H.stats=e?.stats||null}catch{H.daily=[],H.stats=null}He()}async function be(e){let t=document.getElementById("hub-skill-modal"),s=document.getElementById("hub-modal-body"),n=document.getElementById("hub-modal-name"),i=document.getElementById("hub-modal-version");if(!(!t||!s)){s.innerHTML='<div class="hub-empty">Loading\u2026</div>',t.style.display="flex";try{let d=(await A(`/api/hub/skills/${encodeURIComponent(e)}/content`))?.skill||{};n&&(n.textContent=d.name||e),i&&(i.textContent=d.version?`v${d.version}`:"");let u=Ce(d.content),c=`
      <div class="hub-modal-skill-meta">
        <div class="hub-modal-skill-meta-item"><span>Status</span><strong>${a(T(d.status))}</strong></div>
        <div class="hub-modal-skill-meta-item"><span>Lifecycle</span><strong>${a(T(d.lifecycle||d.status))}</strong></div>
        <div class="hub-modal-skill-meta-item"><span>Ownership</span><strong>${a(T(d.ownership))}</strong></div>
        <div class="hub-modal-skill-meta-item"><span>Manifest</span><strong>${a(T(d.manifestSource))}</strong></div>
      </div>
        <div class="hub-modal-change-panel">
          <div class="hub-modal-section-title">Recent skill changes</div>
          ${he(d.recentChanges,8)}
        </div>
        ${xe(d)}
      `,l;try{l=se(u)}catch{l=`<pre>${a(u)}</pre>`}s.innerHTML=`${c}<div class="hub-modal-markdown">${l}</div>`,fe(s),Je(s)}catch(r){s.innerHTML=`<div class="hub-empty">Failed to load skill: ${a(r?.message||String(r))}</div>`}}}function te(e){if(!e)return;let t=e.classList.toggle("open");e.setAttribute("aria-expanded",t?"true":"false")}function fe(e=document){e.querySelectorAll("[data-hub-change-card]").forEach(t=>{t.dataset.changeBound!=="1"&&(t.dataset.changeBound="1",t.addEventListener("click",s=>{s.target.closest("a,button")||te(t)}),t.addEventListener("keydown",s=>{s.key!=="Enter"&&s.key!==" "||(s.preventDefault(),te(t))}))})}function Je(e=document){e.querySelectorAll(".hub-modal-resource-item[data-skill-id][data-resource-path]").forEach(t=>{t.dataset.resourceBound!=="1"&&(t.dataset.resourceBound="1",t.addEventListener("click",s=>{s.preventDefault(),s.stopPropagation(),ye(t.dataset.skillId||"",t.dataset.resourcePath||"")}))})}async function ye(e,t){let s=document.getElementById("hub-modal-resource-preview");if(s){s.innerHTML=`<div class="hub-modal-resource-empty">Loading ${a(t)}...</div>`;try{let i=(await A(`/api/hub/skills/${encodeURIComponent(e)}/resources/content?path=${encodeURIComponent(t)}`))?.resource||{};s.innerHTML=`
      <div class="hub-modal-resource-preview-head">
        <strong>${a(i.path||t)}</strong>
        ${i.truncated?"<span>Truncated</span>":""}
      </div>
      <pre>${a(i.content||"")}</pre>
    `}catch(n){s.innerHTML=`<div class="hub-modal-resource-empty">Failed to load file: ${a(n?.message||String(n))}</div>`}}}function $e(){let e=document.getElementById("hub-skill-modal");e&&(e.style.display="none")}function Qe(){let e=document.getElementById("hub-range-seg");e&&!e._wired&&(e._wired=!0,e.querySelectorAll(".hub-seg-btn").forEach(g=>{g.addEventListener("click",()=>{let m=g.getAttribute("data-range");if(!(!m||m===R)){R=m;try{localStorage.setItem("hub_range",R)}catch{}e.querySelectorAll(".hub-seg-btn").forEach($=>$.classList.toggle("active",$===g)),ve()}})}),e.querySelectorAll(".hub-seg-btn").forEach(g=>{g.classList.toggle("active",g.getAttribute("data-range")===R)}));let t=document.getElementById("hub-viewall-btn");t&&!t._wired&&(t._wired=!0,t.addEventListener("click",()=>{C=!C;try{localStorage.setItem("hub_skills_viewall",C?"1":"0")}catch{}t.textContent=C?"Show top 4 \u25B4":"View all skills \u25BE",z()}),t.textContent=C?"Show top 4 \u25B4":"View all skills \u25BE");let s=document.getElementById("hub-skill-search");s&&!s._wired?(s._wired=!0,s.value=N,s.addEventListener("input",()=>{N=s.value||"";try{localStorage.setItem("hub_skill_search",N)}catch{}z()})):s&&s.value!==N&&(s.value=N);let n=document.getElementById("hub-stats-tabs");n&&!n._wired&&(n._wired=!0,n.querySelectorAll(".hub-stats-tab").forEach(g=>{g.classList.toggle("active",g.getAttribute("data-mode")===b.mode),g.addEventListener("click",()=>{let m=g.getAttribute("data-mode");if(!(!m||m===b.mode)){b.mode=m;try{localStorage.setItem("hub_stats_mode",m)}catch{}n.querySelectorAll(".hub-stats-tab").forEach($=>$.classList.toggle("active",$===g)),ee()}})}));let i=document.getElementById("hub-stats-range");i&&!i._wired&&(i._wired=!0,i.querySelectorAll(".hub-stats-range-btn").forEach(g=>{g.classList.toggle("active",g.getAttribute("data-range")===b.range),g.addEventListener("click",()=>{let m=g.getAttribute("data-range");if(!(!m||m===b.range)){b.range=m;try{localStorage.setItem("hub_stats_range",m)}catch{}i.querySelectorAll(".hub-stats-range-btn").forEach($=>$.classList.toggle("active",$===g)),ze()}})}));let r=document.getElementById("hub-heatmap-prev"),d=document.getElementById("hub-heatmap-next");r&&!r._wired&&(r._wired=!0,r.addEventListener("click",()=>{L.month-=1,L.month<1&&(L.month=12,L.year-=1),le()})),d&&!d._wired&&(d._wired=!0,d.addEventListener("click",()=>{L.month+=1,L.month>12&&(L.month=1,L.year+=1),le()}));let u=document.getElementById("hub-curator-refresh-btn");u&&!u._wired&&(u._wired=!0,u.addEventListener("click",U));let c=document.getElementById("hub-curator-run-btn");c&&!c._wired&&(c._wired=!0,c.addEventListener("click",Ke));let l=document.getElementById("hub-goals-refresh");l&&!l._wired&&(l._wired=!0,l.addEventListener("click",()=>pe({force:!0})));let h=document.getElementById("hub-providers-refresh");h&&!h._wired&&(h._wired=!0,h.addEventListener("click",me))}function Ze(){if(Qe(),!L.year){let e=new Date;L.year=e.getFullYear(),L.month=e.getMonth()+1}me(),pe(),ae()}window.hubPageActivate=Ze;window.openHubSkillModal=be;window.closeHubSkillModal=$e;window.toggleHubSkillChangeCard=te;window.openHubSkillResource=ye;window.loadCuratorSuggestions=U;document.addEventListener("keydown",e=>{if(e.key==="Escape"){let t=document.getElementById("hub-skill-modal");t&&t.style.display==="flex"&&$e()}});export{Ze as a};
