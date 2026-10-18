import{H as g,I as h,O as U,P as V}from"./chunk-RV4P4Q6H.js";import{e as K}from"./chunk-Q3X4BHCF.js";import{a as B}from"./chunk-DMDHDKAQ.js";import"./chunk-QOVQ3TSE.js";import{h as v,mb as W}from"./chunk-LWMMI44A.js";import"./chunk-YMT6MSCC.js";import{a as G,b as z,c as Y}from"./chunk-C2LHQX4Q.js";import"./chunk-U5MPZLTV.js";import{c as J,d as C,g as F,h as L}from"./chunk-I7ZJTRGE.js";import"./chunk-JF4LWGNM.js";import"./chunk-EPSJJCWL.js";var Q={openai:["gpt-6.1-sol","gpt-6-astra","gpt-6-sol","gpt-6-luna","gpt-5.6-sol","gpt-5.6-terra","gpt-5.6-luna","gpt-5.5","gpt-5.4-pro","gpt-5.4","gpt-5.4-mini","gpt-5.4-nano","gpt-5-pro","gpt-5","gpt-5-mini","gpt-5-nano","gpt-5-chat-latest","gpt-4.1","gpt-4.1-mini","gpt-4o","gpt-4o-mini","o4-mini","o3","o1"],openai_codex:["gpt-6.1-sol","gpt-6-astra","gpt-6-sol","gpt-6-luna","gpt-5.6-sol","gpt-5.6-terra","gpt-5.6-luna","gpt-5.5","gpt-5.4-codex","gpt-5.4-codex-mini","gpt-5.4","gpt-5.4-mini","gpt-5.3-codex","gpt-5.3-codex-spark","gpt-5.3","gpt-5.2-codex","gpt-5.2","gpt-5.1-codex-max","gpt-5.1-codex-mini","gpt-5.1-codex","gpt-5.1"],anthropic:["claude-fable-5-1","claude-fable-5","claude-opus-5-5","claude-opus-5","claude-opus-4-8","claude-opus-4-7","claude-opus-4-6","claude-sonnet-5-5","claude-sonnet-5","claude-sonnet-4-6","claude-sonnet-4-5-20250514","claude-haiku-5-5","claude-haiku-4-5-20251001"],perplexity:["sonar-pro","sonar","sonar-reasoning-pro","sonar-reasoning","sonar-deep-research"],gemini:["gemini-2.5-pro","gemini-2.5-flash","gemini-2.5-flash-lite","gemini-2.0-flash","gemini-1.5-pro","gemini-1.5-flash"],xai:["grok-4.7","grok-4.6","grok-4.5","grok-composer-2.5-fast","grok-4.3","grok-4.3-latest","grok-latest","grok-4.20-0309-reasoning","grok-4.20-0309-non-reasoning","grok-4.20-multi-agent-0309","grok-4.20-multi-agent","grok-build-0.1"]},_=null;async function ce(t=!1){if(_&&!t)return _;try{let e=await v("/api/extensions/catalog?kind=provider");_=Array.isArray(e?.items)?e.items:[]}catch{_=_||[]}return _}function P(t,e=""){let n=String(t||"").trim(),s=(_||[]).find(i=>i&&i.id===n)||null,o=[];(i=>{if(Array.isArray(i))for(let y of i){let p=String(y&&y.name||y||"").trim();p&&!o.includes(p)&&o.push(p)}})(s&&s.runtime&&s.runtime.options&&s.runtime.options.staticModels);let l=Array.isArray(Q[n])?Q[n]:[];l.forEach((i,y)=>{let p=String(i||"").trim();if(!p||o.includes(p))return;let k=-1;for(let $=y-1;$>=0&&k<0;$--)k=o.indexOf(String(l[$]||"").trim());if(k>=0){o.splice(k+1,0,p);return}let S=-1;for(let $=y+1;$<l.length&&S<0;$++)S=o.indexOf(String(l[$]||"").trim());S>=0?o.splice(S,0,p):o.push(p)});let a=String(e||"").trim();return a&&!o.includes(a)&&o.unshift(a),o}var H=[{id:"system",title:"System",icon:"gear",desc:"Theme-independent runtime and automatic chat settling."},{id:"heartbeat",title:"Heartbeat",icon:"clock",desc:"Background heartbeat cadence and instructions."},{id:"search",title:"Search",icon:"target",desc:"Preferred web search provider."},{id:"credentials",title:"Credentials",icon:"gear",desc:"Search keys, vault status, and audit log."},{id:"security",title:"Security",icon:"check",desc:"Workspace and file access allow/block lists."},{id:"models",title:"Models",icon:"brain",desc:"LLM providers, defaults, brain, and compaction."},{id:"voice",title:"Voice",icon:"mic",desc:"Voice providers, defaults, and listening mode."},{id:"agents",title:"Agents",icon:"robot",desc:"Agent list and model defaults."},{id:"channels",title:"Channels",icon:"send",desc:"Telegram, Discord, and WhatsApp connections."},{id:"integrations",title:"Integrations",icon:"paperclip",desc:"Webhooks and MCP servers."}],le=new Set(H.map(t=>t.id));function X(t,e="muted"){return`<div class="pm-settings-status ${e}">${h(t||"")}</div>`}function b(t,e,n="gear",s=""){return`<article class="pm-card pm-settings-card ${s}">
    <div class="pm-card-head">${g[n]||""} ${h(t)}</div>
    ${e}
  </article>`}function r(t,e,n=""){return`<label class="pm-settings-field"><span>${h(t)}</span>${e}${n?`<em>${h(n)}</em>`:""}</label>`}function f(t,e,n){return`<select class="pm-input pm-select" id="${h(t)}">${e.map(s=>{let o=typeof s=="string"?s:s.value,d=typeof s=="string"?s:s.label;return`<option value="${h(o)}" ${String(o)===String(n)?"selected":""}>${h(d)}</option>`}).join("")}</select>`}function A(t,e){return(e||[]).map(n=>({value:n,label:B(n,t)}))}function m(t,e="",n=""){return`<input class="pm-input" id="${h(t)}" value="${h(e||"")}" ${n} />`}function M(t,e="",n=""){return`<textarea class="pm-textarea" id="${h(t)}" ${n}>${h(e||"")}</textarea>`}function w(t,e,n,s=""){return`<div class="pm-settings-toggle-row">
    <div><strong>${h(e)}</strong>${s?`<span>${h(s)}</span>`:""}</div>
    <button class="pm-toggle ${n?"on":""}" id="${h(t)}" data-toggle-bool="${h(t)}" aria-label="${h(e)}" aria-pressed="${n?"true":"false"}"></button>
  </div>`}function x(t,e){return t.querySelector(`#${CSS.escape(e)}`)?.classList.contains("on")===!0}function c(t,e){return String(t.querySelector(`#${CSS.escape(e)}`)?.value||"").trim()}function me(t){return String(t||"").split(",").map(e=>e.trim()).filter(Boolean)}function Z(t){return String(t||"").split(`
`).map(e=>e.trim()).filter(Boolean)}function u(t,e,n="muted"){let s=t.querySelector("#pm-settings-live-status");s&&(s.className=`pm-settings-status ${n}`,s.textContent=e||"")}function E(t){t.querySelectorAll("[data-toggle-bool]").forEach(e=>{e.addEventListener("click",()=>{let n=!e.classList.contains("on");e.classList.toggle("on",n),e.setAttribute("aria-pressed",n?"true":"false")})})}function ee(t){return{openai:"OpenAI API",openai_codex:"OpenAI OAuth",anthropic:"Anthropic",xai:"xAI / Grok",ollama:"Ollama",gemini:"Gemini",perplexity:"Perplexity",elevenlabs:"ElevenLabs"}[t]||t.replace(/_/g," ").replace(/\b\w/g,n=>n.toUpperCase())}function pe(t){let e=t?.providers&&typeof t.providers=="object"?t.providers:{},n=Object.keys(e);return n.includes("ollama")||n.push("ollama"),n.includes("openai")||n.push("openai"),n.includes("openai_codex")||n.push("openai_codex"),n.includes("anthropic")||n.push("anthropic"),n.includes("xai")||n.push("xai"),n}function ue(t=""){return`<div class="pm-settings-section-grid">
    ${H.map(e=>`<button class="pm-settings-section ${e.id===t?"active":""}" data-settings-section="${e.id}">
      <span>${g[e.icon]||g.gear}</span>
      <strong>${h(e.title)}</strong>
      <em>${h(e.desc)}</em>
    </button>`).join("")}
  </div>`}function Oe(t,{section:e="",navigate:n}={}){K();let s=le.has(e)?e:"",o=s&&H.find(l=>l.id===s)?.title||"Settings",d=s?"back":"menu";t.innerHTML=`
    ${U({title:o,online:!0,leftIcon:d})}
    <main class="pm-body pm-settings-body">
      ${s?`<div class="pm-settings-topnav"><button class="pm-btn ghost" data-settings-home>${g.back} All settings</button></div>`:""}
      <div id="pm-settings-content">${s?`<div class="pm-card">${X("Loading settings...")}</div>`:he()}</div>
    </main>
  `,V(t,{onBack:()=>n?.("#mobile/settings"),onSettings:()=>n?.("#mobile/settings")}),t.querySelector("[data-settings-home]")?.addEventListener("click",()=>n?.("#mobile/settings")),t.querySelectorAll("[data-settings-section]").forEach(l=>{l.addEventListener("click",()=>n?.(`#mobile/settings/${l.getAttribute("data-settings-section")}`))}),s&&ve(t,s,n).catch(l=>{let a=t.querySelector("#pm-settings-content");a&&(a.innerHTML=b("Error",X(l.message||"Failed to load settings","error"),"gear"))})}function he(){return`
    ${b("Mobile Settings",'<div class="pm-card-body">Configure the same Settings tabs from desktop, adapted for this paired phone. Shortcuts and Pairing stay desktop-only.</div>',"gear","pm-card-strong")}
    ${ue("")}
  `}async function ve(t,e,n){let s=t.querySelector("#pm-settings-content");if(s){if(e==="system")return oe(s,t);if(e==="models")return ie(s,t);if(e==="voice")return ye(s,t,n);if(e==="credentials")return D(s,t);if(e==="search")return ke(s,t);if(e==="heartbeat")return $e(s,t);if(e==="security")return Se(s,t);if(e==="agents")return O(s,t);if(e==="channels")return we(s,t);if(e==="integrations")return Te(s,t)}}async function ye(t,e,n){t.innerHTML=b("Voice settings",'<div id="pm-voice-provider-settings">Loading voice settings\u2026</div>',"mic","pm-card-strong"),await G(t.querySelector("#pm-voice-provider-settings"),{request:v,mode:"mobile",onChatConnections:()=>n?.("#mobile/settings/models")})}function ge(){let t=new Date;return t.setDate(t.getDate()-1),`${t.getFullYear()}-${String(t.getMonth()+1).padStart(2,"0")}-${String(t.getDate()).padStart(2,"0")}`}function be(){return new Promise(t=>{let e=document.createElement("div");e.style.cssText="position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.38);display:flex;align-items:center;justify-content:center;padding:16px";let n=document.createElement("div");n.style.cssText="width:min(520px,100%);background:var(--pm-panel,var(--panel));border:1px solid var(--pm-line,var(--line));border-radius:16px;padding:20px;color:var(--pm-text,var(--text));box-shadow:0 12px 42px rgba(0,0,0,.22)",n.innerHTML=`
      <div style="font-size:16px;font-weight:800;margin-bottom:9px">When should auto-settle begin?</div>
      <div style="font-size:13px;line-height:1.55;color:var(--pm-muted,var(--muted));margin-bottom:16px">Include chats already older than the selected date, or start the inactivity clock from now for existing chats.</div>
      <div style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap">
        <button data-choice="cancel" class="pm-btn ghost" type="button">Cancel</button>
        <button data-choice="start_now" class="pm-btn" type="button">Start from now</button>
        <button data-choice="apply_existing" class="pm-btn primary" type="button">Apply to eligible chats</button>
      </div>`,e.appendChild(n),document.body.appendChild(e);let s=o=>{e.remove(),t(o)};n.querySelectorAll("[data-choice]").forEach(o=>o.addEventListener("click",()=>{let d=o.getAttribute("data-choice");s(d==="cancel"?null:d)})),e.addEventListener("click",o=>{o.target===e&&s(null)})})}async function oe(t,e){let n=await v("/api/settings/session"),s=n?.session?.autoSettle||{},o=s.mode==="custom"?"custom":String(Number(s.afterDays)||0),d=[{value:"0",label:"Never"},{value:"7",label:"7 days"},{value:"14",label:"14 days"},{value:"30",label:"30 days"},{value:"90",label:"90 days"},{value:"custom",label:"Custom"}];t.innerHTML=`
    ${b("Auto-settle untouched chats",`
      <div class="pm-card-body">Move untouched conversations to Settled Chats after the selected inactivity period. Nothing is deleted, summarized, marked read, or detached.</div>
      ${r("Inactivity period",f("pm-auto-settle-after",d,o))}
      <div id="pm-auto-settle-custom-wrap" style="display:${o==="custom"?"block":"none"}">
        ${r("Custom cutoff date",m("pm-auto-settle-custom-date",s.customDate||"",`type="date" max="${ge()}"`),"Choose a date before today.")}
      </div>
      <div class="pm-card-body">Protected chats\u2014pinned, active, task-owned, scheduled, supervised, project, approval-sensitive, and automated chats\u2014are always skipped.</div>
      <div id="pm-settings-live-status"></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="pm-btn" id="pm-preview-auto-settle" type="button">Preview eligible chats</button>
        <button class="pm-btn primary" id="pm-save-auto-settle" type="button">Save auto-settle</button>
      </div>
    `,"gear","pm-card-strong")}
    ${b("Last auto-settle check",`<div class="pm-card-body" id="pm-auto-settle-last-run">${h(n?.session?.autoSettleLastRun?`Completed ${new Date(Number(n.session.autoSettleLastRun.completedAt||0)).toLocaleString()} \xB7 ${Number(n.session.autoSettleLastRun.settled||0)} settled.`:"No automatic check has run yet.")}</div>`,"clock")}
  `;let l=e.querySelector("#pm-auto-settle-after"),a=e.querySelector("#pm-auto-settle-custom-wrap");l?.addEventListener("change",()=>{a&&(a.style.display=l.value==="custom"?"block":"none")}),e.querySelector("#pm-preview-auto-settle")?.addEventListener("click",async()=>{try{u(e,"Previewing protected-state checks...");let y=(await v("/api/settings/auto-settle/preview",{method:"POST",body:JSON.stringify({})}))?.summary||{};u(e,`${Number(y.wouldSettle||0)} eligible \xB7 ${Number(y.scanned||0)} scanned.`,"ok")}catch(i){u(e,i.message,"error")}}),e.querySelector("#pm-save-auto-settle")?.addEventListener("click",async()=>{let i=l?.value||"0",y={afterDays:i==="custom"?"custom":Number(i),activationMode:"start_now"};if(i==="custom"){if(y.customDate=c(e,"pm-auto-settle-custom-date"),!y.customDate){u(e,"Choose a custom cutoff date first.","error");return}let p=new Date(`${y.customDate}T00:00:00`);if(y.customDateOffsetMinutes=Number.isFinite(p.getTime())?p.getTimezoneOffset():new Date().getTimezoneOffset(),y.activationMode=await be(),!y.activationMode)return}try{await v("/api/settings/session",{method:"POST",body:JSON.stringify({autoSettle:y})}),u(e,"Auto-settle settings saved.","ok"),await oe(t,e)}catch(p){u(e,p.message,"error")}})}async function ie(t,e){let[n,s,o]=await Promise.all([v("/api/settings/provider"),v("/api/settings/session").catch(()=>null),W().catch(()=>null),ce()]),d=n?.llm||{},l=d.provider||"ollama",a=pe(d),i=d.providers?.[l]||{},y=s?.session||{};t.innerHTML=`
    ${b("Runtime",`<div class="pm-settings-kv">
      <span>Current model</span><strong>${h(o?.currentModel||i.model||"Unknown")}</strong>
      <span>Provider</span><strong>${h(ee(l))}</strong>
      <span>Status</span><strong>${o?.providerOnline?"Online":"Unknown"}</strong>
    </div>`,"brain")}
    ${b("Provider",`
      ${r("Active provider",f("pm-set-provider",a.map(p=>({value:p,label:ee(p)})),l))}
      <div id="pm-provider-fields">${te(l,i)}</div>
      <div class="pm-row-buttons">
        <button class="pm-btn" id="pm-refresh-models">${g.refresh} Refresh Models</button>
        <button class="pm-btn" id="pm-test-model">${g.refresh} Test</button>
        <button class="pm-btn primary" id="pm-save-model">${g.check} Save</button>
      </div>
      <div id="pm-settings-live-status"></div>
    `,"gear","pm-card-strong")}
    ${z(y.contextProfile,y.contextBudget,"mobile-context")}
    ${b("Context Compaction",`
      <div class="pm-card-body">Prometheus uses the selected model's token window automatically. Context is compacted only when token pressure requires it; message count does not define model context.</div>
      ${w("pm-session-roll","Rolling compaction",y.rollingCompactionEnabled!==!1,"Automatically summarize older active context when token pressure requires it.")}
      ${w("pm-session-compact-auto","Use selected context window",y.compactionThreshold==="auto"||y.compactionThreshold==null,"Automatic sizing reserves output, reasoning and one estimation margin. Turn off to use a manual earlier threshold.")}
      ${r("Manual compaction threshold",m("pm-session-compact",typeof y.compactionThreshold=="number"?y.compactionThreshold:.7,'type="number" min="0.4" max="0.95" step="0.01"'))}
      ${r("Memory flush threshold",m("pm-session-memory",y.memoryFlushThreshold||.9,'type="number" min="0.5" max="0.98" step="0.01"'))}
      ${r("Rolling tool turns",m("pm-session-tool-turns",y.rollingCompactionToolTurns||4,'type="number" min="1" max="12"'))}
      <div class="pm-card-body">Summary length is adaptive. Compaction preserves requests, decisions, pending work and recovery references; there is no fixed 900-word cutoff.</div>
      ${r("Compaction model override",m("pm-session-model",y.rollingCompactionModel||"",'placeholder="Optional"'))}
      <button class="pm-btn primary" id="pm-save-session">${g.check} Save compaction</button>
    `,"clipboard")}
  `,E(e),e.querySelector("#pm-set-provider")?.addEventListener("change",()=>{let p=c(e,"pm-set-provider"),k=d.providers?.[p]||{},S=e.querySelector("#pm-provider-fields");S&&(S.innerHTML=te(p,k)),E(e)}),e.querySelector("#pm-refresh-models")?.addEventListener("click",async()=>{u(e,"Loading models...");try{let p=q(e,d),k=p.provider,S=await v("/api/models/test",{method:"POST",body:JSON.stringify({llm:p})}),$=(S.models||[]).map(T=>typeof T=="string"?T:T.name||String(T)).filter(Boolean),I=e.querySelector(`#${CSS.escape(R(k))}`);if(I&&$.length&&I.tagName==="SELECT"){let T=I.value;I.innerHTML=A(k,$).map(j=>`<option value="${h(j.value)}">${h(j.label)}</option>`).join(""),T&&$.includes(T)&&(I.value=T)}u(e,$.length?`${$.length} model(s) found.`:S.error||"No models found.",$.length?"ok":"warn")}catch(p){u(e,p.message,"error")}}),e.querySelector("#pm-test-model")?.addEventListener("click",async()=>{u(e,"Testing provider...");try{let p=q(e,d),k=await v("/api/models/test",{method:"POST",body:JSON.stringify({llm:p})});u(e,k.success?`Connected. ${Array.isArray(k.models)?k.models.length:0} models returned.`:k.error||"Could not connect",k.success?"ok":"warn")}catch(p){u(e,p.message,"error")}}),e.querySelector("#pm-save-model")?.addEventListener("click",async()=>{u(e,"Saving model settings...");try{let p=q(e,d);await v("/api/settings/provider",{method:"POST",body:JSON.stringify({llm:p})}),u(e,"Model settings saved.","ok")}catch(p){u(e,p.message,"error")}}),Y(e,y.contextProfile,p=>v("/api/settings/context-window",{method:"POST",body:JSON.stringify(p)}),()=>ie(t,e),"mobile-context"),e.querySelector("#pm-save-session")?.addEventListener("click",async()=>{try{await v("/api/settings/session",{method:"POST",body:JSON.stringify({rollingCompactionEnabled:x(e,"pm-session-roll"),compactionThreshold:x(e,"pm-session-compact-auto")?"auto":Number(c(e,"pm-session-compact")),compactionThresholdMode:x(e,"pm-session-compact-auto")?"auto":"manual",memoryFlushThreshold:Number(c(e,"pm-session-memory")),rollingCompactionToolTurns:Number(c(e,"pm-session-tool-turns")),rollingCompactionModel:c(e,"pm-session-model")})}),u(e,"Compaction settings saved.","ok")}catch(p){u(e,p.message,"error")}})}function q(t,e){let n=c(t,"pm-set-provider")||e.provider||"ollama",s={...e.providers||{}};s[n]={...s[n]||{}};let o=s[n],d=c(t,R(n));d&&(o.model=d);let l=c(t,re(n));l?o.endpoint=l:delete o.endpoint;let a=c(t,ae(n));a&&(o.api_key=a);let i=c(t,de(n));if(i&&F(n,o.model,i)?o.reasoning_effort=i:delete o.reasoning_effort,n==="anthropic"){o.extended_thinking=x(t,"pm-anthropic-thinking");let p=Number(c(t,"pm-anthropic-budget"));p&&(o.thinking_budget=p)}let y=c(t,`pm-speed-${n}`);return L(n,o.model)?o.speed=y==="fast"?"fast":"standard":delete o.speed,delete o.fast_mode,{...e,provider:n,providers:s}}function R(t){return`pm-model-${t}`}function re(t){return`pm-endpoint-${t}`}function ae(t){return`pm-key-${t}`}function de(t){return`pm-effort-${t}`}function te(t,e={}){let n=R(t),s=re(t),o=ae(t),d=de(t);if(t==="ollama")return`
      ${r("Endpoint",m(s,e.endpoint||"http://localhost:11434"))}
      ${r("Active Model",m(n,e.model||"",'placeholder="qwen3:4b"'))}
    `;if(t==="llama_cpp")return`${r("Endpoint",m(s,e.endpoint||"http://localhost:8080"))}${r("Model name",m(n,e.model||"",'placeholder="qwen2.5-7b"'))}`;if(t==="lm_studio")return`${r("Endpoint",m(s,e.endpoint||"http://localhost:1234"))}${r("Model name",m(n,e.model||"",'placeholder="qwen2.5-7b-instruct"'))}`;if(t==="openai"){let l=C(t,e.model||"gpt-5.5").map(a=>({value:a,label:a||"provider default"}));return`
      ${r("API Key",m(o,e.api_key||"",'type="password" placeholder="sk-..."'))}
      ${r("Model",f(n,A(t,P(t,e.model||"gpt-5.5")),e.model||"gpt-5.5"))}
      ${l.length>1?r("Reasoning Effort",f(d,l,e.reasoning_effort||"")):""}
      ${L(t,e.model||"gpt-5.5")?r("Speed",f(`pm-speed-${t}`,[{value:"standard",label:"Standard"},{value:"fast",label:"Fast"}],e.speed||(e.fast_mode===!0?"fast":"standard"))):""}
    `}if(t==="openai_codex"){let l=C(t,e.model||"gpt-5.5").map(a=>({value:a,label:a||"provider default"}));return`
      ${r("Model",f(n,A(t,P(t,e.model||"gpt-5.5")),e.model||"gpt-5.5"))}
      ${r("Reasoning Effort",f(d,l,e.reasoning_effort||""))}
      ${L(t,e.model||"gpt-5.5")?r("Speed",f(`pm-speed-${t}`,[{value:"standard",label:"Standard"},{value:"fast",label:"Fast"}],e.speed||(e.fast_mode===!0?"fast":"standard"))):""}
      <div class="pm-settings-callout">Connect or disconnect the ChatGPT account from Credentials/Auth controls on desktop if OAuth needs renewal.</div>
    `}if(t==="anthropic"){let l=J(t,e.model||"claude-sonnet-5"),a=C(t,e.model||"claude-sonnet-5").map(i=>({value:i,label:i||"provider default"}));return`
      ${r("Model",f(n,A(t,P(t,e.model||"claude-sonnet-5")),e.model||"claude-sonnet-5"))}
      ${a.length>1?r("Thinking Effort",f(d,a,e.reasoning_effort||"")):""}
      ${w("pm-anthropic-thinking","Extended thinking",e.extended_thinking===!0)}
      ${L(t,e.model||"claude-sonnet-5")?r("Speed",f(`pm-speed-${t}`,[{value:"standard",label:"Standard"},{value:"fast",label:"Fast"}],e.speed||(e.fast_mode===!0?"fast":"standard"))):""}
      ${l.thinkingMode==="manual"?r("Thinking Budget",f("pm-anthropic-budget",["2048","5000","10000","16000","24000","32000"],String(e.thinking_budget||"10000"))):""}
    `}if(t==="perplexity")return`${r("API Key",m(o,e.api_key||"",'type="password" placeholder="pplx-..."'))}${r("Model",f(n,A(t,P(t,e.model||"sonar-pro")),e.model||"sonar-pro"))}${r("Reasoning Effort",f(d,["","low","medium","high"].map(l=>({value:l,label:l||"provider default"})),e.reasoning_effort||""))}`;if(t==="xai"){let a=(/^grok-4\.20-multi-agent(?:-|$)/i.test(String(e.model||"").trim())?["","low","medium","high","xhigh"]:["","low","medium","high"]).map(i=>({value:i,label:i==="xhigh"?"extra high":i||"provider default"}));return`${r("API Key",m(o,e.api_key||"",'type="password" placeholder="xai-..."'))}${r("Model",f(n,A(t,P(t,e.model||"grok-4.3")),e.model||"grok-4.3"))}${r("Reasoning Effort",f(d,a,e.reasoning_effort||""))}${r("Endpoint",m(s,e.endpoint||"",'placeholder="https://api.x.ai/v1"'))}`}return t==="gemini"?`${r("API Key",m(o,e.api_key||"",'type="password" placeholder="AIza..."'))}${r("Model",f(n,A(t,P(t,e.model||"gemini-2.5-pro")),e.model||"gemini-2.5-pro"))}`:`${r("Model",m(n,e.model||"",'placeholder="Provider model"'))}${r("Endpoint",m(s,e.endpoint||"",'placeholder="Optional endpoint"'))}`}async function D(t,e){let[n,s,o]=await Promise.all([v("/api/settings/search").catch(()=>({})),v("/api/credentials/status").catch(()=>({keys:[]})),v("/api/credentials/audit").catch(()=>({lines:[]}))]);t.innerHTML=`
    ${b("Search Provider Keys",`
      <div class="pm-card-body" style="margin-bottom:10px;">Stored encrypted in the vault. Masked values keep the existing key.</div>
      ${r("TinyFish API Key",m("pm-cred-tinyfish",n.tinyfish_api_key||"",'type="password" placeholder="tf-..." autocomplete="new-password"'))}
      ${r("Tavily API Key",m("pm-cred-tavily",n.tavily_api_key||"",'type="password" placeholder="tvly-..." autocomplete="new-password"'))}
      ${r("Google API Key",m("pm-cred-google",n.google_api_key||"",'type="password" placeholder="AIza..." autocomplete="new-password"'))}
      ${r("Google CSE ID",m("pm-cred-google-cx",n.google_cx||"",'placeholder="Custom search engine ID"'),"Stored for persistence; leave as-is to keep current value.")}
      ${r("Brave API Key",m("pm-cred-brave",n.brave_api_key||"",'type="password" placeholder="BSA..." autocomplete="new-password"'))}
      <button class="pm-btn primary" id="pm-save-creds">${g.check} Save credentials</button>
      <div id="pm-settings-live-status"></div>
    `,"gear","pm-card-strong")}
    ${b("Vault Status",`<div class="pm-settings-list">
      ${(s.keys||[]).map(d=>`<div class="pm-settings-row"><span><strong>${h(fe(d))}</strong><em>${h(d)}</em></span><span class="pm-pill active">stored</span></div>`).join("")||'<div class="pm-card-body">No credentials stored yet.</div>'}
    </div>`,"check")}
    ${b("How Credentials Work",'<div class="pm-card-body">When saved, keys are encrypted with AES-256-GCM and referenced from config as vault entries. If a field shows bullets, a key is already stored.</div>',"clipboard")}
    ${b("Recent Vault Access",`<div class="pm-settings-log">${(o.lines||[]).slice(-18).reverse().map(d=>`<div>${h(d)}</div>`).join("")||"<div>No audit entries yet.</div>"}</div>
      <button class="pm-btn" id="pm-refresh-creds">${g.refresh} Refresh</button>`,"clipboard")}
  `,e.querySelector("#pm-refresh-creds")?.addEventListener("click",()=>D(t,e)),e.querySelector("#pm-save-creds")?.addEventListener("click",async()=>{try{await v("/api/settings/search",{method:"POST",body:JSON.stringify({preferred_provider:n.preferred_provider||"tavily",search_rigor:n.search_rigor||"verified",tinyfish_api_key:c(e,"pm-cred-tinyfish"),tavily_api_key:c(e,"pm-cred-tavily"),google_api_key:c(e,"pm-cred-google"),google_cx:c(e,"pm-cred-google-cx"),brave_api_key:c(e,"pm-cred-brave")})}),u(e,"Credentials saved.","ok"),await D(t,e)}catch(d){u(e,d.message,"error")}})}function fe(t){return{"search.tavily_api_key":"Tavily API Key","search.tinyfish_api_key":"TinyFish API Key","search.google_api_key":"Google API Key","search.google_cx":"Google CSE ID","search.brave_api_key":"Brave API Key","llm.openai.api_key":"OpenAI API Key","hooks.token":"Webhook Token","channels.telegram.botToken":"Telegram Token","channels.discord.botToken":"Discord Token"}[t]||t}async function ke(t,e){let n=await v("/api/settings/search");t.innerHTML=`
    ${b("Web Search",`
      ${r("Preferred provider",f("pm-search-provider",["tavily","tinyfish","google","brave","none"],n.preferred_provider||"tavily"))}
      <div class="pm-settings-callout">API keys are managed in the Credentials tab and stored encrypted.</div>
      <button class="pm-btn primary" id="pm-save-search">${g.check} Save search provider</button>
      <div id="pm-settings-live-status"></div>
    `,"target","pm-card-strong")}
  `,e.querySelector("#pm-save-search")?.addEventListener("click",async()=>{try{await v("/api/settings/search",{method:"POST",body:JSON.stringify({preferred_provider:c(e,"pm-search-provider"),search_rigor:n.search_rigor||"verified",tavily_api_key:n.tavily_api_key||"",tinyfish_api_key:n.tinyfish_api_key||"",google_api_key:n.google_api_key||"",google_cx:n.google_cx||"",brave_api_key:n.brave_api_key||""})}),u(e,"Search settings saved.","ok")}catch(s){u(e,s.message,"error")}})}async function $e(t,e){let s=(await v("/api/settings/heartbeat")).heartbeat||{};t.innerHTML=b("Heartbeat",`
    ${w("pm-hb-enabled","Enabled",s.enabled!==!1,"Allow Prometheus to wake itself for background work.")}
    ${r("Interval minutes",m("pm-hb-interval",s.interval_minutes||30,'type="number" min="1" max="1440"'))}
    ${r("Model override",m("pm-hb-model",s.model||"",'placeholder="Optional"'))}
    ${w("pm-hb-review","Review teams after run",s.review_teams_after_run===!0)}
    ${r("Instructions",M("pm-hb-instructions",s.instructions||"",'rows="10"'))}
    <button class="pm-btn primary" id="pm-save-heartbeat">${g.check} Save heartbeat</button>
    <div id="pm-settings-live-status"></div>
  `,"clock","pm-card-strong"),E(e),e.querySelector("#pm-save-heartbeat")?.addEventListener("click",async()=>{try{await v("/api/settings/heartbeat",{method:"POST",body:JSON.stringify({enabled:x(e,"pm-hb-enabled"),interval_minutes:Number(c(e,"pm-hb-interval")),model:c(e,"pm-hb-model"),review_teams_after_run:x(e,"pm-hb-review"),instructions:e.querySelector("#pm-hb-instructions")?.value||""})}),u(e,"Heartbeat settings saved.","ok")}catch(o){u(e,o.message,"error")}})}async function Se(t,e){let n=await v("/api/settings/paths").catch(()=>({}));t.innerHTML=`
    ${b("File Access",`
      ${r("Workspace Path",m("pm-sec-workspace",n.workspace_path||"",'placeholder="%APPDATA%\\\\Prometheus\\\\workspace"'))}
      ${r("Allowed Paths (one per line)",M("pm-sec-allowed",(n.allowed_paths||[]).join(`
`),'rows="6"'))}
      ${r("Blocked Paths (one per line)",M("pm-sec-blocked",(n.blocked_paths||[]).join(`
`),'rows="5"'))}
      <button class="pm-btn primary" id="pm-save-security">${g.check} Save file access</button>
      <div id="pm-settings-live-status"></div>
    `,"check","pm-card-strong")}
  `,e.querySelector("#pm-save-security")?.addEventListener("click",async()=>{try{await v("/api/settings/paths",{method:"POST",body:JSON.stringify({workspace_path:c(e,"pm-sec-workspace"),allowed_paths:Z(e.querySelector("#pm-sec-allowed")?.value||""),blocked_paths:Z(e.querySelector("#pm-sec-blocked")?.value||"")})}),u(e,"File access settings saved.","ok")}catch(s){u(e,s.message,"error")}})}async function O(t,e){let[n,s]=await Promise.all([v("/api/agents").catch(()=>({agents:[]})),v("/api/settings/agent-model-defaults").catch(()=>({defaults:{}}))]),o=n.agents||n.items||[],d=s.defaults||{},l=["main_chat","proposal_executor_high_risk","proposal_executor_low_risk","coordinator","manager","subagent_planner","subagent_orchestrator","subagent_researcher","subagent_analyst","subagent_builder","subagent_operator"],a=o.find(i=>String(i.id)===String(e._pmSelectedAgentId))||o.find(i=>i.id==="main")||o[0]||{};t.innerHTML=`
    ${b("Model Defaults",`
      ${l.map(i=>r(i.replace(/_/g," "),m(`pm-agent-def-${i}`,d[i]||"",'placeholder="Provider/model"'))).join("")}
      <button class="pm-btn primary" id="pm-save-agent-defaults">${g.check} Save defaults</button>
      <div id="pm-settings-live-status"></div>
    `,"brain","pm-card-strong")}
    ${b("Configured Agents",`<div class="pm-settings-list">${o.map(i=>`<button class="pm-settings-row pm-settings-row-button ${String(i.id)===String(a.id)?"active":""}" data-agent-id="${h(i.id)}">
      <span><strong>${h(i.name||i.id)}</strong><em>${h(i.description||i.model||i.status||"")}</em></span>
      <span class="pm-pill ${i.enabled===!1?"gray":"active"}">${i.enabled===!1?"off":"on"}</span>
    </button>`).join("")||'<div class="pm-card-body">No agents found.</div>'}</div>
      <button class="pm-btn" id="pm-new-agent" style="margin-top:10px;">${g.plus} New Agent</button>`,"robot")}
    ${ne(a)}
  `,e.querySelectorAll("[data-agent-id]").forEach(i=>i.addEventListener("click",async()=>{e._pmSelectedAgentId=i.getAttribute("data-agent-id"),await O(t,e)})),e.querySelector("#pm-new-agent")?.addEventListener("click",()=>{e._pmSelectedAgentId="";let i=e.querySelector("#pm-agent-editor");i&&(i.innerHTML=ne({id:"",name:"",description:"",workspace:"",maxSteps:8,default:!1},!0)),se(e,t)}),se(e,t,a),e.querySelector("#pm-save-agent-defaults")?.addEventListener("click",async()=>{try{let i={};l.forEach(y=>{i[y]=c(e,`pm-agent-def-${y}`)}),await v("/api/settings/agent-model-defaults",{method:"POST",body:JSON.stringify(i)}),u(e,"Agent defaults saved.","ok")}catch(i){u(e,i.message,"error")}})}function ne(t={},e=!1){return`<div id="pm-agent-editor">${b("Agent Details",`
    ${r("ID",m("pm-agent-id",t.id||"",`${e?"":"readonly"} placeholder="researcher"`))}
    ${r("Name",m("pm-agent-name",t.name||"",'placeholder="Scout"'))}
    ${r("Description",M("pm-agent-description",t.description||"",'rows="3"'))}
    ${r("Workspace",m("pm-agent-workspace",t.workspace||"",'placeholder="%APPDATA%\\\\Prometheus\\\\workspace\\\\agents\\\\researcher"'))}
    ${r("Model",m("pm-agent-model",t.model||"",'placeholder="provider/model or blank for default"'))}
    ${r("Max Steps",m("pm-agent-max-steps",t.maxSteps||t.max_steps||8,'type="number" min="1" step="1"'))}
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
  `,"play"):""}</div>`}function se(t,e){E(t),t.querySelector("#pm-save-agent")?.addEventListener("click",async()=>{let n=c(t,"pm-agent-id");if(!n)return u(t,"Agent ID is required.","error");let s={id:n,name:c(t,"pm-agent-name"),description:t.querySelector("#pm-agent-description")?.value||"",workspace:c(t,"pm-agent-workspace"),model:c(t,"pm-agent-model"),maxSteps:Number(c(t,"pm-agent-max-steps"))||8,default:x(t,"pm-agent-default")};try{let o=!!t._pmSelectedAgentId;await v(o?`/api/agents/${encodeURIComponent(n)}`:"/api/agents",{method:o?"PUT":"POST",body:JSON.stringify({agent:s})}),t._pmSelectedAgentId=n,u(t,"Agent saved.","ok"),await O(e,t)}catch(o){u(t,o.message,"error")}}),t.querySelector("#pm-delete-agent")?.addEventListener("click",async()=>{let n=c(t,"pm-agent-id");if(!(!n||!window.confirm(`Delete agent "${n}"?`)))try{await v(`/api/agents/${encodeURIComponent(n)}`,{method:"DELETE"}),t._pmSelectedAgentId="",await O(e,t)}catch(s){u(t,s.message,"error")}}),t.querySelector("#pm-run-agent")?.addEventListener("click",async()=>{let n=c(t,"pm-agent-id"),s=String(t.querySelector("#pm-agent-task")?.value||"").trim(),o=t.querySelector("#pm-agent-run-output");if(!s)return u(t,"Provide a task first.","error");o&&(o.innerHTML="<div>Running...</div>");try{let d=await v(`/api/agents/${encodeURIComponent(n)}/spawn`,{method:"POST",body:JSON.stringify({task:s})});o&&(o.innerHTML=`<div>${h(JSON.stringify(d.result||d,null,2)).replace(/\n/g,"<br>")}</div>`)}catch(d){o&&(o.innerHTML=`<div>${h(d.message)}</div>`)}}),t.querySelector("#pm-agent-history")?.addEventListener("click",async()=>{let n=c(t,"pm-agent-id"),s=t.querySelector("#pm-agent-run-output");try{let o=await v(`/api/agents/history?agentId=${encodeURIComponent(n)}&limit=12`);s&&(s.innerHTML=(o.history||[]).map(d=>`<div><strong>${h(d.success?"success":"failed")}</strong> ${h(d.trigger||"manual")}<br><em>${h(d.resultPreview||d.error||"")}</em></div>`).join("")||"<div>No runs yet.</div>")}catch(o){s&&(s.innerHTML=`<div>${h(o.message)}</div>`)}})}async function we(t,e){let n=await v("/api/channels/status"),s=n.telegram||{},o=n.discord||{},d=n.whatsapp||{};t.innerHTML=`
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
  `;let l=()=>xe(e,{telegram:s,discord:o,whatsapp:d});e.querySelector("#pm-channel-select")?.addEventListener("change",l),l(),e.querySelector("#pm-channel-save")?.addEventListener("click",async()=>{let a=c(e,"pm-channel-select")||"telegram";try{await v("/api/channels/config",{method:"POST",body:JSON.stringify({channels:{[a]:N(e,a)}})}),u(e,`${a} settings saved.`,"ok")}catch(i){u(e,i.message,"error")}}),e.querySelector("#pm-channel-test")?.addEventListener("click",async()=>{let a=c(e,"pm-channel-select")||"telegram";try{let i=await v(`/api/channels/test/${a}`,{method:"POST",body:JSON.stringify(N(e,a))});u(e,i.success?`${a} connection test passed.`:i.error||`${a} test failed.`,i.success?"ok":"error")}catch(i){u(e,i.message,"error")}}),e.querySelector("#pm-channel-send")?.addEventListener("click",async()=>{let a=c(e,"pm-channel-select")||"telegram";try{let i=await v(`/api/channels/send-test/${a}`,{method:"POST",body:JSON.stringify(N(e,a))});u(e,i.success?`Test message sent via ${a}.`:i.error||"Send test failed.",i.success?"ok":"error")}catch(i){u(e,i.message,"error")}})}function xe(t,e){let n=c(t,"pm-channel-select")||"telegram",s=e[n]||{},o=t.querySelector("#pm-channel-status-card"),d=t.querySelector("#pm-channel-form"),l=t.querySelector("#pm-channel-guide");o&&(o.innerHTML=`<div class="pm-settings-channel">
    <div><strong>${h(n[0].toUpperCase()+n.slice(1))}</strong><span>${s.enabled?"Enabled":"Disabled"}${s.connected?" \xB7 connected":""}</span></div>
    <span class="pm-pill ${s.enabled?"active":"gray"}">${s.enabled?"on":"off"}</span>
  </div>`),n==="telegram"&&d?(d.innerHTML=`
      ${r("Bot Token",m("pm-ch-token","",`type="password" placeholder="${s.hasToken?"\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022 (saved)":"123456:ABC-DEF1234..."}"`))}
      ${r("Your Telegram User ID(s)",m("pm-ch-userids",(s.allowedUserIds||[]).join(", "),'placeholder="123456789, 987654321"'))}
      ${w("pm-ch-enabled","Enable Telegram channel",s.enabled===!0)}
    `,l&&(l.innerHTML="Create a bot with BotFather, paste the token, add allowed user IDs, then Test, Save, and Send Test.")):n==="discord"&&d?(d.innerHTML=`
      ${r("Bot Token",m("pm-ch-token","",`type="password" placeholder="${s.hasToken?"\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022 (saved)":"Discord bot token"}"`))}
      ${r("Application ID (optional)",m("pm-ch-appid",s.applicationId||""))}
      ${r("Guild ID (optional)",m("pm-ch-guildid",s.guildId||""))}
      ${r("Channel ID (for send-test)",m("pm-ch-channelid",s.channelId||""))}
      ${r("Webhook URL (optional)",m("pm-ch-webhook","",`type="password" placeholder="${s.hasWebhook?"\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022 (saved)":"https://discord.com/api/webhooks/..."}"`))}
      ${w("pm-ch-enabled","Enable Discord channel",s.enabled===!0)}
    `,l&&(l.innerHTML="Create an app and bot in Discord Developer Portal, invite it to your server, then Test, Save, and Send Test.")):d&&(d.innerHTML=`
      ${r("Access Token",m("pm-ch-token","",`type="password" placeholder="${s.hasAccessToken?"\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022 (saved)":"Meta access token"}"`))}
      ${r("Phone Number ID",m("pm-ch-phoneid",s.phoneNumberId||""))}
      ${r("Business Account ID (optional)",m("pm-ch-baid",s.businessAccountId||""))}
      ${r("Webhook Verify Token (optional)",m("pm-ch-verify","",`type="password" placeholder="${s.verifyTokenSet?"\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022 (saved)":"Verify token"}"`))}
      ${r("Webhook Secret (optional)",m("pm-ch-secret","",`type="password" placeholder="${s.webhookSecretSet?"\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022 (saved)":"Webhook secret"}"`))}
      ${r("Test Recipient (E.164)",m("pm-ch-recipient",s.testRecipient||"",'placeholder="15551234567"'))}
      ${w("pm-ch-enabled","Enable WhatsApp channel",s.enabled===!0)}
    `,l&&(l.innerHTML="Copy WhatsApp Cloud API credentials from Meta Developer dashboard, configure optional webhook fields, then Test, Save, and Send Test.")),E(t)}function N(t,e){let n=x(t,"pm-ch-enabled");return e==="telegram"?{enabled:n,botToken:c(t,"pm-ch-token"),allowedUserIds:me(c(t,"pm-ch-userids"))}:e==="discord"?{enabled:n,botToken:c(t,"pm-ch-token"),applicationId:c(t,"pm-ch-appid"),guildId:c(t,"pm-ch-guildid"),channelId:c(t,"pm-ch-channelid"),webhookUrl:c(t,"pm-ch-webhook")}:{enabled:n,accessToken:c(t,"pm-ch-token"),phoneNumberId:c(t,"pm-ch-phoneid"),businessAccountId:c(t,"pm-ch-baid"),verifyToken:c(t,"pm-ch-verify"),webhookSecret:c(t,"pm-ch-secret"),testRecipient:c(t,"pm-ch-recipient")}}async function Te(t,e){let[n,s,o]=await Promise.all([v("/api/settings/hooks").catch(()=>null),v("/api/mcp/servers").catch(()=>({servers:[]})),v("/api/extensions/catalog").catch(()=>({items:[],extensions:[]}))]),d=s.servers||[],l=o.items||o.extensions||o.catalog||[];t.innerHTML=`
    ${b("Webhooks",`
      ${w("pm-hooks-enabled","Enabled",n?.hooks?.enabled||n?.enabled||!1)}
      ${r("Secret Token",m("pm-hooks-token",n?.hooks?.token||n?.token||"",'type="password" placeholder="Paste or generate a secret token"'))}
      ${r("Path",m("pm-hooks-path",n?.hooks?.path||n?.path||"/hooks/prometheus"))}
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
  `,E(e),e.querySelector("#pm-generate-hooks")?.addEventListener("click",()=>{let a=new Uint8Array(24);crypto.getRandomValues(a);let i=Array.from(a).map(p=>p.toString(16).padStart(2,"0")).join(""),y=e.querySelector("#pm-hooks-token");y&&(y.value=i,y.type="text")}),e.querySelector("#pm-save-hooks")?.addEventListener("click",async()=>{try{await v("/api/settings/hooks",{method:"POST",body:JSON.stringify({enabled:x(e,"pm-hooks-enabled"),token:c(e,"pm-hooks-token"),path:c(e,"pm-hooks-path")})}),u(e,"Webhook settings saved. Restart gateway to apply endpoint changes.","ok")}catch(a){u(e,a.message,"error")}}),e.querySelector("#pm-test-hooks")?.addEventListener("click",async()=>{try{let a=await v("/api/settings/hooks/test",{method:"POST",body:"{}"});u(e,a.success?"Webhook test sent.":a.error||"Webhook test failed.",a.success?"ok":"error")}catch(a){u(e,a.message,"error")}})}export{Oe as renderMobileSettingsPage};
