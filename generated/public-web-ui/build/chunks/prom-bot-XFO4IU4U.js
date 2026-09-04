import{b as S}from"./chunk-JF4LWGNM.js";import"./chunk-EPSJJCWL.js";var A="prometheus_prom_bot_mode_v1",T="prometheus_prom_bot_section_collapsed_v1",h="sidebarPromBotToggle",f="prom-bot-sidebar-section",c="prom-bot-subagents-list",a="prom-bot-main-surface",r=!1,m=[],l="",g=null,w=null,d=null,x=null,b=[],_=!1,M='<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="4" y="5" width="8" height="7" rx="2"/><circle cx="6" cy="8" r="1" fill="currentColor" stroke="none"/><circle cx="10" cy="8" r="1" fill="currentColor" stroke="none"/><line x1="8" y1="2" x2="8" y2="5"/><circle cx="8" cy="1.5" r="1" fill="currentColor" stroke="none"/></svg>';function O(e,t="",o="prom-bot"){let n=String(window.activeChatSessionId||window.state?.activeChatSessionId||window.agentSessionId||"").trim();n&&(window.__PROM_CHAT_TITLE_OVERRIDE={sessionId:n,title:String(e||"").trim(),subtitle:String(t||"").trim(),source:o},window.syncChatTopbarTitle?.(),typeof window.refreshPromMultiChatTabs=="function"?window.refreshPromMultiChatTabs():window.dispatchEvent(new CustomEvent("prometheus:chat-title-override-changed")))}function v(e=""){let t=window.__PROM_CHAT_TITLE_OVERRIDE;!t||e&&t.source!==e||(delete window.__PROM_CHAT_TITLE_OVERRIDE,window.syncChatTopbarTitle?.(),typeof window.refreshPromMultiChatTabs=="function"?window.refreshPromMultiChatTabs():window.dispatchEvent(new CustomEvent("prometheus:chat-title-override-changed")))}function k(e,t=!1){try{let o=localStorage.getItem(e);return o==null?t:o==="1"||o==="true"}catch{return t}}function R(e,t){try{localStorage.setItem(e,t?"1":"0")}catch{}}function H(){if(document.getElementById("prom-bot-styles"))return;let e=document.createElement("style");e.id="prom-bot-styles",e.textContent=`
    #${h}.prom-bot-active {
      color: var(--pm-gold, var(--brand));
      background: var(--sidebar-active-bg, rgba(214,183,94,.14));
      border-color: color-mix(in srgb, var(--pm-gold, var(--brand)) 48%, transparent);
    }
    #${h} svg { width: 20px; height: 20px; }
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
    /* The regular chat children have authored display rules (for example
       #chat-messages is a flex scroller), so the browser's bare [hidden]
       attribute cannot reliably suppress them. Prom Bot must leave exactly
       one visible surface in #chat-view. */
    #chat-view.prom-bot-chat-active > [hidden],
    #chat-view.prom-bot-group-active > [hidden] {
      display: none !important;
    }
    #${a} {
      position: relative;
      display: flex;
      flex: 1 1 auto;
      width: 100%;
      min-width: 0;
      min-height: 0;
      overflow: hidden;
      background: transparent;
    }
    #${a} #subagent-board {
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
    #${a} #subagent-board-header { display: none !important; }
    #${a} #subagent-board-body { flex: 1 1 auto; min-height: 0; }
    #${a} .unified-agent-chat-shell { width: 100%; height: 100%; min-height: 0; }
    #${a} .unified-agent-chat-header { display: none !important; }
  `,document.head.appendChild(e)}function L(){let e=document.getElementById(h);if(e)return e;let t=document.getElementById("sidebarPriorityToggle"),o=document.getElementById("sidebarSearchToggle");return!t?.parentElement||o?.parentElement!==t.parentElement?null:(e=document.createElement("button"),e.className="sidebar-header-btn prom-bot-toggle",e.id=h,e.type="button",e.title="Prom Bot",e.setAttribute("aria-label","Turn on Prom Bot mode"),e.setAttribute("aria-pressed","false"),e.innerHTML=M,e.addEventListener("click",n=>{n.preventDefault(),n.stopPropagation(),u(!r)}),t.parentElement.insertBefore(e,t),e)}function N(){let e=document.getElementById(f);if(e)return e;let t=document.getElementById("sidebar-pinned-section");if(!t?.parentElement)return null;e=document.createElement("div"),e.className="sidebar-section prom-bot-sidebar-section",e.id=f,e.hidden=!0;let o=document.createElement("button");o.className="section-title sidebar-section-toggle",o.type="button",o.setAttribute("aria-controls",c);let n=k(T,!1);e.classList.toggle("is-collapsed",n),o.setAttribute("aria-expanded",String(!n)),o.innerHTML='<span>Subagents</span><span class="sidebar-section-decoration" aria-hidden="true"><span class="sidebar-section-icon">\u2726</span></span>';let i=document.createElement("div");return i.id=c,i.className="session-list",i.hidden=n,o.addEventListener("click",()=>{let s=!i.hidden;i.hidden=s,e.classList.toggle("is-collapsed",s),o.setAttribute("aria-expanded",String(!s)),R(T,s)}),e.append(o,i),t.parentElement.insertBefore(e,t),e}function V(e){let t=String(e?.effectiveModel||e?.model||"").trim();return t?t.includes("/")?t.split("/").pop():t:"Direct subagent chat"}function y(){let e=document.getElementById(c);if(e){if(e.replaceChildren(),!m.length){let t=document.createElement("div");t.className="prom-bot-sidebar-empty",t.textContent="No subagents configured.",e.appendChild(t);return}for(let t of m){let o=String(t?.id||"").trim();if(!o)continue;let n=document.createElement("button");n.type="button",n.className="prom-bot-agent-row",n.dataset.agentId=o,n.classList.toggle("active",o===l),n.setAttribute("aria-current",o===l?"page":"false");let i=document.createElement("span");i.className="prom-bot-agent-avatar",i.innerHTML=M;let s=document.createElement("span");s.className="prom-bot-agent-copy";let B=document.createElement("span");B.className="prom-bot-agent-name",B.textContent=String(t?.name||o);let E=document.createElement("span");E.className="prom-bot-agent-meta",E.textContent=V(t),s.append(B,E);let p=document.createElement("span");p.className=`prom-bot-agent-state${t?.lastRun?.inProgress?" working":""}`,p.title=t?.lastRun?.inProgress?"Working":"Ready",p.setAttribute("aria-label",p.title),n.append(i,s,p),n.addEventListener("click",()=>{$(o)}),e.appendChild(n)}}}async function P({force:e=!1}={}){return g&&!e||(g=(async()=>{try{let t=await S("/api/agents",{timeoutMs:8e3});return m=(Array.isArray(t?.agents)?t.agents:[]).filter(o=>o&&!o.default&&!o.isSynthetic),y(),m}catch(t){let o=document.getElementById(c);if(o){o.replaceChildren();let n=document.createElement("div");n.className="prom-bot-sidebar-empty",n.textContent="Could not load subagents.",o.appendChild(n)}return console.warn("[Prom Bot] Failed to load subagents:",t),[]}finally{g=null}})()),g}async function F(){return w||(w=Promise.all([import("./SubagentsPage-IU5EFTF5.js"),window.__PROM_UNIFIED_DESKTOP_CHAT?Promise.resolve():import("./ChatPage-ZA3QTC54.js")]).then(()=>{if(typeof window.openSubagentDetail!="function"||typeof window.switchSubagentTab!="function")throw new Error("Subagent chat runtime is unavailable.");return!0}).catch(e=>{throw w=null,e})),w}function z(){let e=document.getElementById(a);if(e)return e;let t=document.getElementById("chat-view");return t?(e=document.createElement("div"),e.id=a,e.setAttribute("role","region"),e.setAttribute("aria-label","Prom Bot direct chat"),t.appendChild(e),e):null}function K(e,t){if(!b.length){b=Array.from(e.children).filter(o=>o!==t).map(o=>({node:o,hidden:o.hidden===!0,ariaHidden:o.getAttribute("aria-hidden")}));for(let o of b)o.node.hidden=!0,o.node.setAttribute("aria-hidden","true")}}function U(){for(let e of b)e.node?.isConnected&&(e.node.hidden=e.hidden,e.ariaHidden==null?e.node.removeAttribute("aria-hidden"):e.node.setAttribute("aria-hidden",e.ariaHidden));b=[]}function G(){let e=document.getElementById("subagent-board"),t=document.getElementById("chat-view"),o=z();if(!e||!t||!o)throw new Error("Prom Bot chat surface is unavailable.");d||(d=e.parentNode,x=e.nextSibling),K(t,o),e.parentNode!==o&&o.appendChild(e),e.style.display="flex",e.style.width="100%",e.style.opacity="1",e.style.borderLeft="0",t.classList.add("prom-bot-chat-active")}function D(){let e=document.getElementById("subagent-board");e&&d&&e.parentNode!==d&&(x?.parentNode===d?d.insertBefore(e,x):d.appendChild(e)),U(),document.getElementById(a)?.remove(),document.getElementById("chat-view")?.classList.remove("prom-bot-chat-active")}function C({keepMode:e=!0}={}){if(!l&&!document.getElementById(a)){v("prom-bot");return}D(),v("prom-bot"),l="",window.promBotActiveAgentId="",y();try{window.closeSubagentDetail?.()}catch(t){console.warn("[Prom Bot] Could not close subagent detail:",t)}e||u(!1)}async function $(e){let t=String(e||"").trim();if(t){r||u(!0);try{window.closePromBotGroup?.(),await F(),m.some(n=>String(n?.id||"")===t)||await P({force:!0}),typeof window.setMode=="function"&&window.setMode("chat"),await window.refreshSubagents?.(),await window.openSubagentDetail(t),await window.switchSubagentTab("chat",t),G(),l=t,window.promBotActiveAgentId=t;let o=m.find(n=>String(n?.id||"")===t);O(o?.name||t,"Prom Bot \xB7 Subagent chat","prom-bot"),y(),requestAnimationFrame(()=>document.getElementById("subagent-chat-input")?.focus({preventScroll:!0}))}catch(o){console.error("[Prom Bot] Could not open subagent chat:",o),D(),v("prom-bot"),l="",window.promBotActiveAgentId="",y(),typeof window.showToast=="function"&&window.showToast("Prom Bot",o?.message||"Could not open subagent chat.","error")}}}function Y(){let e=L(),t=N();e&&(e.classList.toggle("prom-bot-active",r),e.setAttribute("aria-pressed",String(r)),e.setAttribute("aria-label",r?"Turn off Prom Bot mode":"Turn on Prom Bot mode"),e.title=r?"Prom Bot \xB7 On":"Prom Bot"),t&&(t.hidden=!r)}function u(e,{persist:t=!0}={}){return r=e===!0,window.promBotMode=r,t&&R(A,r),Y(),r?P():(window.closePromBotGroup?.(),C({keepMode:!0})),r}function q(){if(_)return;let e=document.getElementById("sidebar");e&&(_=!0,e.addEventListener("click",t=>{if(!l)return;let o=t.target instanceof Element?t.target:null;o&&(o.closest(`#${h}`)||o.closest(`#${f}`)||o.closest(".sidebar-header-btn")||C({keepMode:!0}))},!0))}function I(){H(),L(),N(),q(),u(k(A,!1),{persist:!1})}window.setPromBotMode=u;window.togglePromBotMode=()=>u(!r);window.refreshPromBotAgents=P;window.openPromBotAgent=$;window.closePromBotChat=C;window.setPromChatTitleOverride=O;window.clearPromChatTitleOverride=v;window.promBotActiveAgentId="";window.promBotMode=!1;document.readyState==="loading"?document.addEventListener("DOMContentLoaded",I,{once:!0}):I();
