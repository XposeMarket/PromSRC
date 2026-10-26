import{D as k,E as u,I as t,O as b,P as f,b as h,f as v,g,l as $,m,o as G,v as _,w as y}from"./chunk-IWP2YVTN.js";import"./chunk-YNMSZYSC.js";import"./chunk-QRT4XV37.js";import"./chunk-QOVQ3TSE.js";import"./chunk-AXH4665B.js";import"./chunk-YMT6MSCC.js";import"./chunk-I7ZJTRGE.js";import"./chunk-NWWP72PK.js";import"./chunk-JF4LWGNM.js";import"./chunk-EPSJJCWL.js";function E(a){let i=Number(a||0);if(!i)return"Never contacted";let d=Math.max(0,Math.floor((Date.now()-i)/1e3));if(d<10)return"Just now";if(d<60)return`${d}s ago`;let r=Math.floor(d/60);if(r<60)return`${r}m ago`;let c=Math.floor(r/60);return c<24?`${c}h ago`:`${Math.floor(c/24)}d ago`}function I(a){return`is-${String(a||"unknown").replace(/[^a-z]/g,"")||"unknown"}`}function A(a){try{sessionStorage.setItem("pm_open_pairing_scanner","1")}catch{}if(typeof window.__pmMobilePairingScanner=="function"){window.__pmMobilePairingScanner();return}a?.("#mobile/chat")}function L(a){let i=v(a.gatewayId);return`
    <article class="pm-gateway-card ${I(a.status)}" data-gateway-id="${t(a.gatewayId)}">
      <div class="pm-gateway-card-head">
        <div class="pm-gateway-card-title-wrap">
          <span class="pm-gateway-status-dot" aria-hidden="true"></span>
          <div><h2>${t(a.name)}</h2><p>${t(a.platform||"unknown")} \xB7 ${t(a.version||"unknown")}</p></div>
        </div>
        <span class="pm-gateway-status-label">${t(u(a.status))}</span>
      </div>
      <dl class="pm-gateway-meta">
        <div><dt>Last contact</dt><dd>${t(E(a.lastContactAt))}</dd></div>
        <div><dt>Target origin</dt><dd>${t(a.origin)}</dd></div>
        ${a.workspaceName?`<div><dt>Workspace</dt><dd>${t(a.workspaceName)}</dd></div>`:""}
        ${i?`<div><dt>Phone grant</dt><dd><code>${t(i)}</code></dd></div>`:""}
      </dl>
      ${a.lastError?`<p class="pm-gateway-error">${t(a.lastError)}</p>`:""}
      <div class="pm-gateway-card-actions">
        <button type="button" class="pm-btn ghost" data-gateway-action="reconnect" data-gateway-id="${t(a.gatewayId)}">Reconnect</button>
        <button type="button" class="pm-btn ghost" data-gateway-action="repair" data-gateway-id="${t(a.gatewayId)}">Repair</button>
        <button type="button" class="pm-btn ghost danger" data-gateway-action="forget" data-gateway-id="${t(a.gatewayId)}">Forget</button>
      </div>
    </article>`}async function q(a,{navigate:i}){if(!h())return a.innerHTML=`${b({title:"Gateway Connections",online:!0,leftIcon:"back",hideTitle:!1})}<main class="pm-body pm-gateways-page"><section class="pm-gateway-card"><h2>Gateway Connections unavailable</h2><p class="pm-gateway-empty">This phone-side multi-gateway slice is disabled. Existing single-gateway mobile chat remains available.</p></section></main>`,f(a,{onLeft:()=>i?.("#mobile/chat")}),a;try{window.__pmMobileActiveGatewayOrigin="",window.__pmMobileActiveGatewayId="",window.__pmMobileActiveGatewayToken="",window.__pmMobileActiveGatewayExecutionEnabled=!1}catch{}a.innerHTML=`
    ${b({title:"Gateway Connections",online:!0,leftIcon:"back",hideTitle:!1})}
    <main class="pm-body pm-gateways-page" id="pm-gateways-page">
      <section class="pm-gateway-scan-fallback" aria-label="Pair a gateway">
        <div><strong>Pair from a computer</strong></div>
        <button type="button" class="pm-btn ghost" id="pm-gateway-scan">Open camera scanner</button>
      </section>
      <section class="pm-gateway-filter" aria-labelledby="pm-gateway-devices-title">
        <div class="pm-gateway-section-head"><h2 id="pm-gateway-devices-title">Devices</h2><button type="button" class="pm-btn ghost" id="pm-gateway-device-add" aria-label="Add device" title="Add device">+</button></div>
        <div class="pm-gateway-filter-actions"><button type="button" class="pm-btn ghost" id="pm-gateway-filter-all" aria-pressed="true">All</button><div id="pm-gateway-filter-options" class="pm-gateway-filter-options"></div></div>
      </section>
      <section aria-labelledby="pm-gateway-list-title"><div class="pm-gateway-section-head"><h2 id="pm-gateway-list-title">Connected gateways</h2><button type="button" class="pm-btn ghost" id="pm-gateway-refresh">Refresh</button></div><div id="pm-gateway-list" class="pm-gateway-list"><div class="pm-gateway-empty">Loading gateway status\u2026</div></div></section>
    </main>`,f(a,{onLeft:()=>i?.("#mobile/chat")});let d=a.querySelector("#pm-gateway-list"),r=a.querySelector("#pm-gateway-filter-options"),c=a.querySelector("#pm-gateway-filter-all"),l=g();function w(){let e=$(),p=new Set(e.gatewayIds||[]);c.setAttribute("aria-pressed",String(e.mode==="all")),r.innerHTML=l.map(s=>`<label class="pm-gateway-filter-option"><input type="checkbox" data-gateway-filter-id="${t(s.gatewayId)}" ${p.has(s.gatewayId)?"checked":""}><span>${t(s.name)}</span></label>`).join(""),r.querySelectorAll("[data-gateway-filter-id]").forEach(s=>s.addEventListener("change",()=>{let o=[...r.querySelectorAll("input:checked")].map(S=>S.getAttribute("data-gateway-filter-id"));m(o),w(),n()}))}function n(){l=g(),d.innerHTML=l.length?l.map(e=>L(e)).join(""):'<div class="pm-gateway-empty">No gateways are paired on this phone.</div>',d.querySelectorAll("[data-gateway-action]").forEach(e=>e.addEventListener("click",async()=>{let p=e.getAttribute("data-gateway-id")||"",s=e.getAttribute("data-gateway-action")||"";try{if(e.disabled=!0,s==="reconnect"){let o=await _(p);n(),o?.status==="online"?window.pmToast?.(`${o.name||"Gateway"} reconnected.`,"success"):window.pmToast?.(o?.lastError||`${o?.name||"Gateway"} is ${u(o?.status)}.`,"error");return}if(s==="forget"){if(!window.confirm("Forget this gateway from the phone? Its computer data is not deleted."))return;G(p)}if(s==="repair"){A(i);return}n()}catch(o){window.pmToast?.(o?.message||"Gateway action failed.","error")}finally{e.disabled=!1}}))}a.querySelector("#pm-gateway-device-add")?.addEventListener("click",()=>i?.("#mobile/pair/add")),a.querySelector("#pm-gateway-scan")?.addEventListener("click",()=>A(i)),a.querySelector("#pm-gateway-refresh")?.addEventListener("click",async()=>{await y(),n()}),c?.addEventListener("click",()=>{m(l.map(e=>e.gatewayId)),w(),n()});let M=k(()=>{w(),n()});return a._pmCleanup=()=>M(),w(),n(),y().then(()=>{n()}).catch(()=>{n()}),a}export{q as renderMobileGatewaysPage};
