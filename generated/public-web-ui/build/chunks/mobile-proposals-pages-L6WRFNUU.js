import{a as M,b as P,c as A,d as L,e as T,f as q,g as $}from"./chunk-XJKIJKXY.js";import"./chunk-LXT2XHWB.js";import{L as k}from"./chunk-OYW75T5A.js";import"./chunk-J5HXEABW.js";import{a as c}from"./chunk-YAWTYVQR.js";import{F as n,G as s,M as g,N as w}from"./chunk-EYKHKLD7.js";import"./chunk-MIGHGEKK.js";import"./chunk-TWNTE2K7.js";import"./chunk-T6OBFSNS.js";import"./chunk-MGDZYTA3.js";import"./chunk-CUCDWB4G.js";import"./chunk-JHC32INK.js";import{Aa as h,xa as E,ya as S,za as f}from"./chunk-43NFT3AG.js";import"./chunk-YMT6MSCC.js";import"./chunk-7DFOTCAZ.js";import"./chunk-XREJVKMI.js";import"./chunk-4WCZDNBS.js";import"./chunk-3EPMIDRU.js";import"./chunk-GBLBNUG2.js";import"./chunk-IPNQ4FF4.js";import"./chunk-36KIJFV6.js";import"./chunk-JF4LWGNM.js";import"./chunk-EPSJJCWL.js";async function C(r,{proposalId:b="",navigate:l}){if(b)return I(r,{proposalId:b,navigate:l});let d=`<span class="pm-spacer"></span><select id="pm-proposals-filter" class="pm-select"><option value="pending">Pending</option><option value="executing">In progress</option><option value="approved">Approved</option><option value="denied">Denied</option><option value="executed">Executed</option><option value="all">All</option></select><button class="pm-icon-btn" id="pm-proposals-refresh" aria-label="Refresh" style="background:var(--pm-surface);border:1px solid var(--pm-border);">${n.refresh}</button>`;r.innerHTML=`
    ${g({title:"Proposals",online:!0,extras:d,hideTitle:!0,hideBrand:!0})}
    <div class="pm-body pm-proposals-page" id="pm-proposals-body">${$()}</div>
  `,w(r,{});let t=r.querySelector("#pm-proposals-body"),a=r.querySelector("#pm-proposals-filter"),m=[],u=()=>{let o=m.length?m.map(e=>{let y=String(e.status||"").toLowerCase()==="pending";return`<article class="pm-card pm-proposal-card" data-proposal-id="${s(e.id)}">
        <div class="pm-proposal-head">
          <span class="pm-more-icon">${n.doc}</span>
          <div>
            <strong>${s(e.title||"Untitled proposal")}</strong>
            <div class="pm-proposal-badges">${P(e)}${A(e)}<span>${s(e.type||"proposal")}</span></div>
          </div>
          <button class="pm-icon-btn" data-open-proposal="${s(e.id)}" aria-label="Open proposal">${n.dots}</button>
        </div>
        <p>${s(e.summary||"")}</p>
        ${L(e)}
        ${e.estimatedImpact?`<p class="pm-proposal-impact">Impact: ${s(e.estimatedImpact)}</p>`:""}
        <div class="pm-more-meta-row"><span>Submitted: ${s(M(e.createdAt))}</span><span>${s(e.executorAgentId||"main")}</span></div>
        <div class="pm-proposal-actions">
          ${y?`<button class="pm-btn success pm-proposal-action-btn" data-approve-proposal="${s(e.id)}">Approve</button><button class="pm-btn danger pm-proposal-action-btn" data-deny-proposal="${s(e.id)}">Deny</button>`:""}
          <button class="pm-btn ghost" data-open-proposal="${s(e.id)}">View details & plan</button>
        </div>
      </article>`}).join(""):"";t.innerHTML=o||`<div class="pm-empty"><div class="pm-empty-icon">${n.doc}</div><h2>No proposals here</h2><p>Agent-generated proposals will appear here when they need review.</p></div>`,H()},i=async()=>{try{t.innerHTML=$();let o=a?.value||"pending";m=await E(o),u()}catch(o){t.innerHTML=`<div class="pm-empty"><div class="pm-empty-icon">${n.doc}</div><h2>Could not load proposals</h2><p>${s(o.message||"")}</p></div>`}},p=async(o,e,y)=>{if(o){y.disabled=!0;try{let v=e==="approve"?await f(o):await h(o);if(!v||v.success===!1)throw new Error(v?.error||`${e} failed`);c(e==="approve"?"Proposal approved":"Proposal denied","success"),await i()}catch(v){c(v.message||"Action failed","error")}finally{y.disabled=!1}}};function H(){t.querySelectorAll("[data-open-proposal]").forEach(o=>o.addEventListener("click",e=>{e.stopPropagation(),l(`#mobile/proposals/${encodeURIComponent(o.getAttribute("data-open-proposal")||"")}`)})),t.querySelectorAll("[data-proposal-id]").forEach(o=>o.addEventListener("click",e=>{e.target.closest("button")||l(`#mobile/proposals/${encodeURIComponent(o.getAttribute("data-proposal-id")||"")}`)})),t.querySelectorAll("[data-approve-proposal]").forEach(o=>o.addEventListener("click",e=>{e.stopPropagation(),p(o.getAttribute("data-approve-proposal"),"approve",o)})),t.querySelectorAll("[data-deny-proposal]").forEach(o=>o.addEventListener("click",e=>{e.stopPropagation(),p(o.getAttribute("data-deny-proposal"),"deny",o)})),k(t)}a?.addEventListener("change",i),r.querySelector("#pm-proposals-refresh")?.addEventListener("click",i),await i()}async function I(r,{proposalId:b,navigate:l}){r.innerHTML=`
    ${g({title:"Proposal Review",leftIcon:"back",onBack:()=>l("#mobile/proposals"),online:!1,hideTitle:!0,hideBrand:!0})}
    <div class="pm-body pm-proposals-page pm-proposal-review-body" id="pm-proposal-review-body">${$()}</div>
  `,w(r,{onBack:()=>l("#mobile/proposals")});let d=r.querySelector("#pm-proposal-review-body");try{let t=await S(b),a=t?.proposal||t,m=String(a?.status||"").toLowerCase()==="pending";d.innerHTML=`
      <section class="pm-card pm-proposal-review-card">
        <div class="pm-proposal-head">
          <span class="pm-more-icon">${n.doc}</span>
          <div>
            <strong>${s(a.title||"Untitled proposal")}</strong>
            <div class="pm-proposal-badges">${P(a)}${A(a)}<span>${s(a.type||"proposal")}</span></div>
          </div>
        </div>
        <p>${s(a.summary||"")}</p>
        ${L(a,4)}
        ${a.estimatedImpact?`<p class="pm-proposal-impact">Impact: ${s(a.estimatedImpact)}</p>`:""}
      </section>
      ${T(a)}
      ${q(a)}
      <div class="pm-proposal-review-actions">
        ${m?'<button class="pm-btn success" id="pm-proposal-approve">Approve</button><button class="pm-btn danger" id="pm-proposal-deny">Deny</button>':'<button class="pm-btn ghost" id="pm-proposal-back">Back to proposals</button>'}
      </div>
    `,d.querySelector("#pm-proposal-back")?.addEventListener("click",()=>l("#mobile/proposals")),d.querySelector("#pm-proposal-approve")?.addEventListener("click",async u=>{let i=u.currentTarget;i.disabled=!0;try{let p=await f(a.id);if(!p||p.success===!1)throw new Error(p?.error||"Approve failed");c("Proposal approved","success"),l("#mobile/proposals")}catch(p){c(p.message||"Approve failed","error"),i.disabled=!1}}),d.querySelector("#pm-proposal-deny")?.addEventListener("click",async u=>{let i=u.currentTarget;i.disabled=!0;try{let p=await h(a.id);if(!p||p.success===!1)throw new Error(p?.error||"Deny failed");c("Proposal denied","success"),l("#mobile/proposals")}catch(p){c(p.message||"Deny failed","error"),i.disabled=!1}})}catch(t){d.innerHTML=`<div class="pm-empty"><div class="pm-empty-icon">${n.doc}</div><h2>Could not load proposal</h2><p>${s(t.message||"")}</p></div>`}}export{C as renderProposalsPage};
