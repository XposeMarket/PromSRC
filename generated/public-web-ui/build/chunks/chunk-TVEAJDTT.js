import{b as c,c as u}from"./chunk-JF4LWGNM.js";import{a as o}from"./chunk-IPNQ4FF4.js";import{a as p}from"./chunk-GBLBNUG2.js";function v(t){if(!t)return"";try{return new Date(t).toLocaleTimeString()}catch{return""}}function l(t){let e=Number(t);if(!Number.isFinite(e)||e<0)return"";if(e<1e3)return`${Math.round(e)}ms`;let n=Math.round(e/100)/10;return n<60?`${n}s`:`${Math.floor(n/60)}m ${Math.round(n%60)}s`}function w(t,e){return t==="running"||t==="starting"?"#0d4faf":t==="exiting"?"#7c4d00":Number(e)===0?"#1a6e35":"#9c1a1a"}function y(t){return document.getElementById(`process-log-wrap-${t}`)?.dataset.processActiveTab||"combined"}function m(t,e){let n=document.getElementById(`process-log-${t}`);n&&(n.textContent=e||"(no output)",n.scrollTop=n.scrollHeight)}function g(t,e,n="stdout"){let r=document.getElementById(`process-log-${t}`);if(!r||!e)return;let a=y(t);if(a!=="combined"&&a!==n)return;let s=r.scrollHeight-r.scrollTop-r.clientHeight<40;r.textContent=`${r.textContent==="(no output yet)"||r.textContent==="(no output)"?"":r.textContent}${e}`,s&&(r.scrollTop=r.scrollHeight)}function S(t){let e=String(t||"");try{if(window.CSS?.escape)return window.CSS.escape(e)}catch{}return e.replace(/["\\\]]/g,"\\$&")}function h(t){let e=String(t?.state||"unknown"),n=w(e,t?.exitCode),r=t?.title||t?.command||"Command",a=String(t?.outputPreview||"").trim(),s=String(t?.runId||""),i=e==="running"||e==="starting"||e==="exiting",d=t?.durationMs?l(t.durationMs):t?.startedAt?l(Date.now()-Date.parse(t.startedAt)):"",f=t?.shell||"auto",b=`${e}${t?.exitCode!=null?` ${t.exitCode}`:""}`,$=t?.cwd||"";return`
    <div class="process-run-card" data-run-id="${o(s)}">
      <div class="process-run-head">
        <div>
          <div class="process-run-kicker">Shell</div>
          <div class="process-run-title">${o(r)}</div>
        </div>
        <span class="process-run-pill" style="color:${n};border-color:${n}33;background:${n}12">${o(b)}</span>
      </div>
      <div class="process-run-meta">
        <span>${o(s)}</span>
        <span>shell ${o(f)}${t?.pty?" + pty":""}</span>
        <span>${o(t?.mode||"")}</span>
        <span>${o(v(t?.startedAt))}</span>
        ${d?`<span>${o(d)}</span>`:""}
        ${t?.exitCode!=null?`<span>exit ${o(String(t.exitCode))}</span>`:""}
        <span>${o($)}</span>
      </div>
      ${t?.waitingForInputHint?'<div class="process-run-hint">Waiting for input</div>':""}
      ${t?.failureSummary?`<div class="process-run-summary process-run-failure">${o(t.failureSummary)}</div>`:""}
      ${t?.completionSummary&&!i?`<div class="process-run-summary">${o(t.completionSummary)}</div>`:""}
      <div class="process-run-terminal">
        <div class="process-run-terminal-bar">
          <span>Ran command</span>
          <span class="process-run-live-state">${i?"streaming":"completed"}</span>
        </div>
        <pre class="process-run-command"><span class="process-run-prompt">$</span> ${o(t?.command||"")}</pre>
        <pre class="process-run-preview" id="process-log-${o(s)}">${o(a||"(no output yet)")}</pre>
      </div>
      <div class="process-run-actions">
        <button type="button" data-process-action="log" data-run-id="${o(s)}">Live tail</button>
        <button type="button" data-process-action="copy" data-run-id="${o(s)}">Copy output</button>
        <button type="button" data-process-action="rerun" data-run-id="${o(s)}">Rerun</button>
        ${i?`<button type="button" data-process-action="kill" data-run-id="${o(s)}">Kill</button>`:""}
        ${t?.stdinOpen||t?.pty?`<input class="process-run-input" data-process-input="${o(s)}" placeholder="Send input..." /><button type="button" data-process-action="submit" data-run-id="${o(s)}">Send</button>`:""}
      </div>
      <div class="process-run-log-wrap" id="process-log-wrap-${o(s)}" data-process-active-tab="combined">
        <div class="process-run-tabs">
          <button type="button" data-process-tab="combined" data-run-id="${o(s)}">combined</button>
          <button type="button" data-process-tab="stdout" data-run-id="${o(s)}">stdout</button>
          <button type="button" data-process-tab="stderr" data-run-id="${o(s)}">stderr</button>
        </div>
      </div>
    </div>`}function I(t=[]){return!Array.isArray(t)||t.length===0?'<div class="process-run-empty">No command runs yet.</div>':t.map(h).join("")}async function T(t=8){let e=await c(`${u.PROCESSES}?limit=${encodeURIComponent(t)}`);return Array.isArray(e?.runs)?e.runs:[]}function E(t=document){t.addEventListener("click",async e=>{let n=e.target?.closest?.("[data-process-action]");if(!n)return;let r=n.dataset.processAction,a=n.dataset.runId;if(a){if(r==="kill"){await c(u.processRunAction(a,"kill"),{method:"POST",body:{}}),typeof window.refreshProcessRunsPanel=="function"&&window.refreshProcessRunsPanel();return}if(r==="rerun"){await c(u.processRunRerun(a),{method:"POST",body:{}}),typeof window.refreshProcessRunsPanel=="function"&&window.refreshProcessRunsPanel();return}if(r==="submit"){let s=t.querySelector(`[data-process-input="${CSS.escape(a)}"]`),i=s?s.value:"";await c(u.processRunAction(a,"submit"),{method:"POST",body:{data:i}}),s&&(s.value=""),typeof window.refreshProcessRunsPanel=="function"&&window.refreshProcessRunsPanel();return}if(r==="copy"){let s=await c(u.processRunLog(a));await navigator.clipboard?.writeText?.(s?.combined||"");return}if(r==="log"){let s=await c(u.processRunLog(a));m(a,s?.combined||"")}}}),t.addEventListener("click",async e=>{let n=e.target?.closest?.("[data-process-tab]");if(!n)return;let r=n.dataset.runId,a=n.dataset.processTab||"combined";if(!r)return;let s=document.getElementById(`process-log-wrap-${r}`);s&&(s.dataset.processActiveTab=a),n.parentElement?.querySelectorAll("[data-process-tab]")?.forEach(d=>{d.classList.toggle("active",d===n)});let i=await c(u.processRunLog(r));m(r,i?.[a]||"")})}function x(){window.__processRunLiveStreamInstalled||(window.__processRunLiveStreamInstalled=!0,p.on("process_run_output",(t={})=>{let e=String(t.run?.runId||t.runId||"").trim();e&&g(e,String(t.chunk||""),String(t.stream||"stdout"))}),["process_run_started","process_run_update","process_run_exited"].forEach(t=>{p.on(t,(e={})=>{let n=e.run,r=String(n?.runId||e.runId||"").trim(),a=r?document.querySelector(`.process-run-card[data-run-id="${S(r)}"]`):null;if(!n||!a)return;let s=a.querySelector(".process-run-pill");s&&(s.textContent=`${n.state||"unknown"}${n.exitCode!=null?` ${n.exitCode}`:""}`);let i=a.querySelector(".process-run-live-state");i&&(i.textContent=n.state==="exited"?"completed":"streaming")})}))}x();export{h as a,I as b,T as c,E as d};
