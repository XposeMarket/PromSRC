import{b as u,c as d}from"./chunk-JF4LWGNM.js";import{a as r}from"./chunk-CP4XDM65.js";import{a as p}from"./chunk-GRAK6S3F.js";var l=128*1024;function g(t){if(!t)return"";try{return new Date(t).toLocaleTimeString()}catch{return""}}function m(t){let e=Number(t);if(!Number.isFinite(e)||e<0)return"";if(e<1e3)return`${Math.round(e)}ms`;let n=Math.round(e/100)/10;return n<60?`${n}s`:`${Math.floor(n/60)}m ${Math.round(n%60)}s`}function w(t,e){return t==="running"||t==="starting"?"#0d4faf":t==="exiting"?"#7c4d00":Number(e)===0?"#1a6e35":"#9c1a1a"}function y(t){return document.getElementById(`process-log-wrap-${t}`)?.dataset.processActiveTab||"combined"}function f(t,e){let n=document.getElementById(`process-log-${t}`);n&&(n.textContent=e||"(no output)",n.scrollTop=n.scrollHeight)}function S(t,e,n="stdout"){let o=document.getElementById(`process-log-${t}`);if(!o||!e)return;let a=y(t);if(a!=="combined"&&a!==n)return;let s=o.scrollHeight-o.scrollTop-o.clientHeight<40,c=`${o.textContent==="(no output yet)"||o.textContent==="(no output)"?"":o.textContent}${e}`;o.textContent=c.length>l?`[Older live output hidden; open the saved log for more.]
${c.slice(-l)}`:c,s&&(o.scrollTop=o.scrollHeight)}function h(t){let e=String(t||"");try{if(window.CSS?.escape)return window.CSS.escape(e)}catch{}return e.replace(/["\\\]]/g,"\\$&")}function x(t){let e=String(t?.state||"unknown"),n=w(e,t?.exitCode),o=t?.title||t?.command||"Command",a=String(t?.outputPreview||"").trim(),s=String(t?.runId||""),i=e==="running"||e==="starting"||e==="exiting",c=t?.durationMs?m(t.durationMs):t?.startedAt?m(Date.now()-Date.parse(t.startedAt)):"",$=t?.shell||"auto",b=`${e}${t?.exitCode!=null?` ${t.exitCode}`:""}`,v=t?.cwd||"";return`
    <div class="process-run-card" data-run-id="${r(s)}">
      <div class="process-run-head">
        <div>
          <div class="process-run-kicker">Shell</div>
          <div class="process-run-title">${r(o)}</div>
        </div>
        <span class="process-run-pill" style="color:${n};border-color:${n}33;background:${n}12">${r(b)}</span>
      </div>
      <div class="process-run-meta">
        <span>${r(s)}</span>
        <span>shell ${r($)}${t?.pty?" + pty":""}</span>
        <span>${r(t?.mode||"")}</span>
        <span>${r(g(t?.startedAt))}</span>
        ${c?`<span>${r(c)}</span>`:""}
        ${t?.exitCode!=null?`<span>exit ${r(String(t.exitCode))}</span>`:""}
        <span>${r(v)}</span>
      </div>
      ${t?.waitingForInputHint?'<div class="process-run-hint">Waiting for input</div>':""}
      ${t?.failureSummary?`<div class="process-run-summary process-run-failure">${r(t.failureSummary)}</div>`:""}
      ${t?.completionSummary&&!i?`<div class="process-run-summary">${r(t.completionSummary)}</div>`:""}
      <div class="process-run-terminal">
        <div class="process-run-terminal-bar">
          <span>Ran command</span>
          <span class="process-run-live-state">${i?"streaming":"completed"}</span>
        </div>
        <pre class="process-run-command"><span class="process-run-prompt">$</span> ${r(t?.command||"")}</pre>
        <pre class="process-run-preview" id="process-log-${r(s)}">${r(a||"(no output yet)")}</pre>
      </div>
      <div class="process-run-actions">
        <button type="button" data-process-action="log" data-run-id="${r(s)}">Live tail</button>
        <button type="button" data-process-action="copy" data-run-id="${r(s)}">Copy output</button>
        <button type="button" data-process-action="rerun" data-run-id="${r(s)}">Rerun</button>
        ${i?`<button type="button" data-process-action="kill" data-run-id="${r(s)}">Kill</button>`:""}
        ${t?.stdinOpen||t?.pty?`<input class="process-run-input" data-process-input="${r(s)}" placeholder="Send input..." /><button type="button" data-process-action="submit" data-run-id="${r(s)}">Send</button>`:""}
      </div>
      <div class="process-run-log-wrap" id="process-log-wrap-${r(s)}" data-process-active-tab="combined">
        <div class="process-run-tabs">
          <button type="button" data-process-tab="combined" data-run-id="${r(s)}">combined</button>
          <button type="button" data-process-tab="stdout" data-run-id="${r(s)}">stdout</button>
          <button type="button" data-process-tab="stderr" data-run-id="${r(s)}">stderr</button>
        </div>
      </div>
    </div>`}function T(t=[]){return!Array.isArray(t)||t.length===0?'<div class="process-run-empty">No command runs yet.</div>':t.map(x).join("")}async function A(t=8){let e=await u(`${d.PROCESSES}?limit=${encodeURIComponent(t)}`);return Array.isArray(e?.runs)?e.runs:[]}function E(t=document){t.addEventListener("click",async e=>{let n=e.target?.closest?.("[data-process-action]");if(!n)return;let o=n.dataset.processAction,a=n.dataset.runId;if(a){if(o==="kill"){await u(d.processRunAction(a,"kill"),{method:"POST",body:{}}),typeof window.refreshProcessRunsPanel=="function"&&window.refreshProcessRunsPanel();return}if(o==="rerun"){await u(d.processRunRerun(a),{method:"POST",body:{}}),typeof window.refreshProcessRunsPanel=="function"&&window.refreshProcessRunsPanel();return}if(o==="submit"){let s=t.querySelector(`[data-process-input="${CSS.escape(a)}"]`),i=s?s.value:"";await u(d.processRunAction(a,"submit"),{method:"POST",body:{data:i}}),s&&(s.value=""),typeof window.refreshProcessRunsPanel=="function"&&window.refreshProcessRunsPanel();return}if(o==="copy"){let s=await u(d.processRunLog(a));await navigator.clipboard?.writeText?.(s?.combined||"");return}if(o==="log"){let s=await u(d.processRunLog(a));f(a,s?.combined||"")}}}),t.addEventListener("click",async e=>{let n=e.target?.closest?.("[data-process-tab]");if(!n)return;let o=n.dataset.runId,a=n.dataset.processTab||"combined";if(!o)return;let s=document.getElementById(`process-log-wrap-${o}`);s&&(s.dataset.processActiveTab=a),n.parentElement?.querySelectorAll("[data-process-tab]")?.forEach(c=>{c.classList.toggle("active",c===n)});let i=await u(d.processRunLog(o));f(o,i?.[a]||"")})}function R(){window.__processRunLiveStreamInstalled||(window.__processRunLiveStreamInstalled=!0,p.on("process_run_output",(t={})=>{let e=String(t.run?.runId||t.runId||"").trim();e&&S(e,String(t.chunk||""),String(t.stream||"stdout"))}),["process_run_started","process_run_update","process_run_exited"].forEach(t=>{p.on(t,(e={})=>{let n=e.run,o=String(n?.runId||e.runId||"").trim(),a=o?document.querySelector(`.process-run-card[data-run-id="${h(o)}"]`):null;if(!n||!a)return;let s=a.querySelector(".process-run-pill");s&&(s.textContent=`${n.state||"unknown"}${n.exitCode!=null?` ${n.exitCode}`:""}`);let i=a.querySelector(".process-run-live-state");i&&(i.textContent=n.state==="exited"?"completed":"streaming")})}))}R();export{x as a,T as b,A as c,E as d};
