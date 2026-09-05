import{D as _,E as u,G as a,M as b,N as f,b as h,f as v,g,l as $,m,o as G,v as S,w as y}from"./chunk-6WJE3XYN.js";import"./chunk-5RLMNBA7.js";import"./chunk-AMU2LTTO.js";import"./chunk-M3KXBAIH.js";import"./chunk-EIYUY45O.js";import"./chunk-YMT6MSCC.js";import"./chunk-VT2SUWLA.js";import"./chunk-JF4LWGNM.js";import"./chunk-CP4XDM65.js";import"./chunk-EPSJJCWL.js";function E(t){let i=Number(t||0);if(!i)return"Never contacted";let r=Math.max(0,Math.floor((Date.now()-i)/1e3));if(r<10)return"Just now";if(r<60)return`${r}s ago`;let d=Math.floor(r/60);if(d<60)return`${d}m ago`;let c=Math.floor(d/60);return c<24?`${c}h ago`:`${Math.floor(c/24)}d ago`}function I(t){return`is-${String(t||"unknown").replace(/[^a-z]/g,"")||"unknown"}`}function k(t){try{sessionStorage.setItem("pm_open_pairing_scanner","1")}catch{}if(typeof window.__pmMobilePairingScanner=="function"){window.__pmMobilePairingScanner();return}t?.("#mobile/chat")}function L(t){let i=v(t.gatewayId);return`
    <article class="pm-gateway-card ${I(t.status)}" data-gateway-id="${a(t.gatewayId)}">
      <div class="pm-gateway-card-head">
        <div class="pm-gateway-card-title-wrap">
          <span class="pm-gateway-status-dot" aria-hidden="true"></span>
          <div><h2>${a(t.name)}</h2><p>${a(t.platform||"unknown")} \xB7 ${a(t.version||"unknown")}</p></div>
        </div>
        <span class="pm-gateway-status-label">${a(u(t.status))}</span>
      </div>
      <dl class="pm-gateway-meta">
        <div><dt>Last contact</dt><dd>${a(E(t.lastContactAt))}</dd></div>
        <div><dt>Target origin</dt><dd>${a(t.origin)}</dd></div>
        ${t.workspaceName?`<div><dt>Workspace</dt><dd>${a(t.workspaceName)}</dd></div>`:""}
        ${i?`<div><dt>Phone grant</dt><dd><code>${a(i)}</code></dd></div>`:""}
      </dl>
      ${t.lastError?`<p class="pm-gateway-error">${a(t.lastError)}</p>`:""}
      <div class="pm-gateway-card-actions">
        <button type="button" class="pm-btn ghost" data-gateway-action="reconnect" data-gateway-id="${a(t.gatewayId)}">Reconnect</button>
        <button type="button" class="pm-btn ghost" data-gateway-action="repair" data-gateway-id="${a(t.gatewayId)}">Repair</button>
        <button type="button" class="pm-btn ghost danger" data-gateway-action="forget" data-gateway-id="${a(t.gatewayId)}">Forget</button>
      </div>
    </article>`}async function q(t,{navigate:i}){if(!h())return t.innerHTML=`${b({title:"Gateway Connections",online:!0,leftIcon:"back",hideTitle:!1})}<main class="pm-body pm-gateways-page"><section class="pm-gateway-card"><h2>Gateway Connections unavailable</h2><p class="pm-gateway-empty">This phone-side multi-gateway slice is disabled. Existing single-gateway mobile chat remains available.</p></section></main>`,f(t,{onLeft:()=>i?.("#mobile/chat")}),t;try{window.__pmMobileActiveGatewayOrigin="",window.__pmMobileActiveGatewayId="",window.__pmMobileActiveGatewayToken="",window.__pmMobileActiveGatewayExecutionEnabled=!1}catch{}t.innerHTML=`
    ${b({title:"Gateway Connections",online:!0,leftIcon:"back",hideTitle:!1})}
    <main class="pm-body pm-gateways-page" id="pm-gateways-page">
      <section class="pm-gateway-scan-fallback" aria-label="Pair a gateway">
        <div><strong>Pair from a computer</strong><p>Scan the QR in that computer\u2019s Settings \u2192 Pairing. The phone confirms the target before saving its grant.</p></div>
        <button type="button" class="pm-btn ghost" id="pm-gateway-scan">Open camera scanner</button>
      </section>
      <section class="pm-gateway-filter" aria-labelledby="pm-gateway-devices-title">
        <div class="pm-gateway-section-head"><h2 id="pm-gateway-devices-title">Devices</h2><button type="button" class="pm-btn ghost" id="pm-gateway-device-add" aria-label="Add device" title="Add device">+</button></div>
        <div class="pm-gateway-filter-actions"><button type="button" class="pm-btn ghost" id="pm-gateway-filter-all" aria-pressed="true">All</button><div id="pm-gateway-filter-options" class="pm-gateway-filter-options"></div></div>
      </section>
      <section aria-labelledby="pm-gateway-list-title"><div class="pm-gateway-section-head"><h2 id="pm-gateway-list-title">Connected gateways</h2><button type="button" class="pm-btn ghost" id="pm-gateway-refresh">Refresh</button></div><div id="pm-gateway-list" class="pm-gateway-list"><div class="pm-gateway-empty">Loading gateway status\u2026</div></div></section>
    </main>`,f(t,{onLeft:()=>i?.("#mobile/chat")});let r=t.querySelector("#pm-gateway-list"),d=t.querySelector("#pm-gateway-filter-options"),c=t.querySelector("#pm-gateway-filter-all"),l=g();function w(){let e=$(),p=new Set(e.gatewayIds||[]);c.setAttribute("aria-pressed",String(e.mode==="all")),d.innerHTML=l.map(s=>`<label class="pm-gateway-filter-option"><input type="checkbox" data-gateway-filter-id="${a(s.gatewayId)}" ${p.has(s.gatewayId)?"checked":""}><span>${a(s.name)}</span></label>`).join(""),d.querySelectorAll("[data-gateway-filter-id]").forEach(s=>s.addEventListener("change",()=>{let o=[...d.querySelectorAll("input:checked")].map(M=>M.getAttribute("data-gateway-filter-id"));m(o),w(),n()}))}function n(){l=g(),r.innerHTML=l.length?l.map(e=>L(e)).join(""):'<div class="pm-gateway-empty">No gateways are paired on this phone.</div>',r.querySelectorAll("[data-gateway-action]").forEach(e=>e.addEventListener("click",async()=>{let p=e.getAttribute("data-gateway-id")||"",s=e.getAttribute("data-gateway-action")||"";try{if(e.disabled=!0,s==="reconnect"){let o=await S(p);n(),o?.status==="online"?window.pmToast?.(`${o.name||"Gateway"} reconnected.`,"success"):window.pmToast?.(o?.lastError||`${o?.name||"Gateway"} is ${u(o?.status)}.`,"error");return}if(s==="forget"){if(!window.confirm("Forget this gateway from the phone? Its computer data is not deleted."))return;G(p)}if(s==="repair"){k(i);return}n()}catch(o){window.pmToast?.(o?.message||"Gateway action failed.","error")}finally{e.disabled=!1}}))}t.querySelector("#pm-gateway-device-add")?.addEventListener("click",()=>i?.("#mobile/pair/add")),t.querySelector("#pm-gateway-scan")?.addEventListener("click",()=>k(i)),t.querySelector("#pm-gateway-refresh")?.addEventListener("click",async()=>{await y(),n()}),c?.addEventListener("click",()=>{m(l.map(e=>e.gatewayId)),w(),n()});let A=_(()=>{w(),n()});return t._pmCleanup=()=>A(),w(),n(),y().then(()=>{n()}).catch(()=>{n()}),t}export{q as renderMobileGatewaysPage};
