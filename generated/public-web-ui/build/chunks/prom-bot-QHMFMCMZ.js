import{a as z,c as F,d as V}from"./chunk-UGPXJRDS.js";import{b as O}from"./chunk-JF4LWGNM.js";import"./chunk-EPSJJCWL.js";var U="prometheus_prom_bot_mode_v1",q="prometheus_prom_bot_section_collapsed_v1",B="sidebarPromBotToggle",x="prom-bot-sidebar-section",g="prom-bot-subagents-list",d="prom-bot-main-surface",S="prom-bot-teams-list";var s=!1,f=[],L=[],l="",m="",w=null,y=null,A=null,I=null,u=new Map,v=[],G=!1,te='<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="4" y="5" width="8" height="7" rx="2"/><circle cx="6" cy="8" r="1" fill="currentColor" stroke="none"/><circle cx="10" cy="8" r="1" fill="currentColor" stroke="none"/><line x1="8" y1="2" x2="8" y2="5"/><circle cx="8" cy="1.5" r="1" fill="currentColor" stroke="none"/></svg>';function N(e,t="",o="prom-bot"){let n=String(window.activeChatSessionId||window.state?.activeChatSessionId||window.agentSessionId||"").trim();n&&(window.__PROM_CHAT_TITLE_OVERRIDE={sessionId:n,title:String(e||"").trim(),subtitle:String(t||"").trim(),source:o},window.syncChatTopbarTitle?.(),typeof window.refreshPromMultiChatTabs=="function"?window.refreshPromMultiChatTabs():window.dispatchEvent(new CustomEvent("prometheus:chat-title-override-changed")))}function E(e=""){let t=window.__PROM_CHAT_TITLE_OVERRIDE;!t||e&&t.source!==e||(delete window.__PROM_CHAT_TITLE_OVERRIDE,window.syncChatTopbarTitle?.(),typeof window.refreshPromMultiChatTabs=="function"?window.refreshPromMultiChatTabs():window.dispatchEvent(new CustomEvent("prometheus:chat-title-override-changed")))}function Y(e,t=!1){try{let o=localStorage.getItem(e);return o==null?t:o==="1"||o==="true"}catch{return t}}function Q(e,t){try{localStorage.setItem(e,t?"1":"0")}catch{}}function oe(){if(document.getElementById("prom-bot-styles"))return;let e=document.createElement("style");e.id="prom-bot-styles",e.textContent=`
    #${B}.prom-bot-active {
      color: var(--pm-gold, var(--brand));
      background: var(--sidebar-active-bg, rgba(214,183,94,.14));
      border-color: color-mix(in srgb, var(--pm-gold, var(--brand)) 48%, transparent);
    }
    #${B} svg { width: 20px; height: 20px; }
    #${x}[hidden] { display: none !important; }
    #${g} { display: flex; flex-direction: column; gap: 2px; }
    #${g}[hidden] { display: none !important; }
    #${x}.is-collapsed > :not(.sidebar-section-toggle) { display: none !important; }
    #${S} { display: flex; flex-direction: column; gap: 2px; margin-top: 6px; }
    #${S}:empty { display: none; }
    .prom-bot-teams-label { padding:3px 8px 4px; font-size:9px; font-weight:800; letter-spacing:.11em; text-transform:uppercase; color:var(--sidebar-muted,var(--muted)); }
    .prom-bot-team-avatar { font-size: 15px; line-height: 1; }
    .prom-bot-agent-state.paused { opacity: .45; }
    /* Inside Prom Bot the team board is the chat; its close button would
       blank the surface, so the sidebar is the way out. */
    #${d}[data-kind="team"] #team-board-header button[onclick="closeTeamBoard()"] { display: none !important; }
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
    #${d} {
      position: relative;
      display: flex;
      flex: 1 1 auto;
      width: 100%;
      min-width: 0;
      min-height: 0;
      overflow: hidden;
      background: transparent;
    }
    #${d} #subagent-board {
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
    #${d} #subagent-board-header { display: none !important; }
    #${d} #subagent-board-body { flex: 1 1 auto; min-height: 0; }
    #${d} .unified-agent-chat-shell { width: 100%; height: 100%; min-height: 0; }
    #${d} .unified-agent-chat-header { display: none !important; }
  `,document.head.appendChild(e)}function W(){let e=document.getElementById(B);if(e)return e;let t=document.getElementById("sidebarPriorityToggle"),o=document.getElementById("sidebarSearchToggle");return!t?.parentElement||o?.parentElement!==t.parentElement?null:(e=document.createElement("button"),e.className="sidebar-header-btn prom-bot-toggle",e.id=B,e.type="button",e.title="Prom Bot",e.setAttribute("aria-label","Turn on Prom Bot mode"),e.setAttribute("aria-pressed","false"),e.innerHTML=te,e.addEventListener("click",n=>{n.preventDefault(),n.stopPropagation(),h(!s)}),t.parentElement.insertBefore(e,t),e)}function j(){let e=document.getElementById(x);if(e)return e;let t=document.getElementById("sidebar-pinned-section");if(!t?.parentElement)return null;e=document.createElement("div"),e.className="sidebar-section prom-bot-sidebar-section",e.id=x,e.hidden=!0;let o=document.createElement("button");o.className="section-title sidebar-section-toggle",o.type="button",o.setAttribute("aria-controls",g);let n=Y(q,!1);e.classList.toggle("is-collapsed",n),o.setAttribute("aria-expanded",String(!n)),o.innerHTML='<span>Subagents</span><span class="sidebar-section-decoration" aria-hidden="true"><span class="sidebar-section-icon">\u2726</span></span>';let r=document.createElement("div");r.id=g,r.className="session-list",r.hidden=n,o.addEventListener("click",()=>{let i=!r.hidden;r.hidden=i,e.classList.toggle("is-collapsed",i),o.setAttribute("aria-expanded",String(!i)),Q(q,i)});let a=document.createElement("div");return a.id=S,a.className="prom-bot-teams-list",e.append(o,r,a),t.parentElement.insertBefore(e,t),e}function ne(){return String(document.getElementById("prom-bot-roster-search")?.value||"").trim().toLowerCase()}function P(){let e=document.getElementById(S);if(!e)return;e.replaceChildren();let t=ne(),o=L.filter(r=>t?`${r?.name||""} ${r?.description||""}`.toLowerCase().includes(t):!0);if(!o.length)return;let n=document.createElement("div");n.className="prom-bot-teams-label",n.textContent="Teams",e.appendChild(n);for(let r of o){let a=String(r?.id||"").trim();if(!a)continue;let i=document.createElement("button");i.type="button",i.className="prom-bot-agent-row prom-bot-team-row",i.dataset.teamId=a,i.classList.toggle("active",a===m),i.setAttribute("aria-current",a===m?"page":"false");let p=document.createElement("span");p.className="prom-bot-agent-avatar prom-bot-team-avatar",p.innerHTML=V(Array.isArray(r?.subagentIds)?r.subagentIds:[],{size:14,max:3});let c=document.createElement("span");c.className="prom-bot-agent-copy";let _=document.createElement("span");_.className="prom-bot-agent-name",_.textContent=String(r?.name||a);let M=document.createElement("span");M.className="prom-bot-agent-meta";let H=Array.isArray(r?.subagentIds)?r.subagentIds.length:0,k=r?.manager?.paused===!0;M.textContent=`${H} member${H===1?"":"s"} + manager${k?" \xB7 paused":""}`,c.append(_,M);let b=document.createElement("span");b.className=`prom-bot-agent-state${k?" paused":""}`,b.title=k?"Paused":"Ready",b.setAttribute("aria-label",b.title),i.append(p,c,b),i.addEventListener("click",()=>{Z(a)}),e.appendChild(i)}}async function R({force:e=!1}={}){return y&&!e||(y=(async()=>{try{let t=await O("/api/teams",{timeoutMs:8e3});L=Array.isArray(t?.teams)?t.teams.filter(o=>o&&o.id):[]}catch(t){console.warn("[Prom Bot] Failed to load teams:",t)}finally{y=null}return P(),L})()),y}function re(e){let t=String(e?.effectiveModel||e?.model||"").trim();return t?t.includes("/")?t.split("/").pop():t:"Direct subagent chat"}function T(){let e=document.getElementById(g);if(e){if(e.replaceChildren(),!f.length){let t=document.createElement("div");t.className="prom-bot-sidebar-empty",t.textContent="No subagents configured.",e.appendChild(t);return}for(let t of f){let o=String(t?.id||"").trim();if(!o)continue;let n=document.createElement("button");n.type="button",n.className="prom-bot-agent-row",n.dataset.agentId=o,n.classList.toggle("active",o===l),n.setAttribute("aria-current",o===l?"page":"false");let r=document.createElement("span");r.className="prom-bot-agent-avatar",r.innerHTML=F(t,{size:18});let a=document.createElement("span");a.className="prom-bot-agent-copy";let i=document.createElement("span");i.className="prom-bot-agent-name",i.textContent=String(t?.name||o);let p=document.createElement("span");p.className="prom-bot-agent-meta",p.textContent=re(t),a.append(i,p);let c=document.createElement("span");c.className=`prom-bot-agent-state${t?.lastRun?.inProgress?" working":""}`,c.title=t?.lastRun?.inProgress?"Working":"Ready",c.setAttribute("aria-label",c.title),n.append(r,a,c),n.addEventListener("click",()=>{ee(o)}),e.appendChild(n)}}}async function $({force:e=!1}={}){return w&&!e||(w=(async()=>{try{let t=await O("/api/agents",{timeoutMs:8e3});return z(Array.isArray(t?.agents)?t.agents:[]),f=(Array.isArray(t?.agents)?t.agents:[]).filter(o=>o&&!o.default&&!o.isSynthetic),T(),f}catch(t){let o=document.getElementById(g);if(o){o.replaceChildren();let n=document.createElement("div");n.className="prom-bot-sidebar-empty",n.textContent="Could not load subagents.",o.appendChild(n)}return console.warn("[Prom Bot] Failed to load subagents:",t),[]}finally{w=null}})()),w}async function ae(){return A||(A=Promise.all([import("./SubagentsPage-KLCQQY4V.js"),window.__PROM_UNIFIED_DESKTOP_CHAT?Promise.resolve():import("./ChatPage-AM44O2GY.js")]).then(()=>{if(typeof window.openSubagentDetail!="function"||typeof window.switchSubagentTab!="function")throw new Error("Subagent chat runtime is unavailable.");return!0}).catch(e=>{throw A=null,e})),A}function ie(){let e=document.getElementById(d);if(e)return e;let t=document.getElementById("chat-view");return t?(e=document.createElement("div"),e.id=d,e.setAttribute("role","region"),e.setAttribute("aria-label","Prom Bot direct chat"),t.appendChild(e),e):null}function se(e,t){if(!v.length){v=Array.from(e.children).filter(o=>o!==t).map(o=>({node:o,hidden:o.hidden===!0,ariaHidden:o.getAttribute("aria-hidden")}));for(let o of v)o.node.hidden=!0,o.node.setAttribute("aria-hidden","true")}}function de(){for(let e of v)e.node?.isConnected&&(e.node.hidden=e.hidden,e.ariaHidden==null?e.node.removeAttribute("aria-hidden"):e.node.setAttribute("aria-hidden",e.ariaHidden));v=[]}function J(e){let t=u.get(e),o=document.getElementById(e);o&&t?.parent&&o.parentNode!==t.parent&&(t.next?.parentNode===t.parent?t.parent.insertBefore(o,t.next):t.parent.appendChild(o)),u.delete(e)}function X(e,t){let o=document.getElementById(e),n=document.getElementById("chat-view"),r=ie();if(!o||!n||!r)throw new Error("Prom Bot chat surface is unavailable.");for(let a of Array.from(u.keys()))a!==e&&J(a);u.has(e)||u.set(e,{parent:o.parentNode,next:o.nextSibling}),se(n,r),o.parentNode!==r&&r.appendChild(o),o.style.display="flex",o.style.width="100%",o.style.opacity="1",o.style.borderLeft="0",r.dataset.kind=t,n.classList.add("prom-bot-chat-active")}function ce(){X("subagent-board","subagent")}function D(){for(let e of Array.from(u.keys()))J(e);de(),document.getElementById(d)?.remove(),document.getElementById("chat-view")?.classList.remove("prom-bot-chat-active")}var le=D;function C({keepMode:e=!0}={}){if(!l&&!m&&!document.getElementById(d)){E("prom-bot");return}let t=!!m||u.has("team-board"),o=!!l||u.has("subagent-board")||!t;if(D(),E("prom-bot"),l="",m="",window.promBotActiveAgentId="",window.promBotActiveTeamId="",T(),P(),o)try{window.closeSubagentDetail?.()}catch(n){console.warn("[Prom Bot] Could not close subagent detail:",n)}if(t)try{window.closeTeamBoard?.()}catch(n){console.warn("[Prom Bot] Could not close team board:",n)}e||h(!1)}async function me(){return I||(I=import("./TeamsPage-FC27GAPD.js").then(()=>{if(typeof window.openTeamBoard!="function"||typeof window.switchTeamTab!="function")throw new Error("Team chat runtime is unavailable.");return!0}).catch(e=>{throw I=null,e})),I}async function Z(e){let t=String(e||"").trim();if(t){s||h(!0);try{window.closePromBotGroup?.(),l&&C({keepMode:!0}),await me(),typeof window.setMode=="function"&&window.setMode("chat"),await window.refreshTeams?.();let n=(Array.isArray(window.teamsData)?window.teamsData:[]).find(r=>String(r?.id||"")===t);if(!n)throw new Error("That team no longer exists.");await window.openTeamBoard(t),await window.switchTeamTab("chat",t),X("team-board","team"),m=t,window.promBotActiveTeamId=t,N(n.name||t,"Prom Bot \xB7 Team chat","prom-bot"),T(),P(),R({force:!0}),requestAnimationFrame(()=>document.getElementById("team-chat-input")?.focus({preventScroll:!0}))}catch(o){console.error("[Prom Bot] Could not open team chat:",o),D(),E("prom-bot"),m="",window.promBotActiveTeamId="",P(),typeof window.showToast=="function"&&window.showToast("Prom Bot",o?.message||"Could not open team chat.","error")}}}async function ee(e){let t=String(e||"").trim();if(t){s||h(!0);try{window.closePromBotGroup?.(),m&&C({keepMode:!0}),await ae(),f.some(n=>String(n?.id||"")===t)||await $({force:!0}),typeof window.setMode=="function"&&window.setMode("chat"),await window.refreshSubagents?.(),await window.openSubagentDetail(t),await window.switchSubagentTab("chat",t),ce(),l=t,window.promBotActiveAgentId=t;let o=f.find(n=>String(n?.id||"")===t);N(o?.name||t,"Prom Bot \xB7 Subagent chat","prom-bot"),T(),requestAnimationFrame(()=>document.getElementById("subagent-chat-input")?.focus({preventScroll:!0}))}catch(o){console.error("[Prom Bot] Could not open subagent chat:",o),le(),E("prom-bot"),l="",window.promBotActiveAgentId="",T(),typeof window.showToast=="function"&&window.showToast("Prom Bot",o?.message||"Could not open subagent chat.","error")}}}function ue(){let e=W(),t=j();e&&(e.classList.toggle("prom-bot-active",s),e.setAttribute("aria-pressed",String(s)),e.setAttribute("aria-label",s?"Turn off Prom Bot mode":"Turn on Prom Bot mode"),e.title=s?"Prom Bot \xB7 On":"Prom Bot"),t&&(t.hidden=!s)}function h(e,{persist:t=!0}={}){return s=e===!0,window.promBotMode=s,t&&Q(U,s),ue(),s?($(),R()):(window.closePromBotGroup?.(),C({keepMode:!0})),s}function pe(){if(G)return;let e=document.getElementById("sidebar");e&&(G=!0,e.addEventListener("click",t=>{if(!l&&!m)return;let o=t.target instanceof Element?t.target:null;o&&(o.closest(`#${B}`)||o.closest(`#${x}`)||o.closest(".sidebar-header-btn")||C({keepMode:!0}))},!0))}function K(){oe(),W(),j(),pe(),document.addEventListener("input",e=>{e.target instanceof Element&&e.target.id==="prom-bot-roster-search"&&P()}),h(Y(U,!1),{persist:!1})}window.setPromBotMode=h;window.togglePromBotMode=()=>h(!s);window.refreshPromBotAgents=$;window.openPromBotAgent=ee;window.refreshPromBotTeams=R;window.openPromBotTeam=Z;window.closePromBotChat=C;window.promBotActiveTeamId="";window.setPromChatTitleOverride=N;window.clearPromChatTitleOverride=E;window.promBotActiveAgentId="";window.promBotMode=!1;document.readyState==="loading"?document.addEventListener("DOMContentLoaded",K,{once:!0}):K();
