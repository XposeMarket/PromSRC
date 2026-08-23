var h="prometheus_account",c=null;function E(){return c}function k(){try{let e=localStorage.getItem(h);if(!e)return null;let t=JSON.parse(e);return!t||typeof t!="object"||!t.email?null:{email:String(t.email||""),userId:t.userId?String(t.userId):void 0,isAdmin:!!t.isAdmin,purchaseActive:!!(t.purchaseActive||t.accessActive||t.subscriptionActive),accessActive:!!(t.accessActive||t.purchaseActive||t.subscriptionActive),subscriptionActive:!!(t.subscriptionActive||t.purchaseActive||t.accessActive)}}catch{return null}}function C(){return!!c}function x(e=c){return!!(e?.accessActive||e?.purchaseActive||e?.subscriptionActive||e?.isAdmin)}function _(){return x(c)}function v(e){try{if(!e?.email){localStorage.removeItem(h);return}localStorage.setItem(h,JSON.stringify({email:e.email,userId:e.userId,isAdmin:!!e.isAdmin,purchaseActive:!!(e.purchaseActive||e.accessActive||e.subscriptionActive),accessActive:!!(e.accessActive||e.purchaseActive||e.subscriptionActive),subscriptionActive:!!(e.subscriptionActive||e.purchaseActive||e.accessActive),cachedAt:Date.now()}))}catch{}}function A(e){return c={email:e.email,userId:e.userId,isAdmin:!!e.isAdmin,purchaseActive:!!(e.purchaseActive||e.accessActive||e.subscriptionActive),accessActive:!!(e.accessActive||e.purchaseActive||e.subscriptionActive),subscriptionActive:!!(e.subscriptionActive||e.purchaseActive||e.accessActive)},v(c),c}function w(){c=null,v(null)}async function g(e,t={}){let n=Number(t.timeoutMs||0),s=n>0?new AbortController:null,r=s?setTimeout(()=>s.abort(),n):null,{timeoutMs:p,...o}=t;try{let i=await fetch(e,{headers:{"Content-Type":"application/json"},signal:s?.signal,...o}),a=await i.json().catch(()=>({}));return{ok:i.ok,status:i.status,data:a}}catch(i){if(i.name==="AbortError")return{ok:!1,status:0,data:{}};throw i}finally{r&&clearTimeout(r)}}var b=null;async function B(){if(b)return b;let{ok:e,data:t}=await g("/api/account/config");if(!e||!t.supabaseUrl)throw new Error("Could not load auth configuration");return b=t,b}async function y(e,t,n,s={},r){let p={"Content-Type":"application/json",apikey:t,...r?{Authorization:`Bearer ${r}`}:{},...s.headers||{}},o=await fetch(`${e}${n}`,{...s,headers:p}),i=await o.json().catch(()=>({}));if(!o.ok){let a=i.error_description||i.error||i.message||"Auth error";throw new Error(a)}return i}async function S(e,t){let{ok:n,data:s}=await g("/api/account/login/password",{method:"POST",body:JSON.stringify({email:e,password:t})});if(!n)throw new Error(s.error||"Login failed");return c={email:s.email||e,userId:s.userId,isAdmin:!!s.isAdmin,purchaseActive:!!(s.purchaseActive||s.accessActive||s.subscriptionActive),accessActive:!!(s.accessActive||s.purchaseActive||s.subscriptionActive),subscriptionActive:!!(s.subscriptionActive||s.purchaseActive||s.accessActive)},v(c),c}async function T(e,t){let{supabaseUrl:n,supabaseAnonKey:s}=await B(),r=await y(n,s,"/auth/v1/token?grant_type=password",{method:"POST",body:JSON.stringify({email:e,password:t})}),p=r.user?.id,o=r.access_token,i=r.refresh_token,a=Math.floor(Date.now()/1e3)+(r.expires_in||3600);if(!p||!o)throw new Error("Authentication failed \u2014 no token returned");let u=!1;try{let f=await y(n,s,`/rest/v1/profiles?id=eq.${p}&select=is_admin&limit=1`,{},o);u=Array.isArray(f)&&f.length>0&&f[0].is_admin===!0}catch{}let d=!1;if(u)d=!0;else{let f=await y(n,s,`/rest/v1/subscriptions?user_id=eq.${p}&status=in.(active,trialing)&limit=1`,{},o);d=Array.isArray(f)&&f.length>0}let{ok:m,data:l}=await g("/api/account/login",{method:"POST",body:JSON.stringify({accessToken:o,refreshToken:i})});if(!m)throw new Error(l.error||"Session storage failed");return c={email:l.email||e,userId:l.userId,isAdmin:!!l.isAdmin,purchaseActive:!!(l.purchaseActive||l.accessActive||l.subscriptionActive),accessActive:!!(l.accessActive||l.purchaseActive||l.subscriptionActive),subscriptionActive:!!(l.subscriptionActive||l.purchaseActive||l.accessActive)},v(c),c}async function O(){await g("/api/account/logout",{method:"POST"}),w()}async function I(e={}){let{timeoutMs:t=0,strict:n=!1}=e,s=n?"/api/account/status?strict=1":"/api/account/status",r;try{r=await g(s,{timeoutMs:t})}catch{r={ok:!1,status:0,data:{reason:"status_unreachable",retryable:!0}}}let{ok:p,status:o,data:i}=r,a=o===0||i.retryable===!0;if(p&&i.authenticated)return{authenticated:!0,definitive:!a,reason:i.reason||null,retryable:a,account:A(i)};let u=k();if(a&&u&&x(u))return{authenticated:!0,definitive:!1,reason:i.reason||"session_verification_failed",retryable:!0,status:o,account:A(u)};let d=o===401||o===403||p&&i.authenticated===!1&&a!==!0;return d&&w(),{authenticated:!1,definitive:d,reason:i.reason||null,retryable:a,status:o,account:null}}async function M(e={}){return(await I(e)).authenticated}function z(e){let t=document.getElementById("prometheus-login-screen");t&&t.remove();let n=document.createElement("div");if(n.id="prometheus-login-screen",n.innerHTML=`
    <div class="pls-backdrop"></div>
    <div class="pls-card">
      <div class="pls-logo">
        <img src="/assets/Prometheus.png" alt="" class="pls-logo-img" />
        <span class="pls-logo-text">PROMETHEUS</span>
      </div>

      <div class="pls-tagline">Sign in to your account</div>

      <div id="pls-error" class="pls-error" style="display:none"></div>
      <div id="pls-sub-warn" class="pls-sub-warn" style="display:none">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        No Prometheus purchase found. <a data-prometheus-link-mode="external" href="https://prometheusaiagent.vercel.app/pricing" target="_blank" class="pls-link">Buy access at prometheusaiagent.vercel.app</a>
      </div>

      <form id="pls-form" class="pls-form" autocomplete="on">
        <div class="pls-field">
          <label for="pls-email">Email</label>
          <input id="pls-email" type="email" autocomplete="email" placeholder="you@example.com" required />
        </div>
        <div class="pls-field">
          <label for="pls-password">Password</label>
          <input id="pls-password" type="password" autocomplete="current-password" placeholder="Your password" required />
        </div>
        <button type="submit" id="pls-submit" class="pls-btn">
          <span id="pls-btn-text">Sign in</span>
          <svg id="pls-spinner" class="pls-spinner" style="display:none" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" opacity=".25"/>
            <path d="M4 12a8 8 0 0 1 8-8" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>
          </svg>
        </button>
      </form>

      <a data-prometheus-link-mode="external" href="https://prometheusaiagent.vercel.app/signup" target="_blank" class="pls-signup-link">
        Don't have an account? Create one
      </a>
    </div>
  `,!document.getElementById("pls-styles")){let s=document.createElement("style");s.id="pls-styles",s.textContent=`
      #prometheus-login-screen {
        position: fixed;
        inset: 0;
        z-index: 99999;
        display: flex;
        align-items: center;
        justify-content: center;
        font-family: 'Manrope', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      }
      .pls-backdrop {
        position: absolute;
        inset: 0;
        background: #0a0a0f;
        background-image: radial-gradient(ellipse at 50% 0%, rgba(249,115,22,0.07) 0%, transparent 60%);
      }
      .pls-card {
        position: relative;
        width: 100%;
        max-width: 400px;
        margin: 0 16px;
        background: rgba(18,22,30,0.98);
        border: 1px solid rgba(249,115,22,0.18);
        border-radius: 18px;
        padding: 40px 36px 32px;
        box-shadow: 0 32px 80px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.04) inset;
        backdrop-filter: blur(20px);
      }
      .pls-logo {
        display: flex;
        align-items: center;
        gap: 12px;
        margin-bottom: 6px;
      }
      .pls-logo-img {
        width: 40px;
        height: 40px;
        object-fit: contain;
      }
      .pls-logo-text {
        font-size: 22px;
        font-weight: 800;
        letter-spacing: 0.1em;
        background: linear-gradient(135deg, #f97316 0%, #facc15 100%);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        background-clip: text;
      }
      .pls-tagline {
        font-size: 13px;
        color: #7a8799;
        margin-bottom: 28px;
        margin-left: 52px;
      }
      .pls-error {
        background: rgba(220,38,38,0.12);
        border: 1px solid rgba(220,38,38,0.3);
        color: #f87171;
        font-size: 13px;
        border-radius: 10px;
        padding: 10px 14px;
        margin-bottom: 16px;
        line-height: 1.5;
      }
      .pls-sub-warn {
        display: flex;
        align-items: flex-start;
        gap: 8px;
        background: rgba(245,158,11,0.1);
        border: 1px solid rgba(245,158,11,0.25);
        color: #fbbf24;
        font-size: 13px;
        border-radius: 10px;
        padding: 10px 14px;
        margin-bottom: 16px;
        line-height: 1.5;
      }
      .pls-sub-warn svg { flex-shrink: 0; margin-top: 1px; }
      .pls-link { color: #f97316; text-decoration: underline; }
      .pls-form { display: flex; flex-direction: column; gap: 14px; }
      .pls-field { display: flex; flex-direction: column; gap: 6px; }
      .pls-field label {
        font-size: 12px;
        font-weight: 600;
        color: #8a96a8;
        letter-spacing: 0.02em;
      }
      .pls-field input {
        background: rgba(255,255,255,0.05);
        border: 1px solid rgba(255,255,255,0.1);
        border-radius: 10px;
        padding: 11px 14px;
        font-size: 14px;
        color: #e8edf6;
        font-family: inherit;
        outline: none;
        transition: border-color 0.15s;
      }
      .pls-field input::placeholder { color: #4a5568; }
      .pls-field input:focus { border-color: rgba(249,115,22,0.5); background: rgba(249,115,22,0.04); }
      .pls-btn {
        margin-top: 4px;
        background: linear-gradient(135deg, #f97316 0%, #ea6f10 100%);
        color: #fff;
        border: none;
        border-radius: 10px;
        padding: 12px;
        font-size: 14px;
        font-weight: 700;
        font-family: inherit;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        transition: opacity 0.15s, transform 0.1s;
        box-shadow: 0 4px 20px rgba(249,115,22,0.25);
      }
      .pls-btn:hover { opacity: 0.92; }
      .pls-btn:active { transform: scale(0.99); }
      .pls-btn:disabled { opacity: 0.5; cursor: not-allowed; }
      .pls-spinner { width: 16px; height: 16px; animation: pls-spin 0.75s linear infinite; }
      @keyframes pls-spin { to { transform: rotate(360deg); } }
      .pls-signup-link {
        display: block;
        text-align: center;
        margin-top: 20px;
        font-size: 12px;
        color: #5a6677;
        text-decoration: none;
        transition: color 0.15s;
      }
      .pls-signup-link:hover { color: #f97316; }
      #prometheus-login-screen.pls-fade-out {
        animation: pls-fadeout 0.35s ease forwards;
      }
      @keyframes pls-fadeout {
        to { opacity: 0; pointer-events: none; }
      }
    `,document.head.appendChild(s)}document.body.appendChild(n);try{let s=JSON.parse(localStorage.getItem(h)||"{}");s.email&&(document.getElementById("pls-email").value=s.email)}catch{}document.getElementById("pls-form").addEventListener("submit",async s=>{s.preventDefault();let r=document.getElementById("pls-email").value.trim(),p=document.getElementById("pls-password").value,o=document.getElementById("pls-error"),i=document.getElementById("pls-sub-warn"),a=document.getElementById("pls-submit"),u=document.getElementById("pls-btn-text"),d=document.getElementById("pls-spinner");o.style.display="none",i.style.display="none",a.disabled=!0,u.textContent="Signing in\u2026",d.style.display="";try{let m=await S(r,p);if(!x(m)){i.style.display="",a.disabled=!1,u.textContent="Sign in",d.style.display="none";return}n.classList.add("pls-fade-out"),setTimeout(()=>{n.remove(),e(m)},350)}catch(m){o.textContent=m.message||"Login failed. Check your email and password.",o.style.display="",a.disabled=!1,u.textContent="Sign in",d.style.display="none"}})}function P(e,t){let n=document.getElementById("prometheus-login-screen");n?(n.classList.add("pls-fade-out"),setTimeout(()=>{n.remove(),t(e)},350)):t(e)}export{E as a,k as b,C as c,x as d,_ as e,S as f,T as g,O as h,I as i,M as j,z as k,P as l};
