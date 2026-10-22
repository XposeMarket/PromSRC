import{b as L}from"./chunk-JF4LWGNM.js";import"./chunk-EPSJJCWL.js";var G="prometheus_prom_bot_mode_v1",z="prometheus_prom_bot_section_collapsed_v1",B="sidebarPromBotToggle",x="prom-bot-sidebar-section",f="prom-bot-subagents-list",d="prom-bot-main-surface",I="prom-bot-teams-list",ee='<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="5.5" cy="5.5" r="2"/><circle cx="11" cy="6" r="1.7"/><path d="M1.8 13c.4-2.2 1.9-3.4 3.7-3.4s3.3 1.2 3.7 3.4"/><path d="M9.6 9.9c.4-.2.9-.3 1.4-.3 1.5 0 2.7 1 3 2.9"/></svg>',s=!1,g=[],N=[],l="",m="",w=null,y=null,A=null,S=null,p=new Map,v=[],V=!1,K='<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="4" y="5" width="8" height="7" rx="2"/><circle cx="6" cy="8" r="1" fill="currentColor" stroke="none"/><circle cx="10" cy="8" r="1" fill="currentColor" stroke="none"/><line x1="8" y1="2" x2="8" y2="5"/><circle cx="8" cy="1.5" r="1" fill="currentColor" stroke="none"/></svg>';function R(e,t="",o="prom-bot"){let n=String(window.activeChatSessionId||window.state?.activeChatSessionId||window.agentSessionId||"").trim();n&&(window.__PROM_CHAT_TITLE_OVERRIDE={sessionId:n,title:String(e||"").trim(),subtitle:String(t||"").trim(),source:o},window.syncChatTopbarTitle?.(),typeof window.refreshPromMultiChatTabs=="function"?window.refreshPromMultiChatTabs():window.dispatchEvent(new CustomEvent("prometheus:chat-title-override-changed")))}function E(e=""){let t=window.__PROM_CHAT_TITLE_OVERRIDE;!t||e&&t.source!==e||(delete window.__PROM_CHAT_TITLE_OVERRIDE,window.syncChatTopbarTitle?.(),typeof window.refreshPromMultiChatTabs=="function"?window.refreshPromMultiChatTabs():window.dispatchEvent(new CustomEvent("prometheus:chat-title-override-changed")))}function U(e,t=!1){try{let o=localStorage.getItem(e);return o==null?t:o==="1"||o==="true"}catch{return t}}function j(e,t){try{localStorage.setItem(e,t?"1":"0")}catch{}}function te(){if(document.getElementById("prom-bot-styles"))return;let e=document.createElement("style");e.id="prom-bot-styles",e.textContent=`
    #${B}.prom-bot-active {
      color: var(--pm-gold, var(--brand));
      background: var(--sidebar-active-bg, rgba(214,183,94,.14));
      border-color: color-mix(in srgb, var(--pm-gold, var(--brand)) 48%, transparent);
    }
    #${B} svg { width: 20px; height: 20px; }
    #${x}[hidden] { display: none !important; }
    #${f} { display: flex; flex-direction: column; gap: 2px; }
    #${f}[hidden] { display: none !important; }
    #${x}.is-collapsed > :not(.sidebar-section-toggle) { display: none !important; }
    #${I} { display: flex; flex-direction: column; gap: 2px; margin-top: 6px; }
    #${I}:empty { display: none; }
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
  `,document.head.appendChild(e)}function Y(){let e=document.getElementById(B);if(e)return e;let t=document.getElementById("sidebarPriorityToggle"),o=document.getElementById("sidebarSearchToggle");return!t?.parentElement||o?.parentElement!==t.parentElement?null:(e=document.createElement("button"),e.className="sidebar-header-btn prom-bot-toggle",e.id=B,e.type="button",e.title="Prom Bot",e.setAttribute("aria-label","Turn on Prom Bot mode"),e.setAttribute("aria-pressed","false"),e.innerHTML=K,e.addEventListener("click",n=>{n.preventDefault(),n.stopPropagation(),h(!s)}),t.parentElement.insertBefore(e,t),e)}function Q(){let e=document.getElementById(x);if(e)return e;let t=document.getElementById("sidebar-pinned-section");if(!t?.parentElement)return null;e=document.createElement("div"),e.className="sidebar-section prom-bot-sidebar-section",e.id=x,e.hidden=!0;let o=document.createElement("button");o.className="section-title sidebar-section-toggle",o.type="button",o.setAttribute("aria-controls",f);let n=U(z,!1);e.classList.toggle("is-collapsed",n),o.setAttribute("aria-expanded",String(!n)),o.innerHTML='<span>Subagents</span><span class="sidebar-section-decoration" aria-hidden="true"><span class="sidebar-section-icon">\u2726</span></span>';let r=document.createElement("div");r.id=f,r.className="session-list",r.hidden=n,o.addEventListener("click",()=>{let i=!r.hidden;r.hidden=i,e.classList.toggle("is-collapsed",i),o.setAttribute("aria-expanded",String(!i)),j(z,i)});let a=document.createElement("div");return a.id=I,a.className="prom-bot-teams-list",e.append(o,r,a),t.parentElement.insertBefore(e,t),e}function oe(){return String(document.getElementById("prom-bot-roster-search")?.value||"").trim().toLowerCase()}function T(){let e=document.getElementById(I);if(!e)return;e.replaceChildren();let t=oe(),o=N.filter(r=>t?`${r?.name||""} ${r?.description||""}`.toLowerCase().includes(t):!0);if(!o.length)return;let n=document.createElement("div");n.className="prom-bot-teams-label",n.textContent="Teams",e.appendChild(n);for(let r of o){let a=String(r?.id||"").trim();if(!a)continue;let i=document.createElement("button");i.type="button",i.className="prom-bot-agent-row prom-bot-team-row",i.dataset.teamId=a,i.classList.toggle("active",a===m),i.setAttribute("aria-current",a===m?"page":"false");let u=document.createElement("span");u.className="prom-bot-agent-avatar prom-bot-team-avatar";let c=String(r?.emoji||"").trim();c&&c.toLowerCase()!=="team"?u.textContent=c:u.innerHTML=ee;let _=document.createElement("span");_.className="prom-bot-agent-copy";let M=document.createElement("span");M.className="prom-bot-agent-name",M.textContent=String(r?.name||a);let k=document.createElement("span");k.className="prom-bot-agent-meta";let F=Array.isArray(r?.subagentIds)?r.subagentIds.length:0,O=r?.manager?.paused===!0;k.textContent=`${F} member${F===1?"":"s"} + manager${O?" \xB7 paused":""}`,_.append(M,k);let b=document.createElement("span");b.className=`prom-bot-agent-state${O?" paused":""}`,b.title=O?"Paused":"Ready",b.setAttribute("aria-label",b.title),i.append(u,_,b),i.addEventListener("click",()=>{X(a)}),e.appendChild(i)}}async function $({force:e=!1}={}){return y&&!e||(y=(async()=>{try{let t=await L("/api/teams",{timeoutMs:8e3});N=Array.isArray(t?.teams)?t.teams.filter(o=>o&&o.id):[]}catch(t){console.warn("[Prom Bot] Failed to load teams:",t)}finally{y=null}return T(),N})()),y}function ne(e){let t=String(e?.effectiveModel||e?.model||"").trim();return t?t.includes("/")?t.split("/").pop():t:"Direct subagent chat"}function P(){let e=document.getElementById(f);if(e){if(e.replaceChildren(),!g.length){let t=document.createElement("div");t.className="prom-bot-sidebar-empty",t.textContent="No subagents configured.",e.appendChild(t);return}for(let t of g){let o=String(t?.id||"").trim();if(!o)continue;let n=document.createElement("button");n.type="button",n.className="prom-bot-agent-row",n.dataset.agentId=o,n.classList.toggle("active",o===l),n.setAttribute("aria-current",o===l?"page":"false");let r=document.createElement("span");r.className="prom-bot-agent-avatar",r.innerHTML=K;let a=document.createElement("span");a.className="prom-bot-agent-copy";let i=document.createElement("span");i.className="prom-bot-agent-name",i.textContent=String(t?.name||o);let u=document.createElement("span");u.className="prom-bot-agent-meta",u.textContent=ne(t),a.append(i,u);let c=document.createElement("span");c.className=`prom-bot-agent-state${t?.lastRun?.inProgress?" working":""}`,c.title=t?.lastRun?.inProgress?"Working":"Ready",c.setAttribute("aria-label",c.title),n.append(r,a,c),n.addEventListener("click",()=>{Z(o)}),e.appendChild(n)}}}async function D({force:e=!1}={}){return w&&!e||(w=(async()=>{try{let t=await L("/api/agents",{timeoutMs:8e3});return g=(Array.isArray(t?.agents)?t.agents:[]).filter(o=>o&&!o.default&&!o.isSynthetic),P(),g}catch(t){let o=document.getElementById(f);if(o){o.replaceChildren();let n=document.createElement("div");n.className="prom-bot-sidebar-empty",n.textContent="Could not load subagents.",o.appendChild(n)}return console.warn("[Prom Bot] Failed to load subagents:",t),[]}finally{w=null}})()),w}async function re(){return A||(A=Promise.all([import("./SubagentsPage-CF3JREO7.js"),window.__PROM_UNIFIED_DESKTOP_CHAT?Promise.resolve():import("./ChatPage-USXA6DWY.js")]).then(()=>{if(typeof window.openSubagentDetail!="function"||typeof window.switchSubagentTab!="function")throw new Error("Subagent chat runtime is unavailable.");return!0}).catch(e=>{throw A=null,e})),A}function ae(){let e=document.getElementById(d);if(e)return e;let t=document.getElementById("chat-view");return t?(e=document.createElement("div"),e.id=d,e.setAttribute("role","region"),e.setAttribute("aria-label","Prom Bot direct chat"),t.appendChild(e),e):null}function ie(e,t){if(!v.length){v=Array.from(e.children).filter(o=>o!==t).map(o=>({node:o,hidden:o.hidden===!0,ariaHidden:o.getAttribute("aria-hidden")}));for(let o of v)o.node.hidden=!0,o.node.setAttribute("aria-hidden","true")}}function se(){for(let e of v)e.node?.isConnected&&(e.node.hidden=e.hidden,e.ariaHidden==null?e.node.removeAttribute("aria-hidden"):e.node.setAttribute("aria-hidden",e.ariaHidden));v=[]}function W(e){let t=p.get(e),o=document.getElementById(e);o&&t?.parent&&o.parentNode!==t.parent&&(t.next?.parentNode===t.parent?t.parent.insertBefore(o,t.next):t.parent.appendChild(o)),p.delete(e)}function J(e,t){let o=document.getElementById(e),n=document.getElementById("chat-view"),r=ae();if(!o||!n||!r)throw new Error("Prom Bot chat surface is unavailable.");for(let a of Array.from(p.keys()))a!==e&&W(a);p.has(e)||p.set(e,{parent:o.parentNode,next:o.nextSibling}),ie(n,r),o.parentNode!==r&&r.appendChild(o),o.style.display="flex",o.style.width="100%",o.style.opacity="1",o.style.borderLeft="0",r.dataset.kind=t,n.classList.add("prom-bot-chat-active")}function de(){J("subagent-board","subagent")}function H(){for(let e of Array.from(p.keys()))W(e);se(),document.getElementById(d)?.remove(),document.getElementById("chat-view")?.classList.remove("prom-bot-chat-active")}var ce=H;function C({keepMode:e=!0}={}){if(!l&&!m&&!document.getElementById(d)){E("prom-bot");return}let t=!!m||p.has("team-board"),o=!!l||p.has("subagent-board")||!t;if(H(),E("prom-bot"),l="",m="",window.promBotActiveAgentId="",window.promBotActiveTeamId="",P(),T(),o)try{window.closeSubagentDetail?.()}catch(n){console.warn("[Prom Bot] Could not close subagent detail:",n)}if(t)try{window.closeTeamBoard?.()}catch(n){console.warn("[Prom Bot] Could not close team board:",n)}e||h(!1)}async function le(){return S||(S=import("./TeamsPage-AXLOKMMT.js").then(()=>{if(typeof window.openTeamBoard!="function"||typeof window.switchTeamTab!="function")throw new Error("Team chat runtime is unavailable.");return!0}).catch(e=>{throw S=null,e})),S}async function X(e){let t=String(e||"").trim();if(t){s||h(!0);try{window.closePromBotGroup?.(),l&&C({keepMode:!0}),await le(),typeof window.setMode=="function"&&window.setMode("chat"),await window.refreshTeams?.();let n=(Array.isArray(window.teamsData)?window.teamsData:[]).find(r=>String(r?.id||"")===t);if(!n)throw new Error("That team no longer exists.");await window.openTeamBoard(t),await window.switchTeamTab("chat",t),J("team-board","team"),m=t,window.promBotActiveTeamId=t,R(n.name||t,"Prom Bot \xB7 Team chat","prom-bot"),P(),T(),$({force:!0}),requestAnimationFrame(()=>document.getElementById("team-chat-input")?.focus({preventScroll:!0}))}catch(o){console.error("[Prom Bot] Could not open team chat:",o),H(),E("prom-bot"),m="",window.promBotActiveTeamId="",T(),typeof window.showToast=="function"&&window.showToast("Prom Bot",o?.message||"Could not open team chat.","error")}}}async function Z(e){let t=String(e||"").trim();if(t){s||h(!0);try{window.closePromBotGroup?.(),m&&C({keepMode:!0}),await re(),g.some(n=>String(n?.id||"")===t)||await D({force:!0}),typeof window.setMode=="function"&&window.setMode("chat"),await window.refreshSubagents?.(),await window.openSubagentDetail(t),await window.switchSubagentTab("chat",t),de(),l=t,window.promBotActiveAgentId=t;let o=g.find(n=>String(n?.id||"")===t);R(o?.name||t,"Prom Bot \xB7 Subagent chat","prom-bot"),P(),requestAnimationFrame(()=>document.getElementById("subagent-chat-input")?.focus({preventScroll:!0}))}catch(o){console.error("[Prom Bot] Could not open subagent chat:",o),ce(),E("prom-bot"),l="",window.promBotActiveAgentId="",P(),typeof window.showToast=="function"&&window.showToast("Prom Bot",o?.message||"Could not open subagent chat.","error")}}}function me(){let e=Y(),t=Q();e&&(e.classList.toggle("prom-bot-active",s),e.setAttribute("aria-pressed",String(s)),e.setAttribute("aria-label",s?"Turn off Prom Bot mode":"Turn on Prom Bot mode"),e.title=s?"Prom Bot \xB7 On":"Prom Bot"),t&&(t.hidden=!s)}function h(e,{persist:t=!0}={}){return s=e===!0,window.promBotMode=s,t&&j(G,s),me(),s?(D(),$()):(window.closePromBotGroup?.(),C({keepMode:!0})),s}function ue(){if(V)return;let e=document.getElementById("sidebar");e&&(V=!0,e.addEventListener("click",t=>{if(!l&&!m)return;let o=t.target instanceof Element?t.target:null;o&&(o.closest(`#${B}`)||o.closest(`#${x}`)||o.closest(".sidebar-header-btn")||C({keepMode:!0}))},!0))}function q(){te(),Y(),Q(),ue(),document.addEventListener("input",e=>{e.target instanceof Element&&e.target.id==="prom-bot-roster-search"&&T()}),h(U(G,!1),{persist:!1})}window.setPromBotMode=h;window.togglePromBotMode=()=>h(!s);window.refreshPromBotAgents=D;window.openPromBotAgent=Z;window.refreshPromBotTeams=$;window.openPromBotTeam=X;window.closePromBotChat=C;window.promBotActiveTeamId="";window.setPromChatTitleOverride=R;window.clearPromChatTitleOverride=E;window.promBotActiveAgentId="";window.promBotMode=!1;document.readyState==="loading"?document.addEventListener("DOMContentLoaded",q,{once:!0}):q();
