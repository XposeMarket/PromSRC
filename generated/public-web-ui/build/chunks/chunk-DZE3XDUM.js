import{a as b}from"./chunk-GBLBNUG2.js";import{a as r}from"./chunk-IPNQ4FF4.js";import{b as u,c as l}from"./chunk-JF4LWGNM.js";function C(t){if(!t)return"";try{return new Date(t).toLocaleTimeString()}catch{return""}}function v(t){let n=Number(t);if(!Number.isFinite(n)||n<0)return"";if(n<1e3)return`${Math.round(n)}ms`;let e=Math.round(n/100)/10;return e<60?`${e}s`:`${Math.floor(e/60)}m ${Math.round(e%60)}s`}function R(t,n){return t==="running"||t==="starting"?"#0d4faf":t==="exiting"?"#7c4d00":Number(n)===0?"#1a6e35":"#9c1a1a"}function P(t){return document.getElementById(`process-log-wrap-${t}`)?.dataset.processActiveTab||"combined"}function h(t,n){let e=document.getElementById(`process-log-${t}`);e&&(e.textContent=n||"(no output)",e.scrollTop=e.scrollHeight)}function T(t,n,e="stdout"){let o=document.getElementById(`process-log-${t}`);if(!o||!n)return;let i=P(t);if(i!=="combined"&&i!==e)return;let s=o.scrollHeight-o.scrollTop-o.clientHeight<40;o.textContent=`${o.textContent==="(no output yet)"||o.textContent==="(no output)"?"":o.textContent}${n}`,s&&(o.scrollTop=o.scrollHeight)}function I(t){let n=String(t||"");try{if(window.CSS?.escape)return window.CSS.escape(n)}catch{}return n.replace(/["\\\]]/g,"\\$&")}function L(t){let n=String(t?.state||"unknown"),e=R(n,t?.exitCode),o=t?.title||t?.command||"Command",i=String(t?.outputPreview||"").trim(),s=String(t?.runId||""),c=n==="running"||n==="starting"||n==="exiting",d=t?.durationMs?v(t.durationMs):t?.startedAt?v(Date.now()-Date.parse(t.startedAt)):"",m=t?.shell||"auto",f=`${n}${t?.exitCode!=null?` ${t.exitCode}`:""}`,a=t?.cwd||"";return`
    <div class="process-run-card" data-run-id="${r(s)}">
      <div class="process-run-head">
        <div>
          <div class="process-run-kicker">Shell</div>
          <div class="process-run-title">${r(o)}</div>
        </div>
        <span class="process-run-pill" style="color:${e};border-color:${e}33;background:${e}12">${r(f)}</span>
      </div>
      <div class="process-run-meta">
        <span>${r(s)}</span>
        <span>shell ${r(m)}${t?.pty?" + pty":""}</span>
        <span>${r(t?.mode||"")}</span>
        <span>${r(C(t?.startedAt))}</span>
        ${d?`<span>${r(d)}</span>`:""}
        ${t?.exitCode!=null?`<span>exit ${r(String(t.exitCode))}</span>`:""}
        <span>${r(a)}</span>
      </div>
      ${t?.waitingForInputHint?'<div class="process-run-hint">Waiting for input</div>':""}
      ${t?.failureSummary?`<div class="process-run-summary process-run-failure">${r(t.failureSummary)}</div>`:""}
      ${t?.completionSummary&&!c?`<div class="process-run-summary">${r(t.completionSummary)}</div>`:""}
      <div class="process-run-terminal">
        <div class="process-run-terminal-bar">
          <span>Ran command</span>
          <span class="process-run-live-state">${c?"streaming":"completed"}</span>
        </div>
        <pre class="process-run-command"><span class="process-run-prompt">$</span> ${r(t?.command||"")}</pre>
        <pre class="process-run-preview" id="process-log-${r(s)}">${r(i||"(no output yet)")}</pre>
      </div>
      <div class="process-run-actions">
        <button type="button" data-process-action="log" data-run-id="${r(s)}">Live tail</button>
        <button type="button" data-process-action="copy" data-run-id="${r(s)}">Copy output</button>
        <button type="button" data-process-action="rerun" data-run-id="${r(s)}">Rerun</button>
        ${c?`<button type="button" data-process-action="kill" data-run-id="${r(s)}">Kill</button>`:""}
        ${t?.stdinOpen||t?.pty?`<input class="process-run-input" data-process-input="${r(s)}" placeholder="Send input..." /><button type="button" data-process-action="submit" data-run-id="${r(s)}">Send</button>`:""}
      </div>
      <div class="process-run-log-wrap" id="process-log-wrap-${r(s)}" data-process-active-tab="combined">
        <div class="process-run-tabs">
          <button type="button" data-process-tab="combined" data-run-id="${r(s)}">combined</button>
          <button type="button" data-process-tab="stdout" data-run-id="${r(s)}">stdout</button>
          <button type="button" data-process-tab="stderr" data-run-id="${r(s)}">stderr</button>
        </div>
      </div>
    </div>`}function M(t=[]){return!Array.isArray(t)||t.length===0?'<div class="process-run-empty">No command runs yet.</div>':t.map(L).join("")}async function W(t=8){let n=await u(`${l.PROCESSES}?limit=${encodeURIComponent(t)}`);return Array.isArray(n?.runs)?n.runs:[]}function B(t=document){t.addEventListener("click",async n=>{let e=n.target?.closest?.("[data-process-action]");if(!e)return;let o=e.dataset.processAction,i=e.dataset.runId;if(i){if(o==="kill"){await u(l.processRunAction(i,"kill"),{method:"POST",body:{}}),typeof window.refreshProcessRunsPanel=="function"&&window.refreshProcessRunsPanel();return}if(o==="rerun"){await u(l.processRunRerun(i),{method:"POST",body:{}}),typeof window.refreshProcessRunsPanel=="function"&&window.refreshProcessRunsPanel();return}if(o==="submit"){let s=t.querySelector(`[data-process-input="${CSS.escape(i)}"]`),c=s?s.value:"";await u(l.processRunAction(i,"submit"),{method:"POST",body:{data:c}}),s&&(s.value=""),typeof window.refreshProcessRunsPanel=="function"&&window.refreshProcessRunsPanel();return}if(o==="copy"){let s=await u(l.processRunLog(i));await navigator.clipboard?.writeText?.(s?.combined||"");return}if(o==="log"){let s=await u(l.processRunLog(i));h(i,s?.combined||"")}}}),t.addEventListener("click",async n=>{let e=n.target?.closest?.("[data-process-tab]");if(!e)return;let o=e.dataset.runId,i=e.dataset.processTab||"combined";if(!o)return;let s=document.getElementById(`process-log-wrap-${o}`);s&&(s.dataset.processActiveTab=i),e.parentElement?.querySelectorAll("[data-process-tab]")?.forEach(d=>{d.classList.toggle("active",d===e)});let c=await u(l.processRunLog(o));h(o,c?.[i]||"")})}function k(){window.__processRunLiveStreamInstalled||(window.__processRunLiveStreamInstalled=!0,b.on("process_run_output",(t={})=>{let n=String(t.run?.runId||t.runId||"").trim();n&&T(n,String(t.chunk||""),String(t.stream||"stdout"))}),["process_run_started","process_run_update","process_run_exited"].forEach(t=>{b.on(t,(n={})=>{let e=n.run,o=String(e?.runId||n.runId||"").trim(),i=o?document.querySelector(`.process-run-card[data-run-id="${I(o)}"]`):null;if(!e||!i)return;let s=i.querySelector(".process-run-pill");s&&(s.textContent=`${e.state||"unknown"}${e.exitCode!=null?` ${e.exitCode}`:""}`);let c=i.querySelector(".process-run-live-state");c&&(c.textContent=e.state==="exited"?"completed":"streaming")})}))}k();function N(t){let n=String(t||"").match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);return n?Number(n[1])||1:null}function O(t,n={}){let e=String(t||"").replace(/\r\n/g,`
`);if(!e.trim())return`<div class="coding-diff-empty">${r(n.emptyText||"No changes in this view.")}</div>`;if(/^Binary files /m.test(e))return'<div class="coding-diff-binary"><span aria-hidden="true">\u25C8</span><span>Binary file changed. There is no text diff to display.</span></div>';let o=Math.max(100,Math.min(5e3,Number(n.maxLines)||2500)),i=e.split(`
`).slice(0,o),s=0,c=0,d=[];for(let f of i){let a=f===""&&d.length===i.length-1?"":f,g=N(a);if(g!==null){let $=a.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/);s=Number($?.[1]||1),c=Number($?.[3]||g),d.push(`<div class="coding-diff-hunk"><span>${r(a)}</span></div>`);continue}if(a.startsWith("--- ")||a.startsWith("+++ ")||a.startsWith("diff --git ")||a.startsWith("index "))continue;if(a==="\\ No newline at end of file"){d.push(`<div class="coding-diff-note"><span>${r(a)}</span></div>`);continue}let p=a.startsWith("+")?"add":a.startsWith("-")?"del":"context",y=p==="context"?a:a.slice(1),w=p==="add"?"":s++,S=p==="del"?"":c++,x=p==="add"?"+":p==="del"?"-":" ";d.push(`<div class="coding-diff-line coding-diff-line--${p}"><span class="coding-diff-number coding-diff-number--old">${w}</span><span class="coding-diff-number coding-diff-number--new">${S}</span><span class="coding-diff-prefix">${x}</span><span class="coding-diff-content">${r(y)||"&nbsp;"}</span></div>`)}let m=e.split(`
`).length>o;return`<div class="coding-diff-lines" role="list">${d.join("")}${m?'<div class="coding-diff-note">Diff truncated for performance.</div>':""}</div>`}export{L as a,M as b,W as c,B as d,O as e};
