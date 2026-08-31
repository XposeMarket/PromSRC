import{b as A}from"./chunk-JF4LWGNM.js";import{a as oe}from"./chunk-GBLBNUG2.js";import{a as n,r as re}from"./chunk-IPNQ4FF4.js";var Ce=`
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <rect x="4" y="5" width="16" height="11" rx="2"></rect>
    <path d="M9 20h6"></path>
    <path d="M12 16v4"></path>
  </svg>
`;var R="week",C=!1,K=new Set,F=new Set,ee=[],N="",M=[],ge=4,he=4,P=ge,E=!1,me=!1,_="",W=0,j=null,d={suggestions:[],activity:[],pending:0,quarantined:0,appliedActivity:0,observedActivity:0,lowRisk:0,mediumRisk:0,highRisk:0,totalCount:0,offset:0,nextOffset:null,hasMore:!1,loading:!1,loadingMore:!1,actingId:""},L={year:0,month:0,counts:{}},H={daily:[],stats:null},y={mode:"overview",range:"all",tools:null,models:null,loading:!1},I={items:[],loading:!1,loaded:!1};try{let e=localStorage.getItem("hub_stats_mode");(e==="overview"||e==="models")&&(y.mode=e);let t=localStorage.getItem("hub_stats_range");(t==="all"||t==="30d"||t==="7d"||t==="1d")&&(y.range=t)}catch{}var U={startISO:"",counts:{}};try{let e=localStorage.getItem("hub_range");(e==="day"||e==="week"||e==="month")&&(R=e),C=localStorage.getItem("hub_skills_viewall")==="1",N=localStorage.getItem("hub_skill_search")||""}catch{}function B(e){if(!e)return"\u2014";try{let t=new Date(e);return isNaN(t.getTime())?"\u2014":t.toLocaleString()}catch{return"\u2014"}}function D(e){if(!e)return"never";let t=Date.parse(e);if(!isFinite(t))return"never";let s=Date.now()-t,a=Math.floor(s/6e4);if(a<1)return"just now";if(a<60)return a+"m ago";let i=Math.floor(a/60);if(i<24)return i+"h ago";let r=Math.floor(i/24);return r<30?r+"d ago":B(e)}function xe(e,t){if(!e||t<=0)return 0;let s=e/t;return s>.85?5:s>.65?4:s>.45?3:s>.25?2:1}function _e(e){let t=0;for(let s in e)t+=e[s]||0;return t}function ve(e){let t=new Date(e.getFullYear(),e.getMonth(),e.getDate());return t.setDate(t.getDate()-t.getDay()),t}function pe(e){let t=e.getFullYear(),s=String(e.getMonth()+1).padStart(2,"0"),a=String(e.getDate()).padStart(2,"0");return`${t}-${s}-${a}`}function T(e){let t=String(e||"").trim();return t?t.replace(/[-_]+/g," ").replace(/\b\w/g,s=>s.toUpperCase()):"Unknown"}function Ie(e){let t=String(e.lifecycle||"").trim(),s=String(e.ownership||"").trim(),a=String(e.status||"").trim(),i=[];return t&&i.push(`<span class="hub-skill-badge lifecycle" data-value="${n(t)}">${n(T(t))}</span>`),s&&i.push(`<span class="hub-skill-badge ownership" data-value="${n(s)}">${n(T(s))}</span>`),!t&&a&&i.push(`<span class="hub-skill-badge status" data-value="${n(a)}">${n(T(a))}</span>`),i.length?`<div class="hub-skill-badges">${i.join("")}</div>`:""}function Be(e){return String(e||"").replace(/^\s*---\r?\n[\s\S]*?\r?\n---\r?\n?/,"").trimStart()}function be(e,t=3){let s=Array.isArray(e)?e.slice(0,t):[];return s.length?`
    <div class="hub-skill-change-list">
      ${s.map(a=>{let i=T(a.changeType||"skill_update"),r=D(a.timestamp),o=String(a.reason||"").trim(),c=Array.isArray(a.changedPaths)?a.changedPaths.filter(Boolean):[],u=String(a.appliedBy||"").trim(),l=String(a.evidence||"").trim(),g=a.metadata&&typeof a.metadata=="object"?a.metadata:null,h=JSON.stringify({changeType:a.changeType||"skill_update",timestamp:a.timestamp||"",reason:o,changedPaths:c,evidence:l,appliedBy:u,...g?{metadata:g}:{}},null,2);return`
          <div class="hub-skill-change" data-hub-change-card tabindex="0" role="button" aria-expanded="false">
            <div class="hub-skill-change-main">
              <span class="hub-skill-change-type">${n(i)}</span>
              <span class="hub-skill-change-time" title="${n(B(a.timestamp))}">${n(r)}</span>
            </div>
            ${o?`<div class="hub-skill-change-reason">${n(o)}</div>`:""}
            ${c.length?`<div class="hub-skill-change-paths">${c.slice(0,3).map(p=>`<span>${n(p)}</span>`).join("")}</div>`:""}
            ${u?`<div class="hub-skill-change-by">${n(u)}</div>`:""}
            <div class="hub-skill-change-detail"><pre>${n(h)}</pre></div>
          </div>
        `}).join("")}
    </div>
  `:'<div class="hub-skill-change-empty">No recent skill changes.</div>'}function Ne(e){let t=Array.isArray(e?.resources)?e.resources:[];return t.length?`
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
  `:""}function He(e){let t=K.has(e.id),s=Array.isArray(e.recentChanges)?e.recentChanges:[],a=e.promptSignals||{},i=[Array.isArray(a.phrases)?`${a.phrases.length} phrases`:"",Array.isArray(a.allOf)?`${a.allOf.length} allOf`:"",Array.isArray(a.anyOf)?`${a.anyOf.length} anyOf`:"",Array.isArray(a.noneOf)?`${a.noneOf.length} exclusions`:"",a.minScore!==void 0?`min ${a.minScore}`:""].filter(Boolean).join(" \xB7 ");return`
    <div class="hub-skill-card${t?" open":""}" data-skill-id="${n(e.id)}">
      <div class="hub-skill-card-head" data-action="toggle" data-id="${n(e.id)}">
        <div class="hub-skill-icon">${Ce}</div>
        <div class="hub-skill-name" title="${n(e.name)}">${n(e.name)}</div>
        ${Ie(e)}
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
          ${be(s,2)}
        </div>
        <div class="hub-skill-card-actions">
          <button class="hub-skill-view-btn" data-action="view" data-id="${n(e.id)}" type="button">View</button>
          <button class="hub-skill-view-btn secondary" data-action="edit" data-id="${n(e.id)}" type="button">Edit</button>
        </div>
      </div>
    </div>
  `}function Re(e,t){if(!t)return!0;let s=e.requires||{},a=e.assignment||{},i=e.toolBinding||{};return[e.id,e.name,e.description,e.version,e.lifecycle,e.ownership,e.manifestSource,e.status,e.eligibility?.status,e.safety?.verdict,a.agentId,a.teamId,a.mode,i.mode,...Array.isArray(s.tools)?s.tools:[],...Array.isArray(s.connectors)?s.connectors:[],...Array.isArray(s.plugins)?s.plugins:[],...Array.isArray(e.triggers)?e.triggers:[],JSON.stringify(e.promptSignals||{})].join(" ").toLowerCase().includes(t)}function J(){let e=document.getElementById("hub-skills-grid");if(!e)return;let t=N.trim().toLowerCase(),s=ee.filter(i=>Re(i,t)),a=t||C?s:s.slice(0,4);if(!a.length){e.innerHTML=`<div class="hub-empty">${t?"No matching skills found.":"No skills found."}</div>`,e.classList.toggle("hub-skills-grid-all",!!t||C);return}e.innerHTML=a.map(He).join(""),e.classList.toggle("hub-skills-grid-all",!!t||C),we(e),e.querySelectorAll('[data-action="toggle"]').forEach(i=>{i.addEventListener("click",()=>{let r=i.getAttribute("data-id");r&&(K.has(r)?K.delete(r):K.add(r),J())})}),e.querySelectorAll('[data-action="view"]').forEach(i=>{i.addEventListener("click",r=>{r.stopPropagation();let o=i.getAttribute("data-id");o&&ke(o)})}),e.querySelectorAll('[data-action="edit"]').forEach(i=>{i.addEventListener("click",r=>{r.stopPropagation();let o=i.getAttribute("data-id");o&&typeof window.editSkill=="function"&&window.editSkill(o)})})}function fe(e){return String(e?.id||`${e?.sessionId||"goal"}:${e?.createdAt||e?.updatedAt||""}`)}function O(e="",t="info"){let s=document.getElementById("hub-goals-status");s&&(s.hidden=!e,s.className=`hub-goals-status${t==="error"?" error":""}`,s.setAttribute("role",t==="error"?"alert":"status"),s.setAttribute("aria-live",t==="error"?"assertive":"polite"),s.textContent=e)}function De(){let e=document.getElementById("hub-goals-refresh");e&&(e.disabled=E,e.setAttribute("aria-busy",E?"true":"false"),e.title=E?"Refreshing goals":"Refresh goals")}function le(e,t="info"){return`<div class="hub-goals-state${t==="error"?" error":""}" role="${t==="error"?"alert":"status"}" aria-live="${t==="error"?"assertive":"polite"}">${n(e)}</div>`}function qe(e){let t=String(e?.status||"unknown").trim().toLowerCase()||"unknown",s=fe(e),a=F.has(s),i=String(e?.progressSummary||e?.lastReason||e?.blockedReason||e?.pausedReason||e?.failureReason||"").trim(),r=Array.isArray(e?.deniedActions)?e.deniedActions:[],o=r[r.length-1]||null,c=Number(e?.updatedAt||e?.createdAt||0),u=Number.isFinite(c)&&c>0?new Date(c).toISOString():String(e?.updatedAt||e?.createdAt||""),l=e?.goalMetrics&&typeof e.goalMetrics=="object"?e.goalMetrics:null,g=l&&Number.isFinite(Number(l.elapsedMs))?Fe(l.elapsedMs):"Not recorded",h=l&&Number.isFinite(Number(l.totalTokens))?Math.max(0,Number(l.totalTokens)).toLocaleString():"Not recorded",p=String(e?.goal||"Untitled goal");return`
    <article class="hub-goal-card${a?" open":""}" data-status="${n(t)}" data-goal-id="${n(s)}" title="${n(p)}" tabindex="0" role="button" aria-label="${n(p)}" aria-expanded="${a?"true":"false"}">
      <div class="hub-goal-card-head">
        <div class="hub-goal-status">${n(t)}${e?.current?" \xB7 current":""}</div>
        <div class="hub-goal-turns">${Number(e?.turnsUsed||0)} turns</div>
      </div>
      <div class="hub-goal-title">${n(p)}</div>
      <div class="hub-goal-meta">
        <span>${n(e?.sessionTitle||e?.sessionId||"session")}</span>
        <span>${n(D(u))}</span>
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
  `}function de({focusControl:e=!1}={}){E&&!me||P>=M.length||(P=Math.min(M.length,P+he),Q(),e&&document.querySelector("[data-goal-load-more]")?.focus())}function Q(){let e=document.getElementById("hub-achievements-grid");if(!e)return;let t=e.scrollTop;if(j&&(e.removeEventListener("scroll",j),j=null),e.setAttribute("aria-busy",E?"true":"false"),De(),E&&!M.length){O(),e.setAttribute("aria-label","Goals loading"),e.innerHTML=le("Loading goals\u2026"),e.scrollTop=0;return}if(!M.length){O(),e.setAttribute("aria-label",_?"Goals failed to load":"Goals"),e.innerHTML=le(_?`Unable to load goals. ${_}`:"No main-chat goals yet.",_?"error":"info"),e.scrollTop=0;return}let s=[...F].map(u=>M.findIndex(l=>fe(l)===u)).filter(u=>u>=0),a=Math.max(ge,P,s.length?Math.max(...s)+1:0),i=Math.min(M.length,a);P=i;let r=M.slice(0,i),o=i<M.length,c=Math.min(he,M.length-i);E?O("Refreshing goals\u2026"):_?O(`Unable to refresh goals. ${_}`,"error"):O(),e.setAttribute("aria-label",`Goals, showing ${i} of ${M.length}`),e.innerHTML=`${r.map(qe).join("")}
    ${o?`<button class="hub-goals-load-more" data-goal-load-more type="button" aria-controls="hub-achievements-grid">Show ${c} more goal${c===1?"":"s"} <span>${i} of ${M.length}</span></button>`:""}`,e.scrollTop=t,e.querySelectorAll("[data-goal-id]").forEach(u=>{let l=()=>{let g=u.getAttribute("data-goal-id");if(!g)return;let h=document.activeElement===u;F.has(g)?F.delete(g):F.add(g),Q(),h&&[...e.querySelectorAll("[data-goal-id]")].find(p=>p.getAttribute("data-goal-id")===g)?.focus()};u.addEventListener("click",l),u.addEventListener("keydown",g=>{g.key!=="Enter"&&g.key!==" "||(g.preventDefault(),l())})}),e.querySelector("[data-goal-load-more]")?.addEventListener("click",()=>de({focusControl:!0})),o&&(j=()=>{e.scrollTop+e.clientHeight>=e.scrollHeight-48&&de()},e.addEventListener("scroll",j,{passive:!0}))}function je(){let e=document.getElementById("hub-heatmap-grid"),t=document.getElementById("hub-heatmap-label");if(!e||!t)return;let s=H.stats||{},a=Array.isArray(H.daily)?H.daily:[],i=_e(Object.fromEntries(a.map(m=>[m.date,m.tokens||m.count||0])));if(t.textContent=`Last 6 months \xB7 ${b(i)} tokens`,!a.length){e.innerHTML='<div class="hub-empty">No token activity recorded yet.</div>';return}let r=["S","M","T","W","T","F","S"],o='<div class="hub-heat-daylabels">';for(let m=0;m<7;m++)o+=`<div class="hub-heat-daylabel">${r[m]}</div>`;o+="</div>";let c=new Date(`${a[0].date}T00:00:00`),u=Number.isFinite(c.getTime())?c.getDay():0,l=a.map(m=>Math.max(0,Number(m.tokens||m.count||0))),g=Math.max(1,...l),h='<div class="hub-heatmap-cells hub-token-activity-cells">';for(let m=0;m<u;m++)h+='<div class="hub-heat-cell hub-heat-empty"></div>';a.forEach(m=>{let v=Math.max(0,Number(m.tokens||m.count||0)),k=xe(v,g),w=`${m.date} \u2014 ${b(v)} token${v===1?"":"s"}`;h+=`<div class="hub-heat-cell" data-level="${k}" title="${n(w)}"></div>`}),h+="</div>";let p=[],$=new Set;a.forEach((m,v)=>{let[k,w]=String(m.date||"").split("-"),S=`${k}-${w}`;if(!k||!w||$.has(S))return;$.add(S);let X=new Date(`${m.date}T00:00:00`);p.push(`<span style="grid-column:${Math.floor((u+v)/7)+1}">${n(X.toLocaleDateString(void 0,{month:"short"}))}</span>`)}),e.innerHTML=`<div class="hub-token-activity-wrap">${o}<div><div class="hub-token-months">${p.join("")}</div>${h}</div></div>`}function Oe(){let e=document.getElementById("hub-daily-bars"),t=document.getElementById("hub-daily-summary");if(!e||!t)return;let s=U.startISO?new Date(U.startISO+"T00:00:00"):ve(new Date),a=[];for(let m=0;m<7;m++){let v=new Date(s.getFullYear(),s.getMonth(),s.getDate()+m);a.push({key:pe(v),date:v})}let i=a.map(m=>U.counts[m.key]||0),r=Math.max(1,...i),o=i.reduce((m,v)=>m+v,0),c=i.filter(m=>m>0).length,u=c>0?c:7,l=Math.round(o/u),g=s.toLocaleDateString(void 0,{month:"short",day:"numeric"}),h=a[6].date.toLocaleDateString(void 0,{month:"short",day:"numeric"});t.innerHTML=`
    <div class="hub-daily-summary-left">
      <div class="hub-daily-summary-label">Daily Average \xB7 This Week</div>
      <div class="hub-daily-summary-value">${l.toLocaleString()}<span class="hub-daily-summary-unit">tool calls</span></div>
      <div class="hub-daily-summary-range">${n(g)} \u2013 ${n(h)}</div>
    </div>
    <div class="hub-daily-summary-total">${o.toLocaleString()} total</div>
  `;let p=["S","M","T","W","T","F","S"],$="";for(let m=0;m<7;m++){let v=i[m],k=v>0?Math.max(2,Math.round(v/r*100)):0,w=v>0?"hub-daily-bar":"hub-daily-bar empty",S=`${a[m].key} \u2014 ${v} tool call${v===1?"":"s"}`;$+=`
      <div class="hub-daily-col" title="${n(S)}">
        <div class="hub-daily-bar-wrap">
          <div class="${w}" style="height:${k}%"></div>
        </div>
        <div class="hub-daily-bar-label">${p[m]}</div>
      </div>
    `}e.innerHTML=$}function b(e){let t=Number(e)||0;return Math.abs(t)>=1e9?(t/1e9).toFixed(t>=1e10?0:1)+"B":Math.abs(t)>=1e6?(t/1e6).toFixed(t>=1e7?0:1)+"M":Math.abs(t)>=1e4?(t/1e3).toFixed(0)+"K":Math.abs(t)>=1e3?(t/1e3).toFixed(1)+"K":t.toLocaleString()}function x(e){let s=Math.max(0,Number(e)||0)/1e6;return s<=0?"$0":s>=100?"$"+s.toFixed(0):s>=1?"$"+s.toFixed(2):s>=.01?"$"+s.toFixed(3):"$"+s.toFixed(5)}function Z(e){let t=Math.max(0,Number(e)||0);if(t<=0)return"\u2014";if(t<1e3)return Math.round(t)+"ms";if(t<1e4)return(t/1e3).toFixed(2)+"s";if(t<6e4)return(t/1e3).toFixed(1)+"s";let s=Math.floor(t/6e4),a=Math.round(t%6e4/1e3);return s+"m"+(a?" "+a+"s":"")}function Fe(e){let t=Number(e);if(!Number.isFinite(t)||t<0)return"Not recorded";if(t<1e3)return`${Math.round(t)}ms`;if(t<6e4)return`${(t/1e3).toFixed(t<1e4?2:1)}s`;let s=Math.floor(t/6e4),a=Math.round(t%6e4/1e3),i=Math.floor(s/60),r=s%60;return i>0?`${i}h${r?` ${r}m`:""}`:`${s}m${a?` ${a}s`:""}`}function f(e,t,s){return`
    <div class="hub-stat-tile">
      <div class="hub-stat-label">${n(e)}</div>
      <div class="hub-stat-value">${n(String(t))}</div>
      ${s?`<div class="hub-stat-sub">${n(s)}</div>`:""}
    </div>
  `}function Pe(e){let t=Array.isArray(e.expensiveTools)&&e.expensiveTools.length?e.expensiveTools:Array.isArray(e.topTools)?e.topTools:[];return t.length?`
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
          <div class="hub-models-num">${n(b(Number(s.count)||0))}</div>
          <div class="hub-models-num">${n(b(Number(s.contextTokens)||0))}</div>
          <div class="hub-models-num">${n(Z(s.durationMsAvg))}</div>
          <div class="hub-models-num">${n(Z(s.durationMsMax))}</div>
          <div class="hub-models-num">${n(x(s.totalCostMicros))}</div>
        </div>
      `).join("")}
    </div>
  `:'<div class="hub-empty">No tool telemetry recorded yet.</div>'}function te(){let e=document.getElementById("hub-stats-tiles"),t=document.getElementById("hub-stats-models"),s=document.getElementById("hub-stats-footnote");if(!e||!t)return;if(y.loading){e.innerHTML='<div class="hub-empty">Loading\u2026</div>',t.style.display="none",s&&(s.textContent="");return}if(y.mode==="overview"){let l=y.tools&&y.tools.stats||{},g=y.models&&y.models.stats||{},h=l.chatSessions||g.chatSessions||0,p=l.messages||0,$=g.totalTokens||0,m=l.activeDays||g.activeDays||0,v=l.currentStreak||0,k=l.peakHour&&l.peakHour!=="\u2014"?l.peakHour:g.peakHour||"\u2014",w=g.favorite&&g.favorite!=="\u2014"?g.favorite:l.favorite||"\u2014",S=Number(g.totalCostMicros||0),X=Number(l.directCostMicros||0),Me=Number(l.contextCostMicros||0),Le=S+X;if(e.innerHTML=[f("Est. spend",x(Le),"model + direct tool"),f("Model cost",x(S),b($)+" tokens"),f("Tool context",x(Me),b(l.contextTokens||0)+" tokens"),f("Avg tool",Z(l.durationMsAvg),"max "+Z(l.durationMsMax)),f("Sessions",b(h)),f("Messages",b(p)),f("Tool calls",b(l.toolCalls||l.total||0)),f("Active days",String(m)),f("Current streak",v+"d"),f("Peak hour",String(k)),f("Favorite model",String(w))].join(""),t.innerHTML=Pe(y.tools||{}),t.style.display="",s){let Te=y.models&&y.models.summary||"",Ee=y.tools&&y.tools.summary||"";s.textContent=[Te,Ee].filter(Boolean).join(" ")}return}let a=y.models||{},i=a.stats||{},r=Array.isArray(a.topModels)?a.topModels:[],o=Array.isArray(a.topProviders)?a.topProviders:[],c=r.reduce((l,g)=>l+(Number(g.tokens)||0),0)||1;e.innerHTML=[f("Est. cost",x(i.totalCostMicros||0)),f("Total tokens",b(i.totalTokens||0)),f("Input",b(i.inputTokens||0)),f("Output",b(i.outputTokens||0)),f("Reasoning",b(i.reasoningTokens||0)),f("Cache",b(i.cacheTokens||0)),f("Model calls",b(i.messages||0)),f("Model sessions",b(i.modelSessions||i.sessions||0)),f("Favorite",String(i.favorite||"\u2014"))].join("");let u=o.length?`<div class="hub-models-providers">${o.map(l=>`
        <span class="hub-models-chip" title="${n(b(l.tokens)+" tokens \xB7 "+x(l.costMicros))}">
          <span class="hub-models-chip-name">${n(l.name)}</span>
          <span class="hub-models-chip-val">${n(b(l.tokens))}</span>
          <span class="hub-models-chip-val">${n(x(l.costMicros))}</span>
        </span>
      `).join("")}</div>`:"";r.length?t.innerHTML=`
      ${u}
      <div class="hub-models-table is-cost">
        <div class="hub-models-row hub-models-head">
          <div>Model</div>
          <div class="hub-models-num">Calls</div>
          <div class="hub-models-num">Tokens</div>
          <div class="hub-models-num">Cost</div>
          <div class="hub-models-num">Share</div>
          <div class="hub-models-bar-cell"></div>
        </div>
        ${r.map(l=>{let g=Number(l.tokens)||0,h=g/c*100;return`
            <div class="hub-models-row">
              <div class="hub-models-name" title="${n(l.name)}">${n(l.name)}</div>
              <div class="hub-models-num">${n(b(Number(l.calls)||0))}</div>
              <div class="hub-models-num">${n(b(g))}</div>
              <div class="hub-models-num">${n(x(l.costMicros))}</div>
              <div class="hub-models-num">${h.toFixed(1)}%</div>
              <div class="hub-models-bar-cell"><div class="hub-models-bar" style="width:${Math.max(2,Math.min(100,h))}%"></div></div>
            </div>
          `}).join("")}
      </div>
    `:t.innerHTML=`${u}<div class="hub-empty">No model usage recorded yet.</div>`,t.style.display="",s&&(s.textContent=a.summary||"")}function Ue(e){let t=Number(e)||0;return t>=90?"crit":t>=75?"warn":"ok"}function Ge(e){if(e<=0)return"soon";let t=Math.round(e/6e4);if(t<60)return`in ${t}m`;let s=Math.floor(t/60);if(s<48){let a=t%60;return a?`in ${s}h ${a}m`:`in ${s}h`}return`in ${Math.round(s/24)}d`}function We(e,t){if(!e)return"";let s=Date.parse(e);if(!Number.isFinite(s))return"";let a=s-Date.now();if(a<=0)return"resets now";let i=new Date(s),r=i.toLocaleTimeString([],{hour:"numeric",minute:"2-digit"}),o=Ge(a);return/week|day|opus/i.test(String(t||""))||a>=24*3600*1e3?`resets ${i.toLocaleDateString([],{month:"short",day:"numeric"})}, ${r} (${o})`:`resets at ${r} (${o})`}function ce(e,t,s){let a=Math.max(0,Math.min(100,Number(t)||0)),i=We(s,e);return`
    <div class="usage-gauge">
      <div class="usage-gauge-head">
        <span class="usage-gauge-label">${n(e)}</span>
        <span class="usage-gauge-pct">${a}%</span>
      </div>
      <div class="usage-gauge-track"><div class="usage-gauge-fill ${Ue(a)}" style="width:${a}%"></div></div>
      ${i?`<div class="usage-gauge-reset">${n(i)}</div>`:""}
    </div>
  `}function Ve(e){let t=Array.isArray(e.windows)?e.windows:[],s=e.tokens||{},a="";t.length?a+=t.map(o=>ce(o.label,o.used_percent,o.reset_at)+(o.detail?`<div class="usage-gauge-reset">${n(o.detail)}</div>`:"")).join(""):e.usage_scope==="model"?a='<div class="usage-provider-note">Codex Spark limit data is currently unavailable.</div>':e.budget&&e.budget.limit_tokens>0?a=ce("Monthly budget",e.budget.used_percent,null)+`<div class="usage-gauge-reset">${b(e.budget.used_tokens)} / ${b(e.budget.limit_tokens)} tokens</div>`:a='<div class="usage-provider-note">No limit data \u2014 tracking tokens only</div>';let i=e.source==="live"?'<span class="usage-provider-badge live">live</span>':'<span class="usage-provider-badge">tracked</span>',r=e.error?`<div class="usage-provider-err">${n(e.error)}</div>`:"";return`
    <div class="usage-provider-card" data-provider="${n(e.provider)}"${e.account_id?` data-account="${n(e.account_id)}"`:""}>
      <div class="usage-provider-head">
        <span class="usage-provider-name">${n(e.account_label?`${e.label||e.provider} \xB7 ${e.account_label}`:e.label||e.provider)}</span>
        ${i}
      </div>
      ${a}
      ${r}
      <div class="usage-provider-foot">${e.plan_label?`${n(e.plan_label)} \xB7 `:""}${b(s.total||0)} tokens \xB7 ${b(s.calls||0)} calls</div>
    </div>
  `}function ue(){let e=document.getElementById("hub-providers-grid"),t=document.getElementById("hub-providers-section");if(!e)return;if(I.loading&&!I.loaded){e.innerHTML='<div class="hub-empty">Loading\u2026</div>';return}let s=I.items||[];if(!s.length){t&&(t.style.display="none");return}t&&(t.style.display=""),e.innerHTML=s.map(Ve).join("")}async function ye(){I.loading=!0,ue();try{let e=await A("/api/usage/limits",{timeoutMs:3e4});I.items=e&&Array.isArray(e.providers)?e.providers:[]}catch{I.items=[]}finally{I.loading=!1,I.loaded=!0,ue()}}function Y(e){let t=String(e||"pending").toLowerCase();return t==="applied"?"applied":t==="rejected"?"rejected":t==="quarantined"?"quarantined":"pending"}function z(e,t){let s=String(e||"");if(!s)return"";let a=String(t||"").trim().toLowerCase(),i=s.split(/\r?\n/),r=i.findIndex(c=>{let u=c.match(/^##\s+(.+?)\s*$/);return u&&u[1].trim().toLowerCase()===a});if(r<0)return"";let o=i.length;for(let c=r+1;c<i.length;c+=1)if(/^##\s+/.test(i[c])){o=c;break}return i.slice(r+1,o).join(`
`).trim()}function V(e,t=""){let s=String(e||"").replace(/\s+/g," ").trim();if(!s)return t;let a=s.match(/^(.{30,220}?[.!?])(?:\s|$)/);return a?a[1].trim():s.slice(0,220)}function Ke(e){let t=z(e,"Tool Sequence");if(!t)return"";let s=Array.from(t.matchAll(/^\s*[-*]\s*`?([a-zA-Z0-9_.:-]+)`?/gm)).map(i=>i[1]),a=[...new Set(s)].slice(0,5);return a.length?`Captures a reusable tool sequence: ${a.join(", ")}${s.length>a.length?`, +${s.length-a.length} more`:""}.`:""}function Ye(e,t){if(e?.learnedBehavior)return String(e.learnedBehavior);let s=z(t,"Suggested Action"),a=z(t,"Outcome Excerpt"),i=z(t,"Request Excerpt"),r=Ke(t),o=String(e?.change?.kind||"").toLowerCase();if(o==="write_resource"){let c=V(s||e?.reason,"Adds a reusable skill note from a completed run."),u=V(a||i,"");return[c,r||u].filter(Boolean).join(" ")}return o==="manifest_overlay"?V(s||e?.reason,"Updates the skill manifest metadata so Prometheus can route to this skill more reliably."):V(s||e?.reason,"Reviews a proposed skill improvement from Brain.")}function ze(e){if(e?.approvePreview)return String(e.approvePreview);let t=e?.change||{},s=String(t.kind||"").toLowerCase(),a=String(e?.skillId||"this skill"),i=String(t.path||"").trim();return s==="write_resource"?`Approve will add ${i||"a resource file"} to ${a}.`:s==="manifest_overlay"?`Approve will update ${a}'s manifest metadata.`:s==="review_only"?"Approve will mark this daily skill-change audit accepted without changing skill files.":`Approve will apply this suggested change to ${a}.`}function Je(e){let t=String(e||"").trim();return t?t.replace(/[_-]+/g," ").replace(/\b\w/g,s=>s.toUpperCase()):"Skill change"}function Qe(e){let t=String(e||"").toLowerCase();return t.includes("/recovery/")?"Recovery note":t.includes("/styles/")?"Style reference":t.includes("/workflows/")?"Workflow recipe":t.includes("/examples/")?"Example":t.includes("/templates/")?"Template":"Skill resource"}function Ze(e,t){let s=e?.change||{},a=String(s.kind||"").toLowerCase(),i=String(e?.skillId||"unknown skill").trim(),r=String(s.path||"").trim();if(a==="write_resource"){let o=Qe(r);return{action:`Create ${o.toLowerCase()}`,targetLabel:"Will write",target:r?`skill:${i}/${r}`:`skill:${i}/(new resource file)`,scope:`${o} for ${i}.`,writeNote:"Adds a reference file. It does not create a new skill or edit SKILL.md.",teachLabel:"Will teach",teach:t||e?.learnedBehavior||"A reusable behavior captured from Brain evidence."}}return a==="manifest_overlay"?{action:"Update skill routing metadata",targetLabel:"Will write",target:`skill:${i}/skill.json overlay`,scope:"Adds or adjusts trigger words so this skill is found earlier.",writeNote:"No instruction body or resource markdown is changed.",teachLabel:"Routing change",teach:t||e?.learnedBehavior||"Prometheus should route matching requests to this skill sooner."}:a==="review_only"?{action:"Accept daily skill-change audit",targetLabel:"File change",target:"No files written",scope:"Marks a self-improvement audit item as reviewed.",writeNote:"This accepts the audit record only.",teachLabel:"Audit purpose",teach:t||e?.learnedBehavior||"Checks that recent skill mutations were evidence-backed and safe."}:{action:"Apply suggested skill change",targetLabel:"Target",target:r?`skill:${i}/${r}`:`skill:${i}`,scope:"Applies a Brain skill suggestion.",writeNote:"Review the technical details before approving.",teachLabel:"Will teach",teach:t||e?.learnedBehavior||"A reusable skill behavior from Brain evidence."}}function Xe(e){let t=String(e?.change?.kind||"").toLowerCase();return t==="review_only"?"Accept audit":t==="manifest_overlay"?"Update trigger":t==="write_resource"?"Create file":"Apply change"}function et(e){let t=Y(e.status),s=String(e.risk||"low").toLowerCase(),a=e.change||{},i=Array.isArray(e.evidence)?e.evidence:[],r=Array.isArray(e.scan?.findings)?e.scan.findings:[],o=String(a.content||"").trim(),c=Ye(e,o),u=ze(e),l=Ze(e,c),g=Je(e.lessonType||a.kind),h=t==="pending",p=d.actingId===e.id;return`
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
        <strong>${n(l.action)}</strong>
        <small>${n(l.scope)}</small>
      </div>
      <div class="hub-curator-decision-grid">
        <div>
          <span>${n(l.targetLabel)}</span>
          <code title="${n(l.target)}">${n(l.target)}</code>
          <small>${n(l.writeNote)}</small>
        </div>
        <div>
          <span>${n(l.teachLabel)}</span>
          <strong>${n(l.teach)}</strong>
        </div>
        ${e.futureTrigger?`<div><span>Use when</span><strong>${n(e.futureTrigger)}</strong></div>`:""}
      </div>
      ${e.whyUseful?`<div class="hub-curator-why"><strong>Why keep it</strong> ${n(e.whyUseful)}</div>`:""}
      ${e.reason?`<div class="hub-curator-reason"><strong>Curator reason</strong> ${n(e.reason)}</div>`:""}
      <div class="hub-curator-path" title="${n(l.target)}"><span>Target</span>${n(l.target)}</div>
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
          <div><span>Backend preview</span><code>${n(u)}</code></div>
          <div><span>Change kind</span><code>${n(a.kind||"unknown")}</code></div>
        </div>
        ${e.autoDecisionReason?`<div class="hub-curator-findings">${n(e.autoDecisionReason)}</div>`:""}
        ${r.length?`<div class="hub-curator-findings">${r.map($=>`<div>${n($.message||JSON.stringify($))}</div>`).join("")}</div>`:""}
        ${o?`<pre class="hub-curator-content">${n(o.slice(0,2400))}${o.length>2400?`
\u2026`:""}</pre>`:""}
      </details>
      <div class="hub-curator-card-actions">
        ${h?`
          <button class="hub-curator-btn approve" data-curator-action="apply" data-id="${n(e.id)}" type="button" ${p?"disabled":""}>${n(Xe(e))}</button>
          <button class="hub-curator-btn deny" data-curator-action="reject" data-id="${n(e.id)}" type="button" ${p?"disabled":""}>Deny</button>
        `:`<span class="hub-curator-resolved">${n(t)}</span>`}
      </div>
    </article>
  `}function tt(e){let t=String(e?.status||"observed").toLowerCase()==="applied"?"applied":"observed",s=String(e?.appliedBy||e?.source||"brain").trim(),a=String(e?.risk||"").trim(),i=Array.isArray(e?.changedPaths)?e.changedPaths.filter(Boolean):[],r=Array.isArray(e?.evidence)?e.evidence.filter(Boolean):[],o=Array.isArray(e?.toolSequence)?e.toolSequence.filter(Boolean):[],c=String(e?.summary||e?.reason||e?.suggestedAction||"").trim();return`
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
      ${c?`<div class="hub-curator-lesson">${n(c)}</div>`:""}
      ${e?.requestExcerpt?`<div class="hub-curator-why"><strong>Observed</strong> ${n(e.requestExcerpt)}</div>`:""}
      ${e?.finalResponseExcerpt?`<div class="hub-curator-why"><strong>Outcome</strong> ${n(e.finalResponseExcerpt)}</div>`:""}
      ${i.length?`<div class="hub-curator-path" title="${n(i.join(", "))}"><span>Changed</span>${i.slice(0,4).map(n).join(", ")}${i.length>4?`, +${i.length-4} more`:""}</div>`:""}
      ${o.length?`<div class="hub-curator-evidence">${o.slice(0,6).map(u=>`<span title="${n(u)}">${n(u)}</span>`).join("")}${o.length>6?`<span>+${o.length-6} tools</span>`:""}</div>`:""}
      ${r.length?`
        <details class="hub-curator-details">
          <summary>Evidence</summary>
          <div class="hub-curator-evidence">
            ${r.slice(0,10).map(u=>`<span title="${n(u)}">${n(u)}</span>`).join("")}
            ${r.length>10?`<span>+${r.length-10} more</span>`:""}
          </div>
        </details>
      `:""}
    </article>
  `}function G(){let e=document.getElementById("hub-curator-list"),t=document.getElementById("hub-curator-summary"),s=document.getElementById("hub-curator-subtitle");if(!e)return;let a=Array.isArray(d.suggestions)?d.suggestions:[],i=Array.isArray(d.activity)?d.activity:[],r=a.length+i.length,o=Math.max(r,Number(d.totalCount||0)),c=a.reduce((v,k)=>{let w=Y(k.status);return v[w]=(v[w]||0)+1,v},{}),u=Number(d.appliedActivity||0)||i.filter(v=>String(v?.status||"").toLowerCase()==="applied").length,l=Number(d.observedActivity||0)||Math.max(0,i.length-u),g=Number(d.pending||0)||c.pending||0,h=Number(d.quarantined||0)||c.quarantined||0;if(s&&(s.textContent=d.loading?"Loading Brain skill suggestions and Thought/Dream activity...":`${r} of ${o} shown \xB7 ${g} pending, ${h} quarantined, ${u} applied updates, ${l} observed signals`),t){let v=Number(d.lowRisk||0)||a.filter(S=>String(S.risk||"").toLowerCase()==="low").length,k=Number(d.mediumRisk||0)||a.filter(S=>String(S.risk||"").toLowerCase()==="medium").length,w=Number(d.highRisk||0)||a.filter(S=>String(S.risk||"").toLowerCase()==="high").length;t.innerHTML=[f("Pending",b(g)),f("Quarantined",b(h)),f("Applied Updates",b(u)),f("Observed Signals",b(l)),f("Low risk",b(v)),f("Medium risk",b(k)),f("High risk",b(w)),f("Total",b(a.length+i.length))].join("")}if(d.loading&&!a.length&&!i.length){e.innerHTML='<div class="hub-empty">Loading curator suggestions and activity...</div>';return}if(!a.length&&!i.length){e.innerHTML='<div class="hub-empty">No skill curator suggestions or Thought/Dream activity yet.</div>';return}let p=a.slice().sort((v,k)=>{let w=Y(v.status)==="pending"?0:1,S=Y(k.status)==="pending"?0:1;return w-S||String(k.updatedAt||"").localeCompare(String(v.updatedAt||""))}),$=i.slice().sort((v,k)=>String(k.timestamp||"").localeCompare(String(v.timestamp||"")));e.innerHTML=[p.length?`<div class="hub-curator-group-title">Review Queue</div>${p.map(et).join("")}`:"",$.length?`<div class="hub-curator-group-title">Thought and Dream Activity</div>${$.map(tt).join("")}`:"",d.hasMore?`<button class="hub-curator-load-more" id="hub-curator-load-more" type="button" ${d.loadingMore?"disabled":""}>${d.loadingMore?"Loading\u2026":`Show ${Math.min(5,Math.max(1,o-r))} more`}</button>`:""].filter(Boolean).join(""),e.querySelectorAll("[data-curator-action]").forEach(v=>{v.addEventListener("click",k=>{k.stopPropagation(),at(v.getAttribute("data-id"),v.getAttribute("data-curator-action"),v)})});let m=e.querySelector("#hub-curator-load-more");m&&m.addEventListener("click",()=>q({reset:!1}))}async function q({reset:e=!0}={}){if(!e&&(d.loadingMore||!d.hasMore))return;e?(d.loading=!0,d.loadingMore=!1,d.suggestions=[],d.activity=[],d.pending=0,d.quarantined=0,d.appliedActivity=0,d.observedActivity=0,d.lowRisk=0,d.mediumRisk=0,d.highRisk=0,d.totalCount=0,d.offset=0,d.nextOffset=null,d.hasMore=!1):d.loadingMore=!0,G();let t=e?0:Number(d.nextOffset??d.offset??0);try{let s=await A(`/api/hub/skills/review?limit=5&offset=${encodeURIComponent(t)}`,{timeoutMs:3e4}),a=Array.isArray(s?.suggestions)?s.suggestions:[],i=Array.isArray(s?.activity)?s.activity:[];if(e)d.suggestions=a,d.activity=i;else{let r=new Set(d.suggestions.map(c=>String(c?.id||"")).filter(Boolean)),o=new Set(d.activity.map(c=>String(c?.id||"")).filter(Boolean));d.suggestions=d.suggestions.concat(a.filter(c=>{let u=String(c?.id||"");return!u||!r.has(u)})),d.activity=d.activity.concat(i.filter(c=>{let u=String(c?.id||"");return!u||!o.has(u)}))}d.pending=Number(s?.pending||0),d.quarantined=Number(s?.quarantined||0),d.appliedActivity=Number(s?.appliedActivity||0),d.observedActivity=Number(s?.observedActivity||0),d.lowRisk=Number(s?.lowRisk||0),d.mediumRisk=Number(s?.mediumRisk||0),d.highRisk=Number(s?.highRisk||0),d.totalCount=Number(s?.totalCount||d.suggestions.length+d.activity.length),d.offset=Number(s?.offset??t),d.nextOffset=s?.nextOffset==null?null:Number(s.nextOffset),d.hasMore=s?.hasMore===!0||d.nextOffset!==null}catch{e?(d.suggestions=[],d.activity=[],d.totalCount=0):window.showToast?.("Could not load more curator activity","Try again in a moment.","error")}finally{d.loading=!1,d.loadingMore=!1,d.actingId="",G()}}async function st(){d.loading=!0,G();try{await A("/api/hub/skills/review/run",{method:"POST",body:{mode:"pending"},timeoutMs:6e4})}catch(e){window.showToast?.("Skill curator run failed",e?.message||String(e),"error")}finally{await q()}}async function at(e,t,s){let a=String(e||"").trim(),i=String(t||"").trim();if(!(!a||!i)){d.actingId=a,s&&(s.disabled=!0),G();try{await A(`/api/hub/skills/review/${encodeURIComponent(a)}/${i==="apply"?"apply":"reject"}`,{method:"POST",body:{},timeoutMs:3e4}),await q(),ne()}catch(r){window.showToast?.("Skill curator action failed",r?.message||String(r),"error"),d.actingId="",G()}}}async function $e(){y.loading=!(y.tools||y.models),te();let e=encodeURIComponent(y.range);try{let[t,s]=await Promise.allSettled([A(`/api/hub/tools/overview?range=${e}`,{timeoutMs:3e4}),A(`/api/hub/models/overview?range=${e}`,{timeoutMs:3e4})]);t.status==="fulfilled"&&t.value&&t.value.success!==!1&&(y.tools=t.value),s.status==="fulfilled"&&s.value&&s.value.success!==!1&&(y.models=s.value)}finally{y.loading=!1,te()}}async function ne(){try{let e=await A(`/api/hub/skills/usage?range=${encodeURIComponent(R)}`);ee=Array.isArray(e?.skills)?e.skills:[]}catch{ee=[]}J()}async function ie({force:e=!1}={}){if(E&&!e)return;let t=++W;E=!0,_="",Q();try{let s=await A("/api/hub/goals");if(t!==W)return;if(s?.success===!1)throw new Error(s.error||"The goals endpoint returned an error.");M=Array.isArray(s?.goals)?s.goals:[],me=!0}catch(s){if(t!==W)return;_=s?.message||String(s)}finally{if(t!==W)return;E=!1,Q()}}async function se(){try{let e=await A("/api/hub/tokens/activity?range=6m",{timeoutMs:3e4});H.daily=Array.isArray(e?.daily)?e.daily:[],H.stats=e?.stats||null}catch{H.daily=[],H.stats=null}je()}async function nt(){let e=ve(new Date);U.startISO=pe(e);let t=new Date(e.getFullYear(),e.getMonth(),e.getDate()+6),s=new Set([`${e.getFullYear()}-${e.getMonth()+1}`,`${t.getFullYear()}-${t.getMonth()+1}`]),a={};await Promise.all([...s].map(async i=>{let[r,o]=i.split("-").map(Number);try{let c=await A(`/api/hub/tools/heatmap?year=${r}&month=${o}`,{timeoutMs:3e4}),u=c&&c.counts?c.counts:{};Object.assign(a,u)}catch{}})),U.counts=a,Oe()}async function ke(e){let t=document.getElementById("hub-skill-modal"),s=document.getElementById("hub-modal-body"),a=document.getElementById("hub-modal-name"),i=document.getElementById("hub-modal-version");if(!(!t||!s)){s.innerHTML='<div class="hub-empty">Loading\u2026</div>',t.style.display="flex";try{let o=(await A(`/api/hub/skills/${encodeURIComponent(e)}/content`))?.skill||{};a&&(a.textContent=o.name||e),i&&(i.textContent=o.version?`v${o.version}`:"");let c=Be(o.content),u=`
      <div class="hub-modal-skill-meta">
        <div class="hub-modal-skill-meta-item"><span>Status</span><strong>${n(T(o.status))}</strong></div>
        <div class="hub-modal-skill-meta-item"><span>Lifecycle</span><strong>${n(T(o.lifecycle||o.status))}</strong></div>
        <div class="hub-modal-skill-meta-item"><span>Ownership</span><strong>${n(T(o.ownership))}</strong></div>
        <div class="hub-modal-skill-meta-item"><span>Manifest</span><strong>${n(T(o.manifestSource))}</strong></div>
      </div>
        <div class="hub-modal-change-panel">
          <div class="hub-modal-section-title">Recent skill changes</div>
          ${be(o.recentChanges,8)}
        </div>
        ${Ne(o)}
      `,l;try{l=re(c)}catch{l=`<pre>${n(c)}</pre>`}s.innerHTML=`${u}<div class="hub-modal-markdown">${l}</div>`,we(s),it(s)}catch(r){s.innerHTML=`<div class="hub-empty">Failed to load skill: ${n(r?.message||String(r))}</div>`}}}function ae(e){if(!e)return;let t=e.classList.toggle("open");e.setAttribute("aria-expanded",t?"true":"false")}function we(e=document){e.querySelectorAll("[data-hub-change-card]").forEach(t=>{t.dataset.changeBound!=="1"&&(t.dataset.changeBound="1",t.addEventListener("click",s=>{s.target.closest("a,button")||ae(t)}),t.addEventListener("keydown",s=>{s.key!=="Enter"&&s.key!==" "||(s.preventDefault(),ae(t))}))})}function it(e=document){e.querySelectorAll(".hub-modal-resource-item[data-skill-id][data-resource-path]").forEach(t=>{t.dataset.resourceBound!=="1"&&(t.dataset.resourceBound="1",t.addEventListener("click",s=>{s.preventDefault(),s.stopPropagation(),Se(t.dataset.skillId||"",t.dataset.resourcePath||"")}))})}async function Se(e,t){let s=document.getElementById("hub-modal-resource-preview");if(s){s.innerHTML=`<div class="hub-modal-resource-empty">Loading ${n(t)}...</div>`;try{let i=(await A(`/api/hub/skills/${encodeURIComponent(e)}/resources/content?path=${encodeURIComponent(t)}`))?.resource||{};s.innerHTML=`
      <div class="hub-modal-resource-preview-head">
        <strong>${n(i.path||t)}</strong>
        ${i.truncated?"<span>Truncated</span>":""}
      </div>
      <pre>${n(i.content||"")}</pre>
    `}catch(a){s.innerHTML=`<div class="hub-modal-resource-empty">Failed to load file: ${n(a?.message||String(a))}</div>`}}}function Ae(){let e=document.getElementById("hub-skill-modal");e&&(e.style.display="none")}function rt(){let e=document.getElementById("hub-range-seg");e&&!e._wired&&(e._wired=!0,e.querySelectorAll(".hub-seg-btn").forEach(h=>{h.addEventListener("click",()=>{let p=h.getAttribute("data-range");if(!(!p||p===R)){R=p;try{localStorage.setItem("hub_range",R)}catch{}e.querySelectorAll(".hub-seg-btn").forEach($=>$.classList.toggle("active",$===h)),ne()}})}),e.querySelectorAll(".hub-seg-btn").forEach(h=>{h.classList.toggle("active",h.getAttribute("data-range")===R)}));let t=document.getElementById("hub-viewall-btn");t&&!t._wired&&(t._wired=!0,t.addEventListener("click",()=>{C=!C;try{localStorage.setItem("hub_skills_viewall",C?"1":"0")}catch{}t.textContent=C?"Show top 4 \u25B4":"View all skills \u25BE",J()}),t.textContent=C?"Show top 4 \u25B4":"View all skills \u25BE");let s=document.getElementById("hub-skill-search");s&&!s._wired?(s._wired=!0,s.value=N,s.addEventListener("input",()=>{N=s.value||"";try{localStorage.setItem("hub_skill_search",N)}catch{}J()})):s&&s.value!==N&&(s.value=N);let a=document.getElementById("hub-stats-tabs");a&&!a._wired&&(a._wired=!0,a.querySelectorAll(".hub-stats-tab").forEach(h=>{h.classList.toggle("active",h.getAttribute("data-mode")===y.mode),h.addEventListener("click",()=>{let p=h.getAttribute("data-mode");if(!(!p||p===y.mode)){y.mode=p;try{localStorage.setItem("hub_stats_mode",p)}catch{}a.querySelectorAll(".hub-stats-tab").forEach($=>$.classList.toggle("active",$===h)),te()}})}));let i=document.getElementById("hub-stats-range");i&&!i._wired&&(i._wired=!0,i.querySelectorAll(".hub-stats-range-btn").forEach(h=>{h.classList.toggle("active",h.getAttribute("data-range")===y.range),h.addEventListener("click",()=>{let p=h.getAttribute("data-range");if(!(!p||p===y.range)){y.range=p;try{localStorage.setItem("hub_stats_range",p)}catch{}i.querySelectorAll(".hub-stats-range-btn").forEach($=>$.classList.toggle("active",$===h)),$e()}})}));let r=document.getElementById("hub-heatmap-prev"),o=document.getElementById("hub-heatmap-next");r&&!r._wired&&(r._wired=!0,r.addEventListener("click",()=>{L.month-=1,L.month<1&&(L.month=12,L.year-=1),se()})),o&&!o._wired&&(o._wired=!0,o.addEventListener("click",()=>{L.month+=1,L.month>12&&(L.month=1,L.year+=1),se()}));let c=document.getElementById("hub-curator-refresh-btn");c&&!c._wired&&(c._wired=!0,c.addEventListener("click",q));let u=document.getElementById("hub-curator-run-btn");u&&!u._wired&&(u._wired=!0,u.addEventListener("click",st));let l=document.getElementById("hub-goals-refresh");l&&!l._wired&&(l._wired=!0,l.addEventListener("click",()=>ie({force:!0})));let g=document.getElementById("hub-providers-refresh");g&&!g._wired&&(g._wired=!0,g.addEventListener("click",ye))}function ot(){if(rt(),!L.year){let e=new Date;L.year=e.getFullYear(),L.month=e.getMonth()+1}ie(),ne(),$e(),ye(),se(),nt(),q()}window.hubPageActivate=ot;window.openHubSkillModal=ke;window.closeHubSkillModal=Ae;window.toggleHubSkillChangeCard=ae;window.openHubSkillResource=Se;window.loadCuratorSuggestions=q;oe.on("main_chat_goal_updated",()=>{let e=document.getElementById("hub-view");e&&e.style.display!=="none"&&ie()});document.addEventListener("keydown",e=>{if(e.key==="Escape"){let t=document.getElementById("hub-skill-modal");t&&t.style.display==="flex"&&Ae()}});export{Ve as a,ot as b};
