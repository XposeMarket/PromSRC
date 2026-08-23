var o=[{title:"Welcome to Prometheus",caption:"I'm your everything-AI. Anything you can describe, I can probably help you do \u2014 chat, files, browser, desktop, the works.",illus:y()},{title:"Your chat is the command line",caption:"Talk to me like a teammate. I remember context, I write to my own memory, and I can hand work off to background agents.",illus:g()},{title:"Tasks run in the background",caption:"Long jobs go to the Tasks tab so the chat stays responsive. Check back any time to see progress or final results.",illus:w()},{title:"Schedule & Heartbeat keep me alive",caption:"I can run on a cron, or on a recurring heartbeat to check in on your goals \u2014 even when you're not at your desk.",illus:k()},{title:"Teams and Subagents do parallel work",caption:"Spin up a team for big projects. I act as the manager, dispatching specialized subagents to work in parallel.",illus:v()},{title:"Browser, Desktop, Canvas, Files",caption:"I can drive a real browser, click around your desktop, edit files in a shared canvas, and execute code. Real tools, not just text.",illus:b()},{title:"Last step: connect your brain",caption:"Pick a model provider next \u2014 ChatGPT, Claude, an API key, or local Ollama. After that we'll do a quick meet-and-greet.",illus:m()}];function T(){return new Promise(a=>{let e=0,t=document.createElement("div");t.id="prom-onboarding-root",t.innerHTML=`
      <div class="prom-onb-card" role="dialog" aria-modal="true" aria-label="Prometheus onboarding tutorial">
        <div class="prom-onb-header">
          <div class="prom-onb-step" data-step>Step 1 of ${o.length}</div>
          <button class="prom-onb-skip" data-skip>Skip tour</button>
        </div>
        <div class="prom-onb-body">
          <div class="prom-onb-illus" data-illus></div>
          <h2 class="prom-onb-title" data-title></h2>
          <p class="prom-onb-caption" data-caption></p>
        </div>
        <div class="prom-onb-footer">
          <div class="prom-onb-dots" data-dots></div>
          <div class="prom-onb-actions">
            <button class="prom-onb-btn" data-back>Back</button>
            <button class="prom-onb-btn primary" data-next>Next</button>
          </div>
        </div>
      </div>
    `,document.body.appendChild(t);let d=t.querySelector("[data-step]"),f=t.querySelector("[data-illus]"),h=t.querySelector("[data-title]"),x=t.querySelector("[data-caption]"),p=t.querySelector("[data-dots]"),l=t.querySelector("[data-back]"),n=t.querySelector("[data-next]"),u=t.querySelector("[data-skip]");function r(){let i=o[e];d.textContent=`Step ${e+1} of ${o.length}`,f.innerHTML=i.illus,h.textContent=i.title,x.textContent=i.caption,p.innerHTML=o.map((S,c)=>`<div class="prom-onb-dot ${c===e?"active":c<e?"done":""}"></div>`).join(""),l.disabled=e===0,n.textContent=e===o.length-1?"Finish":"Next"}function s(i){t.style.transition="opacity 180ms ease-out",t.style.opacity="0",setTimeout(()=>{t.remove(),a(i)},180)}l.addEventListener("click",()=>{e>0&&(e--,r())}),n.addEventListener("click",()=>{e<o.length-1?(e++,r()):s("completed")}),u.addEventListener("click",()=>s("skipped")),r()})}function y(){return`<svg viewBox="0 0 200 140" xmlns="http://www.w3.org/2000/svg">
    <defs><linearGradient id="g1" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#5b8def"/><stop offset="1" stop-color="#a36ce0"/>
    </linearGradient></defs>
    <circle cx="100" cy="70" r="46" fill="url(#g1)"/>
    <path d="M 100 38 L 114 70 L 100 102 L 86 70 Z" fill="#fff" opacity="0.9"/>
    <circle cx="100" cy="70" r="6" fill="#0d4faf"/>
  </svg>`}function g(){return`<svg viewBox="0 0 200 140" xmlns="http://www.w3.org/2000/svg">
    <rect x="20" y="30" width="120" height="36" rx="10" fill="#dbe5ff"/>
    <rect x="60" y="76" width="120" height="36" rx="10" fill="#0d4faf"/>
    <circle cx="36" cy="48" r="5" fill="#0d4faf"/><circle cx="52" cy="48" r="5" fill="#0d4faf"/><circle cx="68" cy="48" r="5" fill="#0d4faf"/>
    <circle cx="80" cy="94" r="5" fill="#fff"/><circle cx="96" cy="94" r="5" fill="#fff"/><circle cx="112" cy="94" r="5" fill="#fff"/>
  </svg>`}function w(){return`<svg viewBox="0 0 200 140" xmlns="http://www.w3.org/2000/svg">
    <rect x="30" y="28" width="140" height="20" rx="5" fill="#e6f0ff"/>
    <rect x="30" y="28" width="100" height="20" rx="5" fill="#0d4faf"/>
    <rect x="30" y="58" width="140" height="20" rx="5" fill="#e6f0ff"/>
    <rect x="30" y="58" width="60" height="20" rx="5" fill="#5b8def"/>
    <rect x="30" y="88" width="140" height="20" rx="5" fill="#e6f0ff"/>
    <rect x="30" y="88" width="130" height="20" rx="5" fill="#a36ce0"/>
  </svg>`}function k(){return`<svg viewBox="0 0 200 140" xmlns="http://www.w3.org/2000/svg">
    <circle cx="100" cy="70" r="44" fill="none" stroke="#0d4faf" stroke-width="3"/>
    <line x1="100" y1="70" x2="100" y2="38" stroke="#0d4faf" stroke-width="3" stroke-linecap="round"/>
    <line x1="100" y1="70" x2="124" y2="78" stroke="#a36ce0" stroke-width="3" stroke-linecap="round"/>
    <circle cx="100" cy="70" r="4" fill="#0d4faf"/>
  </svg>`}function v(){return`<svg viewBox="0 0 200 140" xmlns="http://www.w3.org/2000/svg">
    <circle cx="100" cy="50" r="14" fill="#0d4faf"/>
    <circle cx="56"  cy="96" r="12" fill="#5b8def"/>
    <circle cx="100" cy="96" r="12" fill="#5b8def"/>
    <circle cx="144" cy="96" r="12" fill="#5b8def"/>
    <line x1="100" y1="64" x2="56"  y2="84" stroke="#a8b8d8" stroke-width="2"/>
    <line x1="100" y1="64" x2="100" y2="84" stroke="#a8b8d8" stroke-width="2"/>
    <line x1="100" y1="64" x2="144" y2="84" stroke="#a8b8d8" stroke-width="2"/>
  </svg>`}function b(){return`<svg viewBox="0 0 200 140" xmlns="http://www.w3.org/2000/svg">
    <rect x="20"  y="34" width="40" height="40" rx="8" fill="#5b8def"/>
    <rect x="74"  y="34" width="40" height="40" rx="8" fill="#a36ce0"/>
    <rect x="128" y="34" width="40" height="40" rx="8" fill="#0d4faf"/>
    <rect x="20"  y="86" width="40" height="22" rx="6" fill="#dbe5ff"/>
    <rect x="74"  y="86" width="40" height="22" rx="6" fill="#dbe5ff"/>
    <rect x="128" y="86" width="40" height="22" rx="6" fill="#dbe5ff"/>
  </svg>`}function m(){return`<svg viewBox="0 0 200 140" xmlns="http://www.w3.org/2000/svg">
    <circle cx="100" cy="70" r="36" fill="#fff" stroke="#0d4faf" stroke-width="3"/>
    <path d="M 80 70 L 95 84 L 122 56" stroke="#0d4faf" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
    <line x1="44"  y1="70" x2="60"  y2="70" stroke="#a36ce0" stroke-width="3" stroke-linecap="round"/>
    <line x1="140" y1="70" x2="156" y2="70" stroke="#a36ce0" stroke-width="3" stroke-linecap="round"/>
    <line x1="100" y1="22" x2="100" y2="34" stroke="#a36ce0" stroke-width="3" stroke-linecap="round"/>
    <line x1="100" y1="106" x2="100" y2="118" stroke="#a36ce0" stroke-width="3" stroke-linecap="round"/>
  </svg>`}export{T as a};
