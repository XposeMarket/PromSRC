import{i as u}from"./chunk-IPNQ4FF4.js";import{b as m}from"./chunk-JF4LWGNM.js";import"./chunk-EPSJJCWL.js";var p="subagent-create-bot-button",f="prom-bot-sidebar-create-button",d="prom-bot-create-modal",S="prom-bot-create-styles",g={blank:{roleType:"",purpose:""},researcher:{roleType:"researcher",purpose:"Research, analysis, source verification, and fact-checking."},analyst:{roleType:"analyst",purpose:"Analyze information, compare evidence, find patterns, and produce clear conclusions."},builder:{roleType:"builder",purpose:"Build, edit, test, and verify code and technical projects."},operator:{roleType:"operator",purpose:"Carry out practical workflows, operate tools, and follow work through to completion."}},b=!1,h=null,y=!1;function C(){try{return!window.__PROM_SHOULD_BOOT_MOBILE?.()}catch{return!0}}function v(){if(document.getElementById(S))return;let e=document.createElement("style");e.id=S,e.textContent=`
    #${p} {
      display:inline-flex;align-items:center;justify-content:center;gap:7px;
      min-height:32px;padding:7px 12px;border:1px solid var(--line);border-radius:9px;
      background:var(--panel-2);color:var(--text);font:inherit;font-size:12px;font-weight:800;
      cursor:pointer;transition:background .14s ease,border-color .14s ease,transform .14s ease;
      margin-left:auto;
    }
    #${p}:hover { background:var(--panel);border-color:color-mix(in srgb,var(--brand) 42%,var(--line)); }
    #${p}:active { transform:translateY(1px); }
    #${p} iconify-icon { color:var(--brand); }

    #${f} {
      position:absolute;right:6px;top:5px;z-index:2;width:26px;height:26px;padding:0;
      display:grid;place-items:center;border:0;border-radius:7px;background:transparent;
      color:var(--sidebar-muted,var(--muted));cursor:pointer;
    }
    #${f}:hover { background:var(--sidebar-item-hover,var(--panel-2));color:var(--text); }
    #prom-bot-sidebar-section { position:relative; }
    #prom-bot-sidebar-section > .section-title { padding-right:38px; }

    #${d} {
      position:fixed;inset:0;z-index:10060;display:none;align-items:center;justify-content:center;
      padding:24px;background:rgba(8,10,16,.54);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);
    }
    #${d}.open { display:flex; }
    .prom-bot-create-card {
      width:min(520px,calc(100vw - 32px));max-height:min(760px,calc(100vh - 40px));overflow:auto;
      border:1px solid var(--line);border-radius:18px;background:var(--panel);color:var(--text);
      box-shadow:0 24px 80px rgba(0,0,0,.28);padding:22px;
    }
    .prom-bot-create-head { display:flex;align-items:flex-start;justify-content:space-between;gap:14px;margin-bottom:20px; }
    .prom-bot-create-kicker { font-size:11px;font-weight:850;letter-spacing:.08em;text-transform:uppercase;color:var(--brand); }
    .prom-bot-create-title { margin-top:4px;font-size:21px;line-height:1.15;font-weight:900;letter-spacing:-.02em; }
    .prom-bot-create-copy { margin-top:6px;font-size:12px;line-height:1.5;color:var(--muted);max-width:390px; }
    .prom-bot-create-close { width:32px;height:32px;display:grid;place-items:center;border:0;border-radius:9px;background:var(--panel-2);color:var(--muted);cursor:pointer; }
    .prom-bot-create-close:hover { color:var(--text); }
    .prom-bot-create-field { display:flex;flex-direction:column;gap:7px;margin-top:14px; }
    .prom-bot-create-label { font-size:11px;font-weight:850;color:var(--text);letter-spacing:.01em; }
    .prom-bot-create-label span { font-weight:600;color:var(--muted); }
    .prom-bot-create-input,.prom-bot-create-textarea,.prom-bot-create-select {
      width:100%;box-sizing:border-box;border:1px solid var(--line);border-radius:10px;
      background:var(--panel-2);color:var(--text);font:inherit;font-size:13px;outline:none;
      transition:border-color .14s ease,box-shadow .14s ease;
    }
    .prom-bot-create-input,.prom-bot-create-select { min-height:40px;padding:9px 11px; }
    .prom-bot-create-textarea { min-height:92px;resize:vertical;padding:10px 11px;line-height:1.45; }
    .prom-bot-create-input:focus,.prom-bot-create-textarea:focus,.prom-bot-create-select:focus {
      border-color:color-mix(in srgb,var(--brand) 65%,var(--line));box-shadow:0 0 0 3px color-mix(in srgb,var(--brand) 11%,transparent);
    }
    .prom-bot-create-help { font-size:10px;line-height:1.45;color:var(--muted); }
    .prom-bot-create-advanced { margin-top:16px;border-top:1px solid var(--line);padding-top:14px; }
    .prom-bot-create-advanced summary { cursor:pointer;font-size:11px;font-weight:850;color:var(--muted);user-select:none; }
    .prom-bot-create-note { margin-top:16px;padding:10px 11px;border:1px solid var(--line);border-radius:10px;background:var(--panel-2);font-size:10.5px;line-height:1.5;color:var(--muted); }
    .prom-bot-create-actions { display:flex;justify-content:flex-end;gap:9px;margin-top:20px; }
    .prom-bot-create-action {
      min-height:36px;padding:8px 14px;border-radius:9px;border:1px solid var(--line);
      background:var(--panel-2);color:var(--text);font:inherit;font-size:12px;font-weight:850;cursor:pointer;
    }
    .prom-bot-create-action.primary { border-color:var(--brand);background:var(--brand);color:var(--brand-contrast,#fff); }
    .prom-bot-create-action:disabled { opacity:.55;cursor:not-allowed; }
  `,document.head.appendChild(e)}function q(e){return String(e||"").trim().toLowerCase().replace(/[^a-z0-9]+/g,"_").replace(/^_+|_+$/g,"").slice(0,48)||`bot_${Date.now().toString(36)}`}async function I(e){let t=await m("/api/agents",{timeoutMs:8e3}),o=new Set((Array.isArray(t?.agents)?t.agents:[]).map(a=>String(a?.id||"").trim()).filter(Boolean)),r=q(e);if(!o.has(r))return r;for(let a=2;a<1e3;a+=1){let i=`${r.slice(0,Math.max(1,48-String(a).length-1))}_${a}`;if(!o.has(i))return i}return`${r.slice(0,36)}_${Date.now().toString(36)}`}function O({name:e,purpose:t,instructions:o}){let r=String(e||"Bot").trim()||"Bot",a=String(t||"").trim(),i=String(o||"").trim(),s=[`# ${r}`];return a&&s.push("","## Purpose",a),s.push("","## Working Identity",`You are ${r}, a distinct Prometheus Bot. Work within the capabilities and workspace access Prometheus actually exposes to you.`),i&&s.push("","## Persistent Instructions",i),`${s.join(`
`).trim()}
`}function E(){let e=document.getElementById(d);return e||(e=document.createElement("div"),e.id=d,e.setAttribute("role","dialog"),e.setAttribute("aria-modal","true"),e.setAttribute("aria-labelledby","prom-bot-create-title"),e.innerHTML=`
    <div class="prom-bot-create-card" role="document">
      <div class="prom-bot-create-head">
        <div>
          <div class="prom-bot-create-kicker">Prom Bot</div>
          <div class="prom-bot-create-title" id="prom-bot-create-title">Create a Bot</div>
          <div class="prom-bot-create-copy">Create the identity first. Tools, skills, memory, schedules, and run policy can be configured later without asking Prometheus to architect the Bot.</div>
        </div>
        <button class="prom-bot-create-close" type="button" data-bot-create-close aria-label="Close"><iconify-icon icon="solar:close-circle-linear" width="19" height="19"></iconify-icon></button>
      </div>

      <form id="prom-bot-create-form">
        <div class="prom-bot-create-field">
          <label class="prom-bot-create-label" for="prom-bot-create-template">Start from</label>
          <select class="prom-bot-create-select" id="prom-bot-create-template">
            <option value="blank">Blank Bot</option>
            <option value="researcher">Researcher</option>
            <option value="analyst">Analyst</option>
            <option value="builder">Builder</option>
            <option value="operator">Operator</option>
          </select>
        </div>

        <div class="prom-bot-create-field">
          <label class="prom-bot-create-label" for="prom-bot-create-name">Name</label>
          <input class="prom-bot-create-input" id="prom-bot-create-name" maxlength="80" autocomplete="off" placeholder="Terra" required />
        </div>

        <div class="prom-bot-create-field">
          <label class="prom-bot-create-label" for="prom-bot-create-purpose">What is this Bot for? <span>optional</span></label>
          <textarea class="prom-bot-create-textarea" id="prom-bot-create-purpose" maxlength="1600" placeholder="Research, analysis, and fact-checking."></textarea>
          <div class="prom-bot-create-help">This becomes the Bot's persistent <strong>Purpose</strong> in AGENT.md. It does not become a tool allowlist, success criteria, timeout, or heartbeat policy.</div>
        </div>

        <details class="prom-bot-create-advanced">
          <summary>Advanced</summary>
          <div class="prom-bot-create-field">
            <label class="prom-bot-create-label" for="prom-bot-create-model">Model override <span>optional</span></label>
            <input class="prom-bot-create-input" id="prom-bot-create-model" maxlength="180" autocomplete="off" placeholder="openai_codex/gpt-5.6-sol" />
            <div class="prom-bot-create-help">Leave blank to inherit Prometheus's configured subagent/default model.</div>
          </div>
          <div class="prom-bot-create-field">
            <label class="prom-bot-create-label" for="prom-bot-create-instructions">Persistent identity instructions <span>optional</span></label>
            <textarea class="prom-bot-create-textarea" id="prom-bot-create-instructions" maxlength="4000" placeholder="How this Bot should consistently work or communicate."></textarea>
          </div>
        </details>

        <div class="prom-bot-create-note">Memory and heartbeat files are intentionally not created here. MEMORY.md is created when the Bot first writes durable memory; heartbeat/schedule state is created only when you enable autonomy for this Bot.</div>

        <div class="prom-bot-create-actions">
          <button class="prom-bot-create-action" type="button" data-bot-create-close>Cancel</button>
          <button class="prom-bot-create-action primary" id="prom-bot-create-submit" type="submit">Create Bot</button>
        </div>
      </form>
    </div>`,document.body.appendChild(e),e.addEventListener("click",t=>{(t.target===e||t.target.closest?.("[data-bot-create-close]"))&&x()}),e.querySelector("#prom-bot-create-template")?.addEventListener("change",t=>{let o=g[String(t.target?.value||"blank")]||g.blank,r=e.querySelector("#prom-bot-create-purpose");r&&(!r.value.trim()||r.dataset.templateOwned==="1")&&(r.value=o.purpose,r.dataset.templateOwned=o.purpose?"1":"0")}),e.querySelector("#prom-bot-create-purpose")?.addEventListener("input",t=>{t.target.dataset.templateOwned="0"}),e.querySelector("#prom-bot-create-form")?.addEventListener("submit",t=>{t.preventDefault(),P()}),e)}function T(){v();let e=E();e.querySelector("#prom-bot-create-form")?.reset();let o=e.querySelector("#prom-bot-create-purpose");o&&(o.dataset.templateOwned="0"),e.classList.add("open"),requestAnimationFrame(()=>e.querySelector("#prom-bot-create-name")?.focus())}function x(){b||document.getElementById(d)?.classList.remove("open")}async function P(){if(b)return;let e=E(),t=String(e.querySelector("#prom-bot-create-name")?.value||"").trim(),o=String(e.querySelector("#prom-bot-create-purpose")?.value||"").trim(),r=String(e.querySelector("#prom-bot-create-template")?.value||"blank"),a=g[r]||g.blank,i=String(e.querySelector("#prom-bot-create-model")?.value||"").trim(),s=String(e.querySelector("#prom-bot-create-instructions")?.value||"").trim();if(!t){u?.("Name required","Give the Bot a name before creating it.","error"),e.querySelector("#prom-bot-create-name")?.focus();return}let l=e.querySelector("#prom-bot-create-submit");b=!0,l&&(l.disabled=!0,l.textContent="Creating\u2026");try{let n=await I(t),A={id:n,name:t,...o?{description:o}:{},...a.roleType?{roleType:a.roleType}:{},...i?{model:i}:{},identity:{displayName:t,shortName:t}},w=await m("/api/agents",{method:"POST",body:JSON.stringify({agent:A}),timeoutMs:12e3});if(!w?.success)throw new Error(w?.error||"Bot creation failed");let B=null;try{await m(`/api/agents/${encodeURIComponent(n)}/agent-md`,{method:"PUT",body:JSON.stringify({content:O({name:t,purpose:o,instructions:s})}),timeoutMs:12e3})}catch(c){B=c,console.warn("[Bot Create] Bot exists but AGENT.md could not be saved:",c)}e.classList.remove("open"),B?u?.("Bot created \xB7 identity save needs attention",`${t} was created successfully, but AGENT.md could not be saved. Open the Bot settings to retry the identity instructions; do not create a duplicate Bot.`,"warning"):u?.("Bot created",`${t} is ready to chat.`,"success");try{await window.refreshSubagents?.()}catch(c){console.warn("[Bot Create] refreshSubagents failed:",c)}try{await window.refreshPromBotAgents?.({force:!0})}catch(c){console.warn("[Bot Create] Prom Bot roster refresh failed:",c)}try{if(typeof window.openPromBotAgent=="function")await window.openPromBotAgent(n);else if(typeof window.openSubagentDetail=="function"){await window.openSubagentDetail(n);try{await window.switchSubagentTab?.("chat",n)}catch{}}}catch(c){console.warn("[Bot Create] Bot was created but could not be opened automatically:",c)}}catch(n){console.error("[Bot Create] Could not create Bot:",n),u?.("Could not create Bot",String(n?.message||n),"error")}finally{b=!1,l&&(l.disabled=!1,l.textContent="Create Bot")}}function M(e,t=!1){let o=document.createElement("button");return o.id=e,o.type="button",t?(o.title="Create Bot",o.setAttribute("aria-label","Create Bot"),o.innerHTML='<iconify-icon icon="solar:add-circle-linear" width="17" height="17"></iconify-icon>'):o.innerHTML='<iconify-icon icon="solar:add-circle-bold" width="17" height="17"></iconify-icon><span>New Bot</span>',o.addEventListener("click",r=>{r.preventDefault(),r.stopPropagation(),T()}),o}function _(){if(document.getElementById(p))return;let e=document.getElementById("subagents-count");if(!e?.parentElement)return;let t=M(p,!1);e.parentElement.appendChild(t)}function $(){if(document.getElementById(f))return;let e=document.getElementById("prom-bot-sidebar-section"),t=e?.querySelector(":scope > .section-title");!e||!t||e.appendChild(M(f,!0))}function L(){y=!1,C()&&(v(),_(),$())}function z(){y||(y=!0,queueMicrotask(L))}function k(){C()&&(v(),L(),!h&&document.body&&(h=new MutationObserver(z),h.observe(document.body,{childList:!0,subtree:!0})),document.addEventListener("keydown",e=>{e.key==="Escape"&&document.getElementById(d)?.classList.contains("open")&&x()}))}window.openBotCreateModal=T;window.closeBotCreateModal=x;document.readyState==="loading"?document.addEventListener("DOMContentLoaded",k,{once:!0}):k();
