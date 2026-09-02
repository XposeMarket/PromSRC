import{b as C}from"./chunk-JF4LWGNM.js";import"./chunk-EPSJJCWL.js";var _="prometheus_prom_bot_mode_v1",S="prometheus_prom_bot_section_collapsed_v1",b="sidebarPromBotToggle",f="prom-bot-sidebar-section",c="prom-bot-subagents-list",i="prom-bot-main-surface",r=!1,h=[],l="",p=null,w=null,d=null,x=null,g=[],A=!1,M='<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="4" y="5" width="8" height="7" rx="2"/><circle cx="6" cy="8" r="1" fill="currentColor" stroke="none"/><circle cx="10" cy="8" r="1" fill="currentColor" stroke="none"/><line x1="8" y1="2" x2="8" y2="5"/><circle cx="8" cy="1.5" r="1" fill="currentColor" stroke="none"/></svg>';function k(e,t=!1){try{let n=localStorage.getItem(e);return n==null?t:n==="1"||n==="true"}catch{return t}}function T(e,t){try{localStorage.setItem(e,t?"1":"0")}catch{}}function R(){if(document.getElementById("prom-bot-styles"))return;let e=document.createElement("style");e.id="prom-bot-styles",e.textContent=`
    #${b}.prom-bot-active {
      color: var(--pm-gold, var(--brand));
      background: var(--sidebar-active-bg, rgba(214,183,94,.14));
      border-color: color-mix(in srgb, var(--pm-gold, var(--brand)) 48%, transparent);
    }
    #${b} svg { width: 20px; height: 20px; }
    #${f}[hidden] { display: none !important; }
    #${c} { display: flex; flex-direction: column; gap: 2px; }
    #${c}[hidden] { display: none !important; }
    #${f}.is-collapsed > :not(.sidebar-section-toggle) { display: none !important; }
    .prom-bot-agent-row {
      width: 100%;
      display: grid;
      grid-template-columns: 30px minmax(0,1fr) auto;
      align-items: center;
      gap: 9px;
      padding: 8px 9px;
      border: 0;
      border-radius: 10px;
      background: transparent;
      color: var(--sidebar-text, var(--text));
      font: inherit;
      text-align: left;
      cursor: pointer;
      transition: background .14s ease, color .14s ease;
    }
    .prom-bot-agent-row:hover { background: var(--sidebar-item-hover, var(--panel-2)); }
    .prom-bot-agent-row.active { background: var(--sidebar-active-bg, var(--panel-2)); color: var(--text); }
    .prom-bot-agent-avatar {
      width: 30px;
      height: 30px;
      border-radius: 9px;
      display: grid;
      place-items: center;
      color: var(--pm-gold, var(--brand));
      background: var(--sidebar-icon-bg, var(--panel-2));
      border: 1px solid var(--sidebar-icon-border, var(--line));
    }
    .prom-bot-agent-avatar svg { width: 17px; height: 17px; }
    .prom-bot-agent-copy { min-width: 0; }
    .prom-bot-agent-name { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; font-weight: 780; }
    .prom-bot-agent-meta { display: block; margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--sidebar-muted, var(--muted)); font-size: 10px; font-weight: 560; }
    .prom-bot-agent-state { width: 6px; height: 6px; border-radius: 50%; background: color-mix(in srgb, var(--sidebar-muted, var(--muted)) 60%, transparent); }
    .prom-bot-agent-state.working { background: #36c986; box-shadow: 0 0 0 3px rgba(54,201,134,.12); }
    .prom-bot-sidebar-empty { padding: 8px 10px 12px; color: var(--sidebar-muted, var(--muted)); font-size: 11px; line-height: 1.45; }

    /* Prom Bot is the main chat surface while an agent is selected. Do not
       stack a second absolute chat panel over the existing conversation. */
    #chat-view.prom-bot-chat-active {
      display: flex !important;
      flex-direction: column;
      min-width: 0;
      min-height: 0;
      overflow: hidden;
    }
    #${i} {
      position: relative;
      display: flex;
      flex: 1 1 auto;
      width: 100%;
      min-width: 0;
      min-height: 0;
      overflow: hidden;
      background: transparent;
    }
    #${i} #subagent-board {
      display: flex !important;
      flex: 1 1 auto;
      width: 100% !important;
      height: 100%;
      min-width: 0;
      min-height: 0;
      opacity: 1 !important;
      border-left: 0 !important;
      background: transparent !important;
    }
    #${i} #subagent-board-header { display: none !important; }
    #${i} #subagent-board-body { flex: 1 1 auto; min-height: 0; }
    #${i} .unified-agent-chat-shell { width: 100%; height: 100%; min-height: 0; }
    #${i} .unified-agent-chat-header { display: none !important; }
  `,document.head.appendChild(e)}function O(){let e=document.getElementById(b);if(e)return e;let t=document.getElementById("sidebarPriorityToggle"),n=document.getElementById("sidebarSearchToggle");return!t?.parentElement||n?.parentElement!==t.parentElement?null:(e=document.createElement("button"),e.className="sidebar-header-btn prom-bot-toggle",e.id=b,e.type="button",e.title="Prom Bot",e.setAttribute("aria-label","Turn on Prom Bot mode"),e.setAttribute("aria-pressed","false"),e.innerHTML=M,e.addEventListener("click",o=>{o.preventDefault(),o.stopPropagation(),u(!r)}),t.parentElement.insertBefore(e,t),e)}function N(){let e=document.getElementById(f);if(e)return e;let t=document.getElementById("sidebar-pinned-section");if(!t?.parentElement)return null;e=document.createElement("div"),e.className="sidebar-section prom-bot-sidebar-section",e.id=f,e.hidden=!0;let n=document.createElement("button");n.className="section-title sidebar-section-toggle",n.type="button",n.setAttribute("aria-controls",c);let o=k(S,!1);e.classList.toggle("is-collapsed",o),n.setAttribute("aria-expanded",String(!o)),n.innerHTML='<span>Subagents</span><span class="sidebar-section-decoration" aria-hidden="true"><span class="sidebar-section-icon">\u2726</span></span>';let a=document.createElement("div");return a.id=c,a.className="session-list",a.hidden=o,n.addEventListener("click",()=>{let s=!a.hidden;a.hidden=s,e.classList.toggle("is-collapsed",s),n.setAttribute("aria-expanded",String(!s)),T(S,s)}),e.append(n,a),t.parentElement.insertBefore(e,t),e}function $(e){let t=String(e?.effectiveModel||e?.model||"").trim();return t?t.includes("/")?t.split("/").pop():t:"Direct subagent chat"}function y(){let e=document.getElementById(c);if(e){if(e.replaceChildren(),!h.length){let t=document.createElement("div");t.className="prom-bot-sidebar-empty",t.textContent="No subagents configured.",e.appendChild(t);return}for(let t of h){let n=String(t?.id||"").trim();if(!n)continue;let o=document.createElement("button");o.type="button",o.className="prom-bot-agent-row",o.dataset.agentId=n,o.classList.toggle("active",n===l),o.setAttribute("aria-current",n===l?"page":"false");let a=document.createElement("span");a.className="prom-bot-agent-avatar",a.innerHTML=M;let s=document.createElement("span");s.className="prom-bot-agent-copy";let v=document.createElement("span");v.className="prom-bot-agent-name",v.textContent=String(t?.name||n);let B=document.createElement("span");B.className="prom-bot-agent-meta",B.textContent=$(t),s.append(v,B);let m=document.createElement("span");m.className=`prom-bot-agent-state${t?.lastRun?.inProgress?" working":""}`,m.title=t?.lastRun?.inProgress?"Working":"Ready",m.setAttribute("aria-label",m.title),o.append(a,s,m),o.addEventListener("click",()=>{D(n)}),e.appendChild(o)}}}async function E({force:e=!1}={}){return p&&!e||(p=(async()=>{try{let t=await C("/api/agents",{timeoutMs:8e3});return h=(Array.isArray(t?.agents)?t.agents:[]).filter(n=>n&&!n.default&&!n.isSynthetic),y(),h}catch(t){let n=document.getElementById(c);if(n){n.replaceChildren();let o=document.createElement("div");o.className="prom-bot-sidebar-empty",o.textContent="Could not load subagents.",n.appendChild(o)}return console.warn("[Prom Bot] Failed to load subagents:",t),[]}finally{p=null}})()),p}async function H(){return w||(w=Promise.all([import("./SubagentsPage-2RYJVA7E.js"),window.__PROM_UNIFIED_DESKTOP_CHAT?Promise.resolve():import("./ChatPage-Y5DUTPMJ.js")]).then(()=>{if(typeof window.openSubagentDetail!="function"||typeof window.switchSubagentTab!="function")throw new Error("Subagent chat runtime is unavailable.");return!0}).catch(e=>{throw w=null,e})),w}function F(){let e=document.getElementById(i);if(e)return e;let t=document.getElementById("chat-view");return t?(e=document.createElement("div"),e.id=i,e.setAttribute("role","region"),e.setAttribute("aria-label","Prom Bot direct chat"),t.appendChild(e),e):null}function z(e,t){if(!g.length){g=Array.from(e.children).filter(n=>n!==t).map(n=>({node:n,hidden:n.hidden===!0,ariaHidden:n.getAttribute("aria-hidden")}));for(let n of g)n.node.hidden=!0,n.node.setAttribute("aria-hidden","true")}}function K(){for(let e of g)e.node?.isConnected&&(e.node.hidden=e.hidden,e.ariaHidden==null?e.node.removeAttribute("aria-hidden"):e.node.setAttribute("aria-hidden",e.ariaHidden));g=[]}function U(){let e=document.getElementById("subagent-board"),t=document.getElementById("chat-view"),n=F();if(!e||!t||!n)throw new Error("Prom Bot chat surface is unavailable.");d||(d=e.parentNode,x=e.nextSibling),z(t,n),e.parentNode!==n&&n.appendChild(e),e.style.display="flex",e.style.width="100%",e.style.opacity="1",e.style.borderLeft="0",t.classList.add("prom-bot-chat-active")}function L(){let e=document.getElementById("subagent-board");e&&d&&e.parentNode!==d&&(x?.parentNode===d?d.insertBefore(e,x):d.appendChild(e)),K(),document.getElementById(i)?.remove(),document.getElementById("chat-view")?.classList.remove("prom-bot-chat-active")}function P({keepMode:e=!0}={}){if(!(!l&&!document.getElementById(i))){L(),l="",window.promBotActiveAgentId="",y();try{window.closeSubagentDetail?.()}catch(t){console.warn("[Prom Bot] Could not close subagent detail:",t)}e||u(!1)}}async function D(e){let t=String(e||"").trim();if(t){r||u(!0);try{await H(),h.some(n=>String(n?.id||"")===t)||await E({force:!0}),typeof window.setMode=="function"&&window.setMode("chat"),await window.openSubagentDetail(t),await window.switchSubagentTab("chat",t),U(),l=t,window.promBotActiveAgentId=t,y(),requestAnimationFrame(()=>document.getElementById("subagent-chat-input")?.focus({preventScroll:!0}))}catch(n){console.error("[Prom Bot] Could not open subagent chat:",n),L(),l="",window.promBotActiveAgentId="",y(),typeof window.showToast=="function"&&window.showToast("Prom Bot",n?.message||"Could not open subagent chat.","error")}}}function V(){let e=O(),t=N();e&&(e.classList.toggle("prom-bot-active",r),e.setAttribute("aria-pressed",String(r)),e.setAttribute("aria-label",r?"Turn off Prom Bot mode":"Turn on Prom Bot mode"),e.title=r?"Prom Bot \xB7 On":"Prom Bot"),t&&(t.hidden=!r)}function u(e,{persist:t=!0}={}){return r=e===!0,window.promBotMode=r,t&&T(_,r),V(),r?E():P({keepMode:!0}),r}function Y(){if(A)return;let e=document.getElementById("sidebar");e&&(A=!0,e.addEventListener("click",t=>{if(!l)return;let n=t.target instanceof Element?t.target:null;n&&(n.closest(`#${b}`)||n.closest(`#${f}`)||n.closest(".sidebar-header-btn")||P({keepMode:!0}))},!0))}function I(){R(),O(),N(),Y(),u(k(_,!1),{persist:!1})}window.setPromBotMode=u;window.togglePromBotMode=()=>u(!r);window.refreshPromBotAgents=E;window.openPromBotAgent=D;window.closePromBotChat=P;window.promBotActiveAgentId="";window.promBotMode=!1;document.readyState==="loading"?document.addEventListener("DOMContentLoaded",I,{once:!0}):I();
