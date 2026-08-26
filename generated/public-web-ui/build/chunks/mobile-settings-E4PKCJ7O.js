import{F as y,G as h,M as U,N as V}from"./chunk-FFGOZKCE.js";import{a as B}from"./chunk-NQO4BGNT.js";import{d as K}from"./chunk-ETIIOFHC.js";import"./chunk-MGDZYTA3.js";import{h as g,jb as j}from"./chunk-4MLV3F4Z.js";import"./chunk-YMT6MSCC.js";import{a as F,b as C,e as J,f as L}from"./chunk-4WCZDNBS.js";import"./chunk-3EPMIDRU.js";import"./chunk-JF4LWGNM.js";import"./chunk-IPNQ4FF4.js";import"./chunk-EPSJJCWL.js";var oe={openai:["gpt-5.6-sol","gpt-5.6-terra","gpt-5.6-luna","gpt-5.5","gpt-5.4-pro","gpt-5.4","gpt-5.4-mini","gpt-5.4-nano","gpt-5-pro","gpt-5","gpt-5-mini","gpt-5-nano","gpt-5-chat-latest","gpt-4.1","gpt-4.1-mini","gpt-4o","gpt-4o-mini","o4-mini","o3","o1"],openai_codex:["gpt-5.6-sol","gpt-5.6-terra","gpt-5.6-luna","gpt-5.5","gpt-5.4-codex","gpt-5.4-codex-mini","gpt-5.4","gpt-5.4-mini","gpt-5.3-codex","gpt-5.3-codex-spark","gpt-5.3","gpt-5.2-codex","gpt-5.2","gpt-5.1-codex-max","gpt-5.1-codex-mini","gpt-5.1-codex","gpt-5.1"],anthropic:["claude-fable-5","claude-opus-4-8","claude-opus-4-7","claude-opus-4-6","claude-sonnet-5","claude-sonnet-4-6","claude-sonnet-4-5-20250514","claude-haiku-4-5-20251001"],perplexity:["sonar-pro","sonar","sonar-reasoning-pro","sonar-reasoning","sonar-deep-research"],gemini:["gemini-2.5-pro","gemini-2.5-flash","gemini-2.5-flash-lite","gemini-2.0-flash","gemini-1.5-pro","gemini-1.5-flash"],xai:["grok-4.6","grok-4.5","grok-composer-2.5-fast","grok-4.3","grok-4.3-latest","grok-latest","grok-4.20-0309-reasoning","grok-4.20-0309-non-reasoning","grok-4.20-multi-agent-0309","grok-4.20-multi-agent","grok-build-0.1"]},w=null;async function ie(t=!1){if(w&&!t)return w;try{let e=await g("/api/extensions/catalog?kind=provider");w=Array.isArray(e?.items)?e.items:[]}catch{w=w||[]}return w}function A(t,e=""){let s=String(t||"").trim(),n=(w||[]).find(d=>d&&d.id===s)||null,o=[],a=d=>{if(Array.isArray(d))for(let r of d){let l=String(r&&r.name||r||"").trim();l&&!o.includes(l)&&o.push(l)}};a(n&&n.runtime&&n.runtime.options&&n.runtime.options.staticModels),a(oe[s]);let v=String(e||"").trim();return v&&!o.includes(v)&&o.unshift(v),o}var H=[{id:"system",title:"System",icon:"gear",desc:"Theme-independent runtime and automatic chat settling."},{id:"heartbeat",title:"Heartbeat",icon:"clock",desc:"Background heartbeat cadence and instructions."},{id:"search",title:"Search",icon:"target",desc:"Preferred web search provider."},{id:"credentials",title:"Credentials",icon:"gear",desc:"Search keys, vault status, and audit log."},{id:"security",title:"Security",icon:"check",desc:"Workspace and file access allow/block lists."},{id:"models",title:"Models",icon:"brain",desc:"LLM providers, defaults, brain, and compaction."},{id:"agents",title:"Agents",icon:"robot",desc:"Agent list and model defaults."},{id:"channels",title:"Channels",icon:"send",desc:"Telegram, Discord, and WhatsApp connections."},{id:"integrations",title:"Integrations",icon:"paperclip",desc:"Webhooks and MCP servers."}],re=new Set(H.map(t=>t.id));function G(t,e="muted"){return`<div class="pm-settings-status ${e}">${h(t||"")}</div>`}function b(t,e,s="gear",n=""){return`<article class="pm-card pm-settings-card ${n}">
    <div class="pm-card-head">${y[s]||""} ${h(t)}</div>
    ${e}
  </article>`}function i(t,e,s=""){return`<label class="pm-settings-field"><span>${h(t)}</span>${e}${s?`<em>${h(s)}</em>`:""}</label>`}function f(t,e,s){return`<select class="pm-input pm-select" id="${h(t)}">${e.map(n=>{let o=typeof n=="string"?n:n.value,a=typeof n=="string"?n:n.label;return`<option value="${h(o)}" ${String(o)===String(s)?"selected":""}>${h(a)}</option>`}).join("")}</select>`}function x(t,e){return(e||[]).map(s=>({value:s,label:B(s,t)}))}function m(t,e="",s=""){return`<input class="pm-input" id="${h(t)}" value="${h(e||"")}" ${s} />`}function M(t,e="",s=""){return`<textarea class="pm-textarea" id="${h(t)}" ${s}>${h(e||"")}</textarea>`}function $(t,e,s,n=""){return`<div class="pm-settings-toggle-row">
    <div><strong>${h(e)}</strong>${n?`<span>${h(n)}</span>`:""}</div>
    <button class="pm-toggle ${s?"on":""}" id="${h(t)}" data-toggle-bool="${h(t)}" aria-label="${h(e)}" aria-pressed="${s?"true":"false"}"></button>
  </div>`}function _(t,e){return t.querySelector(`#${CSS.escape(e)}`)?.classList.contains("on")===!0}function c(t,e){return String(t.querySelector(`#${CSS.escape(e)}`)?.value||"").trim()}function ae(t){return String(t||"").split(",").map(e=>e.trim()).filter(Boolean)}function z(t){return String(t||"").split(`
`).map(e=>e.trim()).filter(Boolean)}function p(t,e,s="muted"){let n=t.querySelector("#pm-settings-live-status");n&&(n.className=`pm-settings-status ${s}`,n.textContent=e||"")}function I(t){t.querySelectorAll("[data-toggle-bool]").forEach(e=>{e.addEventListener("click",()=>{let s=!e.classList.contains("on");e.classList.toggle("on",s),e.setAttribute("aria-pressed",s?"true":"false")})})}function X(t){return{openai:"OpenAI API",openai_codex:"OpenAI OAuth",anthropic:"Anthropic",xai:"xAI / Grok",ollama:"Ollama",gemini:"Gemini",perplexity:"Perplexity",elevenlabs:"ElevenLabs"}[t]||t.replace(/_/g," ").replace(/\b\w/g,s=>s.toUpperCase())}function de(t){let e=t?.providers&&typeof t.providers=="object"?t.providers:{},s=Object.keys(e);return s.includes("ollama")||s.push("ollama"),s.includes("openai")||s.push("openai"),s.includes("openai_codex")||s.push("openai_codex"),s.includes("anthropic")||s.push("anthropic"),s.includes("xai")||s.push("xai"),s}function le(t=""){return`<div class="pm-settings-section-grid">
    ${H.map(e=>`<button class="pm-settings-section ${e.id===t?"active":""}" data-settings-section="${e.id}">
      <span>${y[e.icon]||y.gear}</span>
      <strong>${h(e.title)}</strong>
      <em>${h(e.desc)}</em>
    </button>`).join("")}
  </div>`}function Ie(t,{section:e="",navigate:s}={}){K();let n=re.has(e)?e:"",o=n&&H.find(v=>v.id===n)?.title||"Settings",a=n?"back":"menu";t.innerHTML=`
    ${U({title:o,online:!0,leftIcon:a})}
    <main class="pm-body pm-settings-body">
      ${n?`<div class="pm-settings-topnav"><button class="pm-btn ghost" data-settings-home>${y.back} All settings</button></div>`:""}
      <div id="pm-settings-content">${n?`<div class="pm-card">${G("Loading settings...")}</div>`:ce()}</div>
    </main>
  `,V(t,{onBack:()=>s?.("#mobile/settings"),onSettings:()=>s?.("#mobile/settings")}),t.querySelector("[data-settings-home]")?.addEventListener("click",()=>s?.("#mobile/settings")),t.querySelectorAll("[data-settings-section]").forEach(v=>{v.addEventListener("click",()=>s?.(`#mobile/settings/${v.getAttribute("data-settings-section")}`))}),n&&me(t,n,s).catch(v=>{let d=t.querySelector("#pm-settings-content");d&&(d.innerHTML=b("Error",G(v.message||"Failed to load settings","error"),"gear"))})}function ce(){return`
    ${b("Mobile Settings",'<div class="pm-card-body">Configure the same Settings tabs from desktop, adapted for this paired phone. Shortcuts and Pairing stay desktop-only.</div>',"gear","pm-card-strong")}
    ${le("")}
  `}async function me(t,e,s){let n=t.querySelector("#pm-settings-content");if(n){if(e==="system")return ee(n,t);if(e==="models")return he(n,t);if(e==="credentials")return D(n,t);if(e==="search")return ge(n,t);if(e==="heartbeat")return ye(n,t);if(e==="security")return be(n,t);if(e==="agents")return O(n,t);if(e==="channels")return fe(n,t);if(e==="integrations")return $e(n,t)}}function pe(){let t=new Date;return t.setDate(t.getDate()-1),`${t.getFullYear()}-${String(t.getMonth()+1).padStart(2,"0")}-${String(t.getDate()).padStart(2,"0")}`}function ue(){return new Promise(t=>{let e=document.createElement("div");e.style.cssText="position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.38);display:flex;align-items:center;justify-content:center;padding:16px";let s=document.createElement("div");s.style.cssText="width:min(520px,100%);background:var(--pm-panel,var(--panel));border:1px solid var(--pm-line,var(--line));border-radius:16px;padding:20px;color:var(--pm-text,var(--text));box-shadow:0 12px 42px rgba(0,0,0,.22)",s.innerHTML=`
      <div style="font-size:16px;font-weight:800;margin-bottom:9px">When should auto-settle begin?</div>
      <div style="font-size:13px;line-height:1.55;color:var(--pm-muted,var(--muted));margin-bottom:16px">Include chats already older than the selected date, or start the inactivity clock from now for existing chats.</div>
      <div style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap">
        <button data-choice="cancel" class="pm-btn ghost" type="button">Cancel</button>
        <button data-choice="start_now" class="pm-btn" type="button">Start from now</button>
        <button data-choice="apply_existing" class="pm-btn primary" type="button">Apply to eligible chats</button>
      </div>`,e.appendChild(s),document.body.appendChild(e);let n=o=>{e.remove(),t(o)};s.querySelectorAll("[data-choice]").forEach(o=>o.addEventListener("click",()=>{let a=o.getAttribute("data-choice");n(a==="cancel"?null:a)})),e.addEventListener("click",o=>{o.target===e&&n(null)})})}async function ee(t,e){let s=await g("/api/settings/session"),n=s?.session?.autoSettle||{},o=n.mode==="custom"?"custom":String(Number(n.afterDays)||0),a=[{value:"0",label:"Never"},{value:"7",label:"7 days"},{value:"14",label:"14 days"},{value:"30",label:"30 days"},{value:"90",label:"90 days"},{value:"custom",label:"Custom"}];t.innerHTML=`
    ${b("Auto-settle untouched chats",`
      <div class="pm-card-body">Move untouched conversations to Settled Chats after the selected inactivity period. Nothing is deleted, summarized, marked read, or detached.</div>
      ${i("Inactivity period",f("pm-auto-settle-after",a,o))}
      <div id="pm-auto-settle-custom-wrap" style="display:${o==="custom"?"block":"none"}">
        ${i("Custom cutoff date",m("pm-auto-settle-custom-date",n.customDate||"",`type="date" max="${pe()}"`),"Choose a date before today.")}
      </div>
      <div class="pm-card-body">Protected chats\u2014pinned, active, task-owned, scheduled, supervised, project, approval-sensitive, and automated chats\u2014are always skipped.</div>
      <div id="pm-settings-live-status"></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="pm-btn" id="pm-preview-auto-settle" type="button">Preview eligible chats</button>
        <button class="pm-btn primary" id="pm-save-auto-settle" type="button">Save auto-settle</button>
      </div>
    `,"gear","pm-card-strong")}
    ${b("Last auto-settle check",`<div class="pm-card-body" id="pm-auto-settle-last-run">${h(s?.session?.autoSettleLastRun?`Completed ${new Date(Number(s.session.autoSettleLastRun.completedAt||0)).toLocaleString()} \xB7 ${Number(s.session.autoSettleLastRun.settled||0)} settled.`:"No automatic check has run yet.")}</div>`,"clock")}
  `;let v=e.querySelector("#pm-auto-settle-after"),d=e.querySelector("#pm-auto-settle-custom-wrap");v?.addEventListener("change",()=>{d&&(d.style.display=v.value==="custom"?"block":"none")}),e.querySelector("#pm-preview-auto-settle")?.addEventListener("click",async()=>{try{p(e,"Previewing protected-state checks...");let l=(await g("/api/settings/auto-settle/preview",{method:"POST",body:JSON.stringify({})}))?.summary||{};p(e,`${Number(l.wouldSettle||0)} eligible \xB7 ${Number(l.scanned||0)} scanned.`,"ok")}catch(r){p(e,r.message,"error")}}),e.querySelector("#pm-save-auto-settle")?.addEventListener("click",async()=>{let r=v?.value||"0",l={afterDays:r==="custom"?"custom":Number(r),activationMode:"start_now"};if(r==="custom"){if(l.customDate=c(e,"pm-auto-settle-custom-date"),!l.customDate){p(e,"Choose a custom cutoff date first.","error");return}let u=new Date(`${l.customDate}T00:00:00`);if(l.customDateOffsetMinutes=Number.isFinite(u.getTime())?u.getTimezoneOffset():new Date().getTimezoneOffset(),l.activationMode=await ue(),!l.activationMode)return}try{await g("/api/settings/session",{method:"POST",body:JSON.stringify({autoSettle:l})}),p(e,"Auto-settle settings saved.","ok"),await ee(t,e)}catch(u){p(e,u.message,"error")}})}async function he(t,e){let[s,n,o]=await Promise.all([g("/api/settings/provider"),g("/api/settings/session").catch(()=>null),j().catch(()=>null),ie()]),a=s?.llm||{},v=a.provider||"ollama",d=de(a),r=a.providers?.[v]||{},l=n?.session||{};t.innerHTML=`
    ${b("Runtime",`<div class="pm-settings-kv">
      <span>Current model</span><strong>${h(o?.currentModel||r.model||"Unknown")}</strong>
      <span>Provider</span><strong>${h(X(v))}</strong>
      <span>Status</span><strong>${o?.providerOnline?"Online":"Unknown"}</strong>
    </div>`,"brain")}
    ${b("Provider",`
      ${i("Active provider",f("pm-set-provider",d.map(u=>({value:u,label:X(u)})),v))}
      <div id="pm-provider-fields">${Y(v,r)}</div>
      <div class="pm-row-buttons">
        <button class="pm-btn" id="pm-refresh-models">${y.refresh} Refresh Models</button>
        <button class="pm-btn" id="pm-test-model">${y.refresh} Test</button>
        <button class="pm-btn primary" id="pm-save-model">${y.check} Save</button>
      </div>
      <div id="pm-settings-live-status"></div>
    `,"gear","pm-card-strong")}
    ${b("Context Compaction",`
      <div class="pm-card-body">Prometheus uses the selected model's token window automatically. Context is compacted only when token pressure requires it; message count does not define model context.</div>
      ${$("pm-session-roll","Rolling compaction",l.rollingCompactionEnabled!==!1,"Automatically summarize older active context when token pressure requires it.")}
      ${i("Compaction threshold",m("pm-session-compact",l.compactionThreshold||.82,'type="number" min="0.4" max="0.95" step="0.01"'))}
      ${i("Memory flush threshold",m("pm-session-memory",l.memoryFlushThreshold||.9,'type="number" min="0.5" max="0.98" step="0.01"'))}
      ${i("Rolling tool turns",m("pm-session-tool-turns",l.rollingCompactionToolTurns||4,'type="number" min="1" max="12"'))}
      ${i("Summary max words",m("pm-session-words",l.rollingCompactionSummaryMaxWords||900,'type="number" min="80" max="1500"'))}
      ${i("Compaction model override",m("pm-session-model",l.rollingCompactionModel||"",'placeholder="Optional"'))}
      <button class="pm-btn primary" id="pm-save-session">${y.check} Save compaction</button>
    `,"clipboard")}
  `,I(e),e.querySelector("#pm-set-provider")?.addEventListener("change",()=>{let u=c(e,"pm-set-provider"),k=a.providers?.[u]||{},P=e.querySelector("#pm-provider-fields");P&&(P.innerHTML=Y(u,k)),I(e)}),e.querySelector("#pm-refresh-models")?.addEventListener("click",async()=>{p(e,"Loading models...");try{let u=q(e,a),k=u.provider,P=await g("/api/models/test",{method:"POST",body:JSON.stringify({llm:u})}),T=(P.models||[]).map(S=>typeof S=="string"?S:S.name||String(S)).filter(Boolean),E=e.querySelector(`#${CSS.escape(R(k))}`);if(E&&T.length&&E.tagName==="SELECT"){let S=E.value;E.innerHTML=x(k,T).map(W=>`<option value="${h(W.value)}">${h(W.label)}</option>`).join(""),S&&T.includes(S)&&(E.value=S)}p(e,T.length?`${T.length} model(s) found.`:P.error||"No models found.",T.length?"ok":"warn")}catch(u){p(e,u.message,"error")}}),e.querySelector("#pm-test-model")?.addEventListener("click",async()=>{p(e,"Testing provider...");try{let u=q(e,a),k=await g("/api/models/test",{method:"POST",body:JSON.stringify({llm:u})});p(e,k.success?`Connected. ${Array.isArray(k.models)?k.models.length:0} models returned.`:k.error||"Could not connect",k.success?"ok":"warn")}catch(u){p(e,u.message,"error")}}),e.querySelector("#pm-save-model")?.addEventListener("click",async()=>{p(e,"Saving model settings...");try{let u=q(e,a);await g("/api/settings/provider",{method:"POST",body:JSON.stringify({llm:u})}),p(e,"Model settings saved.","ok")}catch(u){p(e,u.message,"error")}}),e.querySelector("#pm-save-session")?.addEventListener("click",async()=>{try{await g("/api/settings/session",{method:"POST",body:JSON.stringify({rollingCompactionEnabled:_(e,"pm-session-roll"),compactionThreshold:Number(c(e,"pm-session-compact")),memoryFlushThreshold:Number(c(e,"pm-session-memory")),rollingCompactionToolTurns:Number(c(e,"pm-session-tool-turns")),rollingCompactionSummaryMaxWords:Number(c(e,"pm-session-words")),rollingCompactionModel:c(e,"pm-session-model")})}),p(e,"Compaction settings saved.","ok")}catch(u){p(e,u.message,"error")}})}function q(t,e){let s=c(t,"pm-set-provider")||e.provider||"ollama",n={...e.providers||{}};n[s]={...n[s]||{}};let o=n[s],a=c(t,R(s));a&&(o.model=a);let v=c(t,te(s));v?o.endpoint=v:delete o.endpoint;let d=c(t,se(s));d&&(o.api_key=d);let r=c(t,ne(s));if(r&&J(s,o.model,r)?o.reasoning_effort=r:delete o.reasoning_effort,s==="anthropic"){o.extended_thinking=_(t,"pm-anthropic-thinking");let u=Number(c(t,"pm-anthropic-budget"));u&&(o.thinking_budget=u)}let l=c(t,`pm-speed-${s}`);return L(s,o.model)?o.speed=l==="fast"?"fast":"standard":delete o.speed,delete o.fast_mode,{...e,provider:s,providers:n}}function R(t){return`pm-model-${t}`}function te(t){return`pm-endpoint-${t}`}function se(t){return`pm-key-${t}`}function ne(t){return`pm-effort-${t}`}function Y(t,e={}){let s=R(t),n=te(t),o=se(t),a=ne(t),v=["","minimal","low","medium","high","xhigh","max"].map(l=>({value:l,label:l==="xhigh"?"X high":l||"none"})),d=["","minimal","low","medium","high","xhigh","max","ultra"].map(l=>({value:l,label:l==="xhigh"?"X high":l==="ultra"?"Ultra":l||"none"})),r=["","low","medium","high","xhigh","max"].map(l=>({value:l,label:l==="xhigh"?"X high":l||"provider default"}));if(t==="ollama")return`
      ${i("Endpoint",m(n,e.endpoint||"http://localhost:11434"))}
      ${i("Active Model",m(s,e.model||"",'placeholder="qwen3:4b"'))}
    `;if(t==="llama_cpp")return`${i("Endpoint",m(n,e.endpoint||"http://localhost:8080"))}${i("Model name",m(s,e.model||"",'placeholder="qwen2.5-7b"'))}`;if(t==="lm_studio")return`${i("Endpoint",m(n,e.endpoint||"http://localhost:1234"))}${i("Model name",m(s,e.model||"",'placeholder="qwen2.5-7b-instruct"'))}`;if(t==="openai"){let l=C(t,e.model||"gpt-5.5").map(u=>({value:u,label:u||"provider default"}));return`
      ${i("API Key",m(o,e.api_key||"",'type="password" placeholder="sk-..."'))}
      ${i("Model",f(s,x(t,A(t,e.model||"gpt-5.5")),e.model||"gpt-5.5"))}
      ${l.length>1?i("Reasoning Effort",f(a,l,e.reasoning_effort||"")):""}
      ${L(t,e.model||"gpt-5.5")?i("Speed",f(`pm-speed-${t}`,[{value:"standard",label:"Standard"},{value:"fast",label:"Fast"}],e.speed||"standard")):""}
    `}if(t==="openai_codex"){let l=C(t,e.model||"gpt-5.5").map(u=>({value:u,label:u||"provider default"}));return`
      ${i("Model",f(s,x(t,A(t,e.model||"gpt-5.5")),e.model||"gpt-5.5"))}
      ${i("Reasoning Effort",f(a,l,e.reasoning_effort||""))}
      ${L(t,e.model||"gpt-5.5")?i("Speed",f(`pm-speed-${t}`,[{value:"standard",label:"Standard"},{value:"fast",label:"Fast"}],e.speed||"standard")):""}
      <div class="pm-settings-callout">Connect or disconnect the ChatGPT account from Credentials/Auth controls on desktop if OAuth needs renewal.</div>
    `}if(t==="anthropic"){let l=F(t,e.model||"claude-sonnet-5"),u=C(t,e.model||"claude-sonnet-5").map(k=>({value:k,label:k||"provider default"}));return`
      ${i("Model",f(s,x(t,A(t,e.model||"claude-sonnet-5")),e.model||"claude-sonnet-5"))}
      ${u.length>1?i("Thinking Effort",f(a,u,e.reasoning_effort||"")):""}
      ${$("pm-anthropic-thinking","Extended thinking",e.extended_thinking===!0)}
      ${L(t,e.model||"claude-sonnet-5")?i("Speed",f(`pm-speed-${t}`,[{value:"standard",label:"Standard"},{value:"fast",label:"Fast"}],e.speed||(e.fast_mode===!0?"fast":"standard"))):""}
      ${l.thinkingMode==="manual"?i("Thinking Budget",f("pm-anthropic-budget",["2048","5000","10000","16000","24000","32000"],String(e.thinking_budget||"10000"))):""}
    `}if(t==="perplexity")return`${i("API Key",m(o,e.api_key||"",'type="password" placeholder="pplx-..."'))}${i("Model",f(s,x(t,A(t,e.model||"sonar-pro")),e.model||"sonar-pro"))}${i("Reasoning Effort",f(a,["","low","medium","high"].map(l=>({value:l,label:l||"none"})),e.reasoning_effort||""))}`;if(t==="xai"){let u=(/^grok-4\.20-multi-agent(?:-|$)/i.test(String(e.model||"").trim())?["","low","medium","high","xhigh"]:["","none","low","medium","high"]).map(k=>({value:k,label:k==="xhigh"?"extra high":k||"provider default"}));return`${i("API Key",m(o,e.api_key||"",'type="password" placeholder="xai-..."'))}${i("Model",f(s,x(t,A(t,e.model||"grok-4.3")),e.model||"grok-4.3"))}${i("Reasoning Effort",f(a,u,e.reasoning_effort||""))}${i("Endpoint",m(n,e.endpoint||"",'placeholder="https://api.x.ai/v1"'))}`}return t==="gemini"?`${i("API Key",m(o,e.api_key||"",'type="password" placeholder="AIza..."'))}${i("Model",f(s,x(t,A(t,e.model||"gemini-2.5-pro")),e.model||"gemini-2.5-pro"))}`:`${i("Model",m(s,e.model||"",'placeholder="Provider model"'))}${i("Endpoint",m(n,e.endpoint||"",'placeholder="Optional endpoint"'))}`}async function D(t,e){let[s,n,o]=await Promise.all([g("/api/settings/search").catch(()=>({})),g("/api/credentials/status").catch(()=>({keys:[]})),g("/api/credentials/audit").catch(()=>({lines:[]}))]);t.innerHTML=`
    ${b("Search Provider Keys",`
      <div class="pm-card-body" style="margin-bottom:10px;">Stored encrypted in the vault. Masked values keep the existing key.</div>
      ${i("TinyFish API Key",m("pm-cred-tinyfish",s.tinyfish_api_key||"",'type="password" placeholder="tf-..." autocomplete="new-password"'))}
      ${i("Tavily API Key",m("pm-cred-tavily",s.tavily_api_key||"",'type="password" placeholder="tvly-..." autocomplete="new-password"'))}
      ${i("Google API Key",m("pm-cred-google",s.google_api_key||"",'type="password" placeholder="AIza..." autocomplete="new-password"'))}
      ${i("Google CSE ID",m("pm-cred-google-cx",s.google_cx||"",'placeholder="Custom search engine ID"'),"Stored for persistence; leave as-is to keep current value.")}
      ${i("Brave API Key",m("pm-cred-brave",s.brave_api_key||"",'type="password" placeholder="BSA..." autocomplete="new-password"'))}
      <button class="pm-btn primary" id="pm-save-creds">${y.check} Save credentials</button>
      <div id="pm-settings-live-status"></div>
    `,"gear","pm-card-strong")}
    ${b("Vault Status",`<div class="pm-settings-list">
      ${(n.keys||[]).map(a=>`<div class="pm-settings-row"><span><strong>${h(ve(a))}</strong><em>${h(a)}</em></span><span class="pm-pill active">stored</span></div>`).join("")||'<div class="pm-card-body">No credentials stored yet.</div>'}
    </div>`,"check")}
    ${b("How Credentials Work",'<div class="pm-card-body">When saved, keys are encrypted with AES-256-GCM and referenced from config as vault entries. If a field shows bullets, a key is already stored.</div>',"clipboard")}
    ${b("Recent Vault Access",`<div class="pm-settings-log">${(o.lines||[]).slice(-18).reverse().map(a=>`<div>${h(a)}</div>`).join("")||"<div>No audit entries yet.</div>"}</div>
      <button class="pm-btn" id="pm-refresh-creds">${y.refresh} Refresh</button>`,"clipboard")}
  `,e.querySelector("#pm-refresh-creds")?.addEventListener("click",()=>D(t,e)),e.querySelector("#pm-save-creds")?.addEventListener("click",async()=>{try{await g("/api/settings/search",{method:"POST",body:JSON.stringify({preferred_provider:s.preferred_provider||"tavily",search_rigor:s.search_rigor||"verified",tinyfish_api_key:c(e,"pm-cred-tinyfish"),tavily_api_key:c(e,"pm-cred-tavily"),google_api_key:c(e,"pm-cred-google"),google_cx:c(e,"pm-cred-google-cx"),brave_api_key:c(e,"pm-cred-brave")})}),p(e,"Credentials saved.","ok"),await D(t,e)}catch(a){p(e,a.message,"error")}})}function ve(t){return{"search.tavily_api_key":"Tavily API Key","search.tinyfish_api_key":"TinyFish API Key","search.google_api_key":"Google API Key","search.google_cx":"Google CSE ID","search.brave_api_key":"Brave API Key","llm.openai.api_key":"OpenAI API Key","hooks.token":"Webhook Token","channels.telegram.botToken":"Telegram Token","channels.discord.botToken":"Discord Token"}[t]||t}async function ge(t,e){let s=await g("/api/settings/search");t.innerHTML=`
    ${b("Web Search",`
      ${i("Preferred provider",f("pm-search-provider",["tavily","tinyfish","google","brave","none"],s.preferred_provider||"tavily"))}
      <div class="pm-settings-callout">API keys are managed in the Credentials tab and stored encrypted.</div>
      <button class="pm-btn primary" id="pm-save-search">${y.check} Save search provider</button>
      <div id="pm-settings-live-status"></div>
    `,"target","pm-card-strong")}
  `,e.querySelector("#pm-save-search")?.addEventListener("click",async()=>{try{await g("/api/settings/search",{method:"POST",body:JSON.stringify({preferred_provider:c(e,"pm-search-provider"),search_rigor:s.search_rigor||"verified",tavily_api_key:s.tavily_api_key||"",tinyfish_api_key:s.tinyfish_api_key||"",google_api_key:s.google_api_key||"",google_cx:s.google_cx||"",brave_api_key:s.brave_api_key||""})}),p(e,"Search settings saved.","ok")}catch(n){p(e,n.message,"error")}})}async function ye(t,e){let n=(await g("/api/settings/heartbeat")).heartbeat||{};t.innerHTML=b("Heartbeat",`
    ${$("pm-hb-enabled","Enabled",n.enabled!==!1,"Allow Prometheus to wake itself for background work.")}
    ${i("Interval minutes",m("pm-hb-interval",n.interval_minutes||30,'type="number" min="1" max="1440"'))}
    ${i("Model override",m("pm-hb-model",n.model||"",'placeholder="Optional"'))}
    ${$("pm-hb-review","Review teams after run",n.review_teams_after_run===!0)}
    ${i("Instructions",M("pm-hb-instructions",n.instructions||"",'rows="10"'))}
    <button class="pm-btn primary" id="pm-save-heartbeat">${y.check} Save heartbeat</button>
    <div id="pm-settings-live-status"></div>
  `,"clock","pm-card-strong"),I(e),e.querySelector("#pm-save-heartbeat")?.addEventListener("click",async()=>{try{await g("/api/settings/heartbeat",{method:"POST",body:JSON.stringify({enabled:_(e,"pm-hb-enabled"),interval_minutes:Number(c(e,"pm-hb-interval")),model:c(e,"pm-hb-model"),review_teams_after_run:_(e,"pm-hb-review"),instructions:e.querySelector("#pm-hb-instructions")?.value||""})}),p(e,"Heartbeat settings saved.","ok")}catch(o){p(e,o.message,"error")}})}async function be(t,e){let s=await g("/api/settings/paths").catch(()=>({}));t.innerHTML=`
    ${b("File Access",`
      ${i("Workspace Path",m("pm-sec-workspace",s.workspace_path||"",'placeholder="%APPDATA%\\\\Prometheus\\\\workspace"'))}
      ${i("Allowed Paths (one per line)",M("pm-sec-allowed",(s.allowed_paths||[]).join(`
`),'rows="6"'))}
      ${i("Blocked Paths (one per line)",M("pm-sec-blocked",(s.blocked_paths||[]).join(`
`),'rows="5"'))}
      <button class="pm-btn primary" id="pm-save-security">${y.check} Save file access</button>
      <div id="pm-settings-live-status"></div>
    `,"check","pm-card-strong")}
  `,e.querySelector("#pm-save-security")?.addEventListener("click",async()=>{try{await g("/api/settings/paths",{method:"POST",body:JSON.stringify({workspace_path:c(e,"pm-sec-workspace"),allowed_paths:z(e.querySelector("#pm-sec-allowed")?.value||""),blocked_paths:z(e.querySelector("#pm-sec-blocked")?.value||"")})}),p(e,"File access settings saved.","ok")}catch(n){p(e,n.message,"error")}})}async function O(t,e){let[s,n]=await Promise.all([g("/api/agents").catch(()=>({agents:[]})),g("/api/settings/agent-model-defaults").catch(()=>({defaults:{}}))]),o=s.agents||s.items||[],a=n.defaults||{},v=["main_chat","proposal_executor_high_risk","proposal_executor_low_risk","coordinator","manager","subagent_planner","subagent_orchestrator","subagent_researcher","subagent_analyst","subagent_builder","subagent_operator"],d=o.find(r=>String(r.id)===String(e._pmSelectedAgentId))||o.find(r=>r.id==="main")||o[0]||{};t.innerHTML=`
    ${b("Model Defaults",`
      ${v.map(r=>i(r.replace(/_/g," "),m(`pm-agent-def-${r}`,a[r]||"",'placeholder="Provider/model"'))).join("")}
      <button class="pm-btn primary" id="pm-save-agent-defaults">${y.check} Save defaults</button>
      <div id="pm-settings-live-status"></div>
    `,"brain","pm-card-strong")}
    ${b("Configured Agents",`<div class="pm-settings-list">${o.map(r=>`<button class="pm-settings-row pm-settings-row-button ${String(r.id)===String(d.id)?"active":""}" data-agent-id="${h(r.id)}">
      <span><strong>${h(r.name||r.id)}</strong><em>${h(r.description||r.model||r.status||"")}</em></span>
      <span class="pm-pill ${r.enabled===!1?"gray":"active"}">${r.enabled===!1?"off":"on"}</span>
    </button>`).join("")||'<div class="pm-card-body">No agents found.</div>'}</div>
      <button class="pm-btn" id="pm-new-agent" style="margin-top:10px;">${y.plus} New Agent</button>`,"robot")}
    ${Q(d)}
  `,e.querySelectorAll("[data-agent-id]").forEach(r=>r.addEventListener("click",async()=>{e._pmSelectedAgentId=r.getAttribute("data-agent-id"),await O(t,e)})),e.querySelector("#pm-new-agent")?.addEventListener("click",()=>{e._pmSelectedAgentId="";let r=e.querySelector("#pm-agent-editor");r&&(r.innerHTML=Q({id:"",name:"",description:"",workspace:"",maxSteps:8,default:!1},!0)),Z(e,t)}),Z(e,t,d),e.querySelector("#pm-save-agent-defaults")?.addEventListener("click",async()=>{try{let r={};v.forEach(l=>{r[l]=c(e,`pm-agent-def-${l}`)}),await g("/api/settings/agent-model-defaults",{method:"POST",body:JSON.stringify(r)}),p(e,"Agent defaults saved.","ok")}catch(r){p(e,r.message,"error")}})}function Q(t={},e=!1){return`<div id="pm-agent-editor">${b("Agent Details",`
    ${i("ID",m("pm-agent-id",t.id||"",`${e?"":"readonly"} placeholder="researcher"`))}
    ${i("Name",m("pm-agent-name",t.name||"",'placeholder="Scout"'))}
    ${i("Description",M("pm-agent-description",t.description||"",'rows="3"'))}
    ${i("Workspace",m("pm-agent-workspace",t.workspace||"",'placeholder="%APPDATA%\\\\Prometheus\\\\workspace\\\\agents\\\\researcher"'))}
    ${i("Model",m("pm-agent-model",t.model||"",'placeholder="provider/model or blank for default"'))}
    ${i("Max Steps",m("pm-agent-max-steps",t.maxSteps||t.max_steps||8,'type="number" min="1" step="1"'))}
    ${$("pm-agent-default","Default agent",t.default===!0)}
    <div class="pm-row-buttons">
      <button class="pm-btn primary" id="pm-save-agent">${y.check} Save Agent</button>
      ${t.id&&t.id!=="main"?`<button class="pm-btn ghost" id="pm-delete-agent">${y.trash} Delete</button>`:""}
    </div>
  `,"robot","pm-card-strong")}
  ${t.id&&t.id!=="main"?b("Manual Spawn + Run History",`
    ${i("Task",M("pm-agent-task","",'rows="3" placeholder="Run a one-off task for this agent..."'))}
    <div class="pm-row-buttons">
      <button class="pm-btn primary" id="pm-run-agent">${y.play} Run Once</button>
      <button class="pm-btn" id="pm-agent-history">${y.refresh} Refresh History</button>
    </div>
    <div id="pm-agent-run-output" class="pm-settings-log" style="margin-top:10px;"></div>
  `,"play"):""}</div>`}function Z(t,e){I(t),t.querySelector("#pm-save-agent")?.addEventListener("click",async()=>{let s=c(t,"pm-agent-id");if(!s)return p(t,"Agent ID is required.","error");let n={id:s,name:c(t,"pm-agent-name"),description:t.querySelector("#pm-agent-description")?.value||"",workspace:c(t,"pm-agent-workspace"),model:c(t,"pm-agent-model"),maxSteps:Number(c(t,"pm-agent-max-steps"))||8,default:_(t,"pm-agent-default")};try{let o=!!t._pmSelectedAgentId;await g(o?`/api/agents/${encodeURIComponent(s)}`:"/api/agents",{method:o?"PUT":"POST",body:JSON.stringify({agent:n})}),t._pmSelectedAgentId=s,p(t,"Agent saved.","ok"),await O(e,t)}catch(o){p(t,o.message,"error")}}),t.querySelector("#pm-delete-agent")?.addEventListener("click",async()=>{let s=c(t,"pm-agent-id");if(!(!s||!window.confirm(`Delete agent "${s}"?`)))try{await g(`/api/agents/${encodeURIComponent(s)}`,{method:"DELETE"}),t._pmSelectedAgentId="",await O(e,t)}catch(n){p(t,n.message,"error")}}),t.querySelector("#pm-run-agent")?.addEventListener("click",async()=>{let s=c(t,"pm-agent-id"),n=String(t.querySelector("#pm-agent-task")?.value||"").trim(),o=t.querySelector("#pm-agent-run-output");if(!n)return p(t,"Provide a task first.","error");o&&(o.innerHTML="<div>Running...</div>");try{let a=await g(`/api/agents/${encodeURIComponent(s)}/spawn`,{method:"POST",body:JSON.stringify({task:n})});o&&(o.innerHTML=`<div>${h(JSON.stringify(a.result||a,null,2)).replace(/\n/g,"<br>")}</div>`)}catch(a){o&&(o.innerHTML=`<div>${h(a.message)}</div>`)}}),t.querySelector("#pm-agent-history")?.addEventListener("click",async()=>{let s=c(t,"pm-agent-id"),n=t.querySelector("#pm-agent-run-output");try{let o=await g(`/api/agents/history?agentId=${encodeURIComponent(s)}&limit=12`);n&&(n.innerHTML=(o.history||[]).map(a=>`<div><strong>${h(a.success?"success":"failed")}</strong> ${h(a.trigger||"manual")}<br><em>${h(a.resultPreview||a.error||"")}</em></div>`).join("")||"<div>No runs yet.</div>")}catch(o){n&&(n.innerHTML=`<div>${h(o.message)}</div>`)}})}async function fe(t,e){let s=await g("/api/channels/status"),n=s.telegram||{},o=s.discord||{},a=s.whatsapp||{};t.innerHTML=`
    ${b("Channel Connection",`
      ${i("Channel",f("pm-channel-select",[{value:"telegram",label:"Telegram"},{value:"discord",label:"Discord"},{value:"whatsapp",label:"WhatsApp"}],"telegram"))}
      <div id="pm-channel-status-card"></div>
      <div id="pm-channel-form"></div>
      <div class="pm-row-buttons">
        <button class="pm-btn" id="pm-channel-test">${y.refresh} Test</button>
        <button class="pm-btn primary" id="pm-channel-save">${y.check} Save</button>
        <button class="pm-btn" id="pm-channel-send">${y.send} Send Test</button>
      </div>
      <div id="pm-settings-live-status"></div>
    `,"send","pm-card-strong")}
    ${b("Instructions",'<div id="pm-channel-guide" class="pm-card-body"></div>',"clipboard")}
  `;let v=()=>ke(e,{telegram:n,discord:o,whatsapp:a});e.querySelector("#pm-channel-select")?.addEventListener("change",v),v(),e.querySelector("#pm-channel-save")?.addEventListener("click",async()=>{let d=c(e,"pm-channel-select")||"telegram";try{await g("/api/channels/config",{method:"POST",body:JSON.stringify({channels:{[d]:N(e,d)}})}),p(e,`${d} settings saved.`,"ok")}catch(r){p(e,r.message,"error")}}),e.querySelector("#pm-channel-test")?.addEventListener("click",async()=>{let d=c(e,"pm-channel-select")||"telegram";try{let r=await g(`/api/channels/test/${d}`,{method:"POST",body:JSON.stringify(N(e,d))});p(e,r.success?`${d} connection test passed.`:r.error||`${d} test failed.`,r.success?"ok":"error")}catch(r){p(e,r.message,"error")}}),e.querySelector("#pm-channel-send")?.addEventListener("click",async()=>{let d=c(e,"pm-channel-select")||"telegram";try{let r=await g(`/api/channels/send-test/${d}`,{method:"POST",body:JSON.stringify(N(e,d))});p(e,r.success?`Test message sent via ${d}.`:r.error||"Send test failed.",r.success?"ok":"error")}catch(r){p(e,r.message,"error")}})}function ke(t,e){let s=c(t,"pm-channel-select")||"telegram",n=e[s]||{},o=t.querySelector("#pm-channel-status-card"),a=t.querySelector("#pm-channel-form"),v=t.querySelector("#pm-channel-guide");o&&(o.innerHTML=`<div class="pm-settings-channel">
    <div><strong>${h(s[0].toUpperCase()+s.slice(1))}</strong><span>${n.enabled?"Enabled":"Disabled"}${n.connected?" \xB7 connected":""}</span></div>
    <span class="pm-pill ${n.enabled?"active":"gray"}">${n.enabled?"on":"off"}</span>
  </div>`),s==="telegram"&&a?(a.innerHTML=`
      ${i("Bot Token",m("pm-ch-token","",`type="password" placeholder="${n.hasToken?"\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022 (saved)":"123456:ABC-DEF1234..."}"`))}
      ${i("Your Telegram User ID(s)",m("pm-ch-userids",(n.allowedUserIds||[]).join(", "),'placeholder="123456789, 987654321"'))}
      ${$("pm-ch-enabled","Enable Telegram channel",n.enabled===!0)}
    `,v&&(v.innerHTML="Create a bot with BotFather, paste the token, add allowed user IDs, then Test, Save, and Send Test.")):s==="discord"&&a?(a.innerHTML=`
      ${i("Bot Token",m("pm-ch-token","",`type="password" placeholder="${n.hasToken?"\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022 (saved)":"Discord bot token"}"`))}
      ${i("Application ID (optional)",m("pm-ch-appid",n.applicationId||""))}
      ${i("Guild ID (optional)",m("pm-ch-guildid",n.guildId||""))}
      ${i("Channel ID (for send-test)",m("pm-ch-channelid",n.channelId||""))}
      ${i("Webhook URL (optional)",m("pm-ch-webhook","",`type="password" placeholder="${n.hasWebhook?"\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022 (saved)":"https://discord.com/api/webhooks/..."}"`))}
      ${$("pm-ch-enabled","Enable Discord channel",n.enabled===!0)}
    `,v&&(v.innerHTML="Create an app and bot in Discord Developer Portal, invite it to your server, then Test, Save, and Send Test.")):a&&(a.innerHTML=`
      ${i("Access Token",m("pm-ch-token","",`type="password" placeholder="${n.hasAccessToken?"\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022 (saved)":"Meta access token"}"`))}
      ${i("Phone Number ID",m("pm-ch-phoneid",n.phoneNumberId||""))}
      ${i("Business Account ID (optional)",m("pm-ch-baid",n.businessAccountId||""))}
      ${i("Webhook Verify Token (optional)",m("pm-ch-verify","",`type="password" placeholder="${n.verifyTokenSet?"\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022 (saved)":"Verify token"}"`))}
      ${i("Webhook Secret (optional)",m("pm-ch-secret","",`type="password" placeholder="${n.webhookSecretSet?"\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022 (saved)":"Webhook secret"}"`))}
      ${i("Test Recipient (E.164)",m("pm-ch-recipient",n.testRecipient||"",'placeholder="15551234567"'))}
      ${$("pm-ch-enabled","Enable WhatsApp channel",n.enabled===!0)}
    `,v&&(v.innerHTML="Copy WhatsApp Cloud API credentials from Meta Developer dashboard, configure optional webhook fields, then Test, Save, and Send Test.")),I(t)}function N(t,e){let s=_(t,"pm-ch-enabled");return e==="telegram"?{enabled:s,botToken:c(t,"pm-ch-token"),allowedUserIds:ae(c(t,"pm-ch-userids"))}:e==="discord"?{enabled:s,botToken:c(t,"pm-ch-token"),applicationId:c(t,"pm-ch-appid"),guildId:c(t,"pm-ch-guildid"),channelId:c(t,"pm-ch-channelid"),webhookUrl:c(t,"pm-ch-webhook")}:{enabled:s,accessToken:c(t,"pm-ch-token"),phoneNumberId:c(t,"pm-ch-phoneid"),businessAccountId:c(t,"pm-ch-baid"),verifyToken:c(t,"pm-ch-verify"),webhookSecret:c(t,"pm-ch-secret"),testRecipient:c(t,"pm-ch-recipient")}}async function $e(t,e){let[s,n,o]=await Promise.all([g("/api/settings/hooks").catch(()=>null),g("/api/mcp/servers").catch(()=>({servers:[]})),g("/api/extensions/catalog").catch(()=>({items:[],extensions:[]}))]),a=n.servers||[],v=o.items||o.extensions||o.catalog||[];t.innerHTML=`
    ${b("Webhooks",`
      ${$("pm-hooks-enabled","Enabled",s?.hooks?.enabled||s?.enabled||!1)}
      ${i("Secret Token",m("pm-hooks-token",s?.hooks?.token||s?.token||"",'type="password" placeholder="Paste or generate a secret token"'))}
      ${i("Path",m("pm-hooks-path",s?.hooks?.path||s?.path||"/hooks/prometheus"))}
      <div class="pm-row-buttons">
        <button class="pm-btn" id="pm-generate-hooks">${y.refresh} Generate</button>
        <button class="pm-btn" id="pm-test-hooks">${y.refresh} Test</button>
        <button class="pm-btn primary" id="pm-save-hooks">${y.check} Save</button>
      </div>
      <div id="pm-settings-live-status"></div>
    `,"paperclip","pm-card-strong")}
    ${b("MCP Servers",`<div class="pm-settings-list">${a.map(d=>`<div class="pm-settings-row">
      <span><strong>${h(d.name||d.id)}</strong><em>${h(d.status||"disconnected")} \xB7 ${h(String(d.toolCount||0))} tools</em></span>
    </div>`).join("")||'<div class="pm-card-body">No MCP servers configured.</div>'}</div>`,"monitor")}
    ${b("Extensions",`<div class="pm-settings-chip-row">${v.slice(0,20).map(d=>`<span class="pm-pill gray">${h(d.name||d.id||d.title||"Extension")}</span>`).join("")||'<span class="pm-card-body">No extensions found.</span>'}</div>`,"spark")}
  `,I(e),e.querySelector("#pm-generate-hooks")?.addEventListener("click",()=>{let d=new Uint8Array(24);crypto.getRandomValues(d);let r=Array.from(d).map(u=>u.toString(16).padStart(2,"0")).join(""),l=e.querySelector("#pm-hooks-token");l&&(l.value=r,l.type="text")}),e.querySelector("#pm-save-hooks")?.addEventListener("click",async()=>{try{await g("/api/settings/hooks",{method:"POST",body:JSON.stringify({enabled:_(e,"pm-hooks-enabled"),token:c(e,"pm-hooks-token"),path:c(e,"pm-hooks-path")})}),p(e,"Webhook settings saved. Restart gateway to apply endpoint changes.","ok")}catch(d){p(e,d.message,"error")}}),e.querySelector("#pm-test-hooks")?.addEventListener("click",async()=>{try{let d=await g("/api/settings/hooks/test",{method:"POST",body:"{}"});p(e,d.success?"Webhook test sent.":d.error||"Webhook test failed.",d.success?"ok":"error")}catch(d){p(e,d.message,"error")}})}export{Ie as renderMobileSettingsPage};
