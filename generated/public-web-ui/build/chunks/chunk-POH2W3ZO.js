import{d as R,e as E,h as I}from"./chunk-FU3MVKHQ.js";function o(r){return String(r??"").replace(/[&<>"']/g,s=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[s])}function A(r,s="reasoning"){return String(r||"").replace(/[^a-zA-Z0-9_-]/g,"_")||s}function N(r,s=1){let c=Math.max(0,Math.min(1,Number(r)||0)),e=Math.max(1,Number(s)||1),a=e>1?(e-1)/e*360:0;return Math.round(-c*a*1e3)/1e3}function D(r){let s=Math.max(1,Number(r)||1),c=120,e=100,a=66,i=78;return Array.from({length:s},(f,m)=>{let u=-Math.PI/2+m/s*Math.PI*2,v=(c+Math.cos(u)*a).toFixed(2),L=(e+Math.sin(u)*a).toFixed(2),n=(c+Math.cos(u)*i).toFixed(2),w=(e+Math.sin(u)*i).toFixed(2);return`<line x1="${v}" y1="${L}" x2="${n}" y2="${w}" />`}).join("")}function q({provider:r="",model:s="",effort:c="",selectorId:e="reasoning-selector",controlId:a="pm-reasoning-control",liveLabelId:i="pm-reasoning-live-label",advancedId:f="pm-reasoning-advanced",includeAdvanced:m=!1,advancedLabel:u="Advanced",advancedAriaLabel:v="Open Advanced model, provider, speed, and reasoning controls",className:L=""}={}){let n=R(r,s),w=String(c||"").trim().toLowerCase(),d=Math.max(0,n?Math.max(0,n.indexOf(w)):0),h=n&&n.length>1?d/(n.length-1):0,M=n&&n.length?(1/n.length+h*((n.length-1)/n.length))*100:0,t=N(h,n?.length||1),g=s?I(s,r):"Default model",l=n?E(n[d],r):"Default",$=A(e),p=A(a,`${$}-control`),x=A(i,`${$}-live-label`),P=A(f,`${$}-advanced`),S=n?`
     <div class="pm-reasoning-control" id="${o(p)}" style="--pm-reasoning-index:${d};--pm-reasoning-progress:${h};--pm-reasoning-fill-width:${M}%;--pm-reasoning-fill-height:${M}%;--pm-reasoning-color-strength:${Math.round(h*100)}%;--pm-reasoning-arc-gradient:url(#${o(p)}-arc-gradient);--pm-reasoning-wheel-rotation:${t}deg;--pm-reasoning-steps:${Math.max(1,n.length-1)}" role="slider" tabindex="0" aria-label="Reasoning level. Swipe down for higher reasoning and up for lower reasoning." aria-valuemin="0" aria-valuemax="${n.length-1}" aria-valuenow="${d}" aria-valuetext="${o(l)}">
       <div class="pm-reasoning-track">
         <div class="pm-reasoning-fill"></div>
         <svg class="pm-reasoning-wheel-svg" viewBox="0 0 240 126" preserveAspectRatio="xMidYMid meet" focusable="false">
           <defs>
             <linearGradient id="${o(p)}-arc-gradient" x1="0%" y1="0%" x2="100%" y2="0%">
               <stop offset="0%" stop-color="#ffffff" />
               <stop offset="52%" stop-color="#d7d3ff" />
               <stop offset="100%" stop-color="#7b58ff" />
             </linearGradient>
             <clipPath id="${o(p)}-upper-wheel-clip">
               <rect x="0" y="0" width="240" height="101" />
             </clipPath>
           </defs>
           <path class="pm-reasoning-wheel-base-arch" d="M 28 100 C 28 34 212 34 212 100" />
           <g class="pm-reasoning-wheel-rotor" clip-path="url(#${o(p)}-upper-wheel-clip)">
             <circle class="pm-reasoning-wheel-ring" cx="120" cy="100" r="78" pathLength="100" />
             <circle class="pm-reasoning-wheel-glow" cx="120" cy="100" r="78" pathLength="100" />
             <g class="pm-reasoning-wheel-ticks">${D(n.length)}</g>
           </g>
           <path class="pm-reasoning-wheel-arch" d="M 28 100 C 28 34 212 34 212 100" />
           <rect class="pm-reasoning-wheel-indicator" x="112" y="18" width="16" height="34" rx="8" />
         </svg>
         ${n.map((b,y)=>`<button type="button" class="pm-reasoning-segment ${y===d?"is-active ":""}${y<=d?"is-filled":""}" data-index="${y}" data-value="${o(b)}" aria-label="${o(E(b,r))}"><span>${o(E(b,r))}</span></button>`).join("")}
       </div>
     </div>`:`<div class="pm-msheet-empty pm-reasoning-unavailable">No adjustable reasoning levels for ${o(g)}.</div>`;return`<div class="pm-reasoning-selector ${o(L)}" id="${o($)}" data-reasoning-selector role="group" aria-label="Reasoning controls">
    <div class="pm-reasoning-summary" aria-live="polite">
      <strong>${o(g)}</strong><span aria-hidden="true">&middot;</span><span id="${o(x)}">${o(l)}</span>
    </div>
    ${m?`<button type="button" class="pm-reasoning-advanced" id="${o(P)}" aria-label="${o(v)}"><span>${o(u)}</span><span aria-hidden="true">&rsaquo;</span></button>`:""}
    ${S}
  </div>`}function j(r,{onChange:s}={}){let c=r?.matches?.("[data-reasoning-selector]")?r:r?.querySelector?.("[data-reasoning-selector]"),e=c?.querySelector?.(".pm-reasoning-control");if(!c||!e)return()=>{};let a=Array.from(e.querySelectorAll(".pm-reasoning-segment")),i=Math.max(0,a.length-1),f=Number(e.getAttribute("aria-valuenow")||0),m=!1,u=i?f/i:0,v=(t,g=!0)=>{let l=Math.max(0,Math.min(i,Number(t)||0)),$=a[l]?.getAttribute("data-value")||"",p=a[l]?.getAttribute("aria-label")||"",x=i?l/i:0,P=N(x,a.length);e.style.setProperty("--pm-reasoning-index",String(l)),e.style.setProperty("--pm-reasoning-progress",String(x));let S=a.length?(1/a.length+x*(i/a.length))*100:0;e.style.setProperty("--pm-reasoning-fill-width",`${S}%`),e.style.setProperty("--pm-reasoning-wheel-rotation",`${P}deg`),e.setAttribute("aria-valuenow",String(l)),e.setAttribute("aria-valuetext",p),a.forEach((y,k)=>{y.classList.toggle("is-active",k===l),y.classList.toggle("is-filled",k<=l)});let b=c.querySelector('[id$="-live-label"]');b&&(b.textContent=p),g&&s?.($,{index:l,label:p,immediate:g}),f=l,u=x},L=t=>{let g=e.getBoundingClientRect();return g.width?Math.max(0,Math.min(1,(t.clientX-g.left)/g.width)):0},n=t=>{t.pointerType==="mouse"&&t.button!==0||(m=!0,e.classList.add("is-dragging"),e.setPointerCapture?.(t.pointerId),commitFromEvent(t,!1))},w=t=>{m&&commitFromEvent(t,!1)},d=t=>{m&&(m=!1,e.classList.remove("is-dragging"),commitFromEvent(t,!0))},h=t=>{if(!["ArrowLeft","ArrowRight","ArrowUp","ArrowDown","Home","End"].includes(t.key))return;t.preventDefault();let g=Number(e.getAttribute("aria-valuenow")||f);v(t.key==="Home"?0:t.key==="End"?i:g+(["ArrowRight","ArrowDown"].includes(t.key)?1:-1),!0)},M=t=>{t.preventDefault(),t.stopPropagation(),v(t.currentTarget.getAttribute("data-index"),!0)};return e.addEventListener("pointerdown",n),e.addEventListener("pointermove",w),e.addEventListener("pointerup",d),e.addEventListener("pointercancel",d),e.addEventListener("keydown",h),a.forEach(t=>t.addEventListener("click",M)),()=>{e.removeEventListener("pointerdown",n),e.removeEventListener("pointermove",w),e.removeEventListener("pointerup",d),e.removeEventListener("pointercancel",d),e.removeEventListener("keydown",h),a.forEach(t=>t.removeEventListener("click",M))}}export{q as a,j as b};
