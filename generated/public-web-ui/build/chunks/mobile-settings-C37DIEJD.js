import{H as g,I as h,O as U,P as V}from"./chunk-JLTKH2SU.js";import{e as B}from"./chunk-DO6MFBAX.js";import{a as K}from"./chunk-T5RPXYYW.js";import"./chunk-QOVQ3TSE.js";import{h as y,mb as W}from"./chunk-3GPYCJDH.js";import"./chunk-YMT6MSCC.js";import{a as G,b as z}from"./chunk-W5C3O2WF.js";import"./chunk-JF4LWGNM.js";import"./chunk-KSCM72TY.js";import{c as J,d as C,g as F,h as L}from"./chunk-I7ZJTRGE.js";import"./chunk-EPSJJCWL.js";var Y={openai:["gpt-6.1-sol","gpt-6-astra","gpt-6-sol","gpt-6-luna","gpt-5.6-sol","gpt-5.6-terra","gpt-5.6-luna","gpt-5.5","gpt-5.4-pro","gpt-5.4","gpt-5.4-mini","gpt-5.4-nano","gpt-5-pro","gpt-5","gpt-5-mini","gpt-5-nano","gpt-5-chat-latest","gpt-4.1","gpt-4.1-mini","gpt-4o","gpt-4o-mini","o4-mini","o3","o1"],openai_codex:["gpt-6.1-sol","gpt-6-astra","gpt-6-sol","gpt-6-luna","gpt-5.6-sol","gpt-5.6-terra","gpt-5.6-luna","gpt-5.5","gpt-5.4-codex","gpt-5.4-codex-mini","gpt-5.4","gpt-5.4-mini","gpt-5.3-codex","gpt-5.3-codex-spark","gpt-5.3","gpt-5.2-codex","gpt-5.2","gpt-5.1-codex-max","gpt-5.1-codex-mini","gpt-5.1-codex","gpt-5.1"],anthropic:["claude-fable-5-1","claude-fable-5","claude-opus-5-5","claude-opus-5","claude-opus-4-8","claude-opus-4-7","claude-opus-4-6","claude-sonnet-5-5","claude-sonnet-5","claude-sonnet-4-6","claude-sonnet-4-5-20250514","claude-haiku-5-5","claude-haiku-4-5-20251001"],perplexity:["sonar-pro","sonar","sonar-reasoning-pro","sonar-reasoning","sonar-deep-research"],gemini:["gemini-2.5-pro","gemini-2.5-flash","gemini-2.5-flash-lite","gemini-2.0-flash","gemini-1.5-pro","gemini-1.5-flash"],xai:["grok-4.7","grok-4.6","grok-4.5","grok-composer-2.5-fast","grok-4.3","grok-4.3-latest","grok-latest","grok-4.20-0309-reasoning","grok-4.20-0309-non-reasoning","grok-4.20-multi-agent-0309","grok-4.20-multi-agent","grok-build-0.1"]},_=null;async function de(t=!1){if(_&&!t)return _;try{let e=await y("/api/extensions/catalog?kind=provider");_=Array.isArray(e?.items)?e.items:[]}catch{_=_||[]}return _}function P(t,e=""){let s=String(t||"").trim(),n=(_||[]).find(i=>i&&i.id===s)||null,o=[];(i=>{if(Array.isArray(i))for(let v of i){let m=String(v&&v.name||v||"").trim();m&&!o.includes(m)&&o.push(m)}})(n&&n.runtime&&n.runtime.options&&n.runtime.options.staticModels);let l=Array.isArray(Y[s])?Y[s]:[];l.forEach((i,v)=>{let m=String(i||"").trim();if(!m||o.includes(m))return;let k=-1;for(let $=v-1;$>=0&&k<0;$--)k=o.indexOf(String(l[$]||"").trim());if(k>=0){o.splice(k+1,0,m);return}let S=-1;for(let $=v+1;$<l.length&&S<0;$++)S=o.indexOf(String(l[$]||"").trim());S>=0?o.splice(S,0,m):o.push(m)});let a=String(e||"").trim();return a&&!o.includes(a)&&o.unshift(a),o}var H=[{id:"system",title:"System",icon:"gear",desc:"Theme-independent runtime and automatic chat settling."},{id:"heartbeat",title:"Heartbeat",icon:"clock",desc:"Background heartbeat cadence and instructions."},{id:"search",title:"Search",icon:"target",desc:"Preferred web search provider."},{id:"credentials",title:"Credentials",icon:"gear",desc:"Search keys, vault status, and audit log."},{id:"security",title:"Security",icon:"check",desc:"Workspace and file access allow/block lists."},{id:"models",title:"Models",icon:"brain",desc:"LLM providers, defaults, brain, and compaction."},{id:"agents",title:"Agents",icon:"robot",desc:"Agent list and model defaults."},{id:"channels",title:"Channels",icon:"send",desc:"Telegram, Discord, and WhatsApp connections."},{id:"integrations",title:"Integrations",icon:"paperclip",desc:"Webhooks and MCP servers."}],ce=new Set(H.map(t=>t.id));function Q(t,e="muted"){return`<div class="pm-settings-status ${e}">${h(t||"")}</div>`}function b(t,e,s="gear",n=""){return`<article class="pm-card pm-settings-card ${n}">
    <div class="pm-card-head">${g[s]||""} ${h(t)}</div>
    ${e}
  </article>`}function r(t,e,s=""){return`<label class="pm-settings-field"><span>${h(t)}</span>${e}${s?`<em>${h(s)}</em>`:""}</label>`}function f(t,e,s){return`<select class="pm-input pm-select" id="${h(t)}">${e.map(n=>{let o=typeof n=="string"?n:n.value,d=typeof n=="string"?n:n.label;return`<option value="${h(o)}" ${String(o)===String(s)?"selected":""}>${h(d)}</option>`}).join("")}</select>`}function A(t,e){return(e||[]).map(s=>({value:s,label:K(s,t)}))}function p(t,e="",s=""){return`<input class="pm-input" id="${h(t)}" value="${h(e||"")}" ${s} />`}function M(t,e="",s=""){return`<textarea class="pm-textarea" id="${h(t)}" ${s}>${h(e||"")}</textarea>`}function w(t,e,s,n=""){return`<div class="pm-settings-toggle-row">
    <div><strong>${h(e)}</strong>${n?`<span>${h(n)}</span>`:""}</div>
    <button class="pm-toggle ${s?"on":""}" id="${h(t)}" data-toggle-bool="${h(t)}" aria-label="${h(e)}" aria-pressed="${s?"true":"false"}"></button>
  </div>`}function x(t,e){return t.querySelector(`#${CSS.escape(e)}`)?.classList.contains("on")===!0}function c(t,e){return String(t.querySelector(`#${CSS.escape(e)}`)?.value||"").trim()}function le(t){return String(t||"").split(",").map(e=>e.trim()).filter(Boolean)}function X(t){return String(t||"").split(`
`).map(e=>e.trim()).filter(Boolean)}function u(t,e,s="muted"){let n=t.querySelector("#pm-settings-live-status");n&&(n.className=`pm-settings-status ${s}`,n.textContent=e||"")}function I(t){t.querySelectorAll("[data-toggle-bool]").forEach(e=>{e.addEventListener("click",()=>{let s=!e.classList.contains("on");e.classList.toggle("on",s),e.setAttribute("aria-pressed",s?"true":"false")})})}function Z(t){return{openai:"OpenAI API",openai_codex:"OpenAI OAuth",anthropic:"Anthropic",xai:"xAI / Grok",ollama:"Ollama",gemini:"Gemini",perplexity:"Perplexity",elevenlabs:"ElevenLabs"}[t]||t.replace(/_/g," ").replace(/\b\w/g,s=>s.toUpperCase())}function pe(t){let e=t?.providers&&typeof t.providers=="object"?t.providers:{},s=Object.keys(e);return s.includes("ollama")||s.push("ollama"),s.includes("openai")||s.push("openai"),s.includes("openai_codex")||s.push("openai_codex"),s.includes("anthropic")||s.push("anthropic"),s.includes("xai")||s.push("xai"),s}function me(t=""){return`<div class="pm-settings-section-grid">
    ${H.map(e=>`<button class="pm-settings-section ${e.id===t?"active":""}" data-settings-section="${e.id}">
      <span>${g[e.icon]||g.gear}</span>
      <strong>${h(e.title)}</strong>
      <em>${h(e.desc)}</em>
    </button>`).join("")}
  </div>`}function Le(t,{section:e="",navigate:s}={}){B();let n=ce.has(e)?e:"",o=n&&H.find(l=>l.id===n)?.title||"Settings",d=n?"back":"menu";t.innerHTML=`
    ${U({title:o,online:!0,leftIcon:d})}
    <main class="pm-body pm-settings-body">
      ${n?`<div class="pm-settings-topnav"><button class="pm-btn ghost" data-settings-home>${g.back} All settings</button></div>`:""}
      <div id="pm-settings-content">${n?`<div class="pm-card">${Q("Loading settings...")}</div>`:ue()}</div>
    </main>
  `,V(t,{onBack:()=>s?.("#mobile/settings"),onSettings:()=>s?.("#mobile/settings")}),t.querySelector("[data-settings-home]")?.addEventListener("click",()=>s?.("#mobile/settings")),t.querySelectorAll("[data-settings-section]").forEach(l=>{l.addEventListener("click",()=>s?.(`#mobile/settings/${l.getAttribute("data-settings-section")}`))}),n&&he(t,n,s).catch(l=>{let a=t.querySelector("#pm-settings-content");a&&(a.innerHTML=b("Error",Q(l.message||"Failed to load settings","error"),"gear"))})}function ue(){return`
    ${b("Mobile Settings",'<div class="pm-card-body">Configure the same Settings tabs from desktop, adapted for this paired phone. Shortcuts and Pairing stay desktop-only.</div>',"gear","pm-card-strong")}
    ${me("")}
  `}async function he(t,e,s){let n=t.querySelector("#pm-settings-content");if(n){if(e==="system")return ne(n,t);if(e==="models")return oe(n,t);if(e==="credentials")return D(n,t);if(e==="search")return be(n,t);if(e==="heartbeat")return fe(n,t);if(e==="security")return ke(n,t);if(e==="agents")return O(n,t);if(e==="channels")return $e(n,t);if(e==="integrations")return we(n,t)}}function ve(){let t=new Date;return t.setDate(t.getDate()-1),`${t.getFullYear()}-${String(t.getMonth()+1).padStart(2,"0")}-${String(t.getDate()).padStart(2,"0")}`}function ye(){return new Promise(t=>{let e=document.createElement("div");e.style.cssText="position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.38);display:flex;align-items:center;justify-content:center;padding:16px";let s=document.createElement("div");s.style.cssText="width:min(520px,100%);background:var(--pm-panel,var(--panel));border:1px solid var(--pm-line,var(--line));border-radius:16px;padding:20px;color:var(--pm-text,var(--text));box-shadow:0 12px 42px rgba(0,0,0,.22)",s.innerHTML=`
      <div style="font-size:16px;font-weight:800;margin-bottom:9px">When should auto-settle begin?</div>
      <div style="font-size:13px;line-height:1.55;color:var(--pm-muted,var(--muted));margin-bottom:16px">Include chats already older than the selected date, or start the inactivity clock from now for existing chats.</div>
      <div style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap">
        <button data-choice="cancel" class="pm-btn ghost" type="button">Cancel</button>
        <button data-choice="start_now" class="pm-btn" type="button">Start from now</button>
        <button data-choice="apply_existing" class="pm-btn primary" type="button">Apply to eligible chats</button>
      </div>`,e.appendChild(s),document.body.appendChild(e);let n=o=>{e.remove(),t(o)};s.querySelectorAll("[data-choice]").forEach(o=>o.addEventListener("click",()=>{let d=o.getAttribute("data-choice");n(d==="cancel"?null:d)})),e.addEventListener("click",o=>{o.target===e&&n(null)})})}async function ne(t,e){let s=await y("/api/settings/session"),n=s?.session?.autoSettle||{},o=n.mode==="custom"?"custom":String(Number(n.afterDays)||0),d=[{value:"0",label:"Never"},{value:"7",label:"7 days"},{value:"14",label:"14 days"},{value:"30",label:"30 days"},{value:"90",label:"90 days"},{value:"custom",label:"Custom"}];t.innerHTML=`
    ${b("Auto-settle untouched chats",`
      <div class="pm-card-body">Move untouched conversations to Settled Chats after the selected inactivity period. Nothing is deleted, summarized, marked read, or detached.</div>
      ${r("Inactivity period",f("pm-auto-settle-after",d,o))}
      <div id="pm-auto-settle-custom-wrap" style="display:${o==="custom"?"block":"none"}">
        ${r("Custom cutoff date",p("pm-auto-settle-custom-date",n.customDate||"",`type="date" max="${ve()}"`),"Choose a date before today.")}
      </div>
      <div class="pm-card-body">Protected chats\u2014pinned, active, task-owned, scheduled, supervised, project, approval-sensitive, and automated chats\u2014are always skipped.</div>
      <div id="pm-settings-live-status"></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="pm-btn" id="pm-preview-auto-settle" type="button">Preview eligible chats</button>
        <button class="pm-btn primary" id="pm-save-auto-settle" type="button">Save auto-settle</button>
      </div>
    `,"gear","pm-card-strong")}
    ${b("Last auto-settle check",`<div class="pm-card-body" id="pm-auto-settle-last-run">${h(s?.session?.autoSettleLastRun?`Completed ${new Date(Number(s.session.autoSettleLastRun.completedAt||0)).toLocaleString()} \xB7 ${Number(s.session.autoSettleLastRun.settled||0)} settled.`:"No automatic check has run yet.")}</div>`,"clock")}
  `;let l=e.querySelector("#pm-auto-settle-after"),a=e.querySelector("#pm-auto-settle-custom-wrap");l?.addEventListener("change",()=>{a&&(a.style.display=l.value==="custom"?"block":"none")}),e.querySelector("#pm-preview-auto-settle")?.addEventListener("click",async()=>{try{u(e,"Previewing protected-state checks...");let v=(await y("/api/settings/auto-settle/preview",{method:"POST",body:JSON.stringify({})}))?.summary||{};u(e,`${Number(v.wouldSettle||0)} eligible \xB7 ${Number(v.scanned||0)} scanned.`,"ok")}catch(i){u(e,i.message,"error")}}),e.querySelector("#pm-save-auto-settle")?.addEventListener("click",async()=>{let i=l?.value||"0",v={afterDays:i==="custom"?"custom":Number(i),activationMode:"start_now"};if(i==="custom"){if(v.customDate=c(e,"pm-auto-settle-custom-date"),!v.customDate){u(e,"Choose a custom cutoff date first.","error");return}let m=new Date(`${v.customDate}T00:00:00`);if(v.customDateOffsetMinutes=Number.isFinite(m.getTime())?m.getTimezoneOffset():new Date().getTimezoneOffset(),v.activationMode=await ye(),!v.activationMode)return}try{await y("/api/settings/session",{method:"POST",body:JSON.stringify({autoSettle:v})}),u(e,"Auto-settle settings saved.","ok"),await ne(t,e)}catch(m){u(e,m.message,"error")}})}async function oe(t,e){let[s,n,o]=await Promise.all([y("/api/settings/provider"),y("/api/settings/session").catch(()=>null),W().catch(()=>null),de()]),d=s?.llm||{},l=d.provider||"ollama",a=pe(d),i=d.providers?.[l]||{},v=n?.session||{};t.innerHTML=`
    ${b("Runtime",`<div class="pm-settings-kv">
      <span>Current model</span><strong>${h(o?.currentModel||i.model||"Unknown")}</strong>
      <span>Provider</span><strong>${h(Z(l))}</strong>
      <span>Status</span><strong>${o?.providerOnline?"Online":"Unknown"}</strong>
    </div>`,"brain")}
    ${b("Provider",`
      ${r("Active provider",f("pm-set-provider",a.map(m=>({value:m,label:Z(m)})),l))}
      <div id="pm-provider-fields">${ee(l,i)}</div>
      <div class="pm-row-buttons">
        <button class="pm-btn" id="pm-refresh-models">${g.refresh} Refresh Models</button>
        <button class="pm-btn" id="pm-test-model">${g.refresh} Test</button>
        <button class="pm-btn primary" id="pm-save-model">${g.check} Save</button>
      </div>
      <div id="pm-settings-live-status"></div>
    `,"gear","pm-card-strong")}
    ${G(v.contextProfile,v.contextBudget,"mobile-context")}
    ${b("Context Compaction",`
      <div class="pm-card-body">Prometheus uses the selected model's token window automatically. Context is compacted only when token pressure requires it; message count does not define model context.</div>
      ${w("pm-session-roll","Rolling compaction",v.rollingCompactionEnabled!==!1,"Automatically summarize older active context when token pressure requires it.")}
      ${w("pm-session-compact-auto","Use selected context window",v.compactionThreshold==="auto"||v.compactionThreshold==null,"Automatic sizing reserves output, reasoning and one estimation margin. Turn off to use a manual earlier threshold.")}
      ${r("Manual compaction threshold",p("pm-session-compact",typeof v.compactionThreshold=="number"?v.compactionThreshold:.7,'type="number" min="0.4" max="0.95" step="0.01"'))}
      ${r("Memory flush threshold",p("pm-session-memory",v.memoryFlushThreshold||.9,'type="number" min="0.5" max="0.98" step="0.01"'))}
      ${r("Rolling tool turns",p("pm-session-tool-turns",v.rollingCompactionToolTurns||4,'type="number" min="1" max="12"'))}
      <div class="pm-card-body">Summary length is adaptive. Compaction preserves requests, decisions, pending work and recovery references; there is no fixed 900-word cutoff.</div>
      ${r("Compaction model override",p("pm-session-model",v.rollingCompactionModel||"",'placeholder="Optional"'))}
      <button class="pm-btn primary" id="pm-save-session">${g.check} Save compaction</button>
    `,"clipboard")}
  `,I(e),e.querySelector("#pm-set-provider")?.addEventListener("change",()=>{let m=c(e,"pm-set-provider"),k=d.providers?.[m]||{},S=e.querySelector("#pm-provider-fields");S&&(S.innerHTML=ee(m,k)),I(e)}),e.querySelector("#pm-refresh-models")?.addEventListener("click",async()=>{u(e,"Loading models...");try{let m=q(e,d),k=m.provider,S=await y("/api/models/test",{method:"POST",body:JSON.stringify({llm:m})}),$=(S.models||[]).map(T=>typeof T=="string"?T:T.name||String(T)).filter(Boolean),E=e.querySelector(`#${CSS.escape(R(k))}`);if(E&&$.length&&E.tagName==="SELECT"){let T=E.value;E.innerHTML=A(k,$).map(j=>`<option value="${h(j.value)}">${h(j.label)}</option>`).join(""),T&&$.includes(T)&&(E.value=T)}u(e,$.length?`${$.length} model(s) found.`:S.error||"No models found.",$.length?"ok":"warn")}catch(m){u(e,m.message,"error")}}),e.querySelector("#pm-test-model")?.addEventListener("click",async()=>{u(e,"Testing provider...");try{let m=q(e,d),k=await y("/api/models/test",{method:"POST",body:JSON.stringify({llm:m})});u(e,k.success?`Connected. ${Array.isArray(k.models)?k.models.length:0} models returned.`:k.error||"Could not connect",k.success?"ok":"warn")}catch(m){u(e,m.message,"error")}}),e.querySelector("#pm-save-model")?.addEventListener("click",async()=>{u(e,"Saving model settings...");try{let m=q(e,d);await y("/api/settings/provider",{method:"POST",body:JSON.stringify({llm:m})}),u(e,"Model settings saved.","ok")}catch(m){u(e,m.message,"error")}}),z(e,v.contextProfile,m=>y("/api/settings/context-window",{method:"POST",body:JSON.stringify(m)}),()=>oe(t,e),"mobile-context"),e.querySelector("#pm-save-session")?.addEventListener("click",async()=>{try{await y("/api/settings/session",{method:"POST",body:JSON.stringify({rollingCompactionEnabled:x(e,"pm-session-roll"),compactionThreshold:x(e,"pm-session-compact-auto")?"auto":Number(c(e,"pm-session-compact")),compactionThresholdMode:x(e,"pm-session-compact-auto")?"auto":"manual",memoryFlushThreshold:Number(c(e,"pm-session-memory")),rollingCompactionToolTurns:Number(c(e,"pm-session-tool-turns")),rollingCompactionModel:c(e,"pm-session-model")})}),u(e,"Compaction settings saved.","ok")}catch(m){u(e,m.message,"error")}})}function q(t,e){let s=c(t,"pm-set-provider")||e.provider||"ollama",n={...e.providers||{}};n[s]={...n[s]||{}};let o=n[s],d=c(t,R(s));d&&(o.model=d);let l=c(t,ie(s));l?o.endpoint=l:delete o.endpoint;let a=c(t,re(s));a&&(o.api_key=a);let i=c(t,ae(s));if(i&&F(s,o.model,i)?o.reasoning_effort=i:delete o.reasoning_effort,s==="anthropic"){o.extended_thinking=x(t,"pm-anthropic-thinking");let m=Number(c(t,"pm-anthropic-budget"));m&&(o.thinking_budget=m)}let v=c(t,`pm-speed-${s}`);return L(s,o.model)?o.speed=v==="fast"?"fast":"standard":delete o.speed,delete o.fast_mode,{...e,provider:s,providers:n}}function R(t){return`pm-model-${t}`}function ie(t){return`pm-endpoint-${t}`}function re(t){return`pm-key-${t}`}function ae(t){return`pm-effort-${t}`}function ee(t,e={}){let s=R(t),n=ie(t),o=re(t),d=ae(t);if(t==="ollama")return`
      ${r("Endpoint",p(n,e.endpoint||"http://localhost:11434"))}
      ${r("Active Model",p(s,e.model||"",'placeholder="qwen3:4b"'))}
    `;if(t==="llama_cpp")return`${r("Endpoint",p(n,e.endpoint||"http://localhost:8080"))}${r("Model name",p(s,e.model||"",'placeholder="qwen2.5-7b"'))}`;if(t==="lm_studio")return`${r("Endpoint",p(n,e.endpoint||"http://localhost:1234"))}${r("Model name",p(s,e.model||"",'placeholder="qwen2.5-7b-instruct"'))}`;if(t==="openai"){let l=C(t,e.model||"gpt-5.5").map(a=>({value:a,label:a||"provider default"}));return`
      ${r("API Key",p(o,e.api_key||"",'type="password" placeholder="sk-..."'))}
      ${r("Model",f(s,A(t,P(t,e.model||"gpt-5.5")),e.model||"gpt-5.5"))}
      ${l.length>1?r("Reasoning Effort",f(d,l,e.reasoning_effort||"")):""}
      ${L(t,e.model||"gpt-5.5")?r("Speed",f(`pm-speed-${t}`,[{value:"standard",label:"Standard"},{value:"fast",label:"Fast"}],e.speed||(e.fast_mode===!0?"fast":"standard"))):""}
    `}if(t==="openai_codex"){let l=C(t,e.model||"gpt-5.5").map(a=>({value:a,label:a||"provider default"}));return`
      ${r("Model",f(s,A(t,P(t,e.model||"gpt-5.5")),e.model||"gpt-5.5"))}
      ${r("Reasoning Effort",f(d,l,e.reasoning_effort||""))}
      ${L(t,e.model||"gpt-5.5")?r("Speed",f(`pm-speed-${t}`,[{value:"standard",label:"Standard"},{value:"fast",label:"Fast"}],e.speed||(e.fast_mode===!0?"fast":"standard"))):""}
      <div class="pm-settings-callout">Connect or disconnect the ChatGPT account from Credentials/Auth controls on desktop if OAuth needs renewal.</div>
    `}if(t==="anthropic"){let l=J(t,e.model||"claude-sonnet-5"),a=C(t,e.model||"claude-sonnet-5").map(i=>({value:i,label:i||"provider default"}));return`
      ${r("Model",f(s,A(t,P(t,e.model||"claude-sonnet-5")),e.model||"claude-sonnet-5"))}
      ${a.length>1?r("Thinking Effort",f(d,a,e.reasoning_effort||"")):""}
      ${w("pm-anthropic-thinking","Extended thinking",e.extended_thinking===!0)}
      ${L(t,e.model||"claude-sonnet-5")?r("Speed",f(`pm-speed-${t}`,[{value:"standard",label:"Standard"},{value:"fast",label:"Fast"}],e.speed||(e.fast_mode===!0?"fast":"standard"))):""}
      ${l.thinkingMode==="manual"?r("Thinking Budget",f("pm-anthropic-budget",["2048","5000","10000","16000","24000","32000"],String(e.thinking_budget||"10000"))):""}
    `}if(t==="perplexity")return`${r("API Key",p(o,e.api_key||"",'type="password" placeholder="pplx-..."'))}${r("Model",f(s,A(t,P(t,e.model||"sonar-pro")),e.model||"sonar-pro"))}${r("Reasoning Effort",f(d,["","low","medium","high"].map(l=>({value:l,label:l||"provider default"})),e.reasoning_effort||""))}`;if(t==="xai"){let a=(/^grok-4\.20-multi-agent(?:-|$)/i.test(String(e.model||"").trim())?["","low","medium","high","xhigh"]:["","low","medium","high"]).map(i=>({value:i,label:i==="xhigh"?"extra high":i||"provider default"}));return`${r("API Key",p(o,e.api_key||"",'type="password" placeholder="xai-..."'))}${r("Model",f(s,A(t,P(t,e.model||"grok-4.3")),e.model||"grok-4.3"))}${r("Reasoning Effort",f(d,a,e.reasoning_effort||""))}${r("Endpoint",p(n,e.endpoint||"",'placeholder="https://api.x.ai/v1"'))}`}return t==="gemini"?`${r("API Key",p(o,e.api_key||"",'type="password" placeholder="AIza..."'))}${r("Model",f(s,A(t,P(t,e.model||"gemini-2.5-pro")),e.model||"gemini-2.5-pro"))}`:`${r("Model",p(s,e.model||"",'placeholder="Provider model"'))}${r("Endpoint",p(n,e.endpoint||"",'placeholder="Optional endpoint"'))}`}async function D(t,e){let[s,n,o]=await Promise.all([y("/api/settings/search").catch(()=>({})),y("/api/credentials/status").catch(()=>({keys:[]})),y("/api/credentials/audit").catch(()=>({lines:[]}))]);t.innerHTML=`
    ${b("Search Provider Keys",`
      <div class="pm-card-body" style="margin-bottom:10px;">Stored encrypted in the vault. Masked values keep the existing key.</div>
      ${r("TinyFish API Key",p("pm-cred-tinyfish",s.tinyfish_api_key||"",'type="password" placeholder="tf-..." autocomplete="new-password"'))}
      ${r("Tavily API Key",p("pm-cred-tavily",s.tavily_api_key||"",'type="password" placeholder="tvly-..." autocomplete="new-password"'))}
      ${r("Google API Key",p("pm-cred-google",s.google_api_key||"",'type="password" placeholder="AIza..." autocomplete="new-password"'))}
      ${r("Google CSE ID",p("pm-cred-google-cx",s.google_cx||"",'placeholder="Custom search engine ID"'),"Stored for persistence; leave as-is to keep current value.")}
      ${r("Brave API Key",p("pm-cred-brave",s.brave_api_key||"",'type="password" placeholder="BSA..." autocomplete="new-password"'))}
      <button class="pm-btn primary" id="pm-save-creds">${g.check} Save credentials</button>
      <div id="pm-settings-live-status"></div>
    `,"gear","pm-card-strong")}
    ${b("Vault Status",`<div class="pm-settings-list">
      ${(n.keys||[]).map(d=>`<div class="pm-settings-row"><span><strong>${h(ge(d))}</strong><em>${h(d)}</em></span><span class="pm-pill active">stored</span></div>`).join("")||'<div class="pm-card-body">No credentials stored yet.</div>'}
    </div>`,"check")}
    ${b("How Credentials Work",'<div class="pm-card-body">When saved, keys are encrypted with AES-256-GCM and referenced from config as vault entries. If a field shows bullets, a key is already stored.</div>',"clipboard")}
    ${b("Recent Vault Access",`<div class="pm-settings-log">${(o.lines||[]).slice(-18).reverse().map(d=>`<div>${h(d)}</div>`).join("")||"<div>No audit entries yet.</div>"}</div>
      <button class="pm-btn" id="pm-refresh-creds">${g.refresh} Refresh</button>`,"clipboard")}
  `,e.querySelector("#pm-refresh-creds")?.addEventListener("click",()=>D(t,e)),e.querySelector("#pm-save-creds")?.addEventListener("click",async()=>{try{await y("/api/settings/search",{method:"POST",body:JSON.stringify({preferred_provider:s.preferred_provider||"tavily",search_rigor:s.search_rigor||"verified",tinyfish_api_key:c(e,"pm-cred-tinyfish"),tavily_api_key:c(e,"pm-cred-tavily"),google_api_key:c(e,"pm-cred-google"),google_cx:c(e,"pm-cred-google-cx"),brave_api_key:c(e,"pm-cred-brave")})}),u(e,"Credentials saved.","ok"),await D(t,e)}catch(d){u(e,d.message,"error")}})}function ge(t){return{"search.tavily_api_key":"Tavily API Key","search.tinyfish_api_key":"TinyFish API Key","search.google_api_key":"Google API Key","search.google_cx":"Google CSE ID","search.brave_api_key":"Brave API Key","llm.openai.api_key":"OpenAI API Key","hooks.token":"Webhook Token","channels.telegram.botToken":"Telegram Token","channels.discord.botToken":"Discord Token"}[t]||t}async function be(t,e){let s=await y("/api/settings/search");t.innerHTML=`
    ${b("Web Search",`
      ${r("Preferred provider",f("pm-search-provider",["tavily","tinyfish","google","brave","none"],s.preferred_provider||"tavily"))}
      <div class="pm-settings-callout">API keys are managed in the Credentials tab and stored encrypted.</div>
      <button class="pm-btn primary" id="pm-save-search">${g.check} Save search provider</button>
      <div id="pm-settings-live-status"></div>
    `,"target","pm-card-strong")}
  `,e.querySelector("#pm-save-search")?.addEventListener("click",async()=>{try{await y("/api/settings/search",{method:"POST",body:JSON.stringify({preferred_provider:c(e,"pm-search-provider"),search_rigor:s.search_rigor||"verified",tavily_api_key:s.tavily_api_key||"",tinyfish_api_key:s.tinyfish_api_key||"",google_api_key:s.google_api_key||"",google_cx:s.google_cx||"",brave_api_key:s.brave_api_key||""})}),u(e,"Search settings saved.","ok")}catch(n){u(e,n.message,"error")}})}async function fe(t,e){let n=(await y("/api/settings/heartbeat")).heartbeat||{};t.innerHTML=b("Heartbeat",`
    ${w("pm-hb-enabled","Enabled",n.enabled!==!1,"Allow Prometheus to wake itself for background work.")}
    ${r("Interval minutes",p("pm-hb-interval",n.interval_minutes||30,'type="number" min="1" max="1440"'))}
    ${r("Model override",p("pm-hb-model",n.model||"",'placeholder="Optional"'))}
    ${w("pm-hb-review","Review teams after run",n.review_teams_after_run===!0)}
    ${r("Instructions",M("pm-hb-instructions",n.instructions||"",'rows="10"'))}
    <button class="pm-btn primary" id="pm-save-heartbeat">${g.check} Save heartbeat</button>
    <div id="pm-settings-live-status"></div>
  `,"clock","pm-card-strong"),I(e),e.querySelector("#pm-save-heartbeat")?.addEventListener("click",async()=>{try{await y("/api/settings/heartbeat",{method:"POST",body:JSON.stringify({enabled:x(e,"pm-hb-enabled"),interval_minutes:Number(c(e,"pm-hb-interval")),model:c(e,"pm-hb-model"),review_teams_after_run:x(e,"pm-hb-review"),instructions:e.querySelector("#pm-hb-instructions")?.value||""})}),u(e,"Heartbeat settings saved.","ok")}catch(o){u(e,o.message,"error")}})}async function ke(t,e){let s=await y("/api/settings/paths").catch(()=>({}));t.innerHTML=`
    ${b("File Access",`
      ${r("Workspace Path",p("pm-sec-workspace",s.workspace_path||"",'placeholder="%APPDATA%\\\\Prometheus\\\\workspace"'))}
      ${r("Allowed Paths (one per line)",M("pm-sec-allowed",(s.allowed_paths||[]).join(`
`),'rows="6"'))}
      ${r("Blocked Paths (one per line)",M("pm-sec-blocked",(s.blocked_paths||[]).join(`
`),'rows="5"'))}
      <button class="pm-btn primary" id="pm-save-security">${g.check} Save file access</button>
      <div id="pm-settings-live-status"></div>
    `,"check","pm-card-strong")}
  `,e.querySelector("#pm-save-security")?.addEventListener("click",async()=>{try{await y("/api/settings/paths",{method:"POST",body:JSON.stringify({workspace_path:c(e,"pm-sec-workspace"),allowed_paths:X(e.querySelector("#pm-sec-allowed")?.value||""),blocked_paths:X(e.querySelector("#pm-sec-blocked")?.value||"")})}),u(e,"File access settings saved.","ok")}catch(n){u(e,n.message,"error")}})}async function O(t,e){let[s,n]=await Promise.all([y("/api/agents").catch(()=>({agents:[]})),y("/api/settings/agent-model-defaults").catch(()=>({defaults:{}}))]),o=s.agents||s.items||[],d=n.defaults||{},l=["main_chat","proposal_executor_high_risk","proposal_executor_low_risk","coordinator","manager","subagent_planner","subagent_orchestrator","subagent_researcher","subagent_analyst","subagent_builder","subagent_operator"],a=o.find(i=>String(i.id)===String(e._pmSelectedAgentId))||o.find(i=>i.id==="main")||o[0]||{};t.innerHTML=`
    ${b("Model Defaults",`
      ${l.map(i=>r(i.replace(/_/g," "),p(`pm-agent-def-${i}`,d[i]||"",'placeholder="Provider/model"'))).join("")}
      <button class="pm-btn primary" id="pm-save-agent-defaults">${g.check} Save defaults</button>
      <div id="pm-settings-live-status"></div>
    `,"brain","pm-card-strong")}
    ${b("Configured Agents",`<div class="pm-settings-list">${o.map(i=>`<button class="pm-settings-row pm-settings-row-button ${String(i.id)===String(a.id)?"active":""}" data-agent-id="${h(i.id)}">
      <span><strong>${h(i.name||i.id)}</strong><em>${h(i.description||i.model||i.status||"")}</em></span>
      <span class="pm-pill ${i.enabled===!1?"gray":"active"}">${i.enabled===!1?"off":"on"}</span>
    </button>`).join("")||'<div class="pm-card-body">No agents found.</div>'}</div>
      <button class="pm-btn" id="pm-new-agent" style="margin-top:10px;">${g.plus} New Agent</button>`,"robot")}
    ${te(a)}
  `,e.querySelectorAll("[data-agent-id]").forEach(i=>i.addEventListener("click",async()=>{e._pmSelectedAgentId=i.getAttribute("data-agent-id"),await O(t,e)})),e.querySelector("#pm-new-agent")?.addEventListener("click",()=>{e._pmSelectedAgentId="";let i=e.querySelector("#pm-agent-editor");i&&(i.innerHTML=te({id:"",name:"",description:"",workspace:"",maxSteps:8,default:!1},!0)),se(e,t)}),se(e,t,a),e.querySelector("#pm-save-agent-defaults")?.addEventListener("click",async()=>{try{let i={};l.forEach(v=>{i[v]=c(e,`pm-agent-def-${v}`)}),await y("/api/settings/agent-model-defaults",{method:"POST",body:JSON.stringify(i)}),u(e,"Agent defaults saved.","ok")}catch(i){u(e,i.message,"error")}})}function te(t={},e=!1){return`<div id="pm-agent-editor">${b("Agent Details",`
    ${r("ID",p("pm-agent-id",t.id||"",`${e?"":"readonly"} placeholder="researcher"`))}
    ${r("Name",p("pm-agent-name",t.name||"",'placeholder="Scout"'))}
    ${r("Description",M("pm-agent-description",t.description||"",'rows="3"'))}
    ${r("Workspace",p("pm-agent-workspace",t.workspace||"",'placeholder="%APPDATA%\\\\Prometheus\\\\workspace\\\\agents\\\\researcher"'))}
    ${r("Model",p("pm-agent-model",t.model||"",'placeholder="provider/model or blank for default"'))}
    ${r("Max Steps",p("pm-agent-max-steps",t.maxSteps||t.max_steps||8,'type="number" min="1" step="1"'))}
    ${w("pm-agent-default","Default agent",t.default===!0)}
    <div class="pm-row-buttons">
      <button class="pm-btn primary" id="pm-save-agent">${g.check} Save Agent</button>
      ${t.id&&t.id!=="main"?`<button class="pm-btn ghost" id="pm-delete-agent">${g.trash} Delete</button>`:""}
    </div>
  `,"robot","pm-card-strong")}
  ${t.id&&t.id!=="main"?b("Manual Spawn + Run History",`
    ${r("Task",M("pm-agent-task","",'rows="3" placeholder="Run a one-off task for this agent..."'))}
    <div class="pm-row-buttons">
      <button class="pm-btn primary" id="pm-run-agent">${g.play} Run Once</button>
      <button class="pm-btn" id="pm-agent-history">${g.refresh} Refresh History</button>
    </div>
    <div id="pm-agent-run-output" class="pm-settings-log" style="margin-top:10px;"></div>
  `,"play"):""}</div>`}function se(t,e){I(t),t.querySelector("#pm-save-agent")?.addEventListener("click",async()=>{let s=c(t,"pm-agent-id");if(!s)return u(t,"Agent ID is required.","error");let n={id:s,name:c(t,"pm-agent-name"),description:t.querySelector("#pm-agent-description")?.value||"",workspace:c(t,"pm-agent-workspace"),model:c(t,"pm-agent-model"),maxSteps:Number(c(t,"pm-agent-max-steps"))||8,default:x(t,"pm-agent-default")};try{let o=!!t._pmSelectedAgentId;await y(o?`/api/agents/${encodeURIComponent(s)}`:"/api/agents",{method:o?"PUT":"POST",body:JSON.stringify({agent:n})}),t._pmSelectedAgentId=s,u(t,"Agent saved.","ok"),await O(e,t)}catch(o){u(t,o.message,"error")}}),t.querySelector("#pm-delete-agent")?.addEventListener("click",async()=>{let s=c(t,"pm-agent-id");if(!(!s||!window.confirm(`Delete agent "${s}"?`)))try{await y(`/api/agents/${encodeURIComponent(s)}`,{method:"DELETE"}),t._pmSelectedAgentId="",await O(e,t)}catch(n){u(t,n.message,"error")}}),t.querySelector("#pm-run-agent")?.addEventListener("click",async()=>{let s=c(t,"pm-agent-id"),n=String(t.querySelector("#pm-agent-task")?.value||"").trim(),o=t.querySelector("#pm-agent-run-output");if(!n)return u(t,"Provide a task first.","error");o&&(o.innerHTML="<div>Running...</div>");try{let d=await y(`/api/agents/${encodeURIComponent(s)}/spawn`,{method:"POST",body:JSON.stringify({task:n})});o&&(o.innerHTML=`<div>${h(JSON.stringify(d.result||d,null,2)).replace(/\n/g,"<br>")}</div>`)}catch(d){o&&(o.innerHTML=`<div>${h(d.message)}</div>`)}}),t.querySelector("#pm-agent-history")?.addEventListener("click",async()=>{let s=c(t,"pm-agent-id"),n=t.querySelector("#pm-agent-run-output");try{let o=await y(`/api/agents/history?agentId=${encodeURIComponent(s)}&limit=12`);n&&(n.innerHTML=(o.history||[]).map(d=>`<div><strong>${h(d.success?"success":"failed")}</strong> ${h(d.trigger||"manual")}<br><em>${h(d.resultPreview||d.error||"")}</em></div>`).join("")||"<div>No runs yet.</div>")}catch(o){n&&(n.innerHTML=`<div>${h(o.message)}</div>`)}})}async function $e(t,e){let s=await y("/api/channels/status"),n=s.telegram||{},o=s.discord||{},d=s.whatsapp||{};t.innerHTML=`
    ${b("Channel Connection",`
      ${r("Channel",f("pm-channel-select",[{value:"telegram",label:"Telegram"},{value:"discord",label:"Discord"},{value:"whatsapp",label:"WhatsApp"}],"telegram"))}
      <div id="pm-channel-status-card"></div>
      <div id="pm-channel-form"></div>
      <div class="pm-row-buttons">
        <button class="pm-btn" id="pm-channel-test">${g.refresh} Test</button>
        <button class="pm-btn primary" id="pm-channel-save">${g.check} Save</button>
        <button class="pm-btn" id="pm-channel-send">${g.send} Send Test</button>
      </div>
      <div id="pm-settings-live-status"></div>
    `,"send","pm-card-strong")}
    ${b("Instructions",'<div id="pm-channel-guide" class="pm-card-body"></div>',"clipboard")}
  `;let l=()=>Se(e,{telegram:n,discord:o,whatsapp:d});e.querySelector("#pm-channel-select")?.addEventListener("change",l),l(),e.querySelector("#pm-channel-save")?.addEventListener("click",async()=>{let a=c(e,"pm-channel-select")||"telegram";try{await y("/api/channels/config",{method:"POST",body:JSON.stringify({channels:{[a]:N(e,a)}})}),u(e,`${a} settings saved.`,"ok")}catch(i){u(e,i.message,"error")}}),e.querySelector("#pm-channel-test")?.addEventListener("click",async()=>{let a=c(e,"pm-channel-select")||"telegram";try{let i=await y(`/api/channels/test/${a}`,{method:"POST",body:JSON.stringify(N(e,a))});u(e,i.success?`${a} connection test passed.`:i.error||`${a} test failed.`,i.success?"ok":"error")}catch(i){u(e,i.message,"error")}}),e.querySelector("#pm-channel-send")?.addEventListener("click",async()=>{let a=c(e,"pm-channel-select")||"telegram";try{let i=await y(`/api/channels/send-test/${a}`,{method:"POST",body:JSON.stringify(N(e,a))});u(e,i.success?`Test message sent via ${a}.`:i.error||"Send test failed.",i.success?"ok":"error")}catch(i){u(e,i.message,"error")}})}function Se(t,e){let s=c(t,"pm-channel-select")||"telegram",n=e[s]||{},o=t.querySelector("#pm-channel-status-card"),d=t.querySelector("#pm-channel-form"),l=t.querySelector("#pm-channel-guide");o&&(o.innerHTML=`<div class="pm-settings-channel">
    <div><strong>${h(s[0].toUpperCase()+s.slice(1))}</strong><span>${n.enabled?"Enabled":"Disabled"}${n.connected?" \xB7 connected":""}</span></div>
    <span class="pm-pill ${n.enabled?"active":"gray"}">${n.enabled?"on":"off"}</span>
  </div>`),s==="telegram"&&d?(d.innerHTML=`
      ${r("Bot Token",p("pm-ch-token","",`type="password" placeholder="${n.hasToken?"\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022 (saved)":"123456:ABC-DEF1234..."}"`))}
      ${r("Your Telegram User ID(s)",p("pm-ch-userids",(n.allowedUserIds||[]).join(", "),'placeholder="123456789, 987654321"'))}
      ${w("pm-ch-enabled","Enable Telegram channel",n.enabled===!0)}
    `,l&&(l.innerHTML="Create a bot with BotFather, paste the token, add allowed user IDs, then Test, Save, and Send Test.")):s==="discord"&&d?(d.innerHTML=`
      ${r("Bot Token",p("pm-ch-token","",`type="password" placeholder="${n.hasToken?"\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022 (saved)":"Discord bot token"}"`))}
      ${r("Application ID (optional)",p("pm-ch-appid",n.applicationId||""))}
      ${r("Guild ID (optional)",p("pm-ch-guildid",n.guildId||""))}
      ${r("Channel ID (for send-test)",p("pm-ch-channelid",n.channelId||""))}
      ${r("Webhook URL (optional)",p("pm-ch-webhook","",`type="password" placeholder="${n.hasWebhook?"\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022 (saved)":"https://discord.com/api/webhooks/..."}"`))}
      ${w("pm-ch-enabled","Enable Discord channel",n.enabled===!0)}
    `,l&&(l.innerHTML="Create an app and bot in Discord Developer Portal, invite it to your server, then Test, Save, and Send Test.")):d&&(d.innerHTML=`
      ${r("Access Token",p("pm-ch-token","",`type="password" placeholder="${n.hasAccessToken?"\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022 (saved)":"Meta access token"}"`))}
      ${r("Phone Number ID",p("pm-ch-phoneid",n.phoneNumberId||""))}
      ${r("Business Account ID (optional)",p("pm-ch-baid",n.businessAccountId||""))}
      ${r("Webhook Verify Token (optional)",p("pm-ch-verify","",`type="password" placeholder="${n.verifyTokenSet?"\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022 (saved)":"Verify token"}"`))}
      ${r("Webhook Secret (optional)",p("pm-ch-secret","",`type="password" placeholder="${n.webhookSecretSet?"\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022 (saved)":"Webhook secret"}"`))}
      ${r("Test Recipient (E.164)",p("pm-ch-recipient",n.testRecipient||"",'placeholder="15551234567"'))}
      ${w("pm-ch-enabled","Enable WhatsApp channel",n.enabled===!0)}
    `,l&&(l.innerHTML="Copy WhatsApp Cloud API credentials from Meta Developer dashboard, configure optional webhook fields, then Test, Save, and Send Test.")),I(t)}function N(t,e){let s=x(t,"pm-ch-enabled");return e==="telegram"?{enabled:s,botToken:c(t,"pm-ch-token"),allowedUserIds:le(c(t,"pm-ch-userids"))}:e==="discord"?{enabled:s,botToken:c(t,"pm-ch-token"),applicationId:c(t,"pm-ch-appid"),guildId:c(t,"pm-ch-guildid"),channelId:c(t,"pm-ch-channelid"),webhookUrl:c(t,"pm-ch-webhook")}:{enabled:s,accessToken:c(t,"pm-ch-token"),phoneNumberId:c(t,"pm-ch-phoneid"),businessAccountId:c(t,"pm-ch-baid"),verifyToken:c(t,"pm-ch-verify"),webhookSecret:c(t,"pm-ch-secret"),testRecipient:c(t,"pm-ch-recipient")}}async function we(t,e){let[s,n,o]=await Promise.all([y("/api/settings/hooks").catch(()=>null),y("/api/mcp/servers").catch(()=>({servers:[]})),y("/api/extensions/catalog").catch(()=>({items:[],extensions:[]}))]),d=n.servers||[],l=o.items||o.extensions||o.catalog||[];t.innerHTML=`
    ${b("Webhooks",`
      ${w("pm-hooks-enabled","Enabled",s?.hooks?.enabled||s?.enabled||!1)}
      ${r("Secret Token",p("pm-hooks-token",s?.hooks?.token||s?.token||"",'type="password" placeholder="Paste or generate a secret token"'))}
      ${r("Path",p("pm-hooks-path",s?.hooks?.path||s?.path||"/hooks/prometheus"))}
      <div class="pm-row-buttons">
        <button class="pm-btn" id="pm-generate-hooks">${g.refresh} Generate</button>
        <button class="pm-btn" id="pm-test-hooks">${g.refresh} Test</button>
        <button class="pm-btn primary" id="pm-save-hooks">${g.check} Save</button>
      </div>
      <div id="pm-settings-live-status"></div>
    `,"paperclip","pm-card-strong")}
    ${b("MCP Servers",`<div class="pm-settings-list">${d.map(a=>`<div class="pm-settings-row">
      <span><strong>${h(a.name||a.id)}</strong><em>${h(a.status||"disconnected")} \xB7 ${h(String(a.toolCount||0))} tools</em></span>
    </div>`).join("")||'<div class="pm-card-body">No MCP servers configured.</div>'}</div>`,"monitor")}
    ${b("Extensions",`<div class="pm-settings-chip-row">${l.slice(0,20).map(a=>`<span class="pm-pill gray">${h(a.name||a.id||a.title||"Extension")}</span>`).join("")||'<span class="pm-card-body">No extensions found.</span>'}</div>`,"spark")}
  `,I(e),e.querySelector("#pm-generate-hooks")?.addEventListener("click",()=>{let a=new Uint8Array(24);crypto.getRandomValues(a);let i=Array.from(a).map(m=>m.toString(16).padStart(2,"0")).join(""),v=e.querySelector("#pm-hooks-token");v&&(v.value=i,v.type="text")}),e.querySelector("#pm-save-hooks")?.addEventListener("click",async()=>{try{await y("/api/settings/hooks",{method:"POST",body:JSON.stringify({enabled:x(e,"pm-hooks-enabled"),token:c(e,"pm-hooks-token"),path:c(e,"pm-hooks-path")})}),u(e,"Webhook settings saved. Restart gateway to apply endpoint changes.","ok")}catch(a){u(e,a.message,"error")}}),e.querySelector("#pm-test-hooks")?.addEventListener("click",async()=>{try{let a=await y("/api/settings/hooks/test",{method:"POST",body:"{}"});u(e,a.success?"Webhook test sent.":a.error||"Webhook test failed.",a.success?"ok":"error")}catch(a){u(e,a.message,"error")}})}export{Le as renderMobileSettingsPage};
