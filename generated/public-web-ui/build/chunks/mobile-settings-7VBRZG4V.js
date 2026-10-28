import{H as g,I as h,O as G,P as V}from"./chunk-IXU5HK5G.js";import{e as K}from"./chunk-YNMSZYSC.js";import{a as U}from"./chunk-VL6OBL7A.js";import"./chunk-HIQGROVQ.js";import{h as y,ob as W}from"./chunk-LHYIPBQS.js";import"./chunk-YMT6MSCC.js";import"./chunk-UGPXJRDS.js";import"./chunk-WXZ4L2EE.js";import{a as z,b as Y,c as Q}from"./chunk-C2LHQX4Q.js";import{c as B}from"./chunk-X4TZO75O.js";import{c as J,d as M,g as F,h as L}from"./chunk-T36647J3.js";import"./chunk-NWWP72PK.js";import"./chunk-JF4LWGNM.js";import"./chunk-EPSJJCWL.js";var X={openai:["gpt-6.1-sol","gpt-6.1-terra","gpt-6-astra","gpt-6-sol","gpt-6-luna","gpt-5.6-sol","gpt-5.6-terra","gpt-5.6-luna","gpt-5.5","gpt-5.4-pro","gpt-5.4","gpt-5.4-mini","gpt-5.4-nano","gpt-5-pro","gpt-5","gpt-5-mini","gpt-5-nano","gpt-5-chat-latest","gpt-4.1","gpt-4.1-mini","gpt-4o","gpt-4o-mini","o4-mini","o3","o1"],openai_codex:["gpt-6.1-sol","gpt-6.1-terra","gpt-6-astra","gpt-6-sol","gpt-6-luna","gpt-5.6-sol","gpt-5.6-terra","gpt-5.6-luna","gpt-5.5","gpt-5.4-codex","gpt-5.4-codex-mini","gpt-5.4","gpt-5.4-mini","gpt-5.3-codex","gpt-5.3-codex-spark","gpt-5.3","gpt-5.2-codex","gpt-5.2","gpt-5.1-codex-max","gpt-5.1-codex-mini","gpt-5.1-codex","gpt-5.1"],anthropic:["claude-fable-5-1","claude-fable-5","claude-opus-5-5","claude-opus-5","claude-opus-4-8","claude-opus-4-7","claude-opus-4-6","claude-sonnet-5-5","claude-sonnet-5","claude-sonnet-4-6","claude-sonnet-4-5-20250514","claude-haiku-5-5","claude-haiku-4-5-20251001"],perplexity:["sonar-pro","sonar","sonar-reasoning-pro","sonar-reasoning","sonar-deep-research"],gemini:["gemini-2.5-pro","gemini-2.5-flash","gemini-2.5-flash-lite","gemini-2.0-flash","gemini-1.5-pro","gemini-1.5-flash"],xai:["grok-4.7","grok-4.6","grok-4.5","grok-composer-2.5-fast","grok-4.3","grok-4.3-latest","grok-latest","grok-4.20-0309-reasoning","grok-4.20-0309-non-reasoning","grok-4.20-multi-agent-0309","grok-4.20-multi-agent","grok-build-0.1"]},_=null;async function le(t=!1){if(_&&!t)return _;try{let e=await y("/api/extensions/catalog?kind=provider");_=Array.isArray(e?.items)?e.items:[]}catch{_=_||[]}return _}function C(t,e=""){let s=String(t||"").trim(),n=(_||[]).find(i=>i&&i.id===s)||null,r=[];(i=>{if(Array.isArray(i))for(let p of i){let u=String(p&&p.name||p||"").trim();u&&!r.includes(u)&&r.push(u)}})(n&&n.runtime&&n.runtime.options&&n.runtime.options.staticModels);let o=Array.isArray(X[s])?X[s]:[];o.forEach((i,p)=>{let u=String(i||"").trim();if(!u||r.includes(u))return;let $=-1;for(let k=p-1;k>=0&&$<0;k--)$=r.indexOf(String(o[k]||"").trim());if($>=0){r.splice($+1,0,u);return}let S=-1;for(let k=p+1;k<o.length&&S<0;k++)S=r.indexOf(String(o[k]||"").trim());S>=0?r.splice(S,0,u):r.push(u)});let d=String(e||"").trim();return d&&!r.includes(d)&&r.unshift(d),r}var H=[{id:"system",title:"System",icon:"gear",desc:"Theme-independent runtime and automatic chat settling."},{id:"heartbeat",title:"Heartbeat",icon:"clock",desc:"Background heartbeat cadence and instructions."},{id:"search",title:"Search",icon:"target",desc:"Preferred web search provider."},{id:"credentials",title:"Credentials",icon:"gear",desc:"Search keys, vault status, and audit log."},{id:"security",title:"Security",icon:"check",desc:"Workspace, file access lists, and Chrome sign-ins."},{id:"models",title:"Models",icon:"brain",desc:"LLM providers, defaults, brain, and compaction."},{id:"voice",title:"Voice",icon:"mic",desc:"Voice providers, defaults, and listening mode."},{id:"agents",title:"Agents",icon:"robot",desc:"Agent list and model defaults."},{id:"channels",title:"Channels",icon:"send",desc:"Telegram, Discord, and WhatsApp connections."},{id:"integrations",title:"Integrations",icon:"paperclip",desc:"Webhooks and MCP servers."}],me=new Set(H.map(t=>t.id));function Z(t,e="muted"){return`<div class="pm-settings-status ${e}">${h(t||"")}</div>`}function f(t,e,s="gear",n=""){return`<article class="pm-card pm-settings-card ${n}">
    <div class="pm-card-head">${g[s]||""} ${h(t)}</div>
    ${e}
  </article>`}function a(t,e,s=""){return`<label class="pm-settings-field"><span>${h(t)}</span>${e}${s?`<em>${h(s)}</em>`:""}</label>`}function b(t,e,s){return`<select class="pm-input pm-select" id="${h(t)}">${e.map(n=>{let r=typeof n=="string"?n:n.value,c=typeof n=="string"?n:n.label;return`<option value="${h(r)}" ${String(r)===String(s)?"selected":""}>${h(c)}</option>`}).join("")}</select>`}function A(t,e){return(e||[]).map(s=>({value:s,label:U(s,t)}))}function m(t,e="",s=""){return`<input class="pm-input" id="${h(t)}" value="${h(e||"")}" ${s} />`}function I(t,e="",s=""){return`<textarea class="pm-textarea" id="${h(t)}" ${s}>${h(e||"")}</textarea>`}function w(t,e,s,n=""){return`<div class="pm-settings-toggle-row">
    <div><strong>${h(e)}</strong>${n?`<span>${h(n)}</span>`:""}</div>
    <button class="pm-toggle ${s?"on":""}" id="${h(t)}" data-toggle-bool="${h(t)}" aria-label="${h(e)}" aria-pressed="${s?"true":"false"}"></button>
  </div>`}function x(t,e){return t.querySelector(`#${CSS.escape(e)}`)?.classList.contains("on")===!0}function l(t,e){return String(t.querySelector(`#${CSS.escape(e)}`)?.value||"").trim()}function pe(t){return String(t||"").split(",").map(e=>e.trim()).filter(Boolean)}function ee(t){return String(t||"").split(`
`).map(e=>e.trim()).filter(Boolean)}function v(t,e,s="muted"){let n=t.querySelector("#pm-settings-live-status");n&&(n.className=`pm-settings-status ${s}`,n.textContent=e||"")}function P(t){t.querySelectorAll("[data-toggle-bool]").forEach(e=>{e.addEventListener("click",()=>{let s=!e.classList.contains("on");e.classList.toggle("on",s),e.setAttribute("aria-pressed",s?"true":"false")})})}function te(t){return{openai:"OpenAI API",openai_codex:"OpenAI OAuth",anthropic:"Anthropic",xai:"xAI / Grok",ollama:"Ollama",gemini:"Gemini",perplexity:"Perplexity",elevenlabs:"ElevenLabs"}[t]||t.replace(/_/g," ").replace(/\b\w/g,s=>s.toUpperCase())}function ue(t){let e=t?.providers&&typeof t.providers=="object"?t.providers:{},s=Object.keys(e);return s.includes("ollama")||s.push("ollama"),s.includes("openai")||s.push("openai"),s.includes("openai_codex")||s.push("openai_codex"),s.includes("anthropic")||s.push("anthropic"),s.includes("xai")||s.push("xai"),s}function he(t=""){return`<div class="pm-settings-section-grid">
    ${H.map(e=>`<button class="pm-settings-section ${e.id===t?"active":""}" data-settings-section="${e.id}">
      <span>${g[e.icon]||g.gear}</span>
      <strong>${h(e.title)}</strong>
      <em>${h(e.desc)}</em>
    </button>`).join("")}
  </div>`}function Ne(t,{section:e="",navigate:s}={}){K();let n=me.has(e)?e:"",r=n&&H.find(o=>o.id===n)?.title||"Settings",c=n?"back":"menu";t.innerHTML=`
    ${G({title:r,online:!0,leftIcon:c})}
    <main class="pm-body pm-settings-body">
      ${n?`<div class="pm-settings-topnav"><button class="pm-btn ghost" data-settings-home>${g.back} All settings</button></div>`:""}
      <div id="pm-settings-content">${n?`<div class="pm-card">${Z("Loading settings...")}</div>`:ve()}</div>
    </main>
  `,V(t,{onBack:()=>s?.("#mobile/settings"),onSettings:()=>s?.("#mobile/settings")}),t.querySelector("[data-settings-home]")?.addEventListener("click",()=>s?.("#mobile/settings")),t.querySelectorAll("[data-settings-section]").forEach(o=>{o.addEventListener("click",()=>s?.(`#mobile/settings/${o.getAttribute("data-settings-section")}`))}),n&&ye(t,n,s).catch(o=>{let d=t.querySelector("#pm-settings-content");d&&(d.innerHTML=f("Error",Z(o.message||"Failed to load settings","error"),"gear"))})}function ve(){return`
    ${f("Mobile Settings",'<div class="pm-card-body">Configure the same Settings tabs from desktop, adapted for this paired phone. Shortcuts and Pairing stay desktop-only.</div>',"gear","pm-card-strong")}
    ${he("")}
  `}async function ye(t,e,s){let n=t.querySelector("#pm-settings-content");if(n){if(e==="system")return re(n,t);if(e==="models")return ie(n,t);if(e==="voice")return ge(n,t,s);if(e==="credentials")return D(n,t);if(e==="search")return ke(n,t);if(e==="heartbeat")return Se(n,t);if(e==="security")return we(n,t);if(e==="agents")return O(n,t);if(e==="channels")return xe(n,t);if(e==="integrations")return _e(n,t)}}async function ge(t,e,s){t.innerHTML=f("Voice settings",'<div id="pm-voice-provider-settings">Loading voice settings\u2026</div>',"mic","pm-card-strong"),await z(t.querySelector("#pm-voice-provider-settings"),{request:y,mode:"mobile",onChatConnections:()=>s?.("#mobile/settings/models")})}function fe(){let t=new Date;return t.setDate(t.getDate()-1),`${t.getFullYear()}-${String(t.getMonth()+1).padStart(2,"0")}-${String(t.getDate()).padStart(2,"0")}`}function be(){return new Promise(t=>{let e=document.createElement("div");e.style.cssText="position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.38);display:flex;align-items:center;justify-content:center;padding:16px";let s=document.createElement("div");s.style.cssText="width:min(520px,100%);background:var(--pm-panel,var(--panel));border:1px solid var(--pm-line,var(--line));border-radius:16px;padding:20px;color:var(--pm-text,var(--text));box-shadow:0 12px 42px rgba(0,0,0,.22)",s.innerHTML=`
      <div style="font-size:16px;font-weight:800;margin-bottom:9px">When should auto-settle begin?</div>
      <div style="font-size:13px;line-height:1.55;color:var(--pm-muted,var(--muted));margin-bottom:16px">Include chats already older than the selected date, or start the inactivity clock from now for existing chats.</div>
      <div style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap">
        <button data-choice="cancel" class="pm-btn ghost" type="button">Cancel</button>
        <button data-choice="start_now" class="pm-btn" type="button">Start from now</button>
        <button data-choice="apply_existing" class="pm-btn primary" type="button">Apply to eligible chats</button>
      </div>`,e.appendChild(s),document.body.appendChild(e);let n=r=>{e.remove(),t(r)};s.querySelectorAll("[data-choice]").forEach(r=>r.addEventListener("click",()=>{let c=r.getAttribute("data-choice");n(c==="cancel"?null:c)})),e.addEventListener("click",r=>{r.target===e&&n(null)})})}async function re(t,e){let s=await y("/api/settings/session"),n=s?.session?.autoSettle||{},r=n.mode==="custom"?"custom":String(Number(n.afterDays)||0),c=[{value:"0",label:"Never"},{value:"7",label:"7 days"},{value:"14",label:"14 days"},{value:"30",label:"30 days"},{value:"90",label:"90 days"},{value:"custom",label:"Custom"}];t.innerHTML=`
    ${f("Auto-settle untouched chats",`
      <div class="pm-card-body">Move untouched conversations to Settled Chats after the selected inactivity period. Nothing is deleted, summarized, marked read, or detached.</div>
      ${a("Inactivity period",b("pm-auto-settle-after",c,r))}
      <div id="pm-auto-settle-custom-wrap" style="display:${r==="custom"?"block":"none"}">
        ${a("Custom cutoff date",m("pm-auto-settle-custom-date",n.customDate||"",`type="date" max="${fe()}"`),"Choose a date before today.")}
      </div>
      <div class="pm-card-body">Protected chats\u2014pinned, active, task-owned, scheduled, supervised, project, approval-sensitive, and automated chats\u2014are always skipped.</div>
      <div id="pm-settings-live-status"></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="pm-btn" id="pm-preview-auto-settle" type="button">Preview eligible chats</button>
        <button class="pm-btn primary" id="pm-save-auto-settle" type="button">Save auto-settle</button>
      </div>
    `,"gear","pm-card-strong")}
    ${f("Last auto-settle check",`<div class="pm-card-body" id="pm-auto-settle-last-run">${h(s?.session?.autoSettleLastRun?`Completed ${new Date(Number(s.session.autoSettleLastRun.completedAt||0)).toLocaleString()} \xB7 ${Number(s.session.autoSettleLastRun.settled||0)} settled.`:"No automatic check has run yet.")}</div>`,"clock")}
  `;let o=e.querySelector("#pm-auto-settle-after"),d=e.querySelector("#pm-auto-settle-custom-wrap");o?.addEventListener("change",()=>{d&&(d.style.display=o.value==="custom"?"block":"none")}),e.querySelector("#pm-preview-auto-settle")?.addEventListener("click",async()=>{try{v(e,"Previewing protected-state checks...");let p=(await y("/api/settings/auto-settle/preview",{method:"POST",body:JSON.stringify({})}))?.summary||{};v(e,`${Number(p.wouldSettle||0)} eligible \xB7 ${Number(p.scanned||0)} scanned.`,"ok")}catch(i){v(e,i.message,"error")}}),e.querySelector("#pm-save-auto-settle")?.addEventListener("click",async()=>{let i=o?.value||"0",p={afterDays:i==="custom"?"custom":Number(i),activationMode:"start_now"};if(i==="custom"){if(p.customDate=l(e,"pm-auto-settle-custom-date"),!p.customDate){v(e,"Choose a custom cutoff date first.","error");return}let u=new Date(`${p.customDate}T00:00:00`);if(p.customDateOffsetMinutes=Number.isFinite(u.getTime())?u.getTimezoneOffset():new Date().getTimezoneOffset(),p.activationMode=await be(),!p.activationMode)return}try{await y("/api/settings/session",{method:"POST",body:JSON.stringify({autoSettle:p})}),v(e,"Auto-settle settings saved.","ok"),await re(t,e)}catch(u){v(e,u.message,"error")}})}async function ie(t,e){let[s,n,r]=await Promise.all([y("/api/settings/provider"),y("/api/settings/session").catch(()=>null),W().catch(()=>null),le()]),c=s?.llm||{},o=c.provider||"ollama",d=ue(c),i=c.providers?.[o]||{},p=n?.session||{};t.innerHTML=`
    ${f("Runtime",`<div class="pm-settings-kv">
      <span>Current model</span><strong>${h(r?.currentModel||i.model||"Unknown")}</strong>
      <span>Provider</span><strong>${h(te(o))}</strong>
      <span>Status</span><strong>${r?.providerOnline?"Online":"Unknown"}</strong>
    </div>`,"brain")}
    ${f("Provider",`
      ${a("Active provider",b("pm-set-provider",d.map(u=>({value:u,label:te(u)})),o))}
      <div id="pm-provider-fields">${se(o,i)}</div>
      <div class="pm-row-buttons">
        <button class="pm-btn" id="pm-refresh-models">${g.refresh} Refresh Models</button>
        <button class="pm-btn" id="pm-test-model">${g.refresh} Test</button>
        <button class="pm-btn primary" id="pm-save-model">${g.check} Save</button>
      </div>
      <div id="pm-settings-live-status"></div>
    `,"gear","pm-card-strong")}
    ${Y(p.contextProfile,p.contextBudget,"mobile-context")}
    ${f("Context Compaction",`
      <div class="pm-card-body">Prometheus uses the selected model's token window automatically. Context is compacted only when token pressure requires it; message count does not define model context.</div>
      ${w("pm-session-roll","Rolling compaction",p.rollingCompactionEnabled!==!1,"Automatically summarize older active context when token pressure requires it.")}
      ${a("Busy composer",`<select id="pm-session-busy-mode">
        <option value="queue"${p.busyComposerMode==="steer"?"":" selected"}>Queue (run after current)</option>
        <option value="steer"${p.busyComposerMode==="steer"?" selected":""}>Steer (send into current run)</option>
      </select>`,"When you send a message while Prometheus is busy: queue it for the next turn, or steer it into the active run.")}
      ${w("pm-session-compact-auto","Use selected context window",p.compactionThreshold==="auto"||p.compactionThreshold==null,"Automatic sizing reserves output, reasoning and one estimation margin. Turn off to use a manual earlier threshold.")}
      ${a("Manual compaction threshold",m("pm-session-compact",typeof p.compactionThreshold=="number"?p.compactionThreshold:.7,'type="number" min="0.4" max="0.95" step="0.01"'))}
      ${a("Memory flush threshold",m("pm-session-memory",p.memoryFlushThreshold||.9,'type="number" min="0.5" max="0.98" step="0.01"'))}
      ${a("Rolling tool turns",m("pm-session-tool-turns",p.rollingCompactionToolTurns||4,'type="number" min="1" max="12"'))}
      <div class="pm-card-body">Summary length is adaptive. Compaction preserves requests, decisions, pending work and recovery references; there is no fixed 900-word cutoff.</div>
      ${a("Compaction model override",m("pm-session-model",p.rollingCompactionModel||"",'placeholder="Optional"'))}
      <button class="pm-btn primary" id="pm-save-session">${g.check} Save compaction</button>
    `,"clipboard")}
  `,P(e),e.querySelector("#pm-set-provider")?.addEventListener("change",()=>{let u=l(e,"pm-set-provider"),$=c.providers?.[u]||{},S=e.querySelector("#pm-provider-fields");S&&(S.innerHTML=se(u,$)),P(e)}),e.querySelector("#pm-refresh-models")?.addEventListener("click",async()=>{v(e,"Loading models...");try{let u=q(e,c),$=u.provider,S=await y("/api/models/test",{method:"POST",body:JSON.stringify({llm:u})}),k=(S.models||[]).map(T=>typeof T=="string"?T:T.name||String(T)).filter(Boolean),E=e.querySelector(`#${CSS.escape(R($))}`);if(E&&k.length&&E.tagName==="SELECT"){let T=E.value;E.innerHTML=A($,k).map(j=>`<option value="${h(j.value)}">${h(j.label)}</option>`).join(""),T&&k.includes(T)&&(E.value=T)}v(e,k.length?`${k.length} model(s) found.`:S.error||"No models found.",k.length?"ok":"warn")}catch(u){v(e,u.message,"error")}}),e.querySelector("#pm-test-model")?.addEventListener("click",async()=>{v(e,"Testing provider...");try{let u=q(e,c),$=await y("/api/models/test",{method:"POST",body:JSON.stringify({llm:u})});v(e,$.success?`Connected. ${Array.isArray($.models)?$.models.length:0} models returned.`:$.error||"Could not connect",$.success?"ok":"warn")}catch(u){v(e,u.message,"error")}}),e.querySelector("#pm-save-model")?.addEventListener("click",async()=>{v(e,"Saving model settings...");try{let u=q(e,c);await y("/api/settings/provider",{method:"POST",body:JSON.stringify({llm:u})}),v(e,"Model settings saved.","ok")}catch(u){v(e,u.message,"error")}}),Q(e,p.contextProfile,u=>y("/api/settings/context-window",{method:"POST",body:JSON.stringify(u)}),()=>ie(t,e),"mobile-context"),e.querySelector("#pm-save-session")?.addEventListener("click",async()=>{try{await y("/api/settings/session",{method:"POST",body:JSON.stringify({rollingCompactionEnabled:x(e,"pm-session-roll"),compactionThreshold:x(e,"pm-session-compact-auto")?"auto":Number(l(e,"pm-session-compact")),compactionThresholdMode:x(e,"pm-session-compact-auto")?"auto":"manual",memoryFlushThreshold:Number(l(e,"pm-session-memory")),rollingCompactionToolTurns:Number(l(e,"pm-session-tool-turns")),rollingCompactionModel:l(e,"pm-session-model"),busyComposerMode:l(e,"pm-session-busy-mode")==="steer"?"steer":"queue"})}),B(l(e,"pm-session-busy-mode")==="steer"?"steer":"queue"),v(e,"Compaction settings saved.","ok")}catch(u){v(e,u.message,"error")}})}function q(t,e){let s=l(t,"pm-set-provider")||e.provider||"ollama",n={...e.providers||{}};n[s]={...n[s]||{}};let r=n[s],c=l(t,R(s));c&&(r.model=c);let o=l(t,ae(s));o?r.endpoint=o:delete r.endpoint;let d=l(t,de(s));d&&(r.api_key=d);let i=l(t,ce(s));if(i&&F(s,r.model,i)?r.reasoning_effort=i:delete r.reasoning_effort,s==="anthropic"){r.extended_thinking=x(t,"pm-anthropic-thinking");let u=Number(l(t,"pm-anthropic-budget"));u&&(r.thinking_budget=u)}let p=l(t,`pm-speed-${s}`);return L(s,r.model)?r.speed=p==="fast"?"fast":"standard":delete r.speed,delete r.fast_mode,{...e,provider:s,providers:n}}function R(t){return`pm-model-${t}`}function ae(t){return`pm-endpoint-${t}`}function de(t){return`pm-key-${t}`}function ce(t){return`pm-effort-${t}`}function se(t,e={}){let s=R(t),n=ae(t),r=de(t),c=ce(t);if(t==="ollama")return`
      ${a("Endpoint",m(n,e.endpoint||"http://localhost:11434"))}
      ${a("Active Model",m(s,e.model||"",'placeholder="qwen3:4b"'))}
    `;if(t==="llama_cpp")return`${a("Endpoint",m(n,e.endpoint||"http://localhost:8080"))}${a("Model name",m(s,e.model||"",'placeholder="qwen2.5-7b"'))}`;if(t==="lm_studio")return`${a("Endpoint",m(n,e.endpoint||"http://localhost:1234"))}${a("Model name",m(s,e.model||"",'placeholder="qwen2.5-7b-instruct"'))}`;if(t==="openai"){let o=M(t,e.model||"gpt-5.5").map(d=>({value:d,label:d||"provider default"}));return`
      ${a("API Key",m(r,e.api_key||"",'type="password" placeholder="sk-..."'))}
      ${a("Model",b(s,A(t,C(t,e.model||"gpt-5.5")),e.model||"gpt-5.5"))}
      ${o.length>1?a("Reasoning Effort",b(c,o,e.reasoning_effort||"")):""}
      ${L(t,e.model||"gpt-5.5")?a("Speed",b(`pm-speed-${t}`,[{value:"standard",label:"Standard"},{value:"fast",label:"Fast"}],e.speed||(e.fast_mode===!0?"fast":"standard"))):""}
    `}if(t==="openai_codex"){let o=M(t,e.model||"gpt-5.5").map(d=>({value:d,label:d||"provider default"}));return`
      ${a("Model",b(s,A(t,C(t,e.model||"gpt-5.5")),e.model||"gpt-5.5"))}
      ${a("Reasoning Effort",b(c,o,e.reasoning_effort||""))}
      ${L(t,e.model||"gpt-5.5")?a("Speed",b(`pm-speed-${t}`,[{value:"standard",label:"Standard"},{value:"fast",label:"Fast"}],e.speed||(e.fast_mode===!0?"fast":"standard"))):""}
      <div class="pm-settings-callout">Connect or disconnect the ChatGPT account from Credentials/Auth controls on desktop if OAuth needs renewal.</div>
    `}if(t==="anthropic"){let o=J(t,e.model||"claude-sonnet-5"),d=M(t,e.model||"claude-sonnet-5").map(i=>({value:i,label:i||"provider default"}));return`
      ${a("Model",b(s,A(t,C(t,e.model||"claude-sonnet-5")),e.model||"claude-sonnet-5"))}
      ${d.length>1?a("Thinking Effort",b(c,d,e.reasoning_effort||"")):""}
      ${w("pm-anthropic-thinking","Extended thinking",e.extended_thinking===!0)}
      ${L(t,e.model||"claude-sonnet-5")?a("Speed",b(`pm-speed-${t}`,[{value:"standard",label:"Standard"},{value:"fast",label:"Fast"}],e.speed||(e.fast_mode===!0?"fast":"standard"))):""}
      ${o.thinkingMode==="manual"?a("Thinking Budget",b("pm-anthropic-budget",["2048","5000","10000","16000","24000","32000"],String(e.thinking_budget||"10000"))):""}
    `}if(t==="perplexity")return`${a("API Key",m(r,e.api_key||"",'type="password" placeholder="pplx-..."'))}${a("Model",b(s,A(t,C(t,e.model||"sonar-pro")),e.model||"sonar-pro"))}${a("Reasoning Effort",b(c,["","low","medium","high"].map(o=>({value:o,label:o||"provider default"})),e.reasoning_effort||""))}`;if(t==="xai"){let d=(/^grok-4\.20-multi-agent(?:-|$)/i.test(String(e.model||"").trim())?["","low","medium","high","xhigh"]:["","low","medium","high"]).map(i=>({value:i,label:i==="xhigh"?"extra high":i||"provider default"}));return`${a("API Key",m(r,e.api_key||"",'type="password" placeholder="xai-..."'))}${a("Model",b(s,A(t,C(t,e.model||"grok-4.3")),e.model||"grok-4.3"))}${a("Reasoning Effort",b(c,d,e.reasoning_effort||""))}${a("Endpoint",m(n,e.endpoint||"",'placeholder="https://api.x.ai/v1"'))}`}return t==="gemini"?`${a("API Key",m(r,e.api_key||"",'type="password" placeholder="AIza..."'))}${a("Model",b(s,A(t,C(t,e.model||"gemini-2.5-pro")),e.model||"gemini-2.5-pro"))}`:`${a("Model",m(s,e.model||"",'placeholder="Provider model"'))}${a("Endpoint",m(n,e.endpoint||"",'placeholder="Optional endpoint"'))}`}async function D(t,e){let[s,n,r]=await Promise.all([y("/api/settings/search").catch(()=>({})),y("/api/credentials/status").catch(()=>({keys:[]})),y("/api/credentials/audit").catch(()=>({lines:[]}))]),c=(Array.isArray(s.providers)?s.providers:[]).filter(o=>!o.builtin&&o.field);t.innerHTML=`
    ${f("Search Provider Keys",`
      <div class="pm-card-body" style="margin-bottom:10px;">Stored encrypted in the vault. Masked values keep the existing key.</div>
      ${m("pm-cred-filter","",'type="search" placeholder="Search providers (e.g. Exa, Google, free)" autocomplete="off" aria-label="Search providers"')}
      ${a("TinyFish API Key",m("pm-cred-tinyfish",s.tinyfish_api_key||"",'type="password" placeholder="tf-..." autocomplete="new-password"'))}
      ${a("Tavily API Key",m("pm-cred-tavily",s.tavily_api_key||"",'type="password" placeholder="tvly-..." autocomplete="new-password"'))}
      ${a("Google API Key",m("pm-cred-google",s.google_api_key||"",'type="password" placeholder="AIza..." autocomplete="new-password"'))}
      ${a("Google CSE ID",m("pm-cred-google-cx",s.google_cx||"",'placeholder="Custom search engine ID"'),"Stored for persistence; leave as-is to keep current value.")}
      ${a("Brave API Key",m("pm-cred-brave",s.brave_api_key||"",'type="password" placeholder="BSA..." autocomplete="new-password"'))}
      ${c.map(o=>`<div data-provider-search="${h(`${o.label} ${o.id} ${o.freeTier||""} ${o.description||""}`.toLowerCase())}">${a(`${o.label} ${o.kind==="url"?"URL":"API Key"}${o.configured?" \u2713":""}`,m(`pm-cred-extra-${o.id}`,s[o.field]||"",o.kind==="url"?`placeholder="${h(o.placeholder||"")}" autocomplete="off"`:`type="password" placeholder="${h(o.placeholder||"")}" autocomplete="new-password"`),o.freeTier||"")}${o.signupUrl?`<a class="pm-settings-link" href="${h(o.signupUrl)}" target="_blank" rel="noopener" style="display:inline-block;margin:-4px 0 10px;font-size:12px;">${o.kind==="url"?"Setup guide":"Get key"} \u2197</a>`:""}</div>`).join("")}
      <div class="pm-settings-callout" id="pm-cred-filter-empty" hidden>No providers match.</div>
      <button class="pm-btn primary" id="pm-save-creds">${g.check} Save credentials</button>
      <div id="pm-settings-live-status"></div>
    `,"gear","pm-card-strong")}
    ${f("Vault Status",`<div class="pm-settings-list">
      ${(n.keys||[]).map(o=>`<div class="pm-settings-row"><span><strong>${h($e(o))}</strong><em>${h(o)}</em></span><span class="pm-pill active">stored</span></div>`).join("")||'<div class="pm-card-body">No credentials stored yet.</div>'}
    </div>`,"check")}
    ${f("How Credentials Work",'<div class="pm-card-body">When saved, keys are encrypted with AES-256-GCM and referenced from config as vault entries. If a field shows bullets, a key is already stored.</div>',"clipboard")}
    ${f("Recent Vault Access",`<div class="pm-settings-log">${(r.lines||[]).slice(-18).reverse().map(o=>`<div>${h(o)}</div>`).join("")||"<div>No audit entries yet.</div>"}</div>
      <button class="pm-btn" id="pm-refresh-creds">${g.refresh} Refresh</button>`,"clipboard")}
  `;for(let[o,d]of[["pm-cred-tinyfish","tinyfish"],["pm-cred-tavily","tavily free"],["pm-cred-google","google cse free"],["pm-cred-google-cx","google cse id"],["pm-cred-brave","brave"]]){let i=e.querySelector(`#${o}`)?.closest(".pm-field, label, div");i&&!i.hasAttribute("data-provider-search")&&i.setAttribute("data-provider-search",d)}e.querySelector("#pm-cred-filter")?.addEventListener("input",o=>{let d=String(o.target.value||"").trim().toLowerCase(),i=0;e.querySelectorAll("[data-provider-search]").forEach(u=>{let $=!d||d.split(/\s+/).every(S=>u.getAttribute("data-provider-search").includes(S));u.hidden=!$,$&&(i+=1)});let p=e.querySelector("#pm-cred-filter-empty");p&&(p.hidden=i>0)}),e.querySelector("#pm-refresh-creds")?.addEventListener("click",()=>D(t,e)),e.querySelector("#pm-save-creds")?.addEventListener("click",async()=>{try{await y("/api/settings/search",{method:"POST",body:JSON.stringify({preferred_provider:s.preferred_provider||"tavily",search_rigor:s.search_rigor||"verified",tinyfish_api_key:l(e,"pm-cred-tinyfish"),tavily_api_key:l(e,"pm-cred-tavily"),google_api_key:l(e,"pm-cred-google"),google_cx:l(e,"pm-cred-google-cx"),brave_api_key:l(e,"pm-cred-brave"),...Object.fromEntries(c.map(o=>[o.field,l(e,`pm-cred-extra-${o.id}`)]))})}),v(e,"Credentials saved.","ok"),await D(t,e)}catch(o){v(e,o.message,"error")}})}function $e(t){return{"search.tavily_api_key":"Tavily API Key","search.tinyfish_api_key":"TinyFish API Key","search.google_api_key":"Google API Key","search.google_cx":"Google CSE ID","search.brave_api_key":"Brave API Key","llm.openai.api_key":"OpenAI API Key","hooks.token":"Webhook Token","channels.telegram.botToken":"Telegram Token","channels.discord.botToken":"Discord Token"}[t]||t}async function ke(t,e){let s=await y("/api/settings/search");t.innerHTML=`
    ${f("Web Search",`
      ${a("Preferred provider",b("pm-search-provider",Array.isArray(s.providers)&&s.providers.length?s.providers.map(n=>({value:n.id,label:`${n.label}${n.configured?"":" (no key)"}`})):["tavily","tinyfish","google","brave","ddg"],s.preferred_provider||"tavily"))}
      <div class="pm-settings-callout">API keys are managed in the Credentials tab and stored encrypted.</div>
      <button class="pm-btn primary" id="pm-save-search">${g.check} Save search provider</button>
      <div id="pm-settings-live-status"></div>
    `,"target","pm-card-strong")}
  `,e.querySelector("#pm-save-search")?.addEventListener("click",async()=>{try{await y("/api/settings/search",{method:"POST",body:JSON.stringify({preferred_provider:l(e,"pm-search-provider"),search_rigor:s.search_rigor||"verified",tavily_api_key:s.tavily_api_key||"",tinyfish_api_key:s.tinyfish_api_key||"",google_api_key:s.google_api_key||"",google_cx:s.google_cx||"",brave_api_key:s.brave_api_key||""})}),v(e,"Search settings saved.","ok")}catch(n){v(e,n.message,"error")}})}async function Se(t,e){let n=(await y("/api/settings/heartbeat")).heartbeat||{};t.innerHTML=f("Heartbeat",`
    ${w("pm-hb-enabled","Enabled",n.enabled!==!1,"Allow Prometheus to wake itself for background work.")}
    ${a("Interval minutes",m("pm-hb-interval",n.interval_minutes||30,'type="number" min="1" max="1440"'))}
    ${a("Model override",m("pm-hb-model",n.model||"",'placeholder="Optional"'))}
    ${w("pm-hb-review","Review teams after run",n.review_teams_after_run===!0)}
    ${a("Instructions",I("pm-hb-instructions",n.instructions||"",'rows="10"'))}
    <button class="pm-btn primary" id="pm-save-heartbeat">${g.check} Save heartbeat</button>
    <div id="pm-settings-live-status"></div>
  `,"clock","pm-card-strong"),P(e),e.querySelector("#pm-save-heartbeat")?.addEventListener("click",async()=>{try{await y("/api/settings/heartbeat",{method:"POST",body:JSON.stringify({enabled:x(e,"pm-hb-enabled"),interval_minutes:Number(l(e,"pm-hb-interval")),model:l(e,"pm-hb-model"),review_teams_after_run:x(e,"pm-hb-review"),instructions:e.querySelector("#pm-hb-instructions")?.value||""})}),v(e,"Heartbeat settings saved.","ok")}catch(r){v(e,r.message,"error")}})}async function we(t,e){let s=await y("/api/settings/paths").catch(()=>({})),r=(await y("/api/browser/chrome-signin-sync").catch(()=>null))?.enabled===!0;t.innerHTML=`
    ${f("Chrome sign-ins",`
      <div class="pm-card-body">When on, opening a site copies that site's sign-in from your paired Personal Chrome. Cookie values stay on your computer.</div>
      ${w("pm-chrome-signin-sync","Always use my Chrome sign-ins",r)}
      <div id="pm-chrome-signin-status" class="pm-settings-status muted">${r?"On: opening a site copies its Chrome sign-in.":"Off."}</div>
    `,"check")}
    ${f("File Access",`
      ${a("Workspace Path",m("pm-sec-workspace",s.workspace_path||"",'placeholder="%APPDATA%\\\\Prometheus\\\\workspace"'))}
      ${a("Allowed Paths (one per line)",I("pm-sec-allowed",(s.allowed_paths||[]).join(`
`),'rows="6"'))}
      ${a("Blocked Paths (one per line)",I("pm-sec-blocked",(s.blocked_paths||[]).join(`
`),'rows="5"'))}
      <button class="pm-btn primary" id="pm-save-security">${g.check} Save file access</button>
      <div id="pm-settings-live-status"></div>
    `,"check","pm-card-strong")}
  `;let c=e.querySelector("#pm-chrome-signin-sync");c?.addEventListener("click",async()=>{let o=!c.classList.contains("on"),d=e.querySelector("#pm-chrome-signin-status");c.disabled=!0;try{let p=(await y("/api/browser/chrome-signin-sync",{method:"POST",body:JSON.stringify({enabled:o})}))?.enabled===!0;c.classList.toggle("on",p),c.setAttribute("aria-pressed",p?"true":"false"),d&&(d.textContent=p?"On: opening a site copies its Chrome sign-in.":"Off.")}catch(i){d&&(d.textContent=`Could not save: ${i.message}`)}finally{c.disabled=!1}}),e.querySelector("#pm-save-security")?.addEventListener("click",async()=>{try{await y("/api/settings/paths",{method:"POST",body:JSON.stringify({workspace_path:l(e,"pm-sec-workspace"),allowed_paths:ee(e.querySelector("#pm-sec-allowed")?.value||""),blocked_paths:ee(e.querySelector("#pm-sec-blocked")?.value||"")})}),v(e,"File access settings saved.","ok")}catch(o){v(e,o.message,"error")}})}async function O(t,e){let[s,n]=await Promise.all([y("/api/agents").catch(()=>({agents:[]})),y("/api/settings/agent-model-defaults").catch(()=>({defaults:{}}))]),r=s.agents||s.items||[],c=n.defaults||{},o=["main_chat","proposal_executor_high_risk","proposal_executor_low_risk","coordinator","manager","subagent_planner","subagent_orchestrator","subagent_researcher","subagent_analyst","subagent_builder","subagent_operator"],d=r.find(i=>String(i.id)===String(e._pmSelectedAgentId))||r.find(i=>i.id==="main")||r[0]||{};t.innerHTML=`
    ${f("Model Defaults",`
      ${o.map(i=>a(i.replace(/_/g," "),m(`pm-agent-def-${i}`,c[i]||"",'placeholder="Provider/model"'))).join("")}
      <button class="pm-btn primary" id="pm-save-agent-defaults">${g.check} Save defaults</button>
      <div id="pm-settings-live-status"></div>
    `,"brain","pm-card-strong")}
    ${f("Configured Agents",`<div class="pm-settings-list">${r.map(i=>`<button class="pm-settings-row pm-settings-row-button ${String(i.id)===String(d.id)?"active":""}" data-agent-id="${h(i.id)}">
      <span><strong>${h(i.name||i.id)}</strong><em>${h(i.description||i.model||i.status||"")}</em></span>
      <span class="pm-pill ${i.enabled===!1?"gray":"active"}">${i.enabled===!1?"off":"on"}</span>
    </button>`).join("")||'<div class="pm-card-body">No agents found.</div>'}</div>
      <button class="pm-btn" id="pm-new-agent" style="margin-top:10px;">${g.plus} New Agent</button>`,"robot")}
    ${ne(d)}
  `,e.querySelectorAll("[data-agent-id]").forEach(i=>i.addEventListener("click",async()=>{e._pmSelectedAgentId=i.getAttribute("data-agent-id"),await O(t,e)})),e.querySelector("#pm-new-agent")?.addEventListener("click",()=>{e._pmSelectedAgentId="";let i=e.querySelector("#pm-agent-editor");i&&(i.innerHTML=ne({id:"",name:"",description:"",workspace:"",maxSteps:8,default:!1},!0)),oe(e,t)}),oe(e,t,d),e.querySelector("#pm-save-agent-defaults")?.addEventListener("click",async()=>{try{let i={};o.forEach(p=>{i[p]=l(e,`pm-agent-def-${p}`)}),await y("/api/settings/agent-model-defaults",{method:"POST",body:JSON.stringify(i)}),v(e,"Agent defaults saved.","ok")}catch(i){v(e,i.message,"error")}})}function ne(t={},e=!1){return`<div id="pm-agent-editor">${f("Agent Details",`
    ${a("ID",m("pm-agent-id",t.id||"",`${e?"":"readonly"} placeholder="researcher"`))}
    ${a("Name",m("pm-agent-name",t.name||"",'placeholder="Scout"'))}
    ${a("Description",I("pm-agent-description",t.description||"",'rows="3"'))}
    ${a("Workspace",m("pm-agent-workspace",t.workspace||"",'placeholder="%APPDATA%\\\\Prometheus\\\\workspace\\\\agents\\\\researcher"'))}
    ${a("Model",m("pm-agent-model",t.model||"",'placeholder="provider/model or blank for default"'))}
    ${a("Max Steps",m("pm-agent-max-steps",t.maxSteps||t.max_steps||8,'type="number" min="1" step="1"'))}
    ${w("pm-agent-default","Default agent",t.default===!0)}
    <div class="pm-row-buttons">
      <button class="pm-btn primary" id="pm-save-agent">${g.check} Save Agent</button>
      ${t.id&&t.id!=="main"?`<button class="pm-btn ghost" id="pm-delete-agent">${g.trash} Delete</button>`:""}
    </div>
  `,"robot","pm-card-strong")}
  ${t.id&&t.id!=="main"?f("Manual Spawn + Run History",`
    ${a("Task",I("pm-agent-task","",'rows="3" placeholder="Run a one-off task for this agent..."'))}
    <div class="pm-row-buttons">
      <button class="pm-btn primary" id="pm-run-agent">${g.play} Run Once</button>
      <button class="pm-btn" id="pm-agent-history">${g.refresh} Refresh History</button>
    </div>
    <div id="pm-agent-run-output" class="pm-settings-log" style="margin-top:10px;"></div>
  `,"play"):""}</div>`}function oe(t,e){P(t),t.querySelector("#pm-save-agent")?.addEventListener("click",async()=>{let s=l(t,"pm-agent-id");if(!s)return v(t,"Agent ID is required.","error");let n={id:s,name:l(t,"pm-agent-name"),description:t.querySelector("#pm-agent-description")?.value||"",workspace:l(t,"pm-agent-workspace"),model:l(t,"pm-agent-model"),maxSteps:Number(l(t,"pm-agent-max-steps"))||8,default:x(t,"pm-agent-default")};try{let r=!!t._pmSelectedAgentId;await y(r?`/api/agents/${encodeURIComponent(s)}`:"/api/agents",{method:r?"PUT":"POST",body:JSON.stringify({agent:n})}),t._pmSelectedAgentId=s,v(t,"Agent saved.","ok"),await O(e,t)}catch(r){v(t,r.message,"error")}}),t.querySelector("#pm-delete-agent")?.addEventListener("click",async()=>{let s=l(t,"pm-agent-id");if(!(!s||!window.confirm(`Delete agent "${s}"?`)))try{await y(`/api/agents/${encodeURIComponent(s)}`,{method:"DELETE"}),t._pmSelectedAgentId="",await O(e,t)}catch(n){v(t,n.message,"error")}}),t.querySelector("#pm-run-agent")?.addEventListener("click",async()=>{let s=l(t,"pm-agent-id"),n=String(t.querySelector("#pm-agent-task")?.value||"").trim(),r=t.querySelector("#pm-agent-run-output");if(!n)return v(t,"Provide a task first.","error");r&&(r.innerHTML="<div>Running...</div>");try{let c=await y(`/api/agents/${encodeURIComponent(s)}/spawn`,{method:"POST",body:JSON.stringify({task:n})});r&&(r.innerHTML=`<div>${h(JSON.stringify(c.result||c,null,2)).replace(/\n/g,"<br>")}</div>`)}catch(c){r&&(r.innerHTML=`<div>${h(c.message)}</div>`)}}),t.querySelector("#pm-agent-history")?.addEventListener("click",async()=>{let s=l(t,"pm-agent-id"),n=t.querySelector("#pm-agent-run-output");try{let r=await y(`/api/agents/history?agentId=${encodeURIComponent(s)}&limit=12`);n&&(n.innerHTML=(r.history||[]).map(c=>`<div><strong>${h(c.success?"success":"failed")}</strong> ${h(c.trigger||"manual")}<br><em>${h(c.resultPreview||c.error||"")}</em></div>`).join("")||"<div>No runs yet.</div>")}catch(r){n&&(n.innerHTML=`<div>${h(r.message)}</div>`)}})}async function xe(t,e){let s=await y("/api/channels/status"),n=s.telegram||{},r=s.discord||{},c=s.whatsapp||{};t.innerHTML=`
    ${f("Channel Connection",`
      ${a("Channel",b("pm-channel-select",[{value:"telegram",label:"Telegram"},{value:"discord",label:"Discord"},{value:"whatsapp",label:"WhatsApp"}],"telegram"))}
      <div id="pm-channel-status-card"></div>
      <div id="pm-channel-form"></div>
      <div class="pm-row-buttons">
        <button class="pm-btn" id="pm-channel-test">${g.refresh} Test</button>
        <button class="pm-btn primary" id="pm-channel-save">${g.check} Save</button>
        <button class="pm-btn" id="pm-channel-send">${g.send} Send Test</button>
      </div>
      <div id="pm-settings-live-status"></div>
    `,"send","pm-card-strong")}
    ${f("Instructions",'<div id="pm-channel-guide" class="pm-card-body"></div>',"clipboard")}
  `;let o=()=>Te(e,{telegram:n,discord:r,whatsapp:c});e.querySelector("#pm-channel-select")?.addEventListener("change",o),o(),e.querySelector("#pm-channel-save")?.addEventListener("click",async()=>{let d=l(e,"pm-channel-select")||"telegram";try{await y("/api/channels/config",{method:"POST",body:JSON.stringify({channels:{[d]:N(e,d)}})}),v(e,`${d} settings saved.`,"ok")}catch(i){v(e,i.message,"error")}}),e.querySelector("#pm-channel-test")?.addEventListener("click",async()=>{let d=l(e,"pm-channel-select")||"telegram";try{let i=await y(`/api/channels/test/${d}`,{method:"POST",body:JSON.stringify(N(e,d))});v(e,i.success?`${d} connection test passed.`:i.error||`${d} test failed.`,i.success?"ok":"error")}catch(i){v(e,i.message,"error")}}),e.querySelector("#pm-channel-send")?.addEventListener("click",async()=>{let d=l(e,"pm-channel-select")||"telegram";try{let i=await y(`/api/channels/send-test/${d}`,{method:"POST",body:JSON.stringify(N(e,d))});v(e,i.success?`Test message sent via ${d}.`:i.error||"Send test failed.",i.success?"ok":"error")}catch(i){v(e,i.message,"error")}})}function Te(t,e){let s=l(t,"pm-channel-select")||"telegram",n=e[s]||{},r=t.querySelector("#pm-channel-status-card"),c=t.querySelector("#pm-channel-form"),o=t.querySelector("#pm-channel-guide");r&&(r.innerHTML=`<div class="pm-settings-channel">
    <div><strong>${h(s[0].toUpperCase()+s.slice(1))}</strong><span>${n.enabled?"Enabled":"Disabled"}${n.connected?" \xB7 connected":""}</span></div>
    <span class="pm-pill ${n.enabled?"active":"gray"}">${n.enabled?"on":"off"}</span>
  </div>`),s==="telegram"&&c?(c.innerHTML=`
      ${a("Bot Token",m("pm-ch-token","",`type="password" placeholder="${n.hasToken?"\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022 (saved)":"123456:ABC-DEF1234..."}"`))}
      ${a("Your Telegram User ID(s)",m("pm-ch-userids",(n.allowedUserIds||[]).join(", "),'placeholder="123456789, 987654321"'))}
      ${w("pm-ch-enabled","Enable Telegram channel",n.enabled===!0)}
    `,o&&(o.innerHTML="Create a bot with BotFather, paste the token, add allowed user IDs, then Test, Save, and Send Test.")):s==="discord"&&c?(c.innerHTML=`
      ${a("Bot Token",m("pm-ch-token","",`type="password" placeholder="${n.hasToken?"\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022 (saved)":"Discord bot token"}"`))}
      ${a("Application ID (optional)",m("pm-ch-appid",n.applicationId||""))}
      ${a("Guild ID (optional)",m("pm-ch-guildid",n.guildId||""))}
      ${a("Channel ID (for send-test)",m("pm-ch-channelid",n.channelId||""))}
      ${a("Webhook URL (optional)",m("pm-ch-webhook","",`type="password" placeholder="${n.hasWebhook?"\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022 (saved)":"https://discord.com/api/webhooks/..."}"`))}
      ${w("pm-ch-enabled","Enable Discord channel",n.enabled===!0)}
    `,o&&(o.innerHTML="Create an app and bot in Discord Developer Portal, invite it to your server, then Test, Save, and Send Test.")):c&&(c.innerHTML=`
      ${a("Access Token",m("pm-ch-token","",`type="password" placeholder="${n.hasAccessToken?"\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022 (saved)":"Meta access token"}"`))}
      ${a("Phone Number ID",m("pm-ch-phoneid",n.phoneNumberId||""))}
      ${a("Business Account ID (optional)",m("pm-ch-baid",n.businessAccountId||""))}
      ${a("Webhook Verify Token (optional)",m("pm-ch-verify","",`type="password" placeholder="${n.verifyTokenSet?"\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022 (saved)":"Verify token"}"`))}
      ${a("Webhook Secret (optional)",m("pm-ch-secret","",`type="password" placeholder="${n.webhookSecretSet?"\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022 (saved)":"Webhook secret"}"`))}
      ${a("Test Recipient (E.164)",m("pm-ch-recipient",n.testRecipient||"",'placeholder="15551234567"'))}
      ${w("pm-ch-enabled","Enable WhatsApp channel",n.enabled===!0)}
    `,o&&(o.innerHTML="Copy WhatsApp Cloud API credentials from Meta Developer dashboard, configure optional webhook fields, then Test, Save, and Send Test.")),P(t)}function N(t,e){let s=x(t,"pm-ch-enabled");return e==="telegram"?{enabled:s,botToken:l(t,"pm-ch-token"),allowedUserIds:pe(l(t,"pm-ch-userids"))}:e==="discord"?{enabled:s,botToken:l(t,"pm-ch-token"),applicationId:l(t,"pm-ch-appid"),guildId:l(t,"pm-ch-guildid"),channelId:l(t,"pm-ch-channelid"),webhookUrl:l(t,"pm-ch-webhook")}:{enabled:s,accessToken:l(t,"pm-ch-token"),phoneNumberId:l(t,"pm-ch-phoneid"),businessAccountId:l(t,"pm-ch-baid"),verifyToken:l(t,"pm-ch-verify"),webhookSecret:l(t,"pm-ch-secret"),testRecipient:l(t,"pm-ch-recipient")}}async function _e(t,e){let[s,n,r]=await Promise.all([y("/api/settings/hooks").catch(()=>null),y("/api/mcp/servers").catch(()=>({servers:[]})),y("/api/extensions/catalog").catch(()=>({items:[],extensions:[]}))]),c=n.servers||[],o=r.items||r.extensions||r.catalog||[];t.innerHTML=`
    ${f("Webhooks",`
      ${w("pm-hooks-enabled","Enabled",s?.hooks?.enabled||s?.enabled||!1)}
      ${a("Secret Token",m("pm-hooks-token",s?.hooks?.token||s?.token||"",'type="password" placeholder="Paste or generate a secret token"'))}
      ${a("Path",m("pm-hooks-path",s?.hooks?.path||s?.path||"/hooks/prometheus"))}
      <div class="pm-row-buttons">
        <button class="pm-btn" id="pm-generate-hooks">${g.refresh} Generate</button>
        <button class="pm-btn" id="pm-test-hooks">${g.refresh} Test</button>
        <button class="pm-btn primary" id="pm-save-hooks">${g.check} Save</button>
      </div>
      <div id="pm-settings-live-status"></div>
    `,"paperclip","pm-card-strong")}
    ${f("MCP Servers",`<div class="pm-settings-list">${c.map(d=>`<div class="pm-settings-row">
      <span><strong>${h(d.name||d.id)}</strong><em>${h(d.status||"disconnected")} \xB7 ${h(String(d.toolCount||0))} tools</em></span>
    </div>`).join("")||'<div class="pm-card-body">No MCP servers configured.</div>'}</div>`,"monitor")}
    ${f("Extensions",`<div class="pm-settings-chip-row">${o.slice(0,20).map(d=>`<span class="pm-pill gray">${h(d.name||d.id||d.title||"Extension")}</span>`).join("")||'<span class="pm-card-body">No extensions found.</span>'}</div>`,"spark")}
  `,P(e),e.querySelector("#pm-generate-hooks")?.addEventListener("click",()=>{let d=new Uint8Array(24);crypto.getRandomValues(d);let i=Array.from(d).map(u=>u.toString(16).padStart(2,"0")).join(""),p=e.querySelector("#pm-hooks-token");p&&(p.value=i,p.type="text")}),e.querySelector("#pm-save-hooks")?.addEventListener("click",async()=>{try{await y("/api/settings/hooks",{method:"POST",body:JSON.stringify({enabled:x(e,"pm-hooks-enabled"),token:l(e,"pm-hooks-token"),path:l(e,"pm-hooks-path")})}),v(e,"Webhook settings saved. Restart gateway to apply endpoint changes.","ok")}catch(d){v(e,d.message,"error")}}),e.querySelector("#pm-test-hooks")?.addEventListener("click",async()=>{try{let d=await y("/api/settings/hooks/test",{method:"POST",body:"{}"});v(e,d.success?"Webhook test sent.":d.error||"Webhook test failed.",d.success?"ok":"error")}catch(d){v(e,d.message,"error")}})}export{Ne as renderMobileSettingsPage};
